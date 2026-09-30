// LLM_in_PowerPoint 任务窗格逻辑：
// 在幻灯片里选中文字 / 文本框 / 表格 / 整页 → ＋ 添加为目标（按「页 ID + 形状 ID + 字符位置」锚定，
// 写回前核对原文，对不上就不写）→ 下指令 → 本机服务流式回复 → 每个目标一张 diff 预览卡 →
// ✅ 应用（只改动变化的文字：没改的字保留原有字体、颜色、加粗和项目符号层级）→ ↩ 撤销。
// UI 与 LLM_in_Word 0.7.2 一致；文档操作从 Word API 换成 PowerPoint API。
(() => {
  'use strict';

  const I18N = window.PptI18n;
  const tr = I18N.t;
  const uiText = I18N.known;

  const API = ''; // 面板和服务同源，相对路径即可

  // 模型列表：[候选值, 显示名]。别名由 CLI 解析成当下最新版本。
  const MODELS = {
    claude: [['sonnet', 'Sonnet · 自动版本'], ['opus', 'Opus · 自动版本'], ['haiku', 'Haiku · 自动版本']],
    codex: [['(default)', '默认 · 跟随本机配置']],
  };
  const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
  const EFFORT_LABELS = { none: '不额外思考', ultra: '最深入', minimal: '最少', low: '轻快', medium: '均衡', high: '深入', xhigh: '更深入', max: '最高' };
  let modelEfforts = { codex: {} };
  let modelDetails = {};
  const observedModels = { claude: {}, codex: {} };

  // 快捷指令（点一下填进输入框，可再编辑）。改写和问答各一组。
  const PRESETS = {
    edit: [
      ['润色', '润色这些文字，使表达更清晰、更通顺；保持原意、事实和数据不变'],
      ['精简要点', '把这些要点压缩得更短、更有力，每条尽量一行；保留关键数据和原有条目数'],
      ['修语法', '修正错别字、语法和标点问题，尽量少改动措辞'],
      ['统一句式', '统一这些要点的句式和措辞（比如都用动词开头），语气与全篇一致'],
      ['提炼标题', '把标题改得更短、更有力，直接点出这一页的结论'],
      ['译成英文', '把这些文字翻译成地道的英文，语域与原文一致'],
    ],
    ask: [
      ['写讲稿', '为选中的幻灯片（没有选中就为整份演示文稿）逐页写口语化的演讲稿，每页 3–5 句，可直接放进演讲者备注'],
      ['查一致性', '检查整份演示文稿里的术语、数字、单位和大小写是否前后一致，按页码列出问题和建议'],
      ['找错别字', '找出整份演示文稿里的错别字、语法和标点问题，按页码列出（原文 → 建议）'],
      ['总结全篇', '用不超过 5 条要点总结这份演示文稿的核心信息'],
    ],
  };

  const SOFT_SEL_LIMIT = 30000;   // 目标合计超过这个字符数给出警告（还是允许发）
  const CTX_CAP = 110000;         // 随请求附带的全文上限（超过就保留目标所在页及周边）
  const LONG_SESSION_MSGS = 14;   // 消息数达到这个阈值提醒开新会话
  const MAX_TARGETS = 16;         // 目标数量上限（选中整页时每个文本框各算一处）
  const SNAPSHOT_WIDTH = 1280;    // 当前页截图宽度（像素）

  // 附件限制
  const TEXT_EXTS = ['txt', 'md', 'csv'];
  const BIN_EXTS = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
  const TEXT_CAP = 50000;
  const BIN_CAP = 10 * 1024 * 1024;
  const MAX_FILES = 8;
  const TOTAL_BIN_CAP = 25 * 1024 * 1024;

  // 形状角色：给模型的上下文用中文标签（与提示词一致），界面上按语言翻译。
  const ROLE_ZH = { title: '标题', subtitle: '副标题', body: '正文', textbox: '文本框', shape: '形状', table: '表格', footer: '页脚' };
  const FOOTER_PH = ['Date', 'SlideNumber', 'Footer', 'Header'];
  const SHAPE_PROPS = 'items/id,items/name,items/type,items/left,items/top';

  // ---------- 运行状态 ----------
  const state = {
    cfg: { backend: 'claude', model_claude: 'sonnet', model_codex: '(default)', effort: 'medium', mode: 'edit' },
    // [{ id, slideId, shapeId, kind:'text'|'table', start, length, text, values, whole, role, slideNo, ord }]
    // 位置 = 页 ID + 形状 ID + 字符区间；每次读幻灯片都会按原文重新核对和定位。
    targets: [],
    docChars: 0,       // 最近一次读取的全篇文字字符数
    slideCount: 0,
    messages: [],      // { role: 'user'|'assistant', content, via? }
    streaming: false,
    aborter: null,
    reader: null,        // 流式读取器：停止时必须 cancel 它（Office 的 WebKit 里光 abort 会挂死 read()）
    curReq: 0,           // 当前请求编号：强制恢复后，旧请求迟到的输出直接丢弃
    stopRequested: false,
    serverOk: null,
    pptReady: false,
    api: { v18: false, v19: false, v110: false }, // PowerPointApi 1.8（表格/分组/截图）、1.9（增删表格行）、1.10（安全读文本框）
    longNoteShown: false,
    attachments: [],   // { id, name, kind:'text'|'binary', mime, text?, b64?, size, truncated }
    cliSession: { claude: null, codex: null }, // CLI 会话 id：有值=后续轮"续写+服务端缓存"，新会话清空
    cliContext: { claude: null, codex: null },
    health: null,
    sentAtts: { claude: [], codex: [] },       // 已进入对应 CLI 会话的附件 id（续轮只发新增附件）
  };
  let attSeq = 0;
  let tgtSeq = 0;
  let docKey = 'untitled';

  // ---------- 小工具 ----------
  const $ = (s) => document.querySelector(s);
  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  // PowerPoint 的段落符是 \r、段内换行是 \v。逐个换成 \n（长度不变，字符位置和 PowerPoint 一一对应）。
  // \u2028/\u2029（Unicode 行/段分隔符）按字符码构造，源码里不放这两个会被当成换行的字符
  const NL_RE = new RegExp('[\\r\\v' + String.fromCharCode(0x2028, 0x2029) + ']', 'g');
  function normNL(s) {
    return String(s == null ? '' : s).replace(NL_RE, '\n');
  }
  // 写回时换行默认作为新段落（\r）：新段落继承所在段落的项目符号和层级。
  // 被替换的原文里有换行时按顺序沿用原来的类型——段内换行（Shift+Enter，\v）改写后仍是段内换行，
  // 不会凭空多出一个要点。
  function toPptText(s, replaced = '') {
    const pool = String(replaced).match(/[\r\v]/g) || [];
    let k = 0;
    return String(s).replace(/\r\n?/g, '\n').replace(/\n/g, () => (k < pool.length ? pool[k++] : '\r'));
  }
  function fmtSize(n) {
    if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + 'M';
    if (n >= 1024) return Math.round(n / 1024) + 'k';
    return n + 'B';
  }
  function fmtTime(ts) {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  async function copyText(text, btn) {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch {}
    if (!ok) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        ta.remove();
      } catch {}
    }
    if (btn) {
      const old = btn.textContent;
      btn.textContent = ok ? tr('✓ 已复制') : tr('✗ 失败');
      setTimeout(() => { btn.textContent = uiText(old); }, 1500);
    }
    return ok;
  }

  // 极简 Markdown 渲染（先转义再套格式，防 XSS；围栏代码块渲成 <pre>）
  function renderMarkdown(src) {
    if (!src) return '';
    const codeBlocks = [];
    let s = src.replace(/```(\w*)[^\S\n]*\n?([\s\S]*?)```/g, (_, _lang, code) => {
      const i = codeBlocks.length;
      codeBlocks.push(`<pre class="pre"><code>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`);
      return ` CB${i} `;
    });
    s = escapeHtml(s);
    s = s.replace(/`([^`\n]+)`/g, (_, c) => `<code class="code">${c}</code>`);
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    const lines = s.split('\n');
    const out = [];
    let listType = null;
    const closeList = () => { if (listType) { out.push(`</${listType}>`); listType = null; } };
    // GFM 表格：表头行 + 分隔线 + 若干数据行（单元格内容此前已转义并处理过行内格式）
    const cells = (row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    const isSep = (row) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(row || '');
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      if (/^\s*\|.*\|\s*$/.test(line) && isSep(lines[li + 1])) {
        closeList();
        const head = cells(line);
        const body = [];
        li += 2;
        while (li < lines.length && /^\s*\|.*\|\s*$/.test(lines[li])) body.push(cells(lines[li++]));
        li--;
        out.push('<table class="md-table"><thead><tr>' + head.map((c) => `<th>${c}</th>`).join('') + '</tr></thead><tbody>'
          + body.map((r) => '<tr>' + head.map((_, i) => `<td>${r[i] ?? ''}</td>`).join('') + '</tr>').join('') + '</tbody></table>');
        continue;
      }
      let m;
      if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
        closeList();
        const lvl = Math.min(6, m[1].length + 2);
        out.push(`<h${lvl}>${m[2]}</h${lvl}>`);
      } else if ((m = line.match(/^\s*>\s?(.*)$/))) {
        closeList();
        out.push(`<blockquote>${m[1]}</blockquote>`);
      } else if ((m = line.match(/^\s*[-*+]\s+(.*)$/))) {
        if (listType !== 'ul') { closeList(); out.push('<ul>'); listType = 'ul'; }
        out.push(`<li>${m[1]}</li>`);
      } else if ((m = line.match(/^\s*\d+\.\s+(.*)$/))) {
        if (listType !== 'ol') { closeList(); out.push('<ol>'); listType = 'ol'; }
        out.push(`<li>${m[1]}</li>`);
      } else if (line.trim() === '') {
        closeList();
        out.push('');
      } else if (line.startsWith(' CB')) {
        closeList();
        out.push(line);
      } else {
        closeList();
        out.push(`<p>${line}</p>`);
      }
    }
    closeList();
    s = out.join('\n');
    s = s.replace(/ CB(\d+) /g, (_, i) => codeBlocks[Number(i)] || '');
    return s;
  }

  // ---------- 围栏解析：从回复里抠出各目标的替换文本 ----------
  // 返回 [{ k, code, idx, len }]（k=目标编号，idx/len 用于从说明文字里剔除围栏）；解析不出返回 null。
  // 单目标：沿用"最长的 text 围栏"；多目标：认围栏前一行的【目标k】标签，
  // 全都没标签时仅当围栏数与目标数一致才按顺序对应（数目不一致宁可不猜）。
  function parseReplacements(raw, n) {
    const fences = [];
    const re = /```([a-zA-Z]*)[^\S\n]*\n([\s\S]*?)```/g;
    let m;
    while ((m = re.exec(raw))) {
      const before = raw.slice(Math.max(0, m.index - 80), m.index);
      const lm = before.match(/【\s*目标\s*(\d+)\s*】[^\S\n]*\n?[^\S\n]*$/);
      fences.push({
        lang: (m[1] || '').toLowerCase(),
        code: m[2].replace(/\n$/, ''),
        label: lm ? Number(lm[1]) : null,
        idx: lm ? m.index - lm[0].length : m.index,
        len: (lm ? lm[0].length : 0) + m[0].length,
      });
    }
    if (!fences.length) return null;
    if (n <= 1) {
      const textish = fences.filter((b) => ['text', 'plain', 'plaintext', 'table', 'markdown', ''].includes(b.lang));
      const pool = textish.length ? textish : fences;
      const pick = pool.reduce((a, b) => (b.code.length >= a.code.length ? b : a));
      return [{ k: 1, code: pick.code, lang: pick.lang, idx: pick.idx, len: pick.len }];
    }
    const byK = new Map();
    const labeled = fences.filter((f) => f.label != null && f.label >= 1 && f.label <= n);
    if (labeled.length) {
      for (const f of labeled) byK.set(f.label, f); // 同号重复取最后一个
    } else if (fences.length === n) {
      fences.forEach((f, i) => byK.set(i + 1, f));
    } else {
      return null;
    }
    return [...byK.entries()].sort((a, b) => a[0] - b[0]).map(([k, f]) => ({ k, code: f.code, lang: f.lang, idx: f.idx, len: f.len }));
  }
  // 把已识别的围栏（含标签行）从回复里剔掉，剩下的当说明文字渲染
  function stripFences(raw, reps) {
    let out = raw;
    for (const r of [...reps].sort((a, b) => b.idx - a.idx)) {
      out = out.slice(0, r.idx) + out.slice(r.idx + r.len);
    }
    return out.trim();
  }

  // ---------- 逐字 diff（LCS）：中文按单字切、英文按词切，否则整段中文会被当成一个词 ----------
  // 返回操作序列 [['='|'-'|'+', 文本], ...]，diff 展示和"只改变化的地方"共用。
  // 先掐掉公共前后缀再对中段做 LCS（长文也能细粒度对比）；中段规模仍超限就退化成
  // "整段删+整段加"——粗但正确。
  function tokDiff(s) {
    return s.match(/[㐀-鿿豈-﫿　-〿＀-￯]|[A-Za-z0-9_]+|\s+|[^\s]/g) || [];
  }
  function diffOps(aStr, bStr) {
    let p = 0;
    const maxP = Math.min(aStr.length, bStr.length);
    while (p < maxP && aStr.charCodeAt(p) === bStr.charCodeAt(p)) p++;
    let sfx = 0;
    while (sfx < maxP - p && aStr.charCodeAt(aStr.length - 1 - sfx) === bStr.charCodeAt(bStr.length - 1 - sfx)) sfx++;
    // 公共前后缀不在英文单词中间断开（否则 quarter→Quarter 会显示成 q|uarter），退到词边界
    const W = /[A-Za-z0-9_]/;
    while (p > 0 && W.test(aStr[p - 1]) && (W.test(aStr[p] || '') || W.test(bStr[p] || ''))) p--;
    while (sfx > 0 && W.test(aStr[aStr.length - sfx]) && (W.test(aStr[aStr.length - sfx - 1] || '') || W.test(bStr[bStr.length - sfx - 1] || ''))) sfx--;
    const am = aStr.slice(p, aStr.length - sfx), bm = bStr.slice(p, bStr.length - sfx);
    const ops = [];
    const push = (t, s) => {
      if (!s) return;
      if (ops.length && ops[ops.length - 1][0] === t) ops[ops.length - 1][1] += s;
      else ops.push([t, s]);
    };
    push('=', aStr.slice(0, p));
    const a = tokDiff(am), b = tokDiff(bm);
    const n = a.length, m = b.length;
    if (n * m > 2000000) {
      push('-', am);
      push('+', bm);
    } else if (n || m) {
      const cols = m + 1;
      const dp = new Uint32Array((n + 1) * cols);
      for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
          dp[i * cols + j] = a[i] === b[j] ? dp[(i + 1) * cols + j + 1] + 1 : Math.max(dp[(i + 1) * cols + j], dp[i * cols + j + 1]);
        }
      }
      let i = 0, j = 0;
      while (i < n && j < m) {
        if (a[i] === b[j]) { push('=', a[i]); i++; j++; }
        else if (dp[(i + 1) * cols + j] >= dp[i * cols + j + 1]) { push('-', a[i]); i++; }
        else { push('+', b[j]); j++; }
      }
      while (i < n) push('-', a[i++]);
      while (j < m) push('+', b[j++]);
    }
    if (sfx) push('=', aStr.slice(aStr.length - sfx));
    return ops;
  }
  function diffHtml(aStr, bStr) {
    return diffOps(aStr, bStr)
      .map(([t, s]) => {
        const e = escapeHtml(s);
        if (t === '-') return `<del>${e}</del>`;
        if (t === '+') return `<ins>${e}</ins>`;
        return e;
      })
      .join('');
  }

  // ---------- 只改变化的地方：把 diff 变成一串"在第 pos 个字处删 del 个字、插入 ins" ----------
  // PowerPoint 写入规则（实测）：替换的文字沿用被替换的第一个字的格式；纯插入沿用左边那个字的格式；
  // 插入 \r 会新起一段，继承所在段落的项目符号和层级。所以没改动的字格式原样不动。
  // 从后往前写，前面的位置不受影响。
  function planEdits(a, b) {
    const edits = [];
    let pos = 0;
    for (const [t, s] of diffOps(a, b)) {
      if (t === '=') { pos += s.length; continue; }
      const last = edits[edits.length - 1];
      const joined = last && last.pos + last.del === pos;
      if (t === '-') {
        if (joined) last.del += s.length;
        else edits.push({ pos, del: s.length, ins: '' });
        pos += s.length;
      } else if (joined) {
        last.ins += s;
      } else {
        edits.push({ pos, del: 0, ins: s });
      }
    }
    return edits;
  }
  // 纯字符串上模拟一遍（单测和写入后的校验用）
  function applyEditsToString(s, edits, map = (x) => x) {
    let out = s;
    for (let i = edits.length - 1; i >= 0; i--) {
      const e = edits[i];
      out = out.slice(0, e.pos) + map(e.ins) + out.slice(e.pos + e.del);
    }
    return out;
  }
  // 模型输出的整理：去掉多余的末尾空行；原文没有项目符号字符、而模型每行都加了 "- " "• " 之类，
  // 说明它在模仿 Markdown 列表——PowerPoint 的项目符号是段落格式，这些字符要去掉，否则会重复出现。
  const BULLET_RE = /^[ \t]*[-*•·▪◦●■►➢][ \t]+/;
  function cleanReplacement(newText, oldText) {
    let s = String(newText == null ? '' : newText).replace(/\r\n?/g, '\n');
    const old = normNL(oldText);
    if (!/\n$/.test(old)) s = s.replace(/\n+$/, '');
    const lines = s.split('\n');
    const filled = lines.filter((l) => l.trim());
    if (filled.length && !old.split('\n').some((l) => BULLET_RE.test(l)) && filled.every((l) => BULLET_RE.test(l))) {
      s = lines.map((l) => l.replace(BULLET_RE, '')).join('\n');
    }
    return s;
  }

  // ---------- 配置 & 会话持久化（localStorage，按演示文稿分开）----------
  function loadCfg() {
    try {
      const saved = JSON.parse(localStorage.getItem('lp:cfg') || '{}');
      Object.assign(state.cfg, Object.fromEntries(Object.entries(saved).filter(([, v]) => v != null)));
    } catch {}
    // 上次刷新到的模型列表（没刷新过就用代码里的兜底列表）
    try {
      const m = JSON.parse(localStorage.getItem('lp:models') || 'null');
      if (m && Array.isArray(m.claude) && m.claude.length) MODELS.claude = m.claude;
      if (m && Array.isArray(m.codex) && m.codex.length) MODELS.codex = m.codex;
      if (m?.efforts) modelEfforts = m.efforts;
      if (m?.details) modelDetails = m.details;
    } catch {}
    if (!['claude', 'codex'].includes(state.cfg.backend)) state.cfg.backend = 'claude';
  }
  function saveCfg() {
    try { localStorage.setItem('lp:cfg', JSON.stringify(state.cfg)); } catch {}
  }
  const HIST_KEY = () => 'lp:hist:' + docKey;
  const ARCH_KEY = () => 'lp:arch:' + docKey;
  const TGT_KEY = () => 'lp:targets:' + docKey;
  function trimMsgs(msgs) {
    return msgs.slice(-40).map((m) => ({
      role: m.role,
      content: m.content.length > 20000 ? m.content.slice(0, 20000) + tr('…（存档截断）') : m.content,
      via: m.via, failed: !!m.failed,
    }));
  }
  function loadHistory() {
    try {
      const h = JSON.parse(localStorage.getItem(HIST_KEY()) || 'null');
      if (h && Array.isArray(h.messages)) state.messages = h.messages;
      if (h && h.cliSession) state.cliSession = { claude: null, codex: null, ...h.cliSession };
      if (h && h.cliContext) state.cliContext = { claude: null, codex: null, ...h.cliContext };
      if (h && h.sentAtts) state.sentAtts = { claude: [], codex: [], ...h.sentAtts };
    } catch {}
  }
  function saveHistory() {
    try {
      localStorage.setItem(HIST_KEY(), JSON.stringify({
        messages: trimMsgs(state.messages), cliSession: state.cliSession, sentAtts: state.sentAtts, cliContext: state.cliContext, ts: Date.now(),
      }));
    } catch {}
  }
  function clearHistory() {
    try { localStorage.removeItem(HIST_KEY()); } catch {}
  }
  function getArchive() {
    try {
      const l = JSON.parse(localStorage.getItem(ARCH_KEY()) || '[]');
      return Array.isArray(l) ? l : [];
    } catch { return []; }
  }
  function setArchive(list) {
    try { localStorage.setItem(ARCH_KEY(), JSON.stringify(list.slice(0, 10))); } catch {}
  }
  // 目标只存位置和原文快照（不改动演示文稿本身）；下次打开面板时按原文核对后恢复。
  function saveTargets() {
    try {
      localStorage.setItem(TGT_KEY(), JSON.stringify(state.targets.map((t) => ({
        slideId: t.slideId, shapeId: t.shapeId, kind: t.kind, start: t.start, length: t.length,
        text: t.text.length > 60000 ? '' : t.text, whole: t.whole, role: t.role, slideNo: t.slideNo, ord: t.ord,
      })).filter((t) => t.text)));
    } catch {}
  }
  function loadSavedTargets() {
    try {
      const l = JSON.parse(localStorage.getItem(TGT_KEY()) || '[]');
      return Array.isArray(l) ? l.filter((t) => t && t.slideId && t.shapeId && typeof t.text === 'string') : [];
    } catch { return []; }
  }
  function sessionEntry(messages) {
    const firstUser = messages.find((m) => m.role === 'user');
    return {
      ts: Date.now(),
      preview: (firstUser?.content || '').slice(0, 60),
      messages: trimMsgs(messages),
      // CLI 会话 id 跟着归档走：切回历史会话时能继续续写
      cliSession: { ...state.cliSession },
      cliContext: { ...state.cliContext },
      sentAtts: { claude: [...(state.sentAtts.claude || [])], codex: [...(state.sentAtts.codex || [])] },
    };
  }
  function sessionMarkdown(messages) {
    const lines = [`# ${docTitle() || tr('PowerPoint 演示文稿')}`, '', tr`> 导出自 LLM_in_PowerPoint · ${new Date().toLocaleString()}`, ''];
    for (const m of messages) {
      if (m.role === 'user') lines.push(tr('## 🙋 用户'), '', m.content, '');
      else lines.push(tr`## 🤖 助手${m.via ? `（${[m.via.backend, m.via.model, 'effort ' + m.via.effort].filter(Boolean).join(' · ')}）` : ''}`, '', m.content, '');
    }
    return lines.join('\n');
  }
  function docTitle() {
    try {
      const u = Office.context.document.url || '';
      return decodeURIComponent(u.split(/[\\/]/).pop() || '') || '';
    } catch { return ''; }
  }

  // ---------- Office / PowerPoint 集成 ----------
  function pptRun(fn) {
    return PowerPoint.run(fn).catch((e) => {
      let msg = String(e?.message || e);
      if (e && e.code) msg = `${e.code}: ${msg}`;
      return { ok: false, error: msg };
    });
  }
  function roleOf(type, placeholderType) {
    if (type === 'Table') return 'table';
    if (placeholderType) {
      if (placeholderType === 'Subtitle') return 'subtitle';
      if (/Title$/.test(placeholderType)) return 'title';   // Title / CenterTitle / VerticalTitle
      if (FOOTER_PH.includes(placeholderType)) return 'footer';
      return 'body';
    }
    if (type === 'Placeholder') return 'body';
    if (type === 'TextBox') return 'textbox';
    return 'shape';
  }
  // 阅读顺序：从上到下、同一行从左到右（上下差 8pt 以内算同一行）
  function sortShapes(list) {
    return [...list].sort((a, b) => (Math.abs(a.top - b.top) > 8 ? a.top - b.top : a.left - b.left));
  }
  function roleLabel(t) {
    return t.kind === 'table' ? tr('表格') : tr(ROLE_ZH[t.role] || '文字');
  }
  function whereOf(t) {
    return tr`第 ${t.slideNo || '?'} 页 · ${roleLabel(t)}`;
  }

  // 读整份演示文稿：每页里有文字的文本框/占位符/形状（含分组里的）和表格，按阅读顺序排好。
  // 返回 [{ id, no, shapes: [{ id, type, role, kind, text, values, top, left, group }] }]
  async function readDeck(ctx) {
    const slides = ctx.presentation.slides;
    slides.load('items/id');
    await ctx.sync();
    const lists = slides.items.map((s) => { const c = s.shapes; c.load(SHAPE_PROPS); return c; });
    await ctx.sync();
    const entries = [];
    slides.items.forEach((_, i) => lists[i].items.forEach((sh) => entries.push({ si: i, sh, group: null })));
    if (state.api.v18) {
      // 分组逐层展开（最多 4 层）；group 记最外层分组的 ID，选中整个分组时用
      let groups = entries.filter((e) => e.sh.type === 'Group');
      for (let depth = 0; groups.length && depth < 4; depth++) {
        const kids = groups.map((g) => { const c = g.sh.group.shapes; c.load(SHAPE_PROPS); return [g, c]; });
        await ctx.sync();
        groups = [];
        for (const [g, c] of kids) {
          for (const sh of c.items) {
            const e = { si: g.si, sh, group: g.group || g.sh.id };
            entries.push(e);
            if (sh.type === 'Group') groups.push(e);
          }
        }
      }
    }
    for (const e of entries) {
      const type = e.sh.type;
      if (type === 'Group') continue;
      if (type === 'Table') {
        if (state.api.v18) { e.tbl = e.sh.getTable(); e.tbl.load('values'); }
        continue;
      }
      if (type === 'Placeholder' && state.api.v18) { e.ph = e.sh.placeholderFormat; e.ph.load('type'); }
      if (state.api.v110) { e.tf = e.sh.getTextFrameOrNullObject(); e.tf.load('hasText'); }
    }
    await ctx.sync();
    if (!state.api.v110) {
      // 旧版没有 getTextFrameOrNullObject：逐个试探，图片之类没有文本框的形状跳过
      for (const e of entries) {
        if (!['GeometricShape', 'TextBox', 'Placeholder', 'Callout', 'Freeform'].includes(e.sh.type)) continue;
        try {
          const tf = e.sh.textFrame;
          tf.load('hasText');
          await ctx.sync();
          e.tf = tf;
        } catch { e.tf = null; }
      }
    }
    for (const e of entries) {
      if (e.tf && !e.tf.isNullObject && e.tf.hasText) { e.tr = e.tf.textRange; e.tr.load('text'); }
    }
    await ctx.sync();
    return slides.items.map((s, i) => {
      const shapes = sortShapes(entries.filter((e) => e.si === i && (e.tr || e.tbl)).map((e) => {
        const values = e.tbl ? (e.tbl.values || []).map((r) => r.map((c) => String(c == null ? '' : c))) : null;
        return {
          id: e.sh.id, type: e.sh.type, top: e.sh.top || 0, left: e.sh.left || 0, group: e.group,
          role: roleOf(e.sh.type, e.ph && e.ph.type),
          kind: e.tbl ? 'table' : 'text',
          text: e.tbl ? TableUtils.toMarkdown(values) : normNL(e.tr.text),
          values,
        };
      }));
      shapes.forEach((x, k) => { x.ord = k; });
      return { id: s.id, no: i + 1, shapes };
    });
  }

  // 按原文重新定位一个文本目标。整框目标跟随文本框当前的全部文字；
  // 部分目标先看原位置，再找原文（多处相同就取离原位置最近的），都找不到返回 null。
  function locateTarget(t, cur) {
    if (t.whole) return { start: 0, length: cur.length, text: cur };
    if (cur.substr(t.start, t.length) === t.text) return { start: t.start, length: t.length, text: t.text };
    let best = -1;
    for (let i = cur.indexOf(t.text); i >= 0; i = cur.indexOf(t.text, i + 1)) {
      if (best < 0 || Math.abs(i - t.start) < Math.abs(best - t.start)) best = i;
      if (!t.text) break;
    }
    return best >= 0 && t.text ? { start: best, length: t.text.length, text: t.text } : null;
  }

  // 用读到的幻灯片校准目标：更新页码/顺序/文字，找不到的移除。返回 { list, lost }。
  function syncTargets(deck, targets) {
    const list = [];
    let lost = 0;
    for (const t of targets) {
      const slide = deck.find((s) => s.id === t.slideId);
      const sh = slide && slide.shapes.find((x) => x.id === t.shapeId);
      if (!sh || sh.kind !== t.kind) { lost++; continue; }
      const next = { ...t, slideNo: slide.no, ord: sh.ord, role: sh.role };
      if (t.kind === 'table') {
        Object.assign(next, { text: sh.text, values: sh.values, start: 0, length: sh.text.length, whole: true });
      } else {
        const loc = locateTarget(t, sh.text);
        if (!loc || !loc.text.trim()) { lost++; continue; }
        Object.assign(next, loc, { whole: !!t.whole || (loc.start === 0 && loc.length === sh.text.length) });
      }
      list.push(next);
    }
    list.sort((a, b) => a.slideNo - b.slideNo || a.ord - b.ord || a.start - b.start);
    return { list, lost };
  }

  // 组模型上下文：按页列出每个文本框（[标题] [正文] …），表格用 Markdown；
  // 单目标用【选中段开始/结束】、多目标用【目标k开始/结束】在原位标出（与提示词约定一致）。
  // 超长时保留目标所在页，再按距离由近及远补其他页，省略的页注明范围。
  function buildDeckContext(deck, targets, cap = CTX_CAP) {
    const single = targets.length === 1;
    const M1 = (k) => (single ? '\n【选中段开始】\n' : `\n【目标${k}开始】\n`);
    const M2 = (k) => (single ? '\n【选中段结束】\n' : `\n【目标${k}结束】\n`);
    const byShape = new Map();
    targets.forEach((t, i) => {
      const key = t.slideId + '|' + t.shapeId;
      if (!byShape.has(key)) byShape.set(key, []);
      byShape.get(key).push({ k: i + 1, t });
    });
    let docChars = 0;
    const blocks = deck.map((slide) => {
      const lines = [`【第 ${slide.no} 页】`];
      let hasTarget = false;
      for (const sh of slide.shapes) {
        const marks = byShape.get(slide.id + '|' + sh.id) || [];
        if (sh.role === 'footer' && !marks.length) continue;
        if (marks.length) hasTarget = true;
        docChars += sh.text.length;
        let body;
        if (sh.kind === 'table' || !marks.length) {
          body = marks.length ? M1(marks[0].k) + sh.text + M2(marks[0].k) : sh.text;
        } else {
          let out = '', pos = 0;
          for (const { k, t } of [...marks].sort((a, b) => a.t.start - b.t.start)) {
            out += sh.text.slice(pos, t.start) + M1(k) + sh.text.substr(t.start, t.length) + M2(k);
            pos = t.start + t.length;
          }
          body = out + sh.text.slice(pos);
        }
        const label = sh.kind === 'table'
          ? `[表格 ${sh.values.length}×${sh.values[0] ? sh.values[0].length : 0}]`
          : `[${ROLE_ZH[sh.role] || '文字'}]`;
        lines.push(body.includes('\n') ? `${label}\n${body.replace(/^\n/, '').replace(/\n$/, '')}` : `${label} ${body}`);
      }
      if (lines.length === 1) lines.push('（本页没有文字）');
      return { no: slide.no, text: lines.join('\n'), hasTarget };
    });
    const total = blocks.reduce((s, b) => s + b.text.length + 2, 0);
    if (total <= cap) return { fullText: blocks.map((b) => b.text).join('\n\n'), truncated: false, docChars, slideCount: deck.length };
    const anchors = blocks.map((b, i) => (b.hasTarget ? i : -1)).filter((i) => i >= 0);
    const dist = (i) => (anchors.length ? Math.min(...anchors.map((a) => Math.abs(a - i))) : i);
    const keep = new Set();
    let used = 0;
    for (const i of [...blocks.keys()].sort((a, b) => dist(a) - dist(b) || a - b)) {
      const len = blocks[i].text.length + 2;
      if (used + len > cap && !blocks[i].hasTarget) continue;
      keep.add(i);
      used += len;
    }
    const out = [];
    let gap = null;
    const flushGap = (end) => {
      if (gap == null) return;
      out.push(gap === end ? `【第 ${blocks[gap].no} 页过长省略】` : `【第 ${blocks[gap].no}–${blocks[end].no} 页过长省略】`);
      gap = null;
    };
    blocks.forEach((b, i) => {
      if (keep.has(i)) { flushGap(i - 1); out.push(b.text); } else if (gap == null) gap = i;
    });
    flushGap(blocks.length - 1);
    return { fullText: out.join('\n\n'), truncated: true, docChars, slideCount: deck.length };
  }

  async function getShape(ctx, slideId, shapeId) {
    const slide = ctx.presentation.slides.getItemOrNullObject(slideId);
    slide.load('id');
    await ctx.sync();
    if (slide.isNullObject) return null;
    const sh = slide.shapes.getItemOrNullObject(shapeId);
    sh.load('id,type');
    await ctx.sync();
    return sh.isNullObject ? null : sh;
  }

  // 重新读一遍幻灯片，校准目标列表（页码、顺序、文字），顺带更新全篇字符数。
  async function refreshTargets(quiet) {
    if (!state.pptReady) return { ok: false };
    const r = await pptRun(async (ctx) => {
      const deck = await readDeck(ctx);
      return { ok: true, deck };
    });
    if (r.ok) {
      const { list, lost } = syncTargets(r.deck, state.targets);
      state.targets = list;
      const ctx = buildDeckContext(r.deck, []);
      state.docChars = ctx.docChars;
      state.slideCount = ctx.slideCount;
      saveTargets();
      renderTargetBar();
      if (lost && !quiet) addNote(tr`⚠️ 有 ${lost} 处目标在幻灯片里找不到了（文字被改动或形状被删除），已移除`);
      return { ok: true, lost };
    }
    if (!quiet) addNote(tr('⚠️ 读取目标失败：') + escapeHtml(uiText(r.error)));
    return r;
  }

  // 读当前选区。实测选中分组时读文字选区（start）会报 InvalidArgument，所以先看选中了哪些形状：
  // 只有没选形状或只选了一个普通形状时才读文字选区，读失败就当没有文字选区。
  async function readSelection(ctx) {
    const pres = ctx.presentation;
    const shapes = pres.getSelectedShapes();
    shapes.load('items/id,items/type');
    const slides = pres.getSelectedSlides();
    slides.load('items/id');
    await ctx.sync();
    const one = shapes.items.length === 1 ? shapes.items[0] : null;
    let text = null;
    if (shapes.items.length <= 1 && !(one && ['Group', 'Table'].includes(one.type))) {
      try {
        const sel = pres.getSelectedTextRangeOrNullObject();
        sel.load('text,start');
        await ctx.sync();
        if (!sel.isNullObject) {
          const sh = sel.getParentTextFrame().getParentShape();
          sh.load('id');
          const sl = sh.getParentSlideOrNullObject();
          sl.load('id');
          await ctx.sync();
          text = { text: normNL(sel.text), start: Math.max(0, sel.start || 0), shapeId: sh.id, slideId: sl.isNullObject ? null : sl.id };
        }
      } catch { text = null; }
    }
    return { shapes: shapes.items, slides: slides.items.map((s) => s.id), text };
  }

  // ＋ 添加选中：
  //   选中一段文字 → 这段文字；点进文本框但没选字 → 整个文本框；
  //   选中若干形状 → 每个有文字的形状一处（表格整张、分组展开）；什么都没选 → 当前页（或缩略图里选中的几页）的全部文字。
  async function addTarget() {
    if (state.targets.length >= MAX_TARGETS) { addNote(tr`⚠️ 目标最多 ${MAX_TARGETS} 处`); return; }
    const r = await pptRun(async (ctx) => {
      const pres = ctx.presentation;
      const cur = await readSelection(ctx);
      const deck = await readDeck(ctx);
      const found = [];
      const wholeOf = (slide, x) => ({ slideId: slide.id, shapeId: x.id, kind: x.kind, start: 0, length: x.text.length, text: x.text, values: x.values, whole: true, role: x.role, slideNo: slide.no, ord: x.ord });
      let source = 'slide';
      if (cur.text) {
        source = 'text';
        if (!cur.text.slideId) return { ok: false, error: 'master' };
        const slide = deck.find((s) => s.id === cur.text.slideId);
        const x = slide && slide.shapes.find((y) => y.id === cur.text.shapeId);
        if (!x) return { ok: false, error: 'empty' };
        const picked = cur.text.text;
        let start = cur.text.start;
        if (picked.trim() && x.kind === 'text' && x.text.substr(start, picked.length) !== picked) {
          const i = x.text.indexOf(picked);
          if (i >= 0) start = i;
        }
        if (x.kind === 'table' || !picked.trim() || (start === 0 && picked.length >= x.text.length)) found.push(wholeOf(slide, x)); // 光标在表格里 → 整张表
        else found.push({ ...wholeOf(slide, x), start, length: picked.length, text: picked, whole: false });
      } else if (cur.shapes.length) {
        source = 'shapes';
        const parents = cur.shapes.map((s) => { const p = s.getParentSlideOrNullObject(); p.load('id'); return p; });
        await ctx.sync();
        cur.shapes.forEach((s, i) => {
          const slideId = parents[i].isNullObject ? cur.slides[0] : parents[i].id;
          const slide = deck.find((d) => d.id === slideId);
          if (!slide) return;
          const direct = slide.shapes.find((x) => x.id === s.id);
          if (direct) found.push(wholeOf(slide, direct));
          else slide.shapes.filter((x) => x.group === s.id).forEach((x) => found.push(wholeOf(slide, x)));
        });
      } else {
        for (const id of cur.slides) {
          const slide = deck.find((d) => d.id === id);
          if (slide) slide.shapes.filter((x) => x.role !== 'footer').forEach((x) => found.push(wholeOf(slide, x)));
        }
      }
      // 合并单元格的表格不收（写回时行列对不上）
      const tables = found.filter((t) => t.kind === 'table');
      if (tables.length) {
        const areas = tables.map((t) => {
          const a = pres.slides.getItem(t.slideId).shapes.getItem(t.shapeId).getTable().getMergedAreas();
          a.load('items');
          return a;
        });
        await ctx.sync();
        tables.forEach((t, i) => { if (areas[i].items.length) t.merged = true; });
      }
      return { ok: true, found, deck, source };
    });
    if (!r.ok) {
      if (r.error === 'empty') addNote(tr('⚠️ 这里没有可改写的文字。先在幻灯片里<b>选中一段文字</b>，或选中文本框/表格，再点「＋ 添加选中」。'));
      else if (r.error === 'master') addNote(tr('⚠️ 母版和版式里的文字暂不支持，请在普通视图的幻灯片上选择。'));
      else addNote(tr('⚠️ 添加目标失败：') + escapeHtml(uiText(r.error)));
      return;
    }
    // 先按幻灯片现状校准已有目标，再去重、查重叠
    const { list } = syncTargets(r.deck, state.targets);
    state.targets = list;
    let skippedOverlap = 0, skippedMerged = 0, skippedFull = 0;
    const overlaps = (a, b) => a.slideId === b.slideId && a.shapeId === b.shapeId
      && (a.whole || b.whole || a.kind === 'table' || (a.start < b.start + b.length && b.start < a.start + a.length));
    const added = [];
    for (const t of r.found) {
      if (!t.text.trim()) continue;
      if (t.merged) { skippedMerged++; continue; }
      if ([...state.targets, ...added].some((x) => overlaps(x, t))) { skippedOverlap++; continue; }
      if (state.targets.length + added.length >= MAX_TARGETS) { skippedFull++; continue; }
      added.push({ ...t, id: 't' + (++tgtSeq) });
    }
    if (!added.length) {
      if (skippedMerged) addNote(tr('⚠️ 这张表格含合并单元格，暂不支持作为目标（可先取消合并）'));
      else if (skippedOverlap) addNote(tr('⚠️ 选中的内容已经是目标了（或和已有目标重叠）。先在设置里 ✕ 掉那个目标，或换一处。'));
      else if (skippedFull) addNote(tr`⚠️ 目标最多 ${MAX_TARGETS} 处`);
      else addNote(tr('⚠️ 这里没有可改写的文字。先在幻灯片里<b>选中一段文字</b>，或选中文本框/表格，再点「＋ 添加选中」。'));
      return;
    }
    state.targets = syncTargets(r.deck, [...state.targets, ...added]).list;
    const ctxInfo = buildDeckContext(r.deck, []);
    state.docChars = ctxInfo.docChars;
    state.slideCount = ctxInfo.slideCount;
    saveTargets();
    renderTargetBar();
    const n = state.targets.length;
    const extra = [skippedOverlap ? tr`${skippedOverlap} 处已是目标` : '', skippedMerged ? tr`${skippedMerged} 张含合并单元格的表格` : '', skippedFull ? tr`${skippedFull} 处超出上限` : '']
      .filter(Boolean).join(tr('、'));
    const skipped = extra ? tr`（跳过：${extra}）` : '';
    if (added.length === 1 && added[0].kind === 'table') {
      const v = added[0].values || [];
      addNote(tr`📊 已把整张表格（${v.length}×${v[0] ? v[0].length : 0}，第 ${added[0].slideNo} 页）添加为目标（当前共 ${n} 处）。可以下指令改单元格内容、增删行。`);
    } else if (r.source === 'slide') {
      const pages = [...new Set(added.map((t) => t.slideNo))].join(tr('、'));
      addNote(added.length === 1
        ? tr`🎯 已把第 ${pages} 页的 1 处文字添加为目标（当前共 ${n} 处）${skipped}。`
        : tr`🎯 已把第 ${pages} 页的 ${added.length} 处文字添加为目标（当前共 ${n} 处）${skipped}。`);
    } else {
      addNote(added.length === 1
        ? tr`🎯 已添加 1 处目标（当前共 ${n} 处，按页码顺序编号）${skipped}。可继续选中别处再点「＋ 添加选中」，或直接下指令。`
        : tr`🎯 已添加 ${added.length} 处目标（当前共 ${n} 处，按页码顺序编号）${skipped}。可继续选中别处再点「＋ 添加选中」，或直接下指令。`);
    }
    els.input.focus();
  }

  // 面板启动时：恢复上次为这份演示文稿设的目标（按原文核对，对不上的丢弃）
  async function restoreTargets() {
    const saved = loadSavedTargets();
    if (!saved.length) { refreshTargets(true); return; }
    state.targets = saved.map((t) => ({ ...t, id: 't' + (++tgtSeq) }));
    const r = await refreshTargets(true);
    if (r.ok && state.targets.length) {
      addNote(tr`🎯 已恢复上次设的 ${state.targets.length} 处目标${r.lost ? tr`（另有 ${r.lost} 处已找不到）` : ''}（不想要就在设置里清除）`);
    }
  }

  function removeTarget(id) {
    if (state.streaming) return;
    state.targets = state.targets.filter((t) => t.id !== id);
    saveTargets();
    renderTargetBar();
  }

  function clearTargets() {
    if (state.streaming) return;
    state.targets = [];
    saveTargets();
    renderTargetBar();
  }

  // 📍 定位：跳到那一页、选中那个形状；部分目标再选中那段文字
  async function revealTarget(id) {
    const t = state.targets.find((x) => x.id === id);
    if (!t) return;
    const r = await pptRun(async (ctx) => {
      const sh = await getShape(ctx, t.slideId, t.shapeId);
      if (!sh) return { ok: false, error: tr('这个目标所在的形状不在了，请重新添加') };
      ctx.presentation.setSelectedSlides([t.slideId]);
      await ctx.sync();
      ctx.presentation.slides.getItem(t.slideId).setSelectedShapes([t.shapeId]);
      await ctx.sync();
      if (t.kind === 'text' && !t.whole) {
        const range = sh.textFrame.textRange;
        range.load('text');
        await ctx.sync();
        const loc = locateTarget(t, normNL(range.text));
        if (loc) { range.getSubstring(loc.start, loc.length).setSelected(); await ctx.sync(); }
      }
      return { ok: true };
    });
    if (!r.ok) addNote('⚠️ ' + escapeHtml(uiText(r.error)));
  }

  // 组"改写模式"的上下文：读整份演示文稿、按原文校准目标、标出目标位置。
  async function getEditContext() {
    return await pptRun(async (ctx) => {
      const deck = await readDeck(ctx);
      const { list, lost } = syncTargets(deck, state.targets);
      if (!list.length) return { ok: false, error: tr('目标在幻灯片里都找不到了（文字被改动或形状被删除），请重新选中并添加目标') };
      return { ok: true, targets: list, lost, ...buildDeckContext(deck, list) };
    });
  }

  // 问答模式（无目标）：整份演示文稿的文字
  async function getWholeDeck() {
    return await pptRun(async (ctx) => {
      const deck = await readDeck(ctx);
      return { ok: true, ...buildDeckContext(deck, []) };
    });
  }

  // ✅ 应用文字：核对原文 → 只写变化的片段（从后往前）→ 回读校验。返回撤销所需的记录。
  async function applyText(tk, newText, force) {
    return await pptRun(async (ctx) => {
      const sh = await getShape(ctx, tk.slideId, tk.shapeId);
      if (!sh) return { ok: false, error: tr('找不到这处目标所在的形状（可能已被删除），请重新选中后添加') };
      const range = sh.textFrame.textRange;
      range.load('text');
      await ctx.sync();
      const raw = range.text;
      const cur = normNL(raw);
      const loc = locateTarget(tk, cur);
      if (!loc) return { ok: false, error: tr('目标原文已被改动或删除，找不到写入位置。请重新选中后添加') };
      if (!force && loc.text !== tk.text) return { ok: false, needConfirm: true };
      const next = cleanReplacement(newText, loc.text);
      const edits = planEdits(loc.text, next);
      if (!edits.length) return { ok: true, unchanged: true };
      for (let i = edits.length - 1; i >= 0; i--) {
        const e = edits[i];
        range.getSubstring(loc.start + e.pos, e.del).text = toPptText(e.ins, raw.substr(loc.start + e.pos, e.del));
      }
      await ctx.sync();
      range.load('text');
      await ctx.sync();
      const after = range.text;
      const expected = cur.slice(0, loc.start) + next + cur.slice(loc.start + loc.length);
      return {
        ok: true, edits: edits.length, verified: normNL(after) === expected,
        undo: { kind: 'text', slideId: tk.slideId, shapeId: tk.shapeId, start: loc.start,
          rawBefore: raw.substr(loc.start, loc.length), rawAfter: after.substr(loc.start, next.length) },
      };
    });
  }

  // 把表格从 oldVals 改成 nv：行按内容对齐（见 TableUtils.planRows），先改单元格、再从下往上删行、
  // 最后按新表顺序插行。列数必须不变。
  async function writeTable(ctx, tbl, oldVals, nv) {
    const oCols = oldVals[0] ? oldVals[0].length : 0, nCols = nv[0] ? nv[0].length : 0;
    if (oCols !== nCols) return { ok: false, error: tr`列数变了（${oCols}→${nCols}）。PowerPoint 版暂不支持增删列，请让模型保持列数后重试` };
    const plan = TableUtils.planRows(oldVals, nv);
    const rowOps = plan.filter((op) => op.type === 'insert' || op.type === 'delete');
    if (rowOps.length && !state.api.v19) return { ok: false, error: tr('当前 PowerPoint 版本不支持增删表格行，请让模型保持行数后重试') };
    let step = tr('改单元格');
    let changed = 0;
    try {
      for (const op of plan) {
        if (op.type !== 'change') continue;
        for (let c = 0; c < oCols; c++) {
          if (String(oldVals[op.old][c] ?? '') !== nv[op.new][c]) { tbl.getCellOrNullObject(op.old, c).text = nv[op.new][c]; changed++; }
        }
      }
      await ctx.sync();
      const deletions = plan.filter((op) => op.type === 'delete').map((op) => op.old).sort((a, b) => b - a);
      let rowCount = oldVals.length;
      if (deletions.length) {
        step = tr('删多余行');
        const rows = tbl.rows;
        rows.load('items');
        await ctx.sync();
        for (const i of deletions) rows.items[i].delete();
        await ctx.sync();
        rowCount -= deletions.length;
      }
      step = tr('加行');
      // 此时表格 = 新表去掉待插入行后的顺序；按新表行号依次插入，前面的行都已就位。
      for (const op of plan) {
        if (op.type !== 'insert') continue;
        if (op.new >= rowCount) tbl.rows.add(undefined, 1);
        else tbl.rows.add(op.new, 1);
        await ctx.sync();
        rowCount++;
        nv[op.new].forEach((v, c) => { tbl.getCellOrNullObject(op.new, c).text = v; });
        await ctx.sync();
      }
    } catch (e) {
      return { ok: false, error: tr`表格更新失败（${step}）：${String(e?.message || e)}。已写入的部分请在幻灯片里检查，必要时手动改回（也可以试试 PowerPoint 的撤销）` };
    }
    return { ok: true, changed, rowsAdded: plan.filter((op) => op.type === 'insert').length, rowsRemoved: plan.filter((op) => op.type === 'delete').length };
  }

  async function applyTable(tk, newVals, force) {
    return await pptRun(async (ctx) => {
      const sh = await getShape(ctx, tk.slideId, tk.shapeId);
      if (!sh || sh.type !== 'Table') return { ok: false, error: tr('找不到这张表格（可能已被删除），请重新选中后添加') };
      const tbl = sh.getTable();
      tbl.load('values');
      await ctx.sync();
      const oldVals = (tbl.values || []).map((r) => r.map((c) => String(c == null ? '' : c)));
      if (!force && TableUtils.toMarkdown(oldVals) !== tk.text) return { ok: false, needConfirm: true };
      const nv = newVals.map((row) => row.map((c) => String(c == null ? '' : c)));
      const w = await writeTable(ctx, tbl, oldVals, nv);
      if (!w.ok) return w;
      return { ...w, undo: { kind: 'table', slideId: tk.slideId, shapeId: tk.shapeId, before: oldVals, after: nv } };
    });
  }

  // ↩ 撤销：把刚写入的内容改回去（同样只改变化的片段）。应用后又被手动改过的就不硬来。
  async function undoApply(u) {
    return await pptRun(async (ctx) => {
      const sh = await getShape(ctx, u.slideId, u.shapeId);
      if (!sh) return { ok: false, error: tr('找不到这处内容所在的形状，无法撤销') };
      if (u.kind === 'table') {
        const tbl = sh.getTable();
        tbl.load('values');
        await ctx.sync();
        const cur = (tbl.values || []).map((r) => r.map((c) => String(c == null ? '' : c)));
        if (JSON.stringify(cur) !== JSON.stringify(u.after)) return { ok: false, error: tr('这张表格在应用后又被改过，无法自动撤销，请手动改回（也可以试试 PowerPoint 的撤销）') };
        return await writeTable(ctx, tbl, cur, u.before.map((r) => [...r]));
      }
      const range = sh.textFrame.textRange;
      range.load('text');
      await ctx.sync();
      const raw = range.text;
      let start = u.start;
      if (raw.substr(start, u.rawAfter.length) !== u.rawAfter) {
        const i = raw.indexOf(u.rawAfter);
        if (i < 0 || raw.indexOf(u.rawAfter, i + 1) >= 0) return { ok: false, error: tr('这处文字在应用后又被改过，无法自动撤销，请手动改回（也可以试试 PowerPoint 的撤销）') };
        start = i;
      }
      const edits = planEdits(u.rawAfter, u.rawBefore);
      for (let i = edits.length - 1; i >= 0; i--) {
        const e = edits[i];
        range.getSubstring(start + e.pos, e.del).text = e.ins;
      }
      await ctx.sync();
      range.load('text');
      await ctx.sync();
      return { ok: true, verified: range.text.substr(start, u.rawBefore.length) === u.rawBefore, start };
    });
  }

  // ---------- 本机服务 ----------
  async function fetchJson(url, timeout = 15000) {
    const ac = new AbortController();
    let timer;
    try {
      return await Promise.race([
        (async () => {
          const resp = await fetch(API + url, { cache: 'no-store', signal: ac.signal });
          if (!resp.ok) throw new Error(tr('服务返回 HTTP ') + resp.status);
          return resp.json();
        })(),
        new Promise((_, reject) => { timer = setTimeout(() => { ac.abort(); reject(new Error(tr('连接超时，请重试'))); }, timeout); }),
      ]);
    } finally { clearTimeout(timer); }
  }
  async function ping() {
    try { state.serverOk = !!(await fetchJson('/api/ping', 5000)).ok; }
    catch { state.serverOk = false; }
    refreshStatusUI();
    if (state.serverOk && !state.health) diagnose(false);
    maybeAutoRefreshModels();
  }
  function refreshStatusUI() {
    const backend = state.health?.backends?.[state.cfg.backend];
    const ready = state.serverOk && (!backend || ['ready', 'unknown'].includes(backend.status));
    els.statusDot.className = 'dot ' + (ready ? 'ok' : state.serverOk === null ? '' : 'bad');
    els.statusText.textContent = state.serverOk === false ? tr('服务未连接') : state.serverOk === null ? tr('正在连接') : backend ? uiText(backend.label) : tr('服务已连接');
    els.statusDot.setAttribute('aria-label', els.statusText.textContent);
    els.statusDot.title = els.statusText.textContent;
    if (state.serverOk === false) {
      els.banner.textContent = tr('本机服务暂时无法连接。打开连接设置查看恢复方法，输入草稿会保留。');
    } else if (!state.pptReady) {
      els.banner.textContent = tr('请在 PowerPoint 的「LLM_in_PowerPoint」加载项中使用。此处可预览界面、检查后端连接。');
    } else if (backend && ['missing', 'auth', 'error'].includes(backend.status)) {
      els.banner.textContent = uiText(backend.hint);
    } else { els.banner.classList.add('hidden'); return; }
    els.banner.classList.remove('hidden');
  }
  async function diagnose(force = true) {
    const button = $('#btn-diagnose');
    if (button.disabled) return;
    button.disabled = true; button.textContent = tr('检测中…');
    try {
      state.health = await fetchJson('/api/health' + (force ? '?refresh=1' : ''), 15000);
      state.serverOk = true;
      const health = state.health;
      $('#connection-details').innerHTML = ['claude', 'codex'].map((id) => {
        const b = health.backends[id];
        return `<div class="connection-card ${b.status === 'ready' ? 'ready' : ''}"><h3>${id === 'claude' ? 'Claude Code' : 'Codex'}<span class="health-badge">${escapeHtml(uiText(b.label))}</span></h3><code>${escapeHtml(b.version || tr('版本未知'))}<br>${escapeHtml(b.path)}</code><p>${escapeHtml(uiText(b.hint))}</p></div>`;
      }).join('') + tr`<p class="settings-footnote">本机服务 v${escapeHtml(health.version)} · ${health.https ? 'HTTPS' : tr('HTTP 调试')} · ${health.proxyConfigured ? tr('已配置代理') : tr('未配置代理')}</p><p class="settings-footnote">日志：${escapeHtml(health.logPath)}</p>`;
    } catch (e) {
      $('#connection-details').innerHTML = tr`<div class="connection-card"><h3>连接检测未完成</h3><p>${escapeHtml(uiText(e.message))}</p><p>在项目目录运行 npm run update，或在终端重启服务：</p><code>npm run update</code></div>`;
    } finally {
      button.disabled = false; button.textContent = tr('重新检测'); refreshStatusUI();
    }
  }
  function saveDraft() { try { localStorage.setItem('lp:draft:' + docKey, els.input.value); } catch {} }
  function restoreDraft() { try { els.input.value = localStorage.getItem('lp:draft:' + docKey) || ''; autoGrow(); } catch {} }
  function contextKey(doc, cfg) {
    const value = JSON.stringify([doc.fullText, state.attachments.map((a) => [a.id, a.name, a.size]), cfg.mode, cfg.backend === 'codex' ? cfg.model_codex : cfg.model_claude]);
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
    return String(hash >>> 0);
  }

  // ---------- 消息渲染 ----------
  function addMessageEl(role) {
    $('#welcome')?.remove();
    const wrap = document.createElement('div');
    wrap.className = `msg ${role}`;
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    wrap.appendChild(bubble);
    els.messages.appendChild(wrap);
    els.messages.scrollTop = els.messages.scrollHeight;
    return bubble;
  }
  function addNote(html) {
    const d = document.createElement('div');
    d.className = 'note';
    d.innerHTML = html;
    els.messages.appendChild(d);
    els.messages.scrollTop = els.messages.scrollHeight;
  }
  function footHtml(via) {
    if (!via) return '';
    return `<div class="foot">${escapeHtml([via.backend, via.model, 'effort ' + via.effort, via.resumed ? tr('♻️缓存续写') : ''].filter(Boolean).join(' · '))}</div>`;
  }
  function renderWelcome() {
    if ($('#welcome')) return;
    const welcome = document.createElement('div');
    welcome.id = 'welcome'; welcome.className = 'welcome';
    welcome.innerHTML = tr('<div class="welcome-icon" aria-hidden="true">✦</div><h2>让每一页，都讲得更清楚</h2><p>选中幻灯片里的文字、文本框或整页，告诉我你的想法。<br>精简要点、统一措辞，或整页翻译。</p><div class="welcome-flow"><span>选择内容</span><b>→</b><span>描述想法</span><b>→</b><span>预览与应用</span></div>');
    els.messages.appendChild(welcome);
  }

  // ---------- 目标条 ----------
  function renderTargetBar() {
    const ts = state.targets;
    renderContextSummary();
    $('#target-count').textContent = `${ts.length} / ${MAX_TARGETS}`;
    $('#btn-clear').classList.toggle('hidden', !ts.length);
    els.targetList.innerHTML = '';
    if (!ts.length) {
      els.targetInfo.innerHTML = tr('<span class="muted">可以添加选中的文字、整个文本框、表格或整页；什么都不选时添加当前页。</span>');
      els.targetBar.classList.add('empty');
      return;
    }
    els.targetBar.classList.remove('empty');
    const total = ts.reduce((s, t) => s + t.text.length, 0);
    const warn = total > SOFT_SEL_LIMIT ? tr(' · <b class="warn">⚠️ 目标过大，建议缩小</b>') : '';
    const cacheOn = state.cliSession[state.cfg.backend];
    const ctxInfo = cacheOn
      ? tr(' · 可续聊')
      : state.docChars ? tr` · 随请求附全篇 ${state.slideCount} 页 ~${Math.max(1, Math.round(state.docChars / 1000))}k 字符` : '';
    els.targetInfo.innerHTML = tr`已选 ${ts.length} 处 · ${total} 字符${ctxInfo}${warn}`;
    ts.forEach((t, i) => {
      const row = document.createElement('div');
      row.className = 'tgt-row';
      const p = t.text.replace(/\s+/g, ' ').trim();
      const isTbl = t.kind === 'table';
      const dims = isTbl && t.values ? `${t.values.length}×${t.values[0] ? t.values[0].length : 0}` : '';
      row.innerHTML =
        `<span class="tgt-k">${i + 1}</span>` +
        `<span class="tgt-main"><span class="tgt-where">${escapeHtml(whereOf(t))}${t.whole || isTbl ? '' : tr(' · 部分文字')}</span>` +
        `<span class="tgt-prev" title="${escapeHtml(p.slice(0, 300))}">${isTbl ? '📊 ' : ''}${escapeHtml(p.length > 60 ? p.slice(0, 60) + '…' : p)}</span></span>` +
        `<span class="tgt-len">${isTbl ? dims : tr`${t.text.length}字`}</span>`;
      const loc = document.createElement('button');
      loc.className = 'ibtn';
      loc.textContent = '📍';
      loc.title = tr('在幻灯片里定位这处');
      loc.addEventListener('click', () => revealTarget(t.id));
      const del = document.createElement('button');
      del.className = 'ibtn';
      del.textContent = '✕';
      del.title = tr('移除这个目标');
      del.addEventListener('click', () => removeTarget(t.id));
      row.append(loc, del);
      els.targetList.appendChild(row);
    });
  }

  // 顶部一行：目标数和字数；详情（目标列表、定位、移除）在设置浮层里。
  function renderContextSummary() {
    const ts = state.targets;
    const total = ts.reduce((s, t) => s + t.text.length, 0);
    const pages = [...new Set(ts.map((t) => t.slideNo).filter(Boolean))];
    const pageText = !pages.length ? '' : pages.length === 1 ? tr` · 第 ${pages[0]} 页` : tr` · ${pages.length} 页`;
    els.contextSummary.textContent = ts.length === 1 ? tr`1 个目标 · ${total} 字${pageText}`
      : ts.length ? tr`${ts.length} 个目标 · ${total} 字${pageText}`
      : state.cfg.mode === 'ask' ? tr('全篇问答') : tr('未选择内容');
    els.contextSummary.title = ts.length ? tr`查看、定位或移除 ${ts.length} 个目标` : tr('查看目标与设置');
  }

  // ---------- 附件 ----------
  function extOf(name) {
    const m = String(name).toLowerCase().match(/\.([a-z0-9]+)$/);
    return m ? m[1] : '';
  }
  function attIcon(a) {
    if (a.kind === 'text') return '📄';
    if (a.slide) return '🖼';
    return a.mime === 'application/pdf' ? '📕' : '🖼';
  }
  function totalBinBytes() {
    return state.attachments.filter((a) => a.kind === 'binary').reduce((s, a) => s + a.size, 0);
  }
  function canAddFile(size, isBin) {
    if (state.attachments.length >= MAX_FILES) return tr`附件最多 ${MAX_FILES} 个`;
    if (isBin && size > BIN_CAP) return tr`单个图片/PDF 最大 ${fmtSize(BIN_CAP)}`;
    if (isBin && totalBinBytes() + size > TOTAL_BIN_CAP) return tr`图片/PDF 合计超过 ${fmtSize(TOTAL_BIN_CAP)}`;
    return null;
  }
  function renderAttachChips() {
    const wrap = els.attChips;
    wrap.innerHTML = '';
    for (const a of state.attachments) {
      const chip = document.createElement('span');
      chip.className = 'att-chip';
      chip.innerHTML = `${attIcon(a)} ${escapeHtml(a.slide ? tr`第 ${a.slide} 页截图` : a.name)} · ${fmtSize(a.size)}${a.truncated ? tr('（截断）') : ''} `;
      const x = document.createElement('button');
      x.textContent = '✕';
      x.title = tr('移除');
      x.addEventListener('click', () => {
        if (state.streaming) return;
        state.attachments = state.attachments.filter((b) => b.id !== a.id);
        renderAttachChips();
      });
      chip.appendChild(x);
      wrap.appendChild(chip);
    }
  }
  async function addLocalFiles(fileList) {
    if (state.streaming || state.loadingFiles) return;
    state.loadingFiles = true;
    els.send.disabled = true;
    try {
      for (const f of fileList) {
        const ext = extOf(f.name);
        const isText = TEXT_EXTS.includes(ext);
        const isBin = !!BIN_EXTS[ext];
        if (!isText && !isBin) { addNote(tr`⚠️ 暂不支持 ${escapeHtml(f.name)}（只收 ${TEXT_EXTS.join('/')}/pdf/图片）`); continue; }
        const err = canAddFile(f.size, isBin);
        if (err) { addNote('⚠️ ' + escapeHtml(err)); continue; }
        try {
          if (isText) {
            let text = await f.text();
            const truncated = text.length > TEXT_CAP;
            if (truncated) text = text.slice(0, TEXT_CAP) + tr('\n…（过长已截断）');
            state.attachments.push({ id: ++attSeq, name: f.name, kind: 'text', mime: 'text/plain', text, size: f.size, truncated });
          } else {
            const b64 = await new Promise((resolve, reject) => {
              const r = new FileReader();
              r.onload = () => resolve(String(r.result).split(',')[1] || '');
              r.onerror = () => reject(new Error(tr('读取失败')));
              r.readAsDataURL(f);
            });
            state.attachments.push({ id: ++attSeq, name: f.name, kind: 'binary', mime: BIN_EXTS[ext] || f.type, b64, size: f.size });
          }
        } catch (e) {
          addNote(tr`⚠️ 读取 ${escapeHtml(f.name)} 失败：${escapeHtml(uiText(e.message))}`);
        }
      }
      renderAttachChips();
    } finally { state.loadingFiles = false; els.send.disabled = false; }
  }
  // 📷 当前页截图：PowerPoint 渲染当前页（或第一个目标所在页）为 PNG，作为图片附件发给模型看版式。
  async function attachSlideImage() {
    if (state.streaming || state.loadingFiles) return;
    if (!state.pptReady) { addNote(tr('请在 PowerPoint 加载项中使用这个功能。')); return; }
    const btn = $('#att-slide');
    btn.disabled = true;
    try {
      const r = await pptRun(async (ctx) => {
        const selected = ctx.presentation.getSelectedSlides();
        selected.load('items/id');
        const all = ctx.presentation.slides;
        all.load('items/id');
        await ctx.sync();
        const id = selected.items[0]?.id || state.targets[0]?.slideId || all.items[0]?.id;
        if (!id) return { ok: false, error: tr('演示文稿里还没有幻灯片') };
        const img = all.getItem(id).getImageAsBase64({ width: SNAPSHOT_WIDTH });
        await ctx.sync();
        return { ok: true, b64: img.value, no: all.items.findIndex((s) => s.id === id) + 1 };
      });
      if (!r.ok) { addNote(tr('⚠️ 截取当前页失败：') + escapeHtml(uiText(r.error))); return; }
      const name = `slide-${r.no}.png`;
      state.attachments = state.attachments.filter((a) => a.name !== name); // 同一页重截就替换
      const size = Math.floor(r.b64.length * 3 / 4);
      const err = canAddFile(size, true);
      if (err) { addNote('⚠️ ' + escapeHtml(err)); return; }
      state.attachments.push({ id: ++attSeq, name, kind: 'binary', mime: 'image/png', b64: r.b64, size, slide: r.no });
      renderAttachChips();
      addNote(tr`📷 已附上第 ${r.no} 页的截图，模型会参考版式、字号和文字是否放得下。`);
    } finally { btn.disabled = state.streaming || !state.api.v18; }
  }

  // ---------- 替换卡片（diff 预览 + 应用 + 撤销）----------
  // tk = 请求时的目标快照 { k, id, slideId, shapeId, kind, text, values, ... }；返回 doApply 供「应用全部」调用
  function attachReplacementCard(bubble, tk, replacement, via, multi, lang) {
    const card = document.createElement('div');
    card.className = 'card';
    const isTableRep = (tk && tk.kind === 'table') || lang === 'table';
    let tableVals = null;
    let tableErr = null;
    if (isTableRep) {
      const p = TableUtils.parseMarkdown(replacement);
      if (p.ok) tableVals = p.values;
      else tableErr = p.error;
    }
    const oldVals = tk && tk.kind === 'table' ? (tk.values || null) : null;
    const newText = tk && tk.kind !== 'table' ? cleanReplacement(replacement, tk.text) : replacement;
    const diff = tableVals ? null : (tk && tk.kind !== 'table' ? diffHtml(tk.text, newText) : null);
    const title = tableVals ? tr('表格预览') : tr('对比');
    const where = tk ? escapeHtml(whereOf(tk)) : '';
    card.innerHTML =
      `<div class="card-head">` +
      `<span class="card-title">${multi ? tr`目标 ${tk.k} · ` : ''}${tableVals ? tr('📊 表格替换') : tr('替换预览')}${where ? `<span class="card-where">${where}</span>` : ''}</span>` +
      `<button class="tab active" data-tab="diff">${title}</button><button class="tab" data-tab="new">${tableVals ? tr('源码') : tr('新文本')}</button>` +
      `</div>` +
      `<pre class="card-body diffview">${diff != null ? diff : ''}</pre>` +
      `<pre class="card-body newview hidden">${escapeHtml(newText)}</pre>` +
      `<div class="card-actions">` +
      tr`<button class="btn btn-primary apply">✅ 应用</button>` +
      tr`<button class="btn undo hidden" title="把这处改回应用前的文字">↩ 撤销</button>` +
      tr`<button class="btn copy">📋 复制</button>` +
      (multi ? '' : tr`<button class="btn retry" title="用同样的指令重新生成">🔁 重试</button>`) +
      `<span class="card-status"></span>` +
      `</div>`;
    bubble.appendChild(card);

    const diffView = card.querySelector('.diffview');
    // 表格：对比页渲染成真表格，变过的单元格高亮并显示旧值；行增减做文字说明
    if (tableVals) {
      diffView.textContent = '';
      diffView.appendChild(tablePreviewEl(oldVals, tableVals));
      const d = TableUtils.diffCells(oldVals, tableVals);
      const notes = [];
      if (oldVals) {
        if (d.changed.length) notes.push(tr`改动 ${d.changed.length} 个单元格`);
        if (d.rowsAdded) notes.push(tr`新增 ${d.rowsAdded} 行`);
        if (d.rowsRemoved) notes.push(tr`删除 ${d.rowsRemoved} 行`);
        if (d.colsChanged) notes.push(tr`⚠️ 列数 ${d.oCols}→${d.nCols}：PowerPoint 版暂不支持增删列，无法应用`);
        if (!notes.length) notes.push(tr('内容与当前表格一致（无变化）'));
      } else {
        notes.push(tr('这是文字目标，PowerPoint 版不能把文字直接换成表格；可复制内容后自行插入表格。'));
      }
      const note = document.createElement('div');
      note.className = 'tbl-note';
      note.textContent = notes.join(' · ');
      diffView.appendChild(note);
    } else if (tk && tk.kind === 'table' && tableErr) {
      diffView.innerHTML = tr`<span class="muted">⚠️ 这是表格目标，但回复没解析出 Markdown 表格（${escapeHtml(uiText(tableErr))}），无法应用。点 🔁 重试。</span>`;
    } else if (diff == null) {
      diffView.innerHTML = tr('<i class="muted">（没有对应目标，只能看新文本）</i>');
    }
    card.querySelectorAll('.tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        card.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
        tab.classList.add('active');
        const isDiff = tab.dataset.tab === 'diff';
        diffView.classList.toggle('hidden', !isDiff);
        card.querySelector('.newview').classList.toggle('hidden', isDiff);
      });
    });

    const statusEl = card.querySelector('.card-status');
    const applyBtn = card.querySelector('.apply');
    const undoBtn = card.querySelector('.undo');
    const blocked = (tk && tk.kind === 'table' && !tableVals)                 // 表格目标没解析出表格
      || (tk && tk.kind !== 'table' && lang === 'table')                     // 文字目标不能换成表格
      || (tableVals && oldVals && oldVals[0] && tableVals[0] && oldVals[0].length !== tableVals[0].length); // 列数变了
    if (blocked) applyBtn.disabled = true;
    let done = false;
    let undoRec = null;
    let forceNext = false; // 二次点击确认覆盖（Office 的 WebView 会吞 window.confirm，不能用弹窗）
    const doApply = async () => {
      if (state.streaming || done) return done;
      if (!tk) { statusEl.textContent = tr('⚠️ 没有对应目标，无法应用'); return false; }
      if (blocked) { statusEl.textContent = tr('⚠️ 这处改写不能直接应用（见上方说明），可复制后手动处理'); return false; }
      applyBtn.disabled = true;
      statusEl.textContent = tr('应用中…');
      const r = tableVals ? await applyTable(tk, tableVals, forceNext) : await applyText(tk, replacement, forceNext);
      if (r.needConfirm) {
        forceNext = true;
        applyBtn.disabled = false;
        statusEl.textContent = multi
          ? tr`⚠️ 目标 ${tk.k} 的内容在发送后已变化（可能手动改过）。确认覆盖请再点一次「✅ 应用」`
          : tr('⚠️ 目标的内容在发送后已变化（可能手动改过）。确认覆盖请再点一次「✅ 应用」');
        return false;
      }
      forceNext = false;
      if (r.ok) {
        done = true;
        state.targets = state.targets.filter((t) => t.id !== tk.id); // 应用成功 → 该目标自动移除
        saveTargets();
        renderTargetBar();
        if (r.unchanged) {
          statusEl.textContent = tr('内容与幻灯片现状一致，没有需要写入的改动。');
          return true;
        }
        undoRec = r.undo || null;
        undoBtn.classList.toggle('hidden', !undoRec);
        const detail = tableVals
          ? tr`（按单元格写回：改动 ${r.changed} 个单元格${r.rowsAdded ? tr`，新增 ${r.rowsAdded} 行` : ''}${r.rowsRemoved ? tr`，删除 ${r.rowsRemoved} 行` : ''}；表格样式保留）`
          : tr`（只改了 ${r.edits} 处变化的文字，其余文字的格式原样保留）`;
        statusEl.textContent = tr`✅ 已应用${detail}。该目标已移除；不满意可点「↩ 撤销」。`;
        if (r.verified === false) statusEl.textContent += tr(' ⚠️ 写入后回读与预期不完全一致，请在幻灯片里检查这一处。');
        return true;
      }
      statusEl.textContent = '⚠️ ' + (r.error || tr('应用失败'));
      applyBtn.disabled = false;
      return false;
    };
    applyBtn.addEventListener('click', doApply);
    undoBtn.addEventListener('click', async () => {
      if (!undoRec || state.streaming) return;
      undoBtn.disabled = true;
      statusEl.textContent = tr('撤销中…');
      const r = await undoApply(undoRec);
      if (!r.ok) { statusEl.textContent = '⚠️ ' + (r.error || tr('撤销失败')); undoBtn.disabled = false; return; }
      undoRec = null;
      undoBtn.classList.add('hidden');
      // 撤销后把原目标放回列表，方便换个说法再改
      if (state.targets.length < MAX_TARGETS && !state.targets.some((t) => t.slideId === tk.slideId && t.shapeId === tk.shapeId)) {
        const back = { ...tk, id: 't' + (++tgtSeq) };
        if (back.kind === 'text' && !back.whole && typeof r.start === 'number') back.start = r.start;
        state.targets.push(back);
        await refreshTargets(true);
      }
      statusEl.textContent = tr('↩ 已撤销，这处已恢复为应用前的文字，并重新放回目标列表。') + (r.verified === false ? tr(' ⚠️ 回读与原文不完全一致，请检查。') : '');
    });
    card.querySelector('.copy').addEventListener('click', (e) => copyText(newText, e.target));
    const retryBtn = card.querySelector('.retry');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        if (state.streaming) return;
        const lastUser = [...state.messages].reverse().find((m) => m.role === 'user');
        if (lastUser) sendInstruction(lastUser.content, { isRetry: true });
      });
    }
    if (via) {
      const foot = document.createElement('div');
      foot.innerHTML = footHtml(via);
      bubble.appendChild(foot.firstChild);
    }
    return doApply;
  }

  // 表格替换预览：新表渲成 DOM，变过的单元格绿底+划线旧值，新增行淡蓝底
  function tablePreviewEl(oldVals, newVals) {
    const tbl = document.createElement('table');
    tbl.className = 'tblprev';
    // 行按内容对齐：新增行整行标出，修改行只标变化的单元格（见 TableUtils.planRows）。
    const sameCols = oldVals && oldVals[0] && newVals[0] && oldVals[0].length === newVals[0].length;
    const source = new Map();
    if (sameCols) for (const op of TableUtils.planRows(oldVals, newVals)) if (op.new != null) source.set(op.new, op.old);
    newVals.forEach((row, r) => {
      const rowEl = document.createElement('tr');
      const oldRow = !oldVals ? null : sameCols ? (source.get(r) == null ? null : oldVals[source.get(r)]) : oldVals[r];
      row.forEach((cell, c) => {
        const td = document.createElement('td');
        const old = oldRow ? oldRow[c] : undefined;
        if (oldVals && old === undefined) {
          td.classList.add('cellnew');
          td.textContent = cell;
        } else if (oldVals && String(old ?? '') !== String(cell ?? '')) {
          td.classList.add('cellchg');
          const ov = document.createElement('span');
          ov.className = 'oldv';
          ov.textContent = old;
          td.appendChild(ov);
          td.appendChild(document.createTextNode(cell));
        } else {
          td.textContent = cell;
        }
        rowEl.appendChild(td);
      });
      tbl.appendChild(rowEl);
    });
    return tbl;
  }

  // ---------- 发送 ----------
  let reqCounter = 0; // 请求编号发生器（配合 state.curReq 做"强制停止后丢弃迟到输出"）
  function send() {
    const text = els.input.value.trim();
    if (!text || state.streaming) return;
    sendInstruction(text, {});
  }

  async function sendInstruction(text, { isRetry = false } = {}) {
    if (state.streaming || state.loadingFiles) return;
    const cfg = { ...state.cfg };
    const mode = cfg.mode;
    if (!state.pptReady) { addNote(tr('⚠️ Office 还没就绪，稍等或点 ⟳ 刷新面板')); return; }
    if (mode === 'edit' && !state.targets.length) {
      addNote(tr('⚠️ 改写模式需要先有目标：在幻灯片里选中文字、文本框或整页，点「＋ 添加选中」（可多次添加）。<br>（只是想提问的话，点上面的「改写 ▾」切换到演示文稿问答）'));
      return;
    }

    if (state.serverOk === false) { addNote(tr('本机服务尚未连接。请打开顶部的连接设置重新检测。')); return; }
    setStreaming(true);
    state.stopRequested = false;
    const ac = new AbortController();
    state.aborter = ac;
    const myReq = ++reqCounter;
    state.curReq = myReq;
    $('#request-status').textContent = tr('正在读取幻灯片…');
    try {
      // 组上下文；sentTargets 是本轮请求的目标快照（编号按页码顺序）
      let doc = { docTitle: docTitle() };
      let sentTargets = [];
      if (state.targets.length) {
        const ctx = await getEditContext();
        if (state.curReq !== myReq || ac.signal.aborted) return;
        if (!ctx.ok) {
          if (mode === 'edit') { addNote('⚠️ ' + escapeHtml(uiText(ctx.error) || tr('拿不到上下文'))); return; }
        } else {
          // 目标被手动编辑过：以幻灯片现状为准，校准基线
          state.targets = ctx.targets;
          state.docChars = ctx.docChars;
          state.slideCount = ctx.slideCount;
          saveTargets();
          renderTargetBar();
          if (ctx.lost) addNote(tr`⚠️ 有 ${ctx.lost} 处目标在幻灯片里找不到了（文字被改动或形状被删除），已移除`);
          sentTargets = state.targets.map((t, i) => ({ ...t, k: i + 1 }));
          Object.assign(doc, {
            targets: sentTargets.map((t) => ({
              k: t.k,
              text: t.text,
              kind: t.kind,
              rows: t.values ? t.values.length : 0,
              cols: t.values && t.values[0] ? t.values[0].length : 0,
              where: `第 ${t.slideNo} 页的${ROLE_ZH[t.role] || '文字'}${t.whole || t.kind === 'table' ? '' : '（部分文字）'}`,
            })),
            fullText: ctx.fullText,
            truncated: ctx.truncated,
            docChars: ctx.docChars,
            slideCount: ctx.slideCount,
          });
        }
      }
      if (!doc.fullText) {
        const w = await getWholeDeck();
        if (!w.ok) { addNote(tr('读取幻灯片失败：') + escapeHtml(uiText(w.error) || tr('请稍后重试'))); return; }
        Object.assign(doc, { fullText: w.fullText, truncated: w.truncated, docChars: w.docChars, slideCount: w.slideCount });
        state.docChars = w.docChars;
        state.slideCount = w.slideCount;
      }
      if (mode === 'edit' && !sentTargets.length) { addNote(tr('⚠️ 目标读取失败，请重试')); return; }

      if (state.curReq !== myReq || ac.signal.aborted) return;
      const sendBackend = cfg.backend;
      const sentContextKey = contextKey(doc, cfg);
      const prior = state.cliContext[sendBackend];
      if (!prior || prior.key !== sentContextKey || prior.turns !== state.messages.length) {
        state.cliSession[sendBackend] = null; state.sentAtts[sendBackend] = [];
      }
      const requestAttachments = [...state.attachments];
      if (els.input.value.trim() === text) { els.input.value = ''; autoGrow(); saveDraft(); }

      const textAtts = state.attachments.filter((a) => a.kind === 'text');
      const binAtts = state.attachments.filter((a) => a.kind === 'binary');
      if (textAtts.length) doc.extraFiles = textAtts.map((a) => ({ name: a.name, text: a.text, truncated: a.truncated }));
      // 续写模式下本轮 prompt 只带"新增附件"（旧的已在 CLI 会话记忆里）；
      // 完整附件仍随 payload 带上，供续写失效时回退重建用
      const sentIds = state.sentAtts[sendBackend] || [];
      doc.newExtraNames = textAtts.filter((a) => !sentIds.includes(a.id)).map((a) => a.name);
      const newAttIdx = [];
      binAtts.forEach((a, i) => { if (!sentIds.includes(a.id)) newAttIdx.push(i); });

      // 用户气泡
      const uBubble = addMessageEl('user');
      let uHtml = `<div>${(isRetry ? '🔁 ' : '') + escapeHtml(text).replace(/\n/g, '<br>')}</div>`;
      if (state.attachments.length) {
        uHtml += `<div class="att-line">📎 ${state.attachments.map((a) => escapeHtml(a.slide ? tr`第 ${a.slide} 页截图` : a.name)).join(' · ')}</div>`;
      }
      uBubble.innerHTML = uHtml;
      state.messages.push({ role: 'user', content: text });

      const aBubble = addMessageEl('assistant');
      aBubble.innerHTML = tr('<span class="typing">思考中<span>.</span><span>.</span><span>.</span></span>');

      let raw = '';
      let thinking = '';
      let rafPending = false, finalized = false;
      const via = {
        backend: cfg.backend,
        model: cfg.backend === 'codex' ? cfg.model_codex : cfg.model_claude,
        effort: cfg.effort,
      };
      const requestedModel = via.model;
      delete observedModels[via.backend][requestedModel];
      renderModelDetail();
      if (via.backend === 'codex' && via.model === '(default)') via.model = tr('本机默认模型');

      const scheduleRender = (final) => {
        if (state.curReq !== myReq) return; // 这条请求已被强制停止作废，别再动界面
        if (rafPending && !final) return;
        rafPending = true;
        requestAnimationFrame(() => {
          rafPending = false;
          if (finalized || state.curReq !== myReq) return;
          const nearBottom = els.messages.scrollHeight - els.messages.scrollTop - els.messages.clientHeight < 90;
          let html = '';
          if (thinking.trim()) {
            html += tr`<details class="think"><summary>💭 思考过程</summary><div>${escapeHtml(thinking)}</div></details>`;
          }
          let show = raw;
          if ((raw.match(/```/g) || []).length % 2 === 1) show = raw + '\n```';
          html += renderMarkdown(show) || tr('<span class="typing">思考中<span>.</span><span>.</span><span>.</span></span>');
          aBubble.innerHTML = html;
          if (nearBottom) els.messages.scrollTop = els.messages.scrollHeight;
        });
      };

      const payload = {
        backend: cfg.backend,
        model: cfg.backend === 'codex' ? cfg.model_codex : cfg.model_claude,
        effort: cfg.effort,
        mode,
        uiLanguage: I18N.language,
        doc,
        attachments: binAtts.map((a) => ({ name: a.name, mime: a.mime, b64: a.b64 })),
        cliSession: { ...state.cliSession },
        newAttIdx,
        messages: state.messages.filter((m) => !m.failed).map((m) => ({ role: m.role, content: m.content })),
      };
      let sawDelta = false, sawDone = false, requestFailed = false;
      let requestPhase = tr('正在连接模型');

      const handleEvt = (evt) => {
        if (state.curReq !== myReq || ac.signal.aborted) return;
        if (evt.type === 'done') { sawDone = true; if (evt.ok === false) requestFailed = true; }
        else if (evt.type === 'status') requestPhase = uiText(evt.text) || tr('正在生成');
        else if (evt.type === 'delta') { sawDelta = true; raw += evt.text; scheduleRender(); }
        else if (evt.type === 'thinking') { thinking += evt.text; scheduleRender(); }
        else if (evt.type === 'model') {
          if (evt.model) {
            via.model = evt.model;
            observedModels[via.backend][requestedModel] = evt.model;
            renderModelDetail();
          }
        }
        else if (evt.type === 'meta') { via.resumed = !!evt.resume; }
        else if (evt.type === 'cli_session') { if (evt.backend) state.cliSession[evt.backend] = evt.id || null; }
        else if (evt.type === 'note') { via.resumed = false; if (evt.text) addNote(escapeHtml(uiText(evt.text))); }
        else if (evt.type === 'error') { requestFailed = true; raw += (raw ? '\n\n' : '') + tr`⚠️ **出错了**：\n\n${uiText(evt.error)}${evt.hint ? '\n\n' + uiText(evt.hint) : ''}`; scheduleRender(); }
      };

      // —— 硬化过的流式请求 ——
      // Office 的 WebKit 有两个坑：① abort() 后挂起的 read() 可能永不返回（停止要靠 reader.cancel()）
      // ② 连接静默死亡时 read() 也会永远挂着。服务端每 15 秒发一次心跳，健康连接不会超过
      //    15 秒没字节，所以 45 秒没字节 = 连接已死，看门狗主动断开，不让界面卡死。
      const CONNECT_TIMEOUT_MS = 20000;
      const READ_STALL_MS = 45000;
      const startedAt = Date.now();
      // 长时间没输出时显示已等待秒数，免得"思考中…"看起来像卡死
      const ticker = setInterval(() => {
        if (state.curReq !== myReq || !state.streaming) return;
        $('#request-status').textContent = `${raw ? tr('正在生成') : requestPhase} · ${Math.round((Date.now() - startedAt) / 1000)}s`;
        if (raw || thinking.trim()) return;
        const s = Math.round((Date.now() - startedAt) / 1000);
        if (s >= 5) {
          aBubble.innerHTML = tr('<span class="typing">思考中<span>.</span><span>.</span><span>.</span></span>') +
            ` <span class="wait-sec">${s}s${s >= 30 ? tr(' · effort 高时要几分钟，可点 ⏹ 停止') : ''}</span>`;
        }
      }, 1000);

      let connectTimer;
      try {
        const resp = await Promise.race([
          fetch(API + '/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: ac.signal,
          }),
          new Promise((_, rej) => { connectTimer = setTimeout(() => rej(new Error('__CONNECT__')), CONNECT_TIMEOUT_MS); }),
        ]);
        clearTimeout(connectTimer);
        if (ac.signal.aborted || state.curReq !== myReq) { resp.body?.cancel().catch(() => {}); return; }
        if (!resp.ok) { let err; try { err = await resp.json(); } catch {} throw new Error(uiText(err?.error) || tr`服务返回 HTTP ${resp.status}`); }
        if (resp.body && resp.body.getReader) {
          const reader = resp.body.getReader();
          state.reader = reader;
          const dec = new TextDecoder();
          let buf = '';
          for (;;) {
            let stallTimer;
            let step;
            try {
              step = await Promise.race([
                reader.read(),
                new Promise((_, rej) => { stallTimer = setTimeout(() => rej(new Error('__STALL__')), READ_STALL_MS); }),
              ]);
            } finally { clearTimeout(stallTimer); }
            if (step.done) {
              buf += dec.decode();
              if (buf.trim()) handleEvt(JSON.parse(buf));
              break;
            }
            buf += dec.decode(step.value, { stream: true });
            let i;
            while ((i = buf.indexOf('\n')) >= 0) {
              const line = buf.slice(0, i);
              buf = buf.slice(i + 1);
              if (!line.trim()) continue;
              handleEvt(JSON.parse(line));
            }
          }
        } else {
          // 老 webview 不支持流式读取：整包拿回来再解析
          const whole = await resp.text();
          for (const line of whole.split('\n')) {
            if (line.trim()) { try { handleEvt(JSON.parse(line)); } catch {} }
          }
        }
        if (!sawDone && !state.stopRequested) throw new Error(tr('连接在完成前中断，请重试。'));
      } catch (e) {
        requestFailed = true;
        ac.abort();
        if (state.curReq !== myReq) return;
        if (state.reader) { try { state.reader.cancel().catch(() => {}); } catch {} } // 别让死连接继续占着
        const msg = String((e && e.message) || e);
        if (e && e.name === 'AbortError') {
          raw += raw ? tr('\n\n_（已停止）_') : tr('_（已停止）_');
        } else if (msg === '__CONNECT__') {
          try { ac.abort(); } catch {}
          raw += (raw ? '\n\n' : '') +
            tr('⚠️ **连不上本机服务**（20 秒无响应）。终端里重启服务后点 🔁 重试：\n\n`npm run update`');
          ping();
        } else if (msg === '__STALL__') {
          raw += (raw ? '\n\n' : '') +
            tr('⚠️ **连接停滞**（45 秒没收到任何数据，已主动断开）。点 🔁 重试；反复出现就重启服务：\n\n`npm run update`');
          ping();
        } else {
          const hint = /load failed|network/i.test(msg)
            ? tr('（连接中途断了。点 🔁 重试；持续出现就重启服务，可在连接设置查看日志路径）')
            : '';
          raw += (raw ? '\n\n' : '') + tr`⚠️ **请求失败**：${msg}${hint}`;
          ping();
        }
        scheduleRender(true);
      } finally { clearInterval(ticker); clearTimeout(connectTimer); }
      if (state.curReq !== myReq) return;
      state.reader = null;
      // 走 reader.cancel() 停下来的（循环正常结束，不抛 AbortError）也要标注"已停止"
      if (state.stopRequested && !raw.includes(tr('_（已停止）_'))) {
        raw += raw ? tr('\n\n_（已停止）_') : tr('_（已停止）_');
        scheduleRender(true);
      }
      // 已被强制停止作废的请求：到此为止，界面早已复位，别再写任何东西
      if (state.curReq !== myReq) return;
      state.aborter = null;
      const successful = sawDone && sawDelta && !requestFailed && !state.stopRequested;
      finalized = true;
      if (!successful) { state.cliSession[sendBackend] = null; state.sentAtts[sendBackend] = []; }

      // 收尾渲染
      state.messages.push({ role: 'assistant', content: raw || tr('（无输出）'), via: { ...via }, failed: !successful });
      state.cliContext[sendBackend] = successful ? { key: sentContextKey, turns: state.messages.length } : null;
      // 本轮成功且 CLI 会话在册 → 当前所有附件都已进入该会话的记忆，下轮不必重发
      if (successful && state.cliSession[sendBackend]) {
        state.sentAtts[sendBackend] = requestAttachments.map((a) => a.id);
      }
      saveHistory();
      renderTargetBar(); // 刷新"可续聊"标识
      if (!state.longNoteShown && state.messages.length >= LONG_SESSION_MSGS) {
        state.longNoteShown = true;
        setTimeout(() => addNote(tr('💡 这个会话有点长了。建议点右上角 <b>＋</b> 开新会话：旧会话自动归档到 ◷ 历史，并<b>重新读取全篇上下文</b>，回复会更快更准。')), 400);
      }
      const reps = mode === 'edit' && successful ? parseReplacements(raw, sentTargets.length) : null;
      let html = '';
      if (thinking.trim()) {
        html += tr`<details class="think"><summary>💭 思考过程</summary><div>${escapeHtml(thinking)}</div></details>`;
      }
      if (reps && reps.length) {
        const note = stripFences(raw, reps);
        if (note) html += renderMarkdown(note);
        aBubble.innerHTML = html;
        const multi = sentTargets.length > 1;
        const applyFns = [];
        for (const r of reps) {
          const tk = sentTargets.find((t) => t.k === r.k) || null;
          applyFns.push(attachReplacementCard(aBubble, tk, r.code, null, multi, r.lang));
        }
        if (multi && reps.length < sentTargets.length) {
          const missing = sentTargets.filter((t) => !reps.some((r) => r.k === t.k)).map((t) => t.k);
          const d = document.createElement('div');
          d.className = 'warnbox';
          d.textContent = tr`模型未输出目标 ${missing.join('、')} 的替换（视为无需改动）。`;
          aBubble.appendChild(d);
        }
        if (applyFns.length > 1) {
          const bar = document.createElement('div');
          bar.className = 'applyall';
          const btn = document.createElement('button');
          btn.className = 'btn btn-primary';
          btn.textContent = tr`✅ 应用全部（${applyFns.length} 处）`;
          btn.addEventListener('click', async () => {
            btn.disabled = true;
            let okCount = 0;
            for (const fn of applyFns) { if (await fn()) okCount++; }
            btn.textContent = tr`✅ 全部应用完成（成功 ${okCount}/${applyFns.length}）`;
          });
          bar.appendChild(btn);
          aBubble.appendChild(bar);
        }
        const foot = document.createElement('div');
        foot.innerHTML = footHtml(via);
        if (foot.firstChild) aBubble.appendChild(foot.firstChild);
      } else {
        html += renderMarkdown(raw) || tr('<i class="muted">（无输出）</i>');
        if (!successful) {
          html += tr('<div class="warnbox">本轮未完成，已保留输出供查看。请重试后再应用改写。</div>');
        } else if (mode === 'edit' && raw.trim()) {
          html += tr`<div class="warnbox">未能把回复解析成替换文本${sentTargets.length > 1 ? tr('（多目标需要每段带【目标k】标签的 \`\`\`text 围栏）') : tr('（需要 \`\`\`text 围栏）')}，无法一键应用。可以「🔁 重试」或换个说法。</div>`;
        }
        html += footHtml(via);
        aBubble.innerHTML = html;
        if (!successful || (mode === 'edit' && raw.trim())) {
          const retryBtn = document.createElement('button');
          retryBtn.className = 'btn';
          retryBtn.textContent = tr('🔁 重试');
          retryBtn.addEventListener('click', () => {
            if (state.streaming) return;
            const lastUser = [...state.messages].reverse().find((m) => m.role === 'user');
            if (lastUser) sendInstruction(lastUser.content, { isRetry: true });
          });
          aBubble.appendChild(retryBtn);
        }
      }
      els.messages.scrollTop = els.messages.scrollHeight;
    } catch (e) {
      if (state.curReq === myReq) addNote(tr('读取或发送失败：') + escapeHtml(e?.message || e));
    } finally {
      if (state.curReq === myReq) { state.aborter = null; setStreaming(false); }
    }
  }

  function stopStream() {
    state.stopRequested = true;
    state.cliSession[state.cfg.backend] = null;
    state.cliContext[state.cfg.backend] = null;
    $('#request-status').textContent = tr('正在停止…');
    // 顺序很重要：先 cancel 读取器（让挂着的 read() 立刻落地——Office 的 WebKit 里
    // 光 abort() 会让 read() 永远悬着），再 abort 请求。
    if (state.reader) { try { state.reader.cancel().catch(() => {}); } catch {} }
    if (state.aborter) { try { state.aborter.abort(); } catch {} }
    // 最后一道保险：2 秒后界面还没恢复，就强制复位并作废这次请求（其迟到的输出全部丢弃）
    const req = state.curReq;
    setTimeout(() => {
      if (state.streaming && state.curReq === req) {
        state.curReq = -1;
        state.aborter = null;
        state.reader = null;
        setStreaming(false);
        addNote(tr('⏹ 已强制停止'));
      }
    }, 2000);
  }
  function setStreaming(v) {
    state.streaming = v;
    els.send.classList.toggle('hidden', v);
    els.stop.classList.toggle('hidden', !v);
    for (const id of ['sel-language', 'sel-backend', 'sel-model', 'sel-effort', 'btn-reload', 'mode-edit', 'mode-ask', 'btn-capture', 'btn-clear', 'btn-new', 'btn-hist', 'att-local', 'att-slide', 'btn-models']) {
      const el = $('#' + id); if (el) el.disabled = v || (id === 'att-slide' && !state.api.v18 && state.pptReady);
    }
    els.messages.setAttribute('aria-busy', String(v));
    if (!v) $('#request-status').textContent = '';
  }

  // ---------- 会话管理 ----------
  async function newSession() {
    if (state.streaming) return;
    if (state.messages.length) {
      const list = getArchive();
      list.unshift(sessionEntry(state.messages));
      setArchive(list);
    }
    state.messages = [];
    state.longNoteShown = false;
    state.cliContext = { claude: null, codex: null };
    state.cliSession = { claude: null, codex: null }; // 清掉 CLI 会话：下一轮重新读全篇、重建缓存
    state.sentAtts = { claude: [], codex: [] };
    els.messages.innerHTML = '';
    clearHistory();
    renderWelcome();
    if (state.targets.length) {
      await refreshTargets(true);
      if (state.targets.length) {
        addNote(tr`🆕 新会话已开启（旧会话在历史里）。已重新读取全篇 ${state.slideCount} 页 ~${Math.max(1, Math.round(state.docChars / 1000))}k 字符，${state.targets.length} 处目标仍有效。`);
      } else {
        addNote(tr('🆕 新会话已开启（旧会话在历史里）。原目标在幻灯片里找不到了，请重新选中添加。'));
      }
    } else {
      addNote(tr('🆕 新会话已开启（旧会话在历史里）。'));
    }
  }

  function mkBtn(label, onClick) {
    const b = document.createElement('button');
    b.className = 'hbtn';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }
  function openHistView() {
    const list = getArchive();
    const wrap = els.histList;
    wrap.innerHTML = '';

    const cur = document.createElement('div');
    cur.className = 'hist-item hist-cur';
    const curMeta = document.createElement('div');
    curMeta.className = 'hist-meta';
    curMeta.textContent = tr`当前会话 · ${state.messages.length} 条消息`;
    cur.appendChild(curMeta);
    const curBtns = document.createElement('div');
    curBtns.className = 'hist-btns';
    const curCopy = mkBtn(tr('📋 复制整段'), () => copyText(sessionMarkdown(state.messages), curCopy));
    curBtns.appendChild(curCopy);
    cur.appendChild(curBtns);
    wrap.appendChild(cur);

    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'hist-empty';
      empty.textContent = tr('还没有归档的会话。开新会话时，旧会话会自动归档到这里（每份演示文稿最多留 10 段）。');
      wrap.appendChild(empty);
    }

    list.forEach((s, i) => {
      const item = document.createElement('div');
      item.className = 'hist-item';
      const meta = document.createElement('div');
      meta.className = 'hist-meta';
      meta.textContent = tr`${fmtTime(s.ts)} · ${s.messages.length} 条消息`;
      const prev = document.createElement('div');
      prev.className = 'hist-prev';
      prev.textContent = s.preview || tr('（无预览）');
      const btns = document.createElement('div');
      btns.className = 'hist-btns';
      const openB = mkBtn(tr('打开'), () => openSession(i));
      const copyB = mkBtn(tr('📋 复制整段'), () => copyText(sessionMarkdown(s.messages), copyB));
      const delB = mkBtn('🗑', () => {
        const l = getArchive();
        l.splice(i, 1);
        setArchive(l);
        openHistView();
      });
      btns.append(openB, copyB, delB);
      item.append(meta, prev, btns);
      wrap.appendChild(item);
    });

    els.histView.classList.remove('hidden');
    $('#hist-close').focus();
  }
  async function openSession(i) {
    if (state.streaming) return;
    const list = getArchive();
    const s = list[i];
    if (!s) return;
    list.splice(i, 1);
    if (state.messages.length) list.unshift(sessionEntry(state.messages));
    setArchive(list);
    state.cliContext = { claude: null, codex: null, ...(s.cliContext || {}) };
    state.messages = s.messages;
    state.longNoteShown = false;
    state.cliSession = { claude: null, codex: null, ...(s.cliSession || {}) };
    state.sentAtts = { claude: [], codex: [], ...(s.sentAtts || {}) };
    els.messages.innerHTML = '';
    renderHistoryMsgs();
    renderTargetBar();
    saveHistory();
    els.histView.classList.add('hidden');
    addNote(tr('🕘 已切回历史会话（它的缓存会话一并恢复：能续写就续写，失效则自动重读全篇）。改写前请确认目标列表里还是你想改的那几处。'));
  }
  function renderHistoryMsgs() {
    for (const m of state.messages) {
      const b = addMessageEl(m.role === 'assistant' ? 'assistant' : 'user');
      if (m.role === 'assistant') b.innerHTML = renderMarkdown(m.content) + footHtml(m.via);
      else b.innerHTML = `<div>${escapeHtml(m.content).replace(/\n/g, '<br>')}</div>`;
    }
  }

  // ---------- 选区提示（帮用户意识到"先选中再点＋"）----------
  let selTimer = 0;
  let selSeq = 0;
  function onDocSelectionChanged() {
    clearTimeout(selTimer);
    selTimer = setTimeout(async () => {
      if (!state.pptReady) return;
      const mySeq = ++selSeq;
      const r = await pptRun(async (ctx) => {
        const cur = await readSelection(ctx);
        return { ok: true, chars: cur.text ? cur.text.text.trim().length : 0, shapes: cur.shapes.length, slides: cur.slides.length };
      });
      if (mySeq !== selSeq) return;
      let hint = '';
      let strong = false;
      if (r.ok) {
        if (r.chars && r.shapes <= 1) { hint = tr`已选中 ${r.chars} 字 → 点「＋ 添加选中」设为目标`; strong = true; }
        else if (r.shapes === 1) { hint = tr('已选中 1 个对象 → 点「＋ 添加选中」设为目标'); strong = true; }
        else if (r.shapes) { hint = tr`已选中 ${r.shapes} 个对象 → 点「＋ 添加选中」设为目标`; strong = true; }
        else if (r.slides > 1) { hint = tr`已选中 ${r.slides} 页 → 点「＋ 添加选中」添加这几页的全部文字`; strong = true; }
        else hint = tr('没有选中内容时，「＋ 添加选中」会添加当前页的全部文字');
      }
      els.selHint.textContent = hint;
      els.capture.classList.toggle('has-selection', strong);
      els.capture.title = hint || tr('把选中的文字、文本框、表格或当前页添加为改写目标');
    }, 350);
  }

  // ---------- UI 绑定 ----------
  const els = {};
  function grabEls() {
    Object.assign(els, {
      statusDot: $('#status-dot'),
      settingsBtn: $('#btn-settings'),
      settingsPop: $('#settings-pop'),
      modeSummary: $('#mode-summary'),
      contextSummary: $('#context-summary'),
      capture: $('#btn-capture'),
      statusText: $('#status-text'),
      banner: $('#banner'),
      backend: $('#sel-backend'),
      model: $('#sel-model'),
      effort: $('#sel-effort'),
      modeEdit: $('#mode-edit'),
      modeAsk: $('#mode-ask'),
      targetBar: $('#target-bar'),
      targetInfo: $('#target-info'),
      targetList: $('#target-list'),
      selHint: $('#sel-hint'),
      presets: $('#presets'),
      messages: $('#messages'),
      input: $('#input'),
      send: $('#btn-send'),
      stop: $('#btn-stop'),
      attChips: $('#att-chips'),
      fileInput: $('#file-input'),
      histView: $('#hist-view'),
      histList: $('#hist-list'),
    });
  }
  function renderModelDetail() {
    const backend = state.cfg.backend;
    const selected = backend === 'codex' ? state.cfg.model_codex : state.cfg.model_claude;
    const actual = observedModels[backend]?.[selected];
    const detail = modelDetails[backend]?.[selected];
    const el = $('#model-detail');
    if (actual) el.textContent = tr`最近调用实际模型：${actual}`;
    else if (detail?.resolvedModel) el.textContent = tr`CLI 当前解析：${detail.resolvedModel}（${selected} 自动版本）`;
    else if (backend === 'claude' && ['sonnet', 'opus', 'haiku'].includes(selected)) el.textContent = tr`${selected} 自动版本 · 尚未取得具体版本，调用后显示实际模型`;
    else el.textContent = selected === '(default)' ? tr('模型按本机 Codex 配置解析') : tr`请求模型：${selected}`;
    el.title = detail?.description || el.textContent;
    els.model.title = el.textContent;
  }
  function fillModelOptions() {
    const list = [...(MODELS[state.cfg.backend] || MODELS.claude)];
    const saved = state.cfg.backend === 'codex' ? state.cfg.model_codex : state.cfg.model_claude;
    if (typeof saved === 'string' && saved && !list.some(([v]) => v === saved)) list.push([saved, saved + tr(' · 已保存')]);
    els.model.innerHTML = list.map(([v, label]) => `<option value="${escapeHtml(v)}">${escapeHtml(uiText(label))}</option>`).join('');
    const want = state.cfg.backend === 'codex' ? state.cfg.model_codex : state.cfg.model_claude;
    els.model.value = list.some(([v]) => v === want) ? want : list[0][0];
    // 列表刷新后原选择可能已不存在，把实际生效的值写回配置，防止发请求时用到失效模型名
    if (state.cfg.backend === 'codex') state.cfg.model_codex = els.model.value;
    else state.cfg.model_claude = els.model.value;
    fillEffortOptions();
    renderModelDetail();
  }
  // 模型设置收在「设置」浮层里；当前后端 · 模型 · 思考强度显示在「设置」按钮的提示里。
  function renderEngineSummary() {
    const label = (select) => select.selectedOptions?.[0]?.textContent?.trim() || '';
    const effort = EFFORT_LABELS[els.effort.value] ? tr(EFFORT_LABELS[els.effort.value]) : els.effort.value;
    const summary = [label(els.backend), label(els.model), effort].filter(Boolean).join(' · ');
    els.settingsBtn.title = summary ? `${tr('模型、模式与目标设置')} · ${summary}` : tr('模型、模式与目标设置');
  }
  // 设置浮层：盖在对话区上方，点外面或按 Esc 收起，不常驻占用侧栏高度。
  function showSettings(open) {
    els.settingsPop.classList.toggle('hidden', !open);
    els.settingsBtn.setAttribute('aria-expanded', String(!!open));
    if (open) {
      const top = els.settingsPop.parentElement.getBoundingClientRect().top;
      els.settingsPop.style.maxHeight = top > 0 ? `${Math.max(160, window.innerHeight - top - 14)}px` : '';
    }
  }
  function fillEffortOptions() {
    const key = 'effort_' + state.cfg.backend;
    const levels = state.cfg.backend === 'codex' ? (modelEfforts.codex?.[els.model.value] || ['low', 'medium', 'high', 'xhigh']) : EFFORTS;
    const want = state.cfg[key] || state.cfg.effort;
    els.effort.innerHTML = levels.map((e) => `<option value="${escapeHtml(e)}">${escapeHtml(tr(EFFORT_LABELS[e] || e))} · ${escapeHtml(e)}</option>`).join('');
    els.effort.value = levels.includes(want) ? want : levels.includes('medium') ? 'medium' : levels[0];
    state.cfg.effort = els.effort.value;
    renderEngineSummary();
  }
  // 更新本机 CLI 模型目录及别名解析，见 server/models.js。
  // quiet=true 是面板启动时的自动刷新：失败不打扰。
  async function refreshModelList(quiet) {
    const btn = $('#btn-models');
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = '…';
    try {
      const r = await fetchJson('/api/models' + (quiet ? '' : '?refresh=1'), 18000);
      if (r.efforts) modelEfforts = r.efforts;
      if (r.details) modelDetails = r.details;
      const got = [];
      if (Array.isArray(r.claude) && r.claude.length) { MODELS.claude = r.claude; got.push('claude ' + r.claude.length + tr(' 个')); }
      if (Array.isArray(r.codex) && r.codex.length) { MODELS.codex = r.codex; got.push('codex ' + r.codex.length + tr(' 个')); }
      if (!got.length) throw new Error(tr('两个后端都没探测到模型（CLI 没装好或网络不通？）'));
      try { localStorage.setItem('lp:models', JSON.stringify({ claude: MODELS.claude, codex: MODELS.codex, fetchedAt: r.fetchedAt, efforts: modelEfforts, details: modelDetails })); } catch {}
      if (!state.streaming) { fillModelOptions(); saveCfg(); }
      if (!quiet) {
        const cur = MODELS[state.cfg.backend].find(([v]) => v === els.model.value);
        addNote(tr`🔄 模型列表已更新（${got.join('、')}）。当前选用：${escapeHtml(uiText(cur ? cur[1] : els.model.value))}`);
      }
      if (!quiet && r.warnings?.length) addNote(escapeHtml(r.warnings.map((value) => uiText(value)).join(' ')));
    } catch (e) {
      if (!quiet) addNote(tr('⚠️ 获取模型列表失败：') + escapeHtml(String(e?.message || e)));
    }
    btn.disabled = state.streaming;
    btn.textContent = '⟳';
  }
  // 面板启动后自动刷新一次；后端合并请求并缓存 5 分钟。
  function maybeAutoRefreshModels() {
    if (state.modelsAutoChecked || !state.serverOk) return;
    state.modelsAutoChecked = true;
    refreshModelList(true);
  }
  function renderPresets() {
    const list = PRESETS[state.cfg.mode] || PRESETS.edit;
    els.presets.innerHTML = list.map(([label], i) => `<button class="chip" data-i="${i}">${escapeHtml(tr(label))}</button>`).join('');
    els.presets.querySelectorAll('.chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        els.input.value = tr((PRESETS[state.cfg.mode] || PRESETS.edit)[Number(chip.dataset.i)][1]);
        autoGrow(); saveDraft();
        els.input.focus();
      });
    });
  }
  function setMode(mode) {
    state.cfg.mode = mode;
    els.modeEdit.classList.toggle('active', mode === 'edit');
    els.modeAsk.classList.toggle('active', mode === 'ask');
    els.modeEdit.setAttribute('aria-pressed', String(mode === 'edit'));
    els.modeAsk.setAttribute('aria-pressed', String(mode === 'ask'));
    els.modeSummary.textContent = mode === 'edit' ? tr('改写 ▾') : tr('问答 ▾');
    els.send.innerHTML = mode === 'edit' ? tr('生成改写 <span aria-hidden="true">↑</span>') : tr('发送提问 <span aria-hidden="true">↑</span>');
    $('#instruction-label').textContent = mode === 'edit' ? tr('告诉我怎么改') : tr('想了解演示文稿的什么');
    renderPresets();
    els.input.placeholder = mode === 'edit'
      ? tr('比如：每条要点压到一行，保留数据…')
      : tr('比如：这份演示文稿的主线清楚吗？…');
    renderContextSummary();
    saveCfg();
  }
  function autoGrow() {
    els.input.style.height = 'auto';
    els.input.style.height = Math.min(140, els.input.scrollHeight) + 'px';
  }
  function bindEvents() {
    $('#sel-language').value = I18N.language;
    $('#sel-language').addEventListener('change', () => {
      if (state.streaming) { $('#sel-language').value = I18N.language; return; }
      I18N.setLanguage($('#sel-language').value);
      I18N.applyStatic(document);
      fillModelOptions(); setMode(state.cfg.mode); refreshStatusUI(); renderTargetBar();
      if (!state.messages.length) { $('.welcome')?.remove(); renderWelcome(); }
      // 已有对话内容保持原语言，只翻译面板自己的控件
      document.querySelectorAll('#messages .btn, .card .tab, .card-title, .card-status, .warnbox, .think summary').forEach((el) => {
        if (el.children.length === 0) el.textContent = uiText(el.textContent);
        if (el.title) el.title = uiText(el.title);
      });
      document.querySelectorAll('.tbl-note').forEach((el) => { el.textContent = el.textContent.split(' · ').map((value) => uiText(value)).join(' · '); });
      if (!$('#hist-view').classList.contains('hidden')) openHistView();
      if (!$('#connection-view').classList.contains('hidden')) diagnose();
      renderAttachChips();
      onDocSelectionChanged();
    });
    $('#btn-connection').addEventListener('click', () => { $('#connection-view').classList.remove('hidden'); $('#connection-close').focus(); diagnose(); });
    $('#connection-close').addEventListener('click', () => { $('#connection-view').classList.add('hidden'); $('#btn-connection').focus(); });
    $('#btn-diagnose').addEventListener('click', () => diagnose());
    $('#btn-capture').addEventListener('click', () => { if (state.pptReady && !state.streaming) addTarget(); else if (!state.pptReady) addNote(tr('请在 PowerPoint 加载项中选中内容，再添加目标。')); });
    $('#btn-clear').addEventListener('click', clearTargets);
    $('#btn-new').addEventListener('click', newSession);
    $('#btn-hist').addEventListener('click', openHistView);
    $('#hist-close').addEventListener('click', () => { els.histView.classList.add('hidden'); $('#btn-hist').focus(); });
    $('#btn-reload').addEventListener('click', () => location.reload());
    $('#btn-models').addEventListener('click', () => refreshModelList(false));
    $('#att-local').addEventListener('click', () => els.fileInput.click());
    $('#att-slide').addEventListener('click', attachSlideImage);
    els.fileInput.addEventListener('change', async () => {
      const files = [...(els.fileInput.files || [])];
      els.fileInput.value = '';
      if (files.length) await addLocalFiles(files);
    });
    els.send.addEventListener('click', send);
    els.stop.addEventListener('click', stopStream);

    els.backend.value = state.cfg.backend;
    els.backend.addEventListener('change', () => {
      state.cfg.backend = els.backend.value;
      refreshStatusUI();
      fillModelOptions();
      renderTargetBar(); // "可续聊"标识按后端分别显示
      saveCfg();
    });
    fillEffortOptions();
    els.effort.addEventListener('change', () => { state.cfg.effort = els.effort.value; state.cfg['effort_' + state.cfg.backend] = els.effort.value; renderEngineSummary(); saveCfg(); });
    els.settingsBtn.addEventListener('click', () => showSettings(els.settingsPop.classList.contains('hidden')));
    els.modeSummary.addEventListener('click', () => { showSettings(true); (state.cfg.mode === 'ask' ? els.modeAsk : els.modeEdit).focus(); });
    els.contextSummary.addEventListener('click', () => showSettings(true));
    document.addEventListener('pointerdown', (e) => {
      if (els.settingsPop.classList.contains('hidden') || els.settingsPop.contains(e.target)) return;
      if ([els.settingsBtn, els.modeSummary, els.contextSummary].some((el) => el.contains(e.target))) return;
      if (e.target.closest?.('.overlay')) return; // 连接设置、会话历史盖在最上层
      showSettings(false);
    });
    els.model.addEventListener('change', () => {
      if (state.cfg.backend === 'codex') state.cfg.model_codex = els.model.value;
      else state.cfg.model_claude = els.model.value;
      fillEffortOptions();
      renderModelDetail();
      saveCfg();
    });
    els.modeEdit.addEventListener('click', () => setMode('edit'));
    els.modeAsk.addEventListener('click', () => setMode('ask'));

    els.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); send(); }
    });
    els.input.addEventListener('input', () => { autoGrow(); saveDraft(); });
    const composer = $('.composer');
    composer.addEventListener('dragover', (e) => { if (!state.streaming && e.dataTransfer?.types.includes('Files')) { e.preventDefault(); composer.classList.add('dragover'); } });
    composer.addEventListener('dragleave', (e) => { if (!composer.contains(e.relatedTarget)) composer.classList.remove('dragover'); });
    composer.addEventListener('drop', (e) => { e.preventDefault(); composer.classList.remove('dragover'); if (!state.streaming && e.dataTransfer?.files.length) addLocalFiles([...e.dataTransfer.files]); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        for (const [view, opener] of [['#connection-view', '#btn-connection'], ['#hist-view', '#btn-hist']]) {
          if (!$(view).classList.contains('hidden')) { $(view).classList.add('hidden'); $(opener).focus(); return; }
        }
        if (!els.settingsPop.classList.contains('hidden')) { showSettings(false); els.settingsBtn.focus(); return; }
      }
      if (e.key === 'Tab') {
        const overlay = document.querySelector('.overlay:not(.hidden)');
        if (!overlay) return;
        const focusable = [...overlay.querySelectorAll('button:not(:disabled), [tabindex="0"]')];
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    });
  }

  // ---------- 启动 ----------
  function init() {
    I18N.applyStatic(document);
    grabEls();
    loadCfg();
    bindEvents();
    fillModelOptions();
    setMode(state.cfg.mode === 'ask' ? 'ask' : 'edit');
    renderTargetBar();
    renderWelcome(); restoreDraft(); ping();
    if (typeof fetch === 'function') setInterval(ping, 30000);

    if (typeof Office === 'undefined') {
      els.banner.innerHTML = tr('⚠️ office.js 加载失败（微软 CDN 不可达？）。检查网络后点 ⟳ 刷新。');
      els.banner.classList.remove('hidden');
      refreshStatusUI();
      return;
    }

    Office.onReady((info) => {
      const isPpt = info.host === Office.HostType.PowerPoint;
      let hasSel = false;
      try { hasSel = Office.context.requirements.isSetSupported('PowerPointApi', '1.5'); } catch {}
      state.pptReady = isPpt && hasSel;
      if (!state.pptReady) {
        els.banner.textContent = isPpt
          ? tr('⚠️ 这个版本的 PowerPoint 太旧（需要 PowerPointApi 1.5，即 2022 年以后的版本）。请更新 PowerPoint。')
          : tr('⚠️ 本加载项只支持 PowerPoint。');
        els.banner.classList.remove('hidden');
        refreshStatusUI();
        return;
      }
      const has = (v) => { try { return Office.context.requirements.isSetSupported('PowerPointApi', v); } catch { return false; } };
      state.api = { v18: has('1.8'), v19: has('1.9'), v110: has('1.10') };
      const slideBtn = $('#att-slide');
      slideBtn.disabled = !state.api.v18;
      if (!state.api.v18) slideBtn.title = tr('当前 PowerPoint 版本不支持截取幻灯片（需要 PowerPointApi 1.8）');
      docKey = (() => {
        const u = (Office.context.document.url || 'untitled');
        let h = 0;
        for (let i = 0; i < u.length; i++) h = (h * 31 + u.charCodeAt(i)) >>> 0;
        return h.toString(36);
      })();

      loadHistory(); restoreDraft();
      els.messages.innerHTML = '';
      if (state.messages.length) renderHistoryMsgs();
      else renderWelcome();

      try {
        Office.context.document.addHandlerAsync(Office.EventType.DocumentSelectionChanged, onDocSelectionChanged);
      } catch {}
      onDocSelectionChanged();
      restoreTargets();
      refreshStatusUI();
      ping();
    });
  }

  init();

  // 测试钩子：让 tools/ 里的单测能在 jsdom 里直接测这些纯函数
  try {
    window.__lp_test = { diffOps, diffHtml, planEdits, applyEditsToString, cleanReplacement, normNL, toPptText, parseReplacements, stripFences, buildDeckContext, locateTarget, syncTargets, roleOf, sortShapes };
  } catch {}
})();
