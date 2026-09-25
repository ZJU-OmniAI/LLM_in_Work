// LLM_in_Word 任务窗格逻辑：
// 选中正文 → 🎯 添加为目标（用隐形内容控件锚定，可多段分散；文档再怎么编辑位置都不丢）→
// 下指令 → 本机服务流式回复 → 每个目标一张 diff 预览卡 → ✅ 应用替换（可走 Word 修订模式，
// 应用时做逐字格式迁移，尽量保留原格式）。
// UI 流程从 LLM_in_Overleaf 的 content.js 移植，编辑器操作从 CM6 换成 Office.js。
(() => {
  'use strict';

  const tr = window.WordI18n.t;
  const uiText = window.WordI18n.known;

  const TAG = 'word_edit_target'; // Stable legacy tag preserves existing document targets. // 目标内容控件的标记，靠它跨会话找回目标
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

  // 快捷指令（点一下填进输入框，可再编辑）
  const PRESETS = [
    ['润色', '润色这些文字，使表达更清晰、更通顺；保持原意、事实和数据不变'],
    ['修语法', '修正错别字、语法和标点问题，尽量少改动措辞'],
    ['精简', '在保留所有关键信息的前提下压缩这些文字，删掉冗余表达'],
    ['扩写', '把这些内容扩写得更充分：补足逻辑衔接和必要细节，风格与全文保持一致'],
    ['更书面', '把这些文字改得更正式、更书面化，适合报告/公文场合'],
    ['译成英文', '把这些文字翻译成地道的英文，语域与原文一致'],
  ];

  const SOFT_SEL_LIMIT = 60000;   // 目标合计超过这个字符数给出警告（还是允许发）
  const CTX_CAP = 110000;         // 随请求附带的全文上限（超过就截取目标周边）
  const LONG_SESSION_MSGS = 14;   // 消息数达到这个阈值提醒开新会话
  const MAX_TARGETS = 8;          // 目标段数量上限

  // 附件限制
  const TEXT_EXTS = ['txt', 'md', 'csv'];
  const BIN_EXTS = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
  const TEXT_CAP = 50000;
  const BIN_CAP = 10 * 1024 * 1024;
  const MAX_FILES = 8;
  const TOTAL_BIN_CAP = 25 * 1024 * 1024;

  // ---------- 运行状态 ----------
  const state = {
    cfg: { backend: 'claude', model_claude: 'sonnet', model_codex: '(default)', effort: 'medium', mode: 'edit', tracked: true },
    targets: [],       // [{ ccId, text, applied }] 按文档顺序；位置由文档里的内容控件锚定
    docChars: 0,       // 最近一次读取的全文字符数（目标条上展示"附全文 ~Xk"）
    messages: [],      // { role: 'user'|'assistant', content, via? }
    streaming: false,
    aborter: null,
    reader: null,        // 流式读取器：停止时必须 cancel 它（Word 的 WebKit 里光 abort 会挂死 read()）
    curReq: 0,           // 当前请求编号：强制恢复后，旧请求迟到的输出直接丢弃
    stopRequested: false,
    serverOk: null,
    wordReady: false,
    has14: false,      // WordApi 1.4：修订模式 + getReviewedText
    longNoteShown: false,
    attachments: [],   // { id, name, kind:'text'|'binary', mime, text?, b64?, size, truncated }
    cliSession: { claude: null, codex: null }, // CLI 会话 id：有值=后续轮"续写+服务端缓存"，🆕 清空
    cliContext: { claude: null, codex: null },
    health: null,
    sentAtts: { claude: [], codex: [] },       // 已进入对应 CLI 会话的附件 id（续轮只发新增附件）
  };
  let attSeq = 0;
  let docKey = 'untitled';

  // ---------- 小工具 ----------
  const $ = (s) => document.querySelector(s);
  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  // Word 的段落符是 \r、软回车是 \v，统一成 \n 再比对/发模型
  function normNL(s) {
    return String(s == null ? '' : s).replace(/\r\n/g, '\n').replace(/[\r\v]/g, '\n');
  }
  // 反向：写回 Word 时换行转成段落符（\r 是 Word 原生段落标记）
  function toWordText(s) {
    return String(s).replace(/\r\n/g, '\n').replace(/\n/g, '\r');
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
    for (const line of lines) {
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
  // 返回操作序列 [['='|'-'|'+', 文本], ...]，diff 展示和"保格式替换"共用。
  // 先掐掉公共前后缀再对中段做 LCS（长文也能细粒度对比）；中段规模仍超限就退化成
  // "整段删+整段加"——粗但正确，格式迁移照样能用。
  function tokDiff(s) {
    return s.match(/[㐀-鿿豈-﫿　-〿＀-￯]|[A-Za-z0-9_]+|\s+|[^\s]/g) || [];
  }
  function diffOps(aStr, bStr) {
    let p = 0;
    const maxP = Math.min(aStr.length, bStr.length);
    while (p < maxP && aStr.charCodeAt(p) === bStr.charCodeAt(p)) p++;
    let sfx = 0;
    while (sfx < maxP - p && aStr.charCodeAt(aStr.length - 1 - sfx) === bStr.charCodeAt(bStr.length - 1 - sfx)) sfx++;
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
      const W = m + 1;
      const dp = new Uint32Array((n + 1) * W);
      for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
          dp[i * W + j] = a[i] === b[j] ? dp[(i + 1) * W + j + 1] + 1 : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
        }
      }
      let i = 0, j = 0;
      while (i < n && j < m) {
        if (a[i] === b[j]) { push('=', a[i]); i++; j++; }
        else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) { push('-', a[i]); i++; }
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

  // ---------- 保格式替换：原 HTML ↔ 新文本逐字对齐，迁移行内格式和段落样式 ----------
  // 思路：把目标段的 HTML（getHtml，带全部格式信息）拍平成"每个字符 + 它的行内格式链
  // （span/b/i/u…）+ 所在段落元素"，和新文本做逐字 diff：没改动的字沿用自己的格式链；
  // 新增的字继承"被它替换的第一个字"（纯插入则左邻）的格式；段落按新文本的换行重排，
  // 段落元素克隆自来源段落（样式/对齐/缩进都带上）。
  // 任何一步对不上（表格图片等复杂结构、HTML 与文本对不齐、自校验失败）都返回 null，
  // 调用方退回纯文本替换——宁可丢格式，绝不写坏内容。
  const BLOCK_RE = /^(P|H[1-6]|LI|DIV|BLOCKQUOTE|TD|TH|TR|TABLE|UL|OL|SECTION)$/;
  function flattenHtmlBody(body) {
    const chars = []; // { ch, chain, block, kind? }  kind: 'p'=段落尾 | 'br'=软回车
    (function walk(el, chain, block) {
      for (const child of el.childNodes) {
        if (child.nodeType === 3) {
          const t = child.data || '';
          for (let k = 0; k < t.length; k++) chars.push({ ch: t[k], chain, block });
        } else if (child.nodeType === 1) {
          const tag = child.tagName;
          if (tag === 'BR') { chars.push({ ch: '\n', kind: 'br', chain, block }); continue; }
          if (/^(SCRIPT|STYLE|META|LINK|TITLE|HEAD)$/.test(tag)) continue;
          const isBlock = BLOCK_RE.test(tag);
          walk(child, isBlock ? [] : chain.concat([child]), isBlock ? child : block);
          if (isBlock) chars.push({ ch: '\n', kind: 'p', chain: [], block: child });
        }
      }
    })(body, [], null);
    while (chars.length && chars[chars.length - 1].kind === 'p') chars.pop(); // 末尾段落符不进文本
    return chars;
  }
  const flatToText = (chars) => chars.map((c) => c.ch).join('');
  const canonText = (s) => normNL(s).replace(/\n+$/, '');
  // Word 导出的 HTML 可能带排版性换行（元素间缩进/断行），三档尝试和纯文本对齐：
  // 原样 → 文本节点里的换行删掉 → 换行当空格
  function dewrapTextNodes(root, mode) {
    const w = root.ownerDocument.createTreeWalker(root, 4 /* TEXT */);
    const nodes = [];
    while (w.nextNode()) nodes.push(w.currentNode);
    for (const n of nodes) {
      n.data = mode === 'strip' ? n.data.replace(/\r?\n[ \t]*/g, '') : n.data.replace(/\r?\n[ \t]*/g, ' ');
    }
  }
  function buildFormattedReplacement(htmlStr, curText, newTextRaw) {
    const newText = canonText(newTextRaw);
    if (!newText || !htmlStr) return null;
    for (const mode of ['strict', 'strip', 'space']) {
      const doc = new DOMParser().parseFromString(htmlStr, 'text/html');
      if (!doc || !doc.body) return null;
      if (doc.body.querySelector('table, img, object, embed, iframe, svg')) return null; // 复杂对象不硬来
      if (mode !== 'strict') dewrapTextNodes(doc.body, mode);
      const src = flattenHtmlBody(doc.body);
      if (!src.length) return null;
      const oldText = flatToText(src);
      if (canonText(oldText) !== canonText(curText)) continue; // HTML 和文本对不齐，换下一档
      const html = rebuildHtml(doc, src, oldText, newText);
      if (html) return html;
    }
    return null;
  }
  function rebuildHtml(doc, src, oldText, newText) {
    // 1) 逐字对齐：输出字符 → 来源字符（新增的继承被替换处/左邻）
    const ops = diffOps(oldText, newText);
    const out = []; // { ch, srcIdx, exact? }
    let si = 0, lastSi = -1, minusStart = -1, prevMinus = false;
    for (const [t, s] of ops) {
      if (t === '=') {
        for (let k = 0; k < s.length; k++) { out.push({ ch: s[k], srcIdx: si, exact: true }); lastSi = si; si++; }
        prevMinus = false;
      } else if (t === '-') {
        minusStart = si;
        si += s.length;
        prevMinus = true;
      } else {
        const inherit = prevMinus ? minusStart : lastSi;
        for (let k = 0; k < s.length; k++) out.push({ ch: s[k], srcIdx: inherit });
        prevMinus = false;
      }
    }
    // 2) 按输出的换行组段落；未改动的软回车仍是 <br>，其余换行都当段落边界
    const at = (i) => src[Math.max(0, Math.min(src.length - 1, i))] || { chain: [], block: null };
    const sameChain = (a, b) => a.length === b.length && a.every((x, k) => x === b[k]);
    const blocks = [];
    let cur = null;
    const ensureBlock = (idx) => {
      if (!cur) { cur = { tpl: at(idx).block, runs: [] }; blocks.push(cur); }
      return cur;
    };
    for (const o of out) {
      const sc = at(o.srcIdx);
      if (o.ch === '\n') {
        if (o.exact && sc.kind === 'br') { ensureBlock(o.srcIdx).runs.push({ br: true }); continue; }
        ensureBlock(o.srcIdx);
        cur = null;
        continue;
      }
      const b = ensureBlock(o.srcIdx);
      const chain = sc.chain || [];
      const last = b.runs[b.runs.length - 1];
      if (last && !last.br && sameChain(last.chain, chain)) last.text += o.ch;
      else b.runs.push({ chain, text: o.ch });
    }
    if (!blocks.length) return null;
    // 3) 重建：克隆段落元素和行内格式链
    const renderRuns = (parentEl, runs) => {
      for (const run of runs) {
        if (run.br) { parentEl.appendChild(doc.createElement('br')); continue; }
        let p = parentEl;
        for (const el of run.chain) { const c = el.cloneNode(false); p.appendChild(c); p = c; }
        p.appendChild(doc.createTextNode(run.text));
      }
    };
    const outBody = doc.createElement('body');
    const pureInline = blocks.length === 1 && !blocks[0].tpl; // 段中片段：不硬加段落结构
    if (pureInline) {
      renderRuns(outBody, blocks[0].runs);
    } else {
      for (const blk of blocks) {
        const blockEl = blk.tpl ? blk.tpl.cloneNode(false) : doc.createElement('p');
        renderRuns(blockEl, blk.runs);
        outBody.appendChild(blockEl);
      }
    }
    // 4) 自校验：重建结果拍平回来必须和新文本一字不差，否则放弃
    if (canonText(flatToText(flattenHtmlBody(outBody))) !== newText) return null;
    doc.documentElement.replaceChild(outBody, doc.body);
    return doc.documentElement.outerHTML;
  }

  // ---------- 配置 & 会话持久化（localStorage，按文档分开）----------
  function loadCfg() {
    try {
      const saved = JSON.parse(localStorage.getItem('we:cfg') || '{}');
      Object.assign(state.cfg, Object.fromEntries(Object.entries(saved).filter(([, v]) => v != null)));
    } catch {}
    // 上次 🔄 探测到的最新模型列表（没探测过就用代码里的兜底列表）
    try {
      const m = JSON.parse(localStorage.getItem('we:models') || 'null');
      if (m && Array.isArray(m.claude) && m.claude.length) MODELS.claude = m.claude;
      if (m && Array.isArray(m.codex) && m.codex.length) MODELS.codex = m.codex;
      if (m?.efforts) modelEfforts = m.efforts;
      if (m?.details) modelDetails = m.details;
    } catch {}
    if (!['claude', 'codex'].includes(state.cfg.backend)) state.cfg.backend = 'claude';
  }
  function saveCfg() {
    try { localStorage.setItem('we:cfg', JSON.stringify(state.cfg)); } catch {}
  }
  const HIST_KEY = () => 'we:hist:' + docKey;
  const ARCH_KEY = () => 'we:arch:' + docKey;
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
    const lines = [`# ${docTitle() || tr('Word 文档')}`, '', tr`> 导出自 LLM_in_Word · ${new Date().toLocaleString()}`, ''];
    for (const m of messages) {
      if (m.role === 'user') lines.push(tr('## 🙋 用户'), '', m.content, '');
      else lines.push(tr`## 🤖 助手${m.via ? `（${[m.via.backend, m.via.model, 'effort ' + m.via.effort].filter(Boolean).join(' · ')}）` : ''}`, '', m.content, '');
    }
    return lines.join('\n');
  }
  function docTitle() {
    try {
      const u = Office.context.document.url || '';
      return decodeURIComponent(u.split('/').pop() || '') || '';
    } catch { return ''; }
  }

  // ---------- Office / Word 集成 ----------
  function wordRun(fn) {
    return Word.run(fn).catch((e) => {
      let msg = String(e?.message || e);
      if (e && e.code) msg = `${e.code}: ${msg}`;
      if (/GeneralException|InvalidArgument/i.test(msg)) {
        msg += tr('（这段选区可能跨表格/文本框等复杂结构，试试只选连续的正文段落）');
      }
      return { ok: false, error: msg };
    });
  }
  // 读一段 Range 的文本：有 WordApi 1.4 就用 getReviewedText('Current')
  // （= 假设所有修订都被接受后的样子，避免把待接受的删除线文字读进来），否则退回 .text
  function queueText(range) {
    if (state.has14) {
      const r = range.getReviewedText('Current');
      return () => r.value;
    }
    range.load('text');
    return () => range.text;
  }
  function getTargetCC(ctx) {
    const ccs = ctx.document.contentControls.getByTag(TAG);
    ccs.load('items/id');
    return ccs;
  }

  // 从文档重新读一遍目标列表（按文档顺序编号），顺带更新全文字符数。
  // 表格目标（控件里包着表）读 values → Markdown 表示；文本目标照旧读纯文本。
  async function refreshTargets(quiet) {
    const r = await wordRun(async (ctx) => {
      const ccs = getTargetCC(ctx);
      const gDoc = queueText(ctx.document.body.getRange('Whole'));
      await ctx.sync();
      const entries = ccs.items.map((cc) => {
        const whole = cc.getRange('Content');
        const tabs = whole.tables;
        tabs.load('items');
        return { id: cc.id, get: queueText(whole), tabs };
      });
      await ctx.sync();
      for (const e of entries) {
        if (e.tabs.items.length) { e.table = e.tabs.items[0]; e.table.load('values'); }
      }
      await ctx.sync();
      return {
        ok: true,
        docChars: normNL(gDoc()).length,
        list: entries.map((e) => {
          if (e.table) {
            const vals = e.table.values || [];
            return { id: e.id, kind: 'table', values: vals, text: TableUtils.toMarkdown(vals) };
          }
          return { id: e.id, kind: 'text', values: null, text: normNL(e.get()) };
        }),
      };
    });
    if (r.ok) {
      const oldById = new Map(state.targets.map((t) => [t.ccId, t]));
      state.targets = r.list
        .filter((t) => t.text.trim())
        .map((t) => ({ ccId: t.id, kind: t.kind, values: t.values, text: t.text, applied: oldById.get(t.id)?.applied || false }));
      state.docChars = r.docChars;
      renderTargetBar();
    } else if (!quiet) {
      addNote(tr('⚠️ 读取目标失败：') + escapeHtml(uiText(r.error)));
    }
    return r;
  }

  // 🎯 把当前选中添加为一个目标段（可多次，多段分散）。
  // 表格支持：光标/选区在表格里 → 整张表作为一个"表格目标"（内容按 Markdown 表格喂给模型）。
  async function addTarget() {
    if (state.targets.length >= MAX_TARGETS) { addNote(tr`⚠️ 目标最多 ${MAX_TARGETS} 段`); return; }
    const r = await wordRun(async (ctx) => {
      const sel = ctx.document.getSelection();
      const getSel = queueText(sel);
      const pt = sel.parentTableOrNullObject;
      pt.load('isNullObject');
      const selTabs = sel.tables;
      selTabs.load('items');
      const ccs = getTargetCC(ctx);
      await ctx.sync();

      let targetRange = sel;
      let isTable = false, rows = 0, cols = 0;
      if (!pt.isNullObject) {
        // 在表格里 → 整张表作为目标
        pt.load('values');
        await ctx.sync();
        const values = pt.values || [];
        cols = values[0] ? values[0].length : 0;
        rows = values.length;
        if (!rows || !cols) return { ok: false, error: tr('这张表格读不到内容') };
        if (values.some((row) => row.length !== cols)) {
          return { ok: false, error: tr('这张表格含合并单元格，暂不支持作为目标（可先取消合并）') };
        }
        targetRange = pt.getRange('Whole');
        isTable = true;
      } else {
        const text = normNL(getSel());
        if (!text.trim()) return { ok: false, error: 'empty' };
        if (selTabs.items.length) {
          return { ok: false, error: tr('选区里混着表格：表格请单独添加（点表格内任意位置再点 🎯），正文和表格分开作为目标') };
        }
      }
      // 和已有目标重叠的选区不收（嵌套锚点会乱）
      if (ccs.items.length) {
        const rels = ccs.items.map((cc) => targetRange.compareLocationWith(cc.getRange('Whole')));
        await ctx.sync();
        for (const rel of rels) {
          const v = rel.value;
          if (v !== 'Before' && v !== 'After' && v !== 'AdjacentBefore' && v !== 'AdjacentAfter' && v !== 'Unrelated') {
            return { ok: false, error: tr('这段选区和已有目标重叠，先 ✕ 掉那个目标，或换一段') };
          }
        }
      }
      const cc = targetRange.insertContentControl();
      cc.tag = TAG;
      cc.title = tr('LLM_in_Word 改写目标');
      cc.appearance = 'Hidden';
      await ctx.sync();
      return { ok: true, isTable, rows, cols };
    });
    if (!r.ok) {
      if (r.error === 'empty') addNote(tr('⚠️ 文档里还没有选中内容。先在正文里<b>拖选一段文字</b>（或点进表格）再点 🎯。'));
      else addNote(tr('⚠️ 添加目标失败：') + escapeHtml(uiText(r.error)));
      return;
    }
    await refreshTargets();
    const n = state.targets.length;
    addNote(r.isTable
      ? tr`📊 已把整张表格（${r.rows}×${r.cols}）添加为目标（当前共 ${n} 段）。可以下指令改单元格内容、增删行等。`
      : tr`🎯 已添加目标（当前共 ${n} 段${n > 1 ? tr('，按文档顺序编号') : ''}）。可继续选中别处再点 🎯 添加，或直接下指令。`);
    els.input.focus();
  }

  // 面板启动时：文档里若还留着上次的目标控件，恢复它们
  async function restoreTarget() {
    await refreshTargets(true);
    if (state.targets.length) {
      addNote(tr`🎯 已从文档恢复上次设的 ${state.targets.length} 段目标（不想要就点 ✕ 清除）`);
    }
  }

  async function removeTarget(ccId) {
    if (state.streaming) return;
    await wordRun(async (ctx) => {
      const ccs = getTargetCC(ctx);
      await ctx.sync();
      for (const cc of ccs.items) if (cc.id === ccId) cc.delete(true);
      await ctx.sync();
      return { ok: true };
    });
    await refreshTargets();
  }

  async function clearTargets() {
    if (state.streaming || !state.wordReady) return;
    await wordRun(async (ctx) => {
      const ccs = getTargetCC(ctx);
      await ctx.sync();
      for (const cc of ccs.items) cc.delete(true);
      await ctx.sync();
      return { ok: true };
    });
    state.targets = [];
    renderTargetBar();
  }

  async function revealTarget(ccId) {
    const r = await wordRun(async (ctx) => {
      const ccs = getTargetCC(ctx);
      await ctx.sync();
      const cc = ccs.items.find((c) => c.id === ccId);
      if (!cc) return { ok: false, error: tr('这个目标的锚点不在了，请重新添加') };
      cc.getRange('Whole').select('Select');
      await ctx.sync();
      return { ok: true };
    });
    if (!r.ok) addNote('⚠️ ' + escapeHtml(uiText(r.error)));
  }

  // 组"改写模式"的文档上下文：全文 + 各目标段标记，超长时截取目标周边。
  // 单目标沿用【选中段开始/结束】标记（与既往提示词一致），多目标用【目标k开始/结束】。
  async function getEditContext() {
    return await wordRun(async (ctx) => {
      const ccs = getTargetCC(ctx);
      await ctx.sync();
      if (!ccs.items.length) return { ok: false, error: tr('目标在文档里找不到了（锚定控件被删除），请重新选中并添加目标') };
      const body = ctx.document.body;
      const gaps = [];     // 目标之间（含首尾）的间隔文本 getter，长度 = 目标数 + 1
      const tgts = [];     // 各目标文本 getter
      const tabsList = []; // 各目标控件里的表格集合（表格目标用 Markdown 表示）
      let prevEnd = body.getRange('Start');
      for (const cc of ccs.items) {
        const whole = cc.getRange('Whole');
        gaps.push(queueText(prevEnd.expandTo(whole.getRange('Start'))));
        tgts.push(queueText(cc.getRange('Content')));
        const tabs = whole.tables;
        tabs.load('items');
        tabsList.push(tabs);
        prevEnd = whole.getRange('End');
      }
      gaps.push(queueText(prevEnd.expandTo(body.getRange('End'))));
      await ctx.sync();
      const tableObjs = tabsList.map((t) => (t.items.length ? t.items[0] : null));
      for (const t of tableObjs) if (t) t.load('values');
      await ctx.sync();
      const kinds = tableObjs.map((t) => (t ? 'table' : 'text'));
      const valuesList = tableObjs.map((t) => (t ? (t.values || []) : null));
      const targetTexts = tgts.map((g, i) => (kinds[i] === 'table' ? TableUtils.toMarkdown(valuesList[i]) : normNL(g())));
      if (targetTexts.every((t) => !t.trim())) return { ok: false, error: tr('目标段现在都是空的，请重新选中并添加目标') };
      const gapTexts = gaps.map((g) => normNL(g()));
      const ids = ccs.items.map((cc) => cc.id);
      return { ok: true, ids, targetTexts, kinds, valuesList, ...markFullText(gapTexts, targetTexts) };
    });
  }
  function markFullText(gaps, targets) {
    const single = targets.length === 1;
    const M1 = (k) => (single ? '\n【选中段开始】\n' : `\n【目标${k}开始】\n`);
    const M2 = (k) => (single ? '\n【选中段结束】\n' : `\n【目标${k}结束】\n`);
    const targetsLen = targets.reduce((s, t) => s + t.length, 0);
    const docChars = targetsLen + gaps.reduce((s, g) => s + g.length, 0);
    let useGaps = gaps;
    let truncated = false;
    if (docChars > CTX_CAP) {
      // 超长：每个间隔按配额保头保尾，省略处标注
      const budget = Math.max(20000, CTX_CAP - targetsLen);
      const per = Math.max(1500, Math.floor(budget / gaps.length));
      useGaps = gaps.map((g) => {
        if (g.length <= per) return g;
        truncated = true;
        const half = Math.floor(per / 2);
        return g.slice(0, half) + '\n【……过长省略……】\n' + g.slice(g.length - half);
      });
    }
    let fullText = '';
    for (let i = 0; i < targets.length; i++) {
      fullText += useGaps[i] + M1(i + 1) + targets[i] + M2(i + 1);
    }
    fullText += useGaps[targets.length];
    return { fullText, truncated, docChars };
  }

  // 问答模式（无目标）：整份文档正文
  async function getWholeDoc() {
    return await wordRun(async (ctx) => {
      const get = queueText(ctx.document.body.getRange('Whole'));
      await ctx.sync();
      let t = normNL(get());
      const docChars = t.length;
      let truncated = false;
      if (t.length > CTX_CAP) { t = t.slice(0, CTX_CAP) + tr('\n…（过长已截断）'); truncated = true; }
      return { ok: true, fullText: t, truncated, docChars };
    });
  }

  // ✅ 应用替换：写回指定目标的内容控件；开着"以修订写入"就临时打开 Word 修订。
  // 文本目标：先尝试"保格式替换"（HTML 逐字格式迁移），构造不出来就退回纯文本。
  // 表格（opts.tableVals = 新值矩阵）：
  //   表格目标 + 列数没变 → 只改变化的单元格（表格样式/未动单元格格式全保留），行数差异用增删行处理；
  //   表格目标 + 列数变了 → 整表重建（insertHtml，样式重置）；
  //   文本目标 + 表格输出 → 文字转表格（insertHtml 插入真表格）。
  async function applyReplacement(ccId, newText, force, opts = {}) {
    return await wordRun(async (ctx) => {
      const ccs = getTargetCC(ctx);
      await ctx.sync();
      const cc = ccs.items.find((c) => c.id === ccId);
      if (!cc) return { ok: false, error: tr('这个目标已丢失（锚定控件被删除），请重新选中并添加目标') };
      const tk = state.targets.find((t) => t.ccId === ccId);
      const ccTabs = cc.getRange('Whole').tables;
      ccTabs.load('items');
      const g = queueText(cc.getRange('Content'));
      const gh = cc.getRange('Content').getHtml();
      await ctx.sync();
      const table = ccTabs.items.length ? ccTabs.items[0] : null;
      const newVals = Array.isArray(opts.tableVals) && opts.tableVals.length ? opts.tableVals : null;

      // 修订模式的临时开关（三条路径共用）
      const doc = ctx.document;
      const wantTrack = state.cfg.tracked && state.has14;
      let prevMode = null;
      if (state.has14) {
        doc.load('changeTrackingMode');
        await ctx.sync();
        prevMode = doc.changeTrackingMode;
      }
      const trackTemp = wantTrack && prevMode === 'Off';
      const trackedFlag = wantTrack || prevMode === 'TrackAll' || prevMode === 'TrackMineOnly';
      const trackOn = async () => { if (trackTemp) { doc.changeTrackingMode = 'TrackAll'; await ctx.sync(); } };

      // 修订临时开关的异常收尾（表格路径专用）
      const trackOffSafe = async () => {
        if (trackTemp) { doc.changeTrackingMode = 'Off'; try { await ctx.sync(); } catch {} }
      };
      const strVals = (vals) => vals.map((row) => row.map((c) => String(c == null ? '' : c)));

      // —— 表格目标 + 表格输出 ——
      if (table && newVals) {
        table.load('values');
        await ctx.sync();
        const oldVals = table.values || [];
        if (!force && tk && tk.text && TableUtils.toMarkdown(oldVals) !== tk.text) {
          return { ok: false, needConfirm: true };
        }
        const oldRows = oldVals.length, oldCols = oldVals[0] ? oldVals[0].length : 0;
        const nv = strVals(newVals);
        const newRows = nv.length, newCols = nv[0] ? nv[0].length : 0;
        await trackOn();
        let tblMode;
        if (newCols === oldCols && oldCols > 0) {
          // 单元格级更新：先加行+改格（一批），再删多余行；失败报出卡在哪一步
          let step = tr('加行/改单元格');
          try {
            if (newRows > oldRows) table.addRows('End', newRows - oldRows, nv.slice(oldRows));
            const lim = Math.min(oldRows, newRows);
            for (let r2 = 0; r2 < lim; r2++) {
              for (let c2 = 0; c2 < oldCols; c2++) {
                if (String(oldVals[r2][c2] ?? '') !== nv[r2][c2]) {
                  table.getCell(r2, c2).value = nv[r2][c2];
                }
              }
            }
            await ctx.sync();
            if (newRows < oldRows) {
              step = tr('删多余行');
              const rows = table.rows;
              rows.load('items');
              await ctx.sync();
              for (let i = oldRows - 1; i >= newRows; i--) rows.items[i].delete();
              await ctx.sync();
            }
            tblMode = 'cells';
          } catch (e) {
            await trackOffSafe();
            return { ok: false, error: tr`表格更新失败（${step}）：${String(e?.message || e)}。已写入的部分可用撤销快捷键恢复（Windows: Ctrl+Z；Mac: Cmd+Z）` };
          }
        } else {
          // 列数变了：原表后插新表（Word 原生 insertTable，行列和内容一次建好），再删原表
          try {
            table.getRange('Whole').insertTable(newRows, newCols, 'After', nv);
            table.delete();
            await ctx.sync();
          } catch (e) {
            await trackOffSafe();
            return { ok: false, error: tr`表格重建失败：${String(e?.message || e)}` };
          }
          tblMode = 'rebuild';
        }
        if (trackTemp) { doc.changeTrackingMode = 'Off'; }
        try { cc.delete(true); await ctx.sync(); } catch { /* 原表连控件一起没了就算了 */ }
        return { ok: true, tracked: trackedFlag, table: tblMode };
      }

      // —— 文本目标 + 表格输出：文字转表格（原生 insertTable，插在原文字之后、再清掉原文字）——
      if (!table && newVals) {
        const curText = normNL(g());
        if (!force && tk && normNL(tk.text) !== curText) return { ok: false, needConfirm: true };
        const nv = strVals(newVals);
        await trackOn();
        try {
          cc.getRange('Whole').insertTable(nv.length, nv[0] ? nv[0].length : 1, 'After', nv);
          cc.insertText('', 'Replace');
          await ctx.sync();
        } catch (e) {
          await trackOffSafe();
          return { ok: false, error: tr`插入表格失败：${String(e?.message || e)}` };
        }
        if (trackTemp) { doc.changeTrackingMode = 'Off'; }
        cc.delete(true);
        await ctx.sync();
        return { ok: true, tracked: trackedFlag, table: 'insert' };
      }

      // —— 文本目标 + 文本输出（原有路径：保格式替换 → 纯文本兜底）——
      const curText = normNL(g());
      if (!force && tk && normNL(tk.text) !== curText) {
        return { ok: false, needConfirm: true };
      }
      let html = null;
      try {
        html = buildFormattedReplacement(gh.value, curText, newText);
      } catch (e) {
        html = null; // 格式迁移失败就走纯文本，不拦应用
      }
      await trackOn();
      if (html) cc.insertHtml(html, 'Replace');
      else cc.insertText(toWordText(newText), 'Replace');
      await ctx.sync();
      if (trackTemp) { doc.changeTrackingMode = 'Off'; }
      cc.delete(true); // 应用完就解除锚定：这段不再是目标（想继续改就重新选中再加）
      await ctx.sync();
      return { ok: true, tracked: trackedFlag, kept: !!html };
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
    if (state.serverOk === false) {
      els.banner.textContent = tr('本机服务暂时无法连接。打开连接设置查看恢复方法，输入草稿会保留。');
    } else if (!state.wordReady) {
      els.banner.textContent = tr('请在 Word 的「LLM_in_Word」加载项中使用。此处可预览界面、检查后端连接。');
    } else if (backend && ['missing', 'auth', 'error'].includes(backend.status)) {
      els.banner.textContent = backend.hint;
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
  function saveDraft() { try { localStorage.setItem('we:draft:' + docKey, els.input.value); } catch {} }
  function restoreDraft() { try { els.input.value = localStorage.getItem('we:draft:' + docKey) || ''; autoGrow(); } catch {} }
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
    welcome.innerHTML = tr('<div class="welcome-icon" aria-hidden="true">✦</div><h2>好文字，从一个想法开始</h2><p>选中一段文字，告诉我你的想法。<br>润色、精简，或让表达更准确。</p><div class="welcome-flow"><span>选择内容</span><b>→</b><span>描述想法</span><b>→</b><span>预览与应用</span></div>');
    els.messages.appendChild(welcome);
  }

  // ---------- 目标条 ----------
  function renderTargetBar() {
    const ts = state.targets;
    $('#target-count').textContent = `${ts.length} / ${MAX_TARGETS}`;
    $('#btn-clear').classList.toggle('hidden', !ts.length);
    els.targetList.innerHTML = '';
    if (!ts.length) {
      els.targetInfo.innerHTML = tr('<span class="muted">支持多个段落，也可以添加整张表格。</span>');
      els.targetBar.classList.add('empty');
      return;
    }
    els.targetBar.classList.remove('empty');
    const total = ts.reduce((s, t) => s + t.text.length, 0);
    const warn = total > SOFT_SEL_LIMIT ? tr(' · <b class="warn">⚠️ 目标过大，建议缩小</b>') : '';
    const cacheOn = state.cliSession[state.cfg.backend];
    const ctxInfo = cacheOn
      ? tr(' · 可续聊')
      : state.docChars ? tr` · 随请求附全文 ~${Math.max(1, Math.round(state.docChars / 1000))}k 字符` : '';
    els.targetInfo.innerHTML = tr`已选 ${ts.length} 处 · ${total} 字符${ctxInfo}${warn}`;
    ts.forEach((t, i) => {
      const row = document.createElement('div');
      row.className = 'tgt-row';
      const p = t.text.replace(/\s+/g, ' ').trim();
      const isTbl = t.kind === 'table';
      const dims = isTbl && t.values ? `${t.values.length}×${t.values[0] ? t.values[0].length : 0}` : '';
      row.innerHTML =
        `<span class="tgt-k">${i + 1}</span>` +
        `<span class="tgt-prev" title="${escapeHtml(p.slice(0, 300))}">${isTbl ? '📊 ' : ''}${escapeHtml(p.length > 60 ? p.slice(0, 60) + '…' : p)}</span>` +
        `<span class="tgt-len">${isTbl ? tr`表格 ${dims}` : tr`${t.text.length}字`}${t.applied ? ' <b class="applied">✓</b>' : ''}</span>`;
      const loc = document.createElement('button');
      loc.className = 'ibtn';
      loc.textContent = '📍';
      loc.title = tr('在文档里定位这段');
      loc.addEventListener('click', () => revealTarget(t.ccId));
      const del = document.createElement('button');
      del.className = 'ibtn';
      del.textContent = '✕';
      del.title = tr('移除这个目标');
      del.addEventListener('click', () => removeTarget(t.ccId));
      row.append(loc, del);
      els.targetList.appendChild(row);
    });
  }

  // ---------- 附件 ----------
  function extOf(name) {
    const m = String(name).toLowerCase().match(/\.([a-z0-9]+)$/);
    return m ? m[1] : '';
  }
  function attIcon(a) {
    if (a.kind === 'text') return '📄';
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
      chip.innerHTML = `${attIcon(a)} ${escapeHtml(a.name)} · ${fmtSize(a.size)}${a.truncated ? tr('（截断）') : ''} `;
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

  // ---------- 替换卡片（diff 预览 + 应用）----------
  // tk = 请求时的目标快照 { k, ccId, text }；返回 doApply 供「应用全部」调用
  function attachReplacementCard(bubble, tk, replacement, via, multi, lang) {
    const card = document.createElement('div');
    card.className = 'card';
    // 表格模式判定：表格目标（必须给表格），或文本目标但模型用 ```table 输出（文字转表格）
    const isTableRep = (tk && tk.kind === 'table') || lang === 'table';
    let tableVals = null;
    let tableErr = null;
    if (isTableRep) {
      const p = TableUtils.parseMarkdown(replacement);
      if (p.ok) tableVals = p.values;
      else tableErr = p.error;
    }
    const oldVals = tk && tk.kind === 'table'
      ? (tk.values || (TableUtils.parseMarkdown(tk.text).ok ? TableUtils.parseMarkdown(tk.text).values : null))
      : null;
    const diff = tableVals ? null : (tk && tk.kind !== 'table' ? diffHtml(tk.text, replacement) : null);
    const title = tableVals ? tr('表格预览') : tr('对比');
    card.innerHTML =
      `<div class="card-head">` +
      `<span class="card-title">${multi ? tr`目标 ${tk.k} · ` : ''}${tableVals ? tr('📊 表格替换') : tr('替换预览')}</span>` +
      `<button class="tab active" data-tab="diff">${title}</button><button class="tab" data-tab="new">${tableVals ? tr('源码') : tr('新文本')}</button>` +
      `</div>` +
      `<pre class="card-body diffview">${diff != null ? diff : ''}</pre>` +
      `<pre class="card-body newview hidden">${escapeHtml(replacement)}</pre>` +
      `<div class="card-actions">` +
      tr`<button class="btn btn-primary apply">✅ 应用</button>` +
      tr`<button class="btn copy">📋 复制</button>` +
      (multi ? '' : tr`<button class="btn retry" title="用同样的指令重新生成">🔁 重试</button>`) +
      `<span class="card-status"></span>` +
      `</div>`;
    bubble.appendChild(card);

    const diffView = card.querySelector('.diffview');
    const newView = card.querySelector('.newview');
    // 表格：对比页渲染成真表格，变过的单元格高亮并显示旧值；行列增减做文字说明
    if (tableVals) {
      diffView.textContent = '';
      diffView.appendChild(tablePreviewEl(oldVals, tableVals));
      const d = TableUtils.diffCells(oldVals, tableVals);
      const notes = [];
      if (oldVals) {
        if (d.changed.length) notes.push(tr`改动 ${d.changed.length} 个单元格`);
        if (d.rowsAdded) notes.push(tr`新增 ${d.rowsAdded} 行`);
        if (d.rowsRemoved) notes.push(tr`删除 ${d.rowsRemoved} 行`);
        if (d.colsChanged) notes.push(tr`⚠️ 列数 ${d.oCols}→${d.nCols}：应用时整表重建，表格样式会重置`);
        if (!notes.length) notes.push(tr('内容与当前表格一致（无变化）'));
      } else {
        notes.push(tr`将把该段文字替换为 ${d.nRows}×${d.nCols} 的表格`);
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
        newView.classList.toggle('hidden', isDiff);
      });
    });

    const statusEl = card.querySelector('.card-status');
    const applyBtn = card.querySelector('.apply');
    if (tk && tk.kind === 'table' && !tableVals) applyBtn.disabled = true; // 表格目标没解析出表格 → 不能应用
    let done = false;
    let forceNext = false; // 二次点击确认覆盖（Word 的 WebView 会吞 window.confirm，不能用弹窗）
    const doApply = async () => {
      if (state.streaming || done) return done;
      if (!tk) { statusEl.textContent = tr('⚠️ 没有对应目标，无法应用'); return false; }
      if (tk.kind === 'table' && !tableVals) { statusEl.textContent = tr('⚠️ 未解析出表格，无法应用'); return false; }
      applyBtn.disabled = true;
      statusEl.textContent = tr('应用中…');
      const opts = tableVals ? { tableVals } : {};
      let r = await applyReplacement(tk.ccId, replacement, forceNext, opts);
      if (r.needConfirm) {
        forceNext = true;
        applyBtn.disabled = false;
        statusEl.textContent = tr`⚠️ 目标${multi ? ' ' + tk.k + ' ' : ''}的内容在捕获后已变化（可能手动改过）。确认覆盖请再点一次「✅ 应用」`;
        return false;
      }
      forceNext = false;
      if (r.ok) {
        done = true;
        state.targets = state.targets.filter((t) => t.ccId !== tk.ccId); // 应用成功 → 该目标自动移除
        renderTargetBar();
        const fmt = r.table === 'cells' ? tr('（按单元格级更新，表格样式保留）')
          : r.table === 'rebuild' ? tr('（列数有变，整表已重建；表格样式被重置，可用格式刷补）')
          : r.table === 'insert' ? tr('（该段文字已替换为表格）')
          : r.kept ? tr('，原格式已保留') : tr('（此段结构复杂，按纯文本写入，局部格式或需手补）');
        statusEl.textContent = r.tracked
          ? tr`✅ 已以修订写入${fmt}，该目标已自动移除。审阅→接受可定稿`
          : tr`✅ 已应用${fmt}，该目标已自动移除。Cmd+Z 可撤销`;
        return true;
      }
      statusEl.textContent = '⚠️ ' + (r.error || tr('应用失败'));
      applyBtn.disabled = false;
      return false;
    };
    applyBtn.addEventListener('click', doApply);
    card.querySelector('.copy').addEventListener('click', (e) => copyText(replacement, e.target));
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
    newVals.forEach((row, r) => {
      const tr = document.createElement('tr');
      row.forEach((cell, c) => {
        const td = document.createElement('td');
        const old = oldVals && oldVals[r] ? oldVals[r][c] : undefined;
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
        tr.appendChild(td);
      });
      tbl.appendChild(tr);
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
    if (!state.wordReady) { addNote(tr('⚠️ Office 还没就绪，稍等或点 ⟳ 刷新面板')); return; }
    if (mode === 'edit' && !state.targets.length) {
      addNote(tr('⚠️ 改写模式需要先有目标：在文档里选中一段正文，点 🎯（可多次添加多段）。<br>（只是想提问的话，切上面的「💬 问答」模式）'));
      return;
    }

    if (state.serverOk === false) { addNote(tr('本机服务尚未连接。请打开顶部的连接设置重新检测。')); return; }
    setStreaming(true);
    state.stopRequested = false;
    const ac = new AbortController();
    state.aborter = ac;
    const myReq = ++reqCounter;
    state.curReq = myReq;
    $('#request-status').textContent = tr('正在读取文档…');
    try {
      // 组文档上下文；sentTargets 是本轮请求的目标快照（编号按文档顺序）
      let doc = { docTitle: docTitle() };
      let sentTargets = [];
      if (state.targets.length) {
        const ctx = await getEditContext();
        if (state.curReq !== myReq || ac.signal.aborted) return;
        if (!ctx.ok) {
          if (mode === 'edit') { addNote('⚠️ ' + escapeHtml(ctx.error || tr('拿不到上下文'))); return; }
        } else {
          // 目标被手动编辑过：以文档现状为准，校准基线
          const oldById = new Map(state.targets.map((t) => [t.ccId, t]));
          state.targets = ctx.ids.map((id, i) => ({
            ccId: id,
            kind: (ctx.kinds && ctx.kinds[i]) || 'text',
            values: (ctx.valuesList && ctx.valuesList[i]) || null,
            text: ctx.targetTexts[i],
            applied: oldById.get(id)?.applied || false,
          }));
          state.docChars = ctx.docChars;
          renderTargetBar();
          sentTargets = state.targets.map((t, i) => ({ k: i + 1, ccId: t.ccId, kind: t.kind, values: t.values, text: t.text }));
          Object.assign(doc, {
            targets: sentTargets.map((t) => ({
              k: t.k,
              text: t.text,
              kind: t.kind,
              rows: t.values ? t.values.length : 0,
              cols: t.values && t.values[0] ? t.values[0].length : 0,
            })),
            fullText: ctx.fullText,
            truncated: ctx.truncated,
            docChars: ctx.docChars,
          });
        }
      }
      if (!doc.fullText) {
        const w = await getWholeDoc();
        if (!w.ok) { addNote(tr('文档读取失败：') + escapeHtml(w.error || tr('请稍后重试'))); return; }
        if (w.ok) Object.assign(doc, { fullText: w.fullText, truncated: w.truncated, docChars: w.docChars });
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
        uHtml += `<div class="att-line">📎 ${state.attachments.map((a) => escapeHtml(a.name)).join(' · ')}</div>`;
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
      // Word 的 WebKit 有两个坑：① abort() 后挂起的 read() 可能永不返回（停止要靠 reader.cancel()）
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
            ` <span style="color:#9aa0b4;font-size:11px">${s}s${s >= 30 ? tr(' · effort 高时要几分钟，可点 ⏹ 停止') : ''}</span>`;
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
      renderTargetBar(); // 刷新 ♻️ 缓存标识
      if (!state.longNoteShown && state.messages.length >= LONG_SESSION_MSGS) {
        state.longNoteShown = true;
        setTimeout(() => addNote(tr('💡 这个会话有点长了。建议点右上角 <b>🆕</b> 开新会话：旧会话自动归档到 🕘，并<b>重新读取全文上下文</b>，回复会更快更准。')), 400);
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
    // 顺序很重要：先 cancel 读取器（让挂着的 read() 立刻落地——Word 的 WebKit 里
    // 光 abort() 会让 read() 永远悬着，这就是以前"点⏹没反应"的原因），再 abort 请求。
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
    for (const id of ['sel-language', 'sel-backend', 'sel-model', 'sel-effort', 'btn-reload', 'mode-edit', 'mode-ask', 'btn-capture', 'btn-clear', 'btn-new', 'btn-hist', 'att-local', 'btn-models']) {
      const el = $('#' + id); if (el) el.disabled = v;
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
    state.cliSession = { claude: null, codex: null }; // 清掉 CLI 会话：下一轮重新读全文、重建缓存
    state.sentAtts = { claude: [], codex: [] };
    els.messages.innerHTML = '';
    clearHistory();
    renderWelcome();
    if (state.targets.length) {
      await refreshTargets(true);
      if (state.targets.length) {
        addNote(tr`🆕 新会话已开启（旧会话在 🕘 里）。已重新读取全文 ~${Math.max(1, Math.round(state.docChars / 1000))}k 字符，${state.targets.length} 段目标仍有效。`);
      } else {
        addNote(tr('🆕 新会话已开启（旧会话在 🕘 里）。原目标在文档里找不到了，请重新选中添加。'));
      }
    } else {
      addNote(tr('🆕 新会话已开启（旧会话在 🕘 里）。'));
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
      empty.textContent = tr('还没有归档的会话。点 🆕 开新会话时，旧会话会自动归档到这里（每个文档最多留 10 段）。');
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
    addNote(tr('🕘 已切回历史会话（它的缓存会话一并恢复：能续写就续写，失效则自动重读全文）。改写前请确认目标条里的目标还是你想改的那几段。'));
  }
  function renderHistoryMsgs() {
    for (const m of state.messages) {
      const b = addMessageEl(m.role === 'assistant' ? 'assistant' : 'user');
      if (m.role === 'assistant') b.innerHTML = renderMarkdown(m.content) + footHtml(m.via);
      else b.innerHTML = `<div>${escapeHtml(m.content).replace(/\n/g, '<br>')}</div>`;
    }
  }

  // ---------- 文档选区提示（帮用户意识到"先选中再点🎯"）----------
  let selTimer = 0;
  function onDocSelectionChanged() {
    clearTimeout(selTimer);
    selTimer = setTimeout(() => {
      try {
        Office.context.document.getSelectedDataAsync(Office.CoercionType.Text, (res) => {
          if (res.status !== Office.AsyncResultStatus.Succeeded) { els.selHint.textContent = ''; return; }
          const n = normNL(res.value || '').length;
          els.selHint.textContent = n > 1 ? tr`文档中已选中 ${n} 字符 → 点 🎯 添加为目标段` : '';
        });
      } catch { els.selHint.textContent = ''; }
    }, 350);
  }

  // ---------- UI 绑定 ----------
  const els = {};
  function grabEls() {
    Object.assign(els, {
      statusDot: $('#status-dot'),
      statusText: $('#status-text'),
      banner: $('#banner'),
      backend: $('#sel-backend'),
      model: $('#sel-model'),
      effort: $('#sel-effort'),
      modeEdit: $('#mode-edit'),
      modeAsk: $('#mode-ask'),
      trackWrap: $('#track-wrap'),
      trackChk: $('#chk-track'),
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
  function fillEffortOptions() {
    const key = 'effort_' + state.cfg.backend;
    const levels = state.cfg.backend === 'codex' ? (modelEfforts.codex?.[els.model.value] || ['low', 'medium', 'high', 'xhigh']) : EFFORTS;
    const want = state.cfg[key] || state.cfg.effort;
    els.effort.innerHTML = levels.map((e) => `<option value="${escapeHtml(e)}">${escapeHtml(tr(EFFORT_LABELS[e] || e))} · ${escapeHtml(e)}</option>`).join('');
    els.effort.value = levels.includes(want) ? want : levels.includes('medium') ? 'medium' : levels[0];
    state.cfg.effort = els.effort.value;
  }
  // 更新本机 CLI 模型目录及别名解析，见 server/models.js。
  // quiet=true 是面板启动时的自动刷新：失败不打扰，列表真变了才提示一句。
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
      try { localStorage.setItem('we:models', JSON.stringify({ claude: MODELS.claude, codex: MODELS.codex, fetchedAt: r.fetchedAt, efforts: modelEfforts, details: modelDetails })); } catch {}
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
  function setMode(mode) {
    state.cfg.mode = mode;
    els.modeEdit.classList.toggle('active', mode === 'edit');
    els.modeAsk.classList.toggle('active', mode === 'ask');
    els.modeEdit.setAttribute('aria-pressed', String(mode === 'edit'));
    els.modeAsk.setAttribute('aria-pressed', String(mode === 'ask'));
    els.trackWrap.classList.toggle('hidden', mode === 'ask');
    els.send.innerHTML = mode === 'edit' ? tr('生成改写 <span aria-hidden="true">↑</span>') : tr('发送提问 <span aria-hidden="true">↑</span>');
    $('#instruction-label').textContent = mode === 'edit' ? tr('告诉我怎么改') : tr('想了解文档的什么');
    els.presets.classList.toggle('hidden', mode !== 'edit');
    els.input.placeholder = mode === 'edit'
      ? tr('比如：更简洁一些，保留关键数据…')
      : tr('比如：总结这份文档的核心观点…');
    saveCfg();
  }
  function autoGrow() {
    els.input.style.height = 'auto';
    els.input.style.height = Math.min(140, els.input.scrollHeight) + 'px';
  }
  function bindEvents() {
    $('#sel-language').value = window.WordI18n.language;
    $('#sel-language').addEventListener('change', () => {
      if (state.streaming) { $('#sel-language').value = window.WordI18n.language; return; }
      window.WordI18n.setLanguage($('#sel-language').value);
      window.WordI18n.applyStatic(document);
      fillModelOptions(); setMode(state.cfg.mode); refreshStatusUI(); renderTargetBar();
      if (!state.messages.length) { $('.welcome')?.remove(); renderWelcome(); }
      $('#presets').querySelectorAll('.chip').forEach((chip) => { chip.textContent = tr(PRESETS[Number(chip.dataset.i)][0]); });
      // Existing conversation content stays in its original language. Only translate owned controls.
      document.querySelectorAll('#messages .btn, .card .tab, .card-title, .card-status, .warnbox, .think summary').forEach((el) => {
        if (el.children.length === 0) el.textContent = uiText(el.textContent);
        if (el.title) el.title = uiText(el.title);
      });
      document.querySelectorAll('.tbl-note').forEach((el) => { el.textContent = el.textContent.split(' · ').map((value) => uiText(value)).join(' · '); });
      if (!$('#hist-view').classList.contains('hidden')) openHistView();
      if (!$('#connection-view').classList.contains('hidden')) diagnose();
      renderAttachChips();
      if (!state.has14 && els.trackChk.disabled) els.trackWrap.title = tr('当前 Word 版本不支持修订 API，将直接替换（Cmd+Z 可撤销）');
      onDocSelectionChanged();
    });
    $('#btn-connection').addEventListener('click', () => { $('#connection-view').classList.remove('hidden'); $('#connection-close').focus(); diagnose(); });
    $('#connection-close').addEventListener('click', () => { $('#connection-view').classList.add('hidden'); $('#btn-connection').focus(); });
    $('#btn-diagnose').addEventListener('click', () => diagnose());
    $('#btn-capture').addEventListener('click', () => { if (state.wordReady && !state.streaming) addTarget(); else if (!state.wordReady) addNote(tr('请在 Word 加载项中选中文字，再添加目标。')); });
    $('#btn-clear').addEventListener('click', clearTargets);
    $('#btn-new').addEventListener('click', newSession);
    $('#btn-hist').addEventListener('click', openHistView);
    $('#hist-close').addEventListener('click', () => { els.histView.classList.add('hidden'); $('#btn-hist').focus(); });
    $('#btn-reload').addEventListener('click', () => location.reload());
    $('#btn-models').addEventListener('click', () => refreshModelList(false));
    $('#att-local').addEventListener('click', () => els.fileInput.click());
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
      renderTargetBar(); // ♻️ 缓存标识按后端分别显示
      saveCfg();
    });
    fillEffortOptions();
    els.effort.addEventListener('change', () => { state.cfg.effort = els.effort.value; state.cfg['effort_' + state.cfg.backend] = els.effort.value; saveCfg(); });
    els.model.addEventListener('change', () => {
      if (state.cfg.backend === 'codex') state.cfg.model_codex = els.model.value;
      else state.cfg.model_claude = els.model.value;
      fillEffortOptions();
      renderModelDetail();
      saveCfg();
    });
    els.modeEdit.addEventListener('click', () => setMode('edit'));
    els.modeAsk.addEventListener('click', () => setMode('ask'));
    els.trackChk.checked = !!state.cfg.tracked;
    els.trackChk.addEventListener('change', () => { state.cfg.tracked = els.trackChk.checked; saveCfg(); });

    els.presets.innerHTML = PRESETS.map(([label], i) => `<button class="chip" data-i="${i}">${escapeHtml(tr(label))}</button>`).join('');
    els.presets.querySelectorAll('.chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        els.input.value = tr(PRESETS[Number(chip.dataset.i)][1]);
        autoGrow(); saveDraft();
        els.input.focus();
      });
    });

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
    window.WordI18n.applyStatic(document);
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
      state.wordReady = info.host === Office.HostType.Word;
      if (!state.wordReady) {
        els.banner.textContent = tr('⚠️ 本加载项只支持 Word。');
        els.banner.classList.remove('hidden');
        refreshStatusUI();
        return;
      }
      try {
        state.has14 = Office.context.requirements.isSetSupported('WordApi', '1.4');
      } catch { state.has14 = false; }
      if (!state.has14) {
        els.trackWrap.title = tr('当前 Word 版本不支持修订 API，将直接替换（Cmd+Z 可撤销）');
        els.trackChk.checked = false;
        els.trackChk.disabled = true;
      }
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
      restoreTarget();
      refreshStatusUI();
      ping();

    });
  }

  init();

  // 测试钩子：让 tools/test-format.js 能在 jsdom 里直接测这些纯函数
  try {
    window.__we_test = { diffOps, diffHtml, buildFormattedReplacement, flattenHtmlBody, flatToText, canonText, normNL, toWordText, parseReplacements, stripFences, markFullText };
  } catch {}
})();
