// LLM_in_Excel 任务窗格逻辑：
// 在工作表里选中单元格区域（可按住 Cmd/Ctrl 多选几块）→ ＋ 添加为目标（按「工作表 ID + 地址」锚定，
// 写回前核对内容，被改过就先确认）→ 下指令 → 本机服务流式回复（带坐标的表格）→ 每个目标一张单元格预览 →
// ✅ 应用（只写有变化的单元格，格式、其他单元格都不动；公式出错会提示）→ ↩ 撤销。
// UI 与 LLM_in_Word / LLM_in_PowerPoint 一致；文档操作换成 Excel API，表格协议见 grid-utils.js。
(() => {
  'use strict';

  const I18N = window.XlI18n;
  const tr = I18N.t;
  const uiText = I18N.known;
  const G = window.GridUtils;

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
      ['清洗整理', '整理这些单元格：去掉多余空格，统一大小写和写法（比如公司名、地区名），不改变含义'],
      ['分类打标', '根据同一行其他列的内容，给每一行填一个简短的分类；已有类别就沿用'],
      ['写公式', '在这些单元格里写公式，计算：'],
      ['补全空白', '按同一列和同一行的规律补全空白单元格；推断不出来的保持空白'],
      ['修错别字', '修正这些单元格里的错别字和标点，尽量少改'],
      ['译成英文', '把这些单元格翻译成英文，专有名词和编号保持不变'],
    ],
    ask: [
      ['总结', '总结这张表的主要内容和关键数字'],
      ['找异常', '检查这张表里的异常值、重复、缺失和前后不一致，按单元格地址列出'],
      ['解释公式', '解释这张表里的公式在算什么，有没有错误或更好的写法'],
      ['推荐图表', '这些数据适合做什么图表？说明用哪几列、为什么'],
    ],
  };

  const MAX_TARGETS = 8;           // 目标（区域）数量上限
  const MAX_TARGET_CELLS = 2000;   // 单个目标的单元格上限（更大的选区先和已用区域取交集）
  const MAX_TOTAL_CELLS = 4000;    // 所有目标合计上限
  const SOFT_CELLS = 600;          // 超过这个数给出"生成会比较慢"的提示
  const CTX_CAP = 110000;          // 随请求附带的工作簿内容上限（字符）
  const PREVIEW_ROWS = 40;         // 预览里最多显示的改动行数
  const LONG_SESSION_MSGS = 14;    // 消息数达到这个阈值提醒开新会话

  // 附件限制
  const TEXT_EXTS = ['txt', 'md', 'csv'];
  const BIN_EXTS = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
  const TEXT_CAP = 50000;
  const BIN_CAP = 10 * 1024 * 1024;
  const MAX_FILES = 8;
  const TOTAL_BIN_CAP = 25 * 1024 * 1024;

  // ---------- 运行状态 ----------
  const state = {
    cfg: { backend: 'claude', model_claude: 'sonnet', model_codex: '(default)', effort: 'medium', mode: 'edit' },
    // [{ id, sheetId, sheetName, address, r1, c1, r2, c2, grid, texts, types, text }]
    // 位置 = 工作表 ID + 地址；grid 是发给模型的「表示法」快照（见 GridUtils.cellRepr），写回前拿它核对。
    targets: [],
    messages: [],      // { role: 'user'|'assistant', content, via? }
    streaming: false,
    aborter: null,
    reader: null,        // 流式读取器：停止时必须 cancel 它（Office 的 WebKit 里光 abort 会挂死 read()）
    curReq: 0,           // 当前请求编号：强制恢复后，旧请求迟到的输出直接丢弃
    stopRequested: false,
    serverOk: null,
    xlReady: false,
    api: { v113: false }, // ExcelApi 1.13：检查合并单元格
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

  // ---------- 配置 & 会话持久化（localStorage，按工作簿分开）----------
  function loadCfg() {
    try {
      const saved = JSON.parse(localStorage.getItem('lx:cfg') || '{}');
      Object.assign(state.cfg, Object.fromEntries(Object.entries(saved).filter(([, v]) => v != null)));
    } catch {}
    // 上次刷新到的模型列表（没刷新过就用代码里的兜底列表）
    try {
      const m = JSON.parse(localStorage.getItem('lx:models') || 'null');
      if (m && Array.isArray(m.claude) && m.claude.length) MODELS.claude = m.claude;
      if (m && Array.isArray(m.codex) && m.codex.length) MODELS.codex = m.codex;
      if (m?.efforts) modelEfforts = m.efforts;
      if (m?.details) modelDetails = m.details;
    } catch {}
    if (!['claude', 'codex'].includes(state.cfg.backend)) state.cfg.backend = 'claude';
  }
  function saveCfg() {
    try { localStorage.setItem('lx:cfg', JSON.stringify(state.cfg)); } catch {}
  }
  const HIST_KEY = () => 'lx:hist:' + docKey;
  const ARCH_KEY = () => 'lx:arch:' + docKey;
  const TGT_KEY = () => 'lx:targets:' + docKey;
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
  // 目标只存位置（不改动工作簿本身）；下次打开面板时重新读取内容。
  function saveTargets() {
    try { localStorage.setItem(TGT_KEY(), JSON.stringify(state.targets.map((t) => ({ sheetId: t.sheetId, sheetName: t.sheetName, address: t.address })))); } catch {}
  }
  function loadSavedTargets() {
    try {
      const l = JSON.parse(localStorage.getItem(TGT_KEY()) || '[]');
      return Array.isArray(l) ? l.filter((t) => t && t.sheetId && typeof t.address === 'string' && G.parseAddress(t.address)) : [];
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
    const lines = [`# ${docTitle() || tr('Excel 工作簿')}`, '', tr`> 导出自 LLM_in_Excel · ${new Date().toLocaleString()}`, ''];
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

  // ---------- Office / Excel 集成 ----------
  function xlRun(fn) {
    return Excel.run(fn).catch((e) => {
      let msg = String(e?.message || e);
      if (e && e.code) msg = `${e.code}: ${msg}`;
      return { ok: false, error: msg };
    });
  }
  const sheetRef = (t) => `${t.sheetName}!${t.address}`;
  function whereOf(t) {
    const rows = t.r2 - t.r1 + 1, cols = t.c2 - t.c1 + 1;
    return tr`${sheetRef(t)} · ${rows}×${cols}`;
  }
  // 发给模型的位置说明（中文，与提示词一致）
  function modelWhere(t) {
    const rows = t.r2 - t.r1 + 1, cols = t.c2 - t.c1 + 1;
    const empty = t.grid.every((row) => row.every((c) => c === ''));
    return `${G.quoteSheet(t.sheetName)}!${t.address}，${rows} 行 × ${cols} 列${empty ? '，目前是空白' : ''}`;
  }
  // 把 range 读到的四个矩阵变成「表示法」网格（见 GridUtils.cellRepr）
  function reprGrid(f, t, ty, v, repr = G.cellRepr) {
    return f.map((row, i) => row.map((x, j) => repr(x, t[i][j], ty[i][j], v[i][j])));
  }
  function rectOf(address) {
    const p = G.parseAddress(address);
    return { r1: p.r1, c1: p.c1, r2: p.r2, c2: p.c2, address: G.rangeAddress(p.r1, p.c1, p.r2, p.c2) };
  }

  // 读一个目标区域的当前内容
  async function readTarget(ctx, t) {
    const ws = ctx.workbook.worksheets.getItemOrNullObject(t.sheetId);
    ws.load('name');
    await ctx.sync();
    if (ws.isNullObject) return null;
    const rg = ws.getRange(t.address);
    rg.load('formulas,text,valueTypes,values');
    await ctx.sync();
    const grid = reprGrid(rg.formulas, rg.text, rg.valueTypes, rg.values);
    return { ...t, sheetName: ws.name, grid, texts: rg.text, types: rg.valueTypes, text: G.toGridMarkdown(grid, t.r1, t.c1) };
  }

  // 用工作簿现状校准目标：更新表名（可能被改名）和内容；所在工作表被删掉的移除。
  async function syncTargets(ctx, targets) {
    const list = [];
    let lost = 0;
    for (const t of targets) {
      const next = await readTarget(ctx, t);
      if (next) list.push(next); else lost++;
    }
    return { list, lost };
  }

  // 组模型上下文：目标所在的表和当前工作表给出带坐标的全表（太大就保留表头、目标附近的行，并注明省略范围），
  // 其他工作表给出前几行预览。公式在上下文里同时给出当前结果（「=公式 → 结果」）。
  async function buildBookContext(ctx, targets) {
    const sheets = ctx.workbook.worksheets;
    sheets.load('items/id,items/name,items/visibility');
    const active = ctx.workbook.worksheets.getActiveWorksheet();
    active.load('id,name');
    await ctx.sync();
    const useds = sheets.items.map((ws) => { const u = ws.getUsedRangeOrNullObject(true); u.load('address,rowIndex,columnIndex,rowCount,columnCount'); return u; });
    await ctx.sync();
    const focus = new Set([active.id, ...targets.map((t) => t.sheetId)]);
    const parts = [];
    let budget = CTX_CAP, truncated = false;
    const order = sheets.items.map((_, i) => i).sort((a, b) => Number(focus.has(sheets.items[b].id)) - Number(focus.has(sheets.items[a].id)) || a - b);
    for (const i of order) {
      const ws = sheets.items[i], used = useds[i];
      const hidden = ws.visibility !== 'Visible' ? '，隐藏' : '';
      if (used.isNullObject) { parts[i] = `【工作表「${ws.name}」 · 空白${hidden}】`; continue; }
      const r1 = used.rowIndex + 1, c1 = used.columnIndex + 1, nRows = used.rowCount, nCols = used.columnCount;
      const head = `【工作表「${ws.name}」 · 已用区域 ${G.rangeAddress(r1, c1, r1 + nRows - 1, c1 + nCols - 1)} · ${nRows} 行 × ${nCols} 列${ws.id === active.id ? '（当前工作表）' : ''}${hidden}】`;
      const full = focus.has(ws.id);
      // 选出要读的行：全表放得下就全读；否则表头 3 行 + 目标附近的行 + 从上往下补到预算
      const cols = Math.min(nCols, full ? 60 : 20);
      const perRow = cols * 12 + 16;
      const maxRows = Math.max(3, Math.floor((full ? budget * 0.8 : Math.min(budget, 6000)) / perRow));
      let rows;
      if (nRows <= maxRows) rows = Array.from({ length: nRows }, (_, k) => r1 + k);
      else {
        truncated = true;
        const want = new Set();
        for (let k = 0; k < Math.min(3, nRows); k++) want.add(r1 + k);
        if (full) for (const t of targets.filter((x) => x.sheetId === ws.id)) for (let r = t.r1 - 5; r <= t.r2 + 5; r++) if (r >= r1 && r < r1 + nRows) want.add(r);
        for (let r = r1; want.size < maxRows && r < r1 + nRows; r++) want.add(r);
        rows = [...want].sort((a, b) => a - b).slice(0, Math.max(maxRows, want.size));
      }
      // 连续的行合成一段读取
      const windows = [];
      for (const r of rows) {
        const last = windows[windows.length - 1];
        if (last && r === last.end + 1) last.end = r; else windows.push({ start: r, end: r });
      }
      const loaded = windows.map((w) => {
        const rg = ws.getRangeByIndexes(w.start - 1, c1 - 1, w.end - w.start + 1, cols);
        rg.load('formulas,text,valueTypes,values');
        return { w, rg };
      });
      await ctx.sync();
      const lines = [head];
      let prevEnd = r1 - 1;
      for (const { w, rg } of loaded) {
        if (w.start > prevEnd + 1) lines.push(`（第 ${prevEnd + 1}–${w.start - 1} 行省略）`);
        lines.push(G.toGridMarkdown(reprGrid(rg.formulas, rg.text, rg.valueTypes, rg.values, G.contextRepr), w.start, c1));
        prevEnd = w.end;
      }
      if (prevEnd < r1 + nRows - 1) lines.push(`（第 ${prevEnd + 1}–${r1 + nRows - 1} 行省略）`);
      if (cols < nCols) { lines.push(`（右侧还有 ${nCols - cols} 列未列出）`); truncated = true; }
      const text = lines.join('\n');
      budget -= text.length;
      parts[i] = text;
    }
    const fullText = parts.filter(Boolean).join('\n\n');
    return { fullText, truncated, sheetCount: sheets.items.length, activeSheet: active.name, docChars: fullText.length };
  }

  // 重新读一遍目标（表名、内容）
  async function refreshTargets(quiet) {
    if (!state.xlReady) return { ok: false };
    const r = await xlRun(async (ctx) => ({ ok: true, ...(await syncTargets(ctx, state.targets)) }));
    if (r.ok) {
      state.targets = r.list;
      saveTargets();
      renderTargetBar();
      if (r.lost && !quiet) addNote(tr`⚠️ 有 ${r.lost} 个目标所在的工作表不在了，已移除`);
      return { ok: true, lost: r.lost };
    }
    if (!quiet) addNote(tr('⚠️ 读取目标失败：') + escapeHtml(uiText(r.error)));
    return r;
  }

  // ＋ 添加选中：每个选区（按住 Cmd/Ctrl 可以多选几块）成为一个目标；空白区域也可以（比如要填的一列）。
  // 整列、整行这样的大选区和已用区域取交集；含合并单元格的区域不收。
  async function addTarget() {
    if (state.targets.length >= MAX_TARGETS) { addNote(tr`⚠️ 目标最多 ${MAX_TARGETS} 个`); return; }
    const r = await xlRun(async (ctx) => {
      const sel = ctx.workbook.getSelectedRanges();
      const areas = sel.areas;
      areas.load('items/address,items/cellCount');
      const ws = sel.worksheet;
      ws.load('id,name');
      await ctx.sync();
      const used = ws.getUsedRangeOrNullObject(true);
      used.load('address');
      await ctx.sync();
      const found = [], problems = [];
      for (const area of areas.items) {
        let rg = area;
        if (area.cellCount > MAX_TARGET_CELLS) {
          if (used.isNullObject) { problems.push({ kind: 'huge', address: area.address }); continue; }
          const inter = area.getIntersectionOrNullObject(used);
          inter.load('address,cellCount');
          await ctx.sync();
          if (inter.isNullObject) { problems.push({ kind: 'empty', address: area.address }); continue; }
          if (inter.cellCount > MAX_TARGET_CELLS) { problems.push({ kind: 'huge', address: area.address }); continue; }
          rg = inter;
        }
        rg.load('address,formulas,text,valueTypes,values');
        const merged = state.api.v113 ? rg.getMergedAreasOrNullObject() : null;
        if (merged) merged.load('areaCount');
        await ctx.sync();
        if (merged && !merged.isNullObject) { problems.push({ kind: 'merged', address: rg.address }); continue; }
        const rect = rectOf(rg.address);
        const grid = reprGrid(rg.formulas, rg.text, rg.valueTypes, rg.values);
        found.push({ sheetId: ws.id, sheetName: ws.name, ...rect, grid, texts: rg.text, types: rg.valueTypes, text: G.toGridMarkdown(grid, rect.r1, rect.c1) });
      }
      return { ok: true, found, problems };
    });
    if (!r.ok) { addNote(tr('⚠️ 添加目标失败：') + escapeHtml(uiText(r.error))); return; }
    let skippedOverlap = 0, skippedFull = 0;
    const added = [];
    const total = () => [...state.targets, ...added].reduce((s, t) => s + cellsOf(t), 0);
    for (const t of r.found) {
      if ([...state.targets, ...added].some((x) => x.sheetId === t.sheetId && G.overlaps(x, t))) { skippedOverlap++; continue; }
      if (state.targets.length + added.length >= MAX_TARGETS || total() + cellsOf(t) > MAX_TOTAL_CELLS) { skippedFull++; continue; }
      added.push({ ...t, id: 't' + (++tgtSeq) });
    }
    for (const p of r.problems) {
      const where = escapeHtml(p.address.replace(/^.*!/, ''));
      if (p.kind === 'merged') addNote(tr`⚠️ ${where} 含合并单元格，暂不支持作为目标（可先取消合并）`);
      else if (p.kind === 'huge') addNote(tr`⚠️ ${where} 太大了（超过 ${MAX_TARGET_CELLS} 个单元格）。请只选需要改的部分，比如某一列的数据行。`);
      else addNote(tr`⚠️ ${where} 和已用区域没有交集，已跳过。要填写空白区域，请直接选中那几个单元格。`);
    }
    if (!added.length) {
      if (skippedOverlap) addNote(tr('⚠️ 选中的区域已经是目标了（或和已有目标重叠）。先在设置里 ✕ 掉那个目标，或换一块。'));
      else if (skippedFull) addNote(tr`⚠️ 目标最多 ${MAX_TARGETS} 个、合计 ${MAX_TOTAL_CELLS} 个单元格`);
      return;
    }
    state.targets = [...state.targets, ...added];
    saveTargets();
    renderTargetBar();
    const skipped = [skippedOverlap ? tr`${skippedOverlap} 块已是目标` : '', skippedFull ? tr`${skippedFull} 块超出上限` : ''].filter(Boolean).join(tr('、'));
    const n = state.targets.length;
    if (added.length === 1) {
      const t = added[0];
      const empty = t.grid.every((row) => row.every((c) => c === ''));
      addNote((empty
        ? tr`🎯 已添加空白区域 ${escapeHtml(sheetRef(t))} 作为目标（当前共 ${n} 个），可以让模型根据同一行的其他列来填写。`
        : tr`🎯 已添加 ${escapeHtml(sheetRef(t))}（${cellsOf(t)} 个单元格）作为目标（当前共 ${n} 个）。`) + (skipped ? tr`（跳过：${skipped}）` : ''));
    } else {
      addNote(tr`🎯 已添加 ${added.length} 块区域作为目标（当前共 ${n} 个）${skipped ? tr`（跳过：${skipped}）` : ''}。`);
    }
    els.input.focus();
  }
  const cellsOf = (t) => (t.r2 - t.r1 + 1) * (t.c2 - t.c1 + 1);

  // 面板启动时：恢复上次为这个工作簿设的目标（所在工作表还在就恢复）
  async function restoreTargets() {
    const saved = loadSavedTargets();
    if (!saved.length) return;
    state.targets = saved.map((t) => ({ ...t, ...rectOf(t.address), grid: [], texts: [], types: [], text: '', id: 't' + (++tgtSeq) }));
    const r = await refreshTargets(true);
    if (r.ok && state.targets.length) {
      addNote(tr`🎯 已恢复上次设的 ${state.targets.length} 个目标${r.lost ? tr`（另有 ${r.lost} 个已找不到）` : ''}（不想要就在设置里清除）`);
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

  // 📍 定位：切到那张表并选中目标区域
  async function revealTarget(id) {
    const t = state.targets.find((x) => x.id === id);
    if (!t) return;
    const r = await xlRun(async (ctx) => {
      const ws = ctx.workbook.worksheets.getItemOrNullObject(t.sheetId);
      ws.load('name');
      await ctx.sync();
      if (ws.isNullObject) return { ok: false, error: tr('这个目标所在的工作表不在了，请重新添加') };
      ws.activate();
      ws.getRange(t.address).select();
      await ctx.sync();
      return { ok: true };
    });
    if (!r.ok) addNote('⚠️ ' + escapeHtml(uiText(r.error)));
  }

  // 组"改写模式"的上下文：读目标区域和工作簿。
  async function getEditContext() {
    return await xlRun(async (ctx) => {
      const { list, lost } = await syncTargets(ctx, state.targets);
      if (!list.length) return { ok: false, error: tr('目标所在的工作表都不在了，请重新选中并添加目标') };
      return { ok: true, targets: list, lost, ...(await buildBookContext(ctx, list)) };
    });
  }

  // 问答模式（无目标）：整个工作簿
  async function getWholeBook() {
    return await xlRun(async (ctx) => ({ ok: true, ...(await buildBookContext(ctx, [])) }));
  }

  // 按模型回复规划写入（预览和应用共用）：解析带坐标的表格，和目标区域比较
  function planFor(tk, replacement) {
    const parsed = G.parseGridMarkdown(replacement, tk);
    if (!parsed.ok) return parsed;
    return { ok: true, ...G.planChanges(tk, tk.grid, parsed.cells, tk.texts), cells: parsed.cells };
  }

  // ✅ 应用：核对目标区域没被改过 → 目标外要写的单元格必须是空的 → 只写有变化的单元格 → 回读查公式错误。
  // 返回撤销所需的记录（每个单元格原来的内容、类型和数字格式）。
  async function applyGrid(tk, replacement, force) {
    return await xlRun(async (ctx) => {
      const ws = ctx.workbook.worksheets.getItemOrNullObject(tk.sheetId);
      ws.load('name');
      await ctx.sync();
      if (ws.isNullObject) return { ok: false, error: tr('找不到目标所在的工作表（可能已被删除），请重新选中后添加') };
      const rg = ws.getRange(tk.address);
      rg.load('formulas,text,valueTypes,values,numberFormat');
      await ctx.sync();
      const grid = reprGrid(rg.formulas, rg.text, rg.valueTypes, rg.values);
      if (!force && JSON.stringify(grid) !== JSON.stringify(tk.grid)) return { ok: false, needConfirm: true };
      const parsed = G.parseGridMarkdown(replacement, tk);
      if (!parsed.ok) return { ok: false, error: uiText(parsed.error) };
      const plan = G.planChanges(tk, grid, parsed.cells, rg.text);
      const outs = plan.outside.map((c) => { const cell = ws.getRange(c.addr); cell.load('formulas,valueTypes,numberFormat'); return cell; });
      await ctx.sync();
      const busy = plan.outside.filter((c, i) => outs[i].valueTypes[0][0] !== 'Empty' || outs[i].formulas[0][0] !== '');
      if (busy.length) {
        return { ok: false, error: tr`回复要写入目标区域外已有内容的单元格（${busy.slice(0, 3).map((c) => c.addr).join('、')}${busy.length > 3 ? '…' : ''}），没有写入。如需修改它们，请把它们也选进目标。` };
      }
      const all = [
        ...plan.inside.map((c) => { const i = c.r - tk.r1, j = c.c - tk.c1; return { ...c, formula: rg.formulas[i][j], type: rg.valueTypes[i][j], nf: rg.numberFormat[i][j] }; }),
        ...plan.outside.map((c, k) => ({ ...c, formula: '', type: 'Empty', nf: outs[k].numberFormat[0][0] })),
      ];
      if (!all.length) return { ok: true, unchanged: true };
      for (const c of all) ws.getRange(c.addr).formulas = [[G.toExcelInput(c.value, c.type)]];
      await ctx.sync();
      const back = all.map((c) => { const cell = ws.getRange(c.addr); cell.load('formulas,valueTypes,text'); return cell; });
      await ctx.sync();
      const errors = [], becameText = [];
      back.forEach((cell, i) => {
        const ty = cell.valueTypes[0][0];
        if (ty === 'Error') errors.push(`${all[i].addr} ${cell.text[0][0]}`);
        else if (all[i].type === 'Double' && ty === 'String') becameText.push(all[i].addr);
      });
      return {
        ok: true, written: all.length, inside: plan.inside.length, outside: plan.outside.length, errors, becameText,
        undo: { sheetId: tk.sheetId, cells: all.map((c, i) => ({ addr: c.addr, formula: c.formula, type: c.type, nf: c.nf, applied: back[i].formulas[0][0] })) },
      };
    });
  }

  // ↩ 撤销：写回每个单元格原来的内容和数字格式。写入后又被改过的单元格就不硬来。
  async function undoGrid(u) {
    return await xlRun(async (ctx) => {
      const ws = ctx.workbook.worksheets.getItemOrNullObject(u.sheetId);
      ws.load('name');
      await ctx.sync();
      if (ws.isNullObject) return { ok: false, error: tr('找不到这块区域所在的工作表，无法撤销') };
      const now = u.cells.map((c) => { const cell = ws.getRange(c.addr); cell.load('formulas'); return cell; });
      await ctx.sync();
      const moved = u.cells.filter((c, i) => String(now[i].formulas[0][0]) !== String(c.applied));
      if (moved.length) return { ok: false, error: tr`有 ${moved.length} 个单元格在写入后又被改过（如 ${moved[0].addr}），无法自动撤销，请手动改回` };
      for (const c of u.cells) ws.getRange(c.addr).formulas = [[G.restoreInput(c.formula, c.type)]];
      await ctx.sync();
      for (const c of u.cells) if (c.nf != null) ws.getRange(c.addr).numberFormat = [[c.nf]];
      await ctx.sync();
      return { ok: true, restored: u.cells.length };
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
    } else if (!state.xlReady) {
      els.banner.textContent = tr('请在 Excel 的「LLM_in_Excel」加载项中使用。此处可预览界面、检查后端连接。');
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
  function saveDraft() { try { localStorage.setItem('lx:draft:' + docKey, els.input.value); } catch {} }
  function restoreDraft() { try { els.input.value = localStorage.getItem('lx:draft:' + docKey) || ''; autoGrow(); } catch {} }
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
    welcome.innerHTML = tr('<div class="welcome-icon" aria-hidden="true">✦</div><h2>把表格整理得井井有条</h2><p>选中一块单元格，告诉我要做什么。<br>清洗整理、分类打标、写公式，或者问问这张表。</p><div class="welcome-flow"><span>选择区域</span><b>→</b><span>描述想法</span><b>→</b><span>预览与应用</span></div>');
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
      els.targetInfo.innerHTML = tr('<span class="muted">可以添加一块或几块单元格区域（按住 Cmd/Ctrl 多选），空白区域也行（比如要填的一列）。</span>');
      els.targetBar.classList.add('empty');
      return;
    }
    els.targetBar.classList.remove('empty');
    const total = ts.reduce((s, t) => s + cellsOf(t), 0);
    const warn = total > SOFT_CELLS ? tr(' · <b class="warn">⚠️ 单元格较多，生成会比较慢</b>') : '';
    const cacheOn = state.cliSession[state.cfg.backend];
    els.targetInfo.innerHTML = tr`已选 ${ts.length} 块 · ${total} 个单元格${cacheOn ? tr(' · 可续聊') : ''}${warn}`;
    ts.forEach((t, i) => {
      const row = document.createElement('div');
      row.className = 'tgt-row';
      const sample = t.grid.flat().filter((c) => c !== '').slice(0, 6).join(' · ');
      row.innerHTML =
        `<span class="tgt-k">${i + 1}</span>` +
        `<span class="tgt-main"><span class="tgt-where">${escapeHtml(whereOf(t))}</span>` +
        `<span class="tgt-prev" title="${escapeHtml(sample.slice(0, 300))}">${escapeHtml(sample ? (sample.length > 60 ? sample.slice(0, 60) + '…' : sample) : tr('（空白）'))}</span></span>` +
        `<span class="tgt-len">${tr`${cellsOf(t)}格`}</span>`;
      const loc = document.createElement('button');
      loc.className = 'ibtn';
      loc.textContent = '📍';
      loc.title = tr('在表格里定位这块区域');
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

  // 顶部一行：目标和单元格数；详情（目标列表、定位、移除）在设置浮层里。
  function renderContextSummary() {
    const ts = state.targets;
    const total = ts.reduce((s, t) => s + cellsOf(t), 0);
    els.contextSummary.textContent = ts.length === 1 ? tr`1 个目标 · ${ts[0].address} · ${total} 格`
      : ts.length ? tr`${ts.length} 个目标 · ${total} 格`
      : state.cfg.mode === 'ask' ? tr('整个工作簿') : tr('未选择区域');
    els.contextSummary.title = ts.length ? tr`查看、定位或移除 ${ts.length} 个目标` : tr('查看目标与设置');
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
  // ---------- 替换卡片（单元格预览 + 应用 + 撤销）----------
  // tk = 请求时的目标快照 { k, id, sheetId, sheetName, address, r1..c2, grid, texts, ... }；返回 doApply 供「应用全部」调用
  function attachGridCard(bubble, tk, replacement, via, multi) {
    const card = document.createElement('div');
    card.className = 'card';
    const plan = tk ? planFor(tk, replacement) : { ok: false, error: '没有对应目标' };
    const where = tk ? escapeHtml(whereOf(tk)) : '';
    card.innerHTML =
      `<div class="card-head">` +
      `<span class="card-title">${multi && tk ? tr`目标 ${tk.k} · ` : ''}${tr('单元格预览')}${where ? `<span class="card-where">${where}</span>` : ''}</span>` +
      `<button class="tab active" data-tab="diff">${tr('对比')}</button><button class="tab" data-tab="new">${tr('源码')}</button>` +
      `</div>` +
      `<div class="card-body diffview"></div>` +
      `<pre class="card-body newview hidden">${escapeHtml(replacement)}</pre>` +
      `<div class="card-actions">` +
      tr`<button class="btn btn-primary apply">✅ 应用</button>` +
      tr`<button class="btn undo hidden" title="把这些单元格改回应用前的内容">↩ 撤销</button>` +
      tr`<button class="btn copy">📋 复制</button>` +
      (multi ? '' : tr`<button class="btn retry" title="用同样的指令重新生成">🔁 重试</button>`) +
      `<span class="card-status"></span>` +
      `</div>`;
    bubble.appendChild(card);

    const diffView = card.querySelector('.diffview');
    const applyBtn = card.querySelector('.apply');
    const undoBtn = card.querySelector('.undo');
    const statusEl = card.querySelector('.card-status');
    let blocked = !plan.ok;
    if (plan.ok) {
      diffView.appendChild(gridPreviewEl(tk, plan));
      const notes = [];
      if (plan.inside.length) notes.push(tr`改动 ${plan.inside.length} 个单元格`);
      if (plan.outside.length) notes.push(tr`目标外空白处新增 ${plan.outside.length} 个`);
      if (!notes.length) { notes.push(tr('内容与当前区域一致（无变化）')); blocked = true; }
      const note = document.createElement('div');
      note.className = 'tbl-note';
      note.textContent = notes.join(' · ');
      diffView.appendChild(note);
    } else {
      diffView.innerHTML = tr`<span class="muted">⚠️ 回复里的表格对不上单元格（${escapeHtml(uiText(plan.error))}），无法应用。点 🔁 重试。</span>`;
    }
    if (blocked) applyBtn.disabled = true;
    card.querySelectorAll('.tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        card.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
        tab.classList.add('active');
        const isDiff = tab.dataset.tab === 'diff';
        diffView.classList.toggle('hidden', !isDiff);
        card.querySelector('.newview').classList.toggle('hidden', isDiff);
      });
    });

    let done = false;
    let undoRec = null;
    let forceNext = false; // 二次点击确认覆盖（Office 的 WebView 会吞 window.confirm，不能用弹窗）
    const doApply = async () => {
      if (state.streaming || done) return done;
      if (!tk) { statusEl.textContent = tr('⚠️ 没有对应目标，无法应用'); return false; }
      if (blocked) { statusEl.textContent = tr('⚠️ 这一处没有可以写入的改动'); return false; }
      applyBtn.disabled = true;
      statusEl.textContent = tr('应用中…');
      const r = await applyGrid(tk, replacement, forceNext);
      if (r.needConfirm) {
        forceNext = true;
        applyBtn.disabled = false;
        statusEl.textContent = multi
          ? tr`⚠️ 目标 ${tk.k} 的内容在发送后已变化（可能手动改过）。确认覆盖请再点一次「✅ 应用」`
          : tr('⚠️ 目标的内容在发送后已变化（可能手动改过）。确认覆盖请再点一次「✅ 应用」');
        return false;
      }
      forceNext = false;
      if (!r.ok) {
        statusEl.textContent = '⚠️ ' + (r.error || tr('应用失败'));
        applyBtn.disabled = false;
        return false;
      }
      done = true;
      state.targets = state.targets.filter((t) => t.id !== tk.id); // 应用成功 → 该目标自动移除
      saveTargets();
      renderTargetBar();
      if (r.unchanged) { statusEl.textContent = tr('内容与表格现状一致，没有需要写入的改动。'); return true; }
      undoRec = r.undo;
      undoBtn.classList.remove('hidden');
      const extra = r.outside ? tr`，其中 ${r.outside} 个在目标外的空白处` : '';
      let msg = tr`✅ 已写入 ${r.written} 个单元格${extra}（只改有变化的单元格，格式不变）。该目标已移除；不满意可点「↩ 撤销」。`;
      if (r.errors.length) msg += tr` ⚠️ ${r.errors.length} 个公式计算出错：${r.errors.slice(0, 3).join('、')}${r.errors.length > 3 ? '…' : ''}，请检查。`;
      if (r.becameText.length) msg += tr` ⚠️ ${r.becameText.slice(0, 3).join('、')}${r.becameText.length > 3 ? '…' : ''} 原来是数字，现在存成了文本。`;
      statusEl.textContent = msg;
      return true;
    };
    applyBtn.addEventListener('click', doApply);
    undoBtn.addEventListener('click', async () => {
      if (!undoRec || state.streaming) return;
      undoBtn.disabled = true;
      statusEl.textContent = tr('撤销中…');
      const r = await undoGrid(undoRec);
      if (!r.ok) { statusEl.textContent = '⚠️ ' + (r.error || tr('撤销失败')); undoBtn.disabled = false; return; }
      undoRec = null;
      undoBtn.classList.add('hidden');
      // 撤销后把原目标放回列表，方便换个说法再改
      if (state.targets.length < MAX_TARGETS && !state.targets.some((t) => t.sheetId === tk.sheetId && G.overlaps(t, tk))) {
        state.targets.push({ ...tk, id: 't' + (++tgtSeq) });
        await refreshTargets(true);
      }
      statusEl.textContent = tr`↩ 已撤销，${r.restored} 个单元格恢复为应用前的内容和格式，目标已放回列表。`;
    });
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

  // 单元格预览：只列出有改动的行和列（带行号、列字母）；改动的格子绿底并划掉旧值，目标外新增的格子蓝底。
  // 长文字用逐字对比显示。行太多时只显示前 PREVIEW_ROWS 行。
  function gridPreviewEl(tk, plan) {
    const changes = [...plan.inside, ...plan.outside];
    const wrap = document.createElement('div');
    wrap.className = 'grid-wrap';
    if (!changes.length) return wrap;
    const rows = [...new Set(changes.map((c) => c.r))].sort((a, b) => a - b);
    const cols = [...new Set(changes.map((c) => c.c))].sort((a, b) => a - b);
    const byAddr = new Map(changes.map((c) => [c.addr, c]));
    const tbl = document.createElement('table');
    tbl.className = 'tblprev gridprev';
    const head = document.createElement('tr');
    head.appendChild(document.createElement('th'));
    for (const c of cols) { const th = document.createElement('th'); th.textContent = G.colName(c); head.appendChild(th); }
    tbl.appendChild(head);
    for (const r of rows.slice(0, PREVIEW_ROWS)) {
      const tr0 = document.createElement('tr');
      const rh = document.createElement('th');
      rh.textContent = String(r);
      tr0.appendChild(rh);
      for (const c of cols) {
        const td = document.createElement('td');
        const ch = byAddr.get(G.cellAddress(r, c));
        const inside = r >= tk.r1 && r <= tk.r2 && c >= tk.c1 && c <= tk.c2;
        if (ch && !inside) {
          td.classList.add('cellnew');
          td.textContent = ch.value;
        } else if (ch) {
          td.classList.add('cellchg');
          const plainText = (s) => s && !/^[='"]/.test(s) && G.numberOf(s) == null;
          if (plainText(ch.old) && plainText(ch.value) && ch.old.length > 12) {
            td.innerHTML = diffHtml(ch.old, ch.value);
          } else {
            if (ch.old !== '') { const ov = document.createElement('span'); ov.className = 'oldv'; ov.textContent = ch.old; td.appendChild(ov); }
            td.appendChild(document.createTextNode(ch.value === '' ? tr('（清空）') : ch.value));
          }
        } else if (inside) {
          td.textContent = tk.grid[r - tk.r1][c - tk.c1];
          td.classList.add('cellsame');
        }
        tr0.appendChild(td);
      }
      tbl.appendChild(tr0);
    }
    wrap.appendChild(tbl);
    if (rows.length > PREVIEW_ROWS) {
      const more = document.createElement('div');
      more.className = 'tbl-note';
      more.textContent = tr`另有 ${rows.length - PREVIEW_ROWS} 行改动未显示（应用时一并写入，可在「源码」里查看全部）`;
      wrap.appendChild(more);
    }
    return wrap;
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
    if (!state.xlReady) { addNote(tr('⚠️ Office 还没就绪，稍等或点 ⟳ 刷新面板')); return; }
    if (mode === 'edit' && !state.targets.length) {
      addNote(tr('⚠️ 改写模式需要先有目标：在表格里选中一块单元格区域，点「＋ 添加选中」（可多次添加）。<br>（只是想提问的话，点上面的「改写 ▾」切换到表格问答）'));
      return;
    }

    if (state.serverOk === false) { addNote(tr('本机服务尚未连接。请打开顶部的连接设置重新检测。')); return; }
    setStreaming(true);
    state.stopRequested = false;
    const ac = new AbortController();
    state.aborter = ac;
    const myReq = ++reqCounter;
    state.curReq = myReq;
    $('#request-status').textContent = tr('正在读取表格…');
    try {
      // 组上下文；sentTargets 是本轮请求的目标快照（编号按添加顺序）
      let doc = { docTitle: docTitle() };
      let sentTargets = [];
      if (state.targets.length) {
        const ctx = await getEditContext();
        if (state.curReq !== myReq || ac.signal.aborted) return;
        if (!ctx.ok) {
          if (mode === 'edit') { addNote('⚠️ ' + escapeHtml(uiText(ctx.error) || tr('拿不到上下文'))); return; }
        } else {
          // 目标被手动编辑过：以表格现状为准，校准基线
          state.targets = ctx.targets;
          saveTargets();
          renderTargetBar();
          if (ctx.lost) addNote(tr`⚠️ 有 ${ctx.lost} 个目标所在的工作表不在了，已移除`);
          sentTargets = state.targets.map((t, i) => ({ ...t, k: i + 1 }));
          Object.assign(doc, {
            targets: sentTargets.map((t) => ({ k: t.k, text: t.text, where: modelWhere(t) })),
            fullText: ctx.fullText, truncated: ctx.truncated, sheetCount: ctx.sheetCount, activeSheet: ctx.activeSheet,
          });
        }
      }
      if (!doc.fullText) {
        const w = await getWholeBook();
        if (!w.ok) { addNote(tr('读取表格失败：') + escapeHtml(uiText(w.error) || tr('请稍后重试'))); return; }
        Object.assign(doc, { fullText: w.fullText, truncated: w.truncated, sheetCount: w.sheetCount, activeSheet: w.activeSheet });
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
        setTimeout(() => addNote(tr('💡 这个会话有点长了。建议点右上角 <b>＋</b> 开新会话：旧会话自动归档到 ◷ 历史，并<b>重新读取工作簿</b>，回复会更快更准。')), 400);
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
          applyFns.push(attachGridCard(aBubble, tk, r.code, null, multi));
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
          html += tr`<div class="warnbox">未能把回复解析成替换文本${sentTargets.length > 1 ? tr('（多目标需要每块带【目标k】标签的 \`\`\`table 围栏）') : tr('（需要 \`\`\`table 围栏）')}，无法一键应用。可以「🔁 重试」或换个说法。</div>`;
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
    state.cliSession = { claude: null, codex: null }; // 清掉 CLI 会话：下一轮重新读全篇、重建缓存
    state.sentAtts = { claude: [], codex: [] };
    els.messages.innerHTML = '';
    clearHistory();
    renderWelcome();
    if (state.targets.length) {
      await refreshTargets(true);
      if (state.targets.length) {
        addNote(tr`🆕 新会话已开启（旧会话在历史里）。${state.targets.length} 个目标仍有效，下一轮会重新读取工作簿。`);
      } else {
        addNote(tr('🆕 新会话已开启（旧会话在历史里）。原目标所在的工作表不在了，请重新选中添加。'));
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
      empty.textContent = tr('还没有归档的会话。开新会话时，旧会话会自动归档到这里（每个工作簿最多留 10 段）。');
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
    addNote(tr('🕘 已切回历史会话（它的缓存会话一并恢复：能续写就续写，失效则自动重读工作簿）。改写前请确认目标列表里还是你想改的那几块。'));
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
      if (!state.xlReady) return;
      const mySeq = ++selSeq;
      const r = await xlRun(async (ctx) => {
        const sel = ctx.workbook.getSelectedRanges();
        sel.load('address,cellCount,areaCount');
        await ctx.sync();
        return { ok: true, address: sel.address, cells: sel.cellCount, areas: sel.areaCount };
      });
      if (mySeq !== selSeq) return;
      let hint = '';
      if (r.ok) {
        const where = String(r.address).split(',').map((a) => a.replace(/^.*!/, '')).join(', ');
        hint = r.areas > 1 ? tr`已选中 ${r.areas} 块区域（${where}）→ 点「＋ 添加选中」设为目标`
          : r.cells > 1 ? tr`已选中 ${where}（${r.cells} 个单元格）→ 点「＋ 添加选中」设为目标`
          : tr`已选中 ${where} → 点「＋ 添加选中」设为目标`;
      }
      els.selHint.textContent = hint;
      els.capture.classList.toggle('has-selection', !!(r.ok && (r.cells > 1 || r.areas > 1)));
      els.capture.title = hint || tr('把选中的单元格区域添加为改写目标');
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
      try { localStorage.setItem('lx:models', JSON.stringify({ claude: MODELS.claude, codex: MODELS.codex, fetchedAt: r.fetchedAt, efforts: modelEfforts, details: modelDetails })); } catch {}
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
    $('#instruction-label').textContent = mode === 'edit' ? tr('告诉我怎么改') : tr('想了解表格的什么');
    renderPresets();
    els.input.placeholder = mode === 'edit'
      ? tr('比如：把 G 列的反馈分成 物流 / 账单 / 产品 / 服务…')
      : tr('比如：哪个地区的增长最快？…');
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
    $('#btn-capture').addEventListener('click', () => { if (state.xlReady && !state.streaming) addTarget(); else if (!state.xlReady) addNote(tr('请在 Excel 加载项中选中单元格，再添加目标。')); });
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
      const isXl = info.host === Office.HostType.Excel;
      const has = (v) => { try { return Office.context.requirements.isSetSupported('ExcelApi', v); } catch { return false; } };
      state.xlReady = isXl && has('1.9');
      if (!state.xlReady) {
        els.banner.textContent = isXl
          ? tr('⚠️ 这个版本的 Excel 太旧（需要 ExcelApi 1.9，即 2019 年以后的版本）。请更新 Excel。')
          : tr('⚠️ 本加载项只支持 Excel。');
        els.banner.classList.remove('hidden');
        refreshStatusUI();
        return;
      }
      state.api = { v113: has('1.13') };
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
    window.__lx_test = { diffOps, diffHtml, parseReplacements, stripFences, reprGrid, rectOf, whereOf, modelWhere, planFor };
  } catch {}
})();
