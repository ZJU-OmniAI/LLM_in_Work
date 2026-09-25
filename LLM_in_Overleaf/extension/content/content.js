// 注入到 Overleaf 项目页的内容脚本（isolated world）：
// 选中 LaTeX → 浮标「✦ 改这段」→ 右侧面板下指令 → 流式回复 → diff 预览 → 一键应用替换。
// 对编辑器的读写全部通过 bridge.js（MAIN world）转发，本文件只管 UI 和流程。
// 用 Shadow DOM 把 UI 和 Overleaf 页面隔离，互不干扰。
(() => {
  'use strict';
  if (window.__llmInOverleafInjected) return;
  window.__llmInOverleafInjected = true;
  if (!/^\/project\/[0-9a-z]{6,}/i.test(location.pathname)) return; // 只在项目编辑页生效

  const NS = 'LLM_IN_OVERLEAF_BRIDGE';

  // 项目 id（会话按项目分开存）
  const PID = (location.pathname.match(/^\/project\/([0-9a-z]+)/i) || [])[1] || 'unknown';
  const HIST_KEY = 'hist:' + PID; // 当前会话
  const ARCH_KEY = 'arch:' + PID; // 归档的历史会话（最多留 10 个）
  const LONG_SESSION_MSGS = 14;   // 消息数达到这个阈值提醒开新会话

  // 模型列表：[候选值, 显示名]。别名由 CLI 解析成当下最新版本。
  const MODELS = {
    claude: [['sonnet', 'Sonnet'], ['opus', 'Opus'], ['haiku', 'Haiku']],
    codex: [['(default)', '使用 Codex 配置']],
  };
  const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
  const EFFORT_LABELS = { low: '快速', medium: '均衡', high: '深入', xhigh: '更深入', max: '最高' };

  // 快捷指令（点一下填进输入框，可再编辑）
  const PRESETS = [
    ['润色', '润色这段学术表达，使其更清晰、更地道；保持原意、术语和引用不变'],
    ['修语法', '修正语法、拼写和标点错误，尽量少改动措辞'],
    ['精简', '在保留所有关键信息的前提下压缩这段文字，删掉冗余表达'],
    ['扩写', '把这段扩写得更充分：补足逻辑衔接和必要细节，风格与全文保持一致'],
    ['公式规范', '检查并修正这段里的 LaTeX 公式与环境写法，规范符号、编号和排版'],
    ['译成英文', '把这段翻译成地道的学术英文 LaTeX，保留所有命令、标签和引用'],
  ];

  const SOFT_SEL_LIMIT = 60000; // 选区超过这个字符数给出警告（还是允许发）

  // 附件限制（类 Cursor 的上下文附件：项目内其他文件 + 本地图片/PDF）
  const TEXT_EXTS = ['tex', 'bib', 'txt', 'md', 'cls', 'sty', 'bst', 'csv'];
  const BIN_EXTS = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
  const TEXT_CAP = 50000;             // 单个文本附件最多进 prompt 的字符数
  const BIN_CAP = 10 * 1024 * 1024;   // 单个图片/PDF 上限 10MB
  const MAX_FILES = 8;                // 附件总数上限
  const TOTAL_BIN_CAP = 25 * 1024 * 1024; // 二进制附件合计上限

  // ---------- 运行状态 ----------
  const state = {
    cfg: { backend: 'claude', model_claude: 'sonnet', model_codex: '(default)', effort: 'medium', width: 480, mode: 'edit', layout: 'push' },
    target: null, // { from, to, text, fileName, line1, line2, docChars, applied }
    messages: [], // { role: 'user'|'assistant', content, via? }
    streaming: false,
    preparing: false,
    applying: false,
    capturing: false,
    followOutput: true,
    port: null,
    stopCurrent: null, // 当前请求的"手动收尾"函数（自己 disconnect 不触发自身 onDisconnect，见 stopStream）
    nativeOk: null, // null=未探测
    editorOk: false,
    longNoteShown: false, // 本会话是否已提醒过"聊太长了"
    attachments: [], // { id, source:'project'|'local', name, kind:'text'|'binary', mime, text?, b64?, size, truncated }
    zipBuf: null,    // 项目源码 zip（ArrayBuffer 缓存）
    zipEntries: null,
    cliSession: { claude: null, codex: null }, // CLI 会话 id：有值=后续轮"续写+服务端缓存"，🆕 清空
    sentAtts: { claude: [], codex: [] },       // 已进入对应 CLI 会话的附件 id（续轮只发新增附件）
  };
  let attSeq = 0;
  let targetSeq = 0;

  // ---------- 配置读写（popup 里改了会经 storage.onChanged 同步过来）----------
  async function loadCfg() {
    try {
      const saved = await chrome.storage.local.get(['backend', 'model_claude', 'model_codex', 'effort', 'width', 'mode', 'layout', 'modelList']);
      const { modelList: m, ...rest } = saved;
      Object.assign(state.cfg, Object.fromEntries(Object.entries(rest).filter(([, v]) => v != null)));
      // 上次 🔄 探测到的最新模型列表（没探测过就用代码里的兜底列表）
      if (m && Array.isArray(m.claude) && m.claude.length) MODELS.claude = m.claude;
      if (m && Array.isArray(m.codex) && m.codex.length) MODELS.codex = m.codex;
    } catch {}
  }
  function saveCfg() {
    try { chrome.storage.local.set(state.cfg); } catch {}
  }
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      let dirty = false;
      for (const k of ['backend', 'model_claude', 'model_codex', 'effort']) {
        if (changes[k] && changes[k].newValue != null && changes[k].newValue !== state.cfg[k]) {
          state.cfg[k] = changes[k].newValue;
          dirty = true;
        }
      }
      if (dirty && els.backend) { els.backend.value = state.cfg.backend; fillModelOptions(); els.effort.value = state.cfg.effort; }
    });
  } catch {}

  // ---------- 与 MAIN world 桥的 RPC ----------
  const pendingRpc = new Map();
  let rpcSeq = 0;
  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.ns !== NS || d.dir !== 'resp') return;
    const w = pendingRpc.get(d.id);
    if (w) { pendingRpc.delete(d.id); clearTimeout(w.timer); w.resolve(d.resp || { ok: false, error: '空响应' }); }
  });
  function bridge(op, args = {}, timeoutMs = 5000) {
    return new Promise((resolve) => {
      const id = ++rpcSeq;
      const timer = setTimeout(() => {
        pendingRpc.delete(id);
        resolve({ ok: false, error: '编辑器桥未响应（页面可能还没加载完，稍等或刷新）' });
      }, timeoutMs);
      pendingRpc.set(id, { resolve, timer });
      window.postMessage({ ns: NS, dir: 'req', id, op, args }, '*');
    });
  }

  // ---------- 会话持久化（按项目存 chrome.storage.local，刷新页面不丢）----------
  function trimMsgs(msgs) {
    return msgs.slice(-40).map((m) => ({
      role: m.role,
      content: m.content.length > 20000 ? m.content.slice(0, 20000) + '…（存档截断）' : m.content,
      via: m.via,
    }));
  }
  async function loadHistory() {
    try {
      const o = await chrome.storage.local.get(HIST_KEY);
      const h = o[HIST_KEY];
      if (h && Array.isArray(h.messages)) state.messages = h.messages;
      if (h && h.cliSession) state.cliSession = { claude: null, codex: null, ...h.cliSession };
      if (h && h.sentAtts) state.sentAtts = { claude: [], codex: [], ...h.sentAtts };
    } catch {}
  }
  function saveHistory() {
    try {
      chrome.storage.local.set({
        [HIST_KEY]: { messages: trimMsgs(state.messages), cliSession: state.cliSession, sentAtts: state.sentAtts, ts: Date.now() },
      });
    } catch {}
  }
  function clearHistory() {
    try { chrome.storage.local.remove(HIST_KEY); } catch {}
  }
  async function getArchive() {
    try {
      const o = await chrome.storage.local.get(ARCH_KEY);
      return Array.isArray(o[ARCH_KEY]) ? o[ARCH_KEY] : [];
    } catch { return []; }
  }
  function setArchive(list) {
    try { chrome.storage.local.set({ [ARCH_KEY]: list.slice(0, 10) }); } catch {}
  }
  function sessionEntry(messages) {
    const firstUser = messages.find((m) => m.role === 'user');
    return {
      ts: Date.now(),
      preview: (firstUser?.content || '').slice(0, 60),
      messages: trimMsgs(messages),
      // CLI 会话 id 跟着归档走：切回历史会话时能继续续写（claude/codex 的会话都存本地磁盘，不过期）
      cliSession: { ...state.cliSession },
      sentAtts: { claude: [...(state.sentAtts.claude || [])], codex: [...(state.sentAtts.codex || [])] },
    };
  }
  function sessionMarkdown(messages) {
    const fname = state.target?.fileName || '';
    const title = (document.title || '').split(' - Overleaf')[0] || 'Overleaf 项目';
    const lines = [`# ${title}${fname ? ` · ${fname}` : ''}`, '', `> 导出自 LLM_in_Overleaf · ${new Date().toLocaleString()}`, ''];
    for (const m of messages) {
      if (m.role === 'user') lines.push(`## 🙋 用户`, '', m.content, '');
      else lines.push(`## 🤖 助手${m.via ? `（${[m.via.backend, m.via.model, 'effort ' + m.via.effort].filter(Boolean).join(' · ')}）` : ''}`, '', m.content, '');
    }
    return lines.join('\n');
  }
  function fmtTime(ts) {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // ---------- 项目源码 zip：拉取 / 解析 / 抽取（零依赖，DEFLATE 用浏览器自带 DecompressionStream）----------
  async function ensureZip(force) {
    if (state.zipEntries && !force) return;
    const res = await fetch(`/project/${PID}/download/zip`, { credentials: 'include' });
    if (!res.ok) throw new Error(`下载项目源码失败 HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    state.zipBuf = buf;
    state.zipEntries = parseZipEntries(buf);
  }
  function parseZipEntries(buf) {
    const dv = new DataView(buf);
    let i = buf.byteLength - 22; // EOCD 最小 22 字节，从尾部往前找签名
    const lo = Math.max(0, buf.byteLength - 22 - 65536);
    while (i >= lo && dv.getUint32(i, true) !== 0x06054b50) i--;
    if (i < lo) throw new Error('不是有效的 zip');
    const count = dv.getUint16(i + 10, true);
    let off = dv.getUint32(i + 16, true);
    const entries = [];
    const td = new TextDecoder();
    for (let k = 0; k < count; k++) {
      if (off + 46 > buf.byteLength || dv.getUint32(off, true) !== 0x02014b50) break;
      const method = dv.getUint16(off + 10, true);
      const csize = dv.getUint32(off + 20, true);
      const usize = dv.getUint32(off + 24, true);
      const nlen = dv.getUint16(off + 28, true);
      const elen = dv.getUint16(off + 30, true);
      const clen = dv.getUint16(off + 32, true);
      const lho = dv.getUint32(off + 42, true);
      const name = td.decode(new Uint8Array(buf, off + 46, nlen));
      if (!name.endsWith('/')) entries.push({ name, method, csize, usize, lho });
      off += 46 + nlen + elen + clen;
    }
    return entries;
  }
  async function extractZipEntry(buf, e) {
    const dv = new DataView(buf);
    if (dv.getUint32(e.lho, true) !== 0x04034b50) throw new Error('zip 条目损坏');
    const nlen = dv.getUint16(e.lho + 26, true);
    const elen = dv.getUint16(e.lho + 28, true);
    const start = e.lho + 30 + nlen + elen;
    const comp = new Uint8Array(buf, start, e.csize);
    if (e.method === 0) return comp.slice();
    if (e.method === 8) {
      const stream = new Blob([comp]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    throw new Error('不支持的 zip 压缩方式 ' + e.method);
  }

  // ---------- 附件管理 ----------
  function extOf(name) {
    const m = String(name).toLowerCase().match(/\.([a-z0-9]+)$/);
    return m ? m[1] : '';
  }
  function fmtSize(n) {
    if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + 'M';
    if (n >= 1024) return Math.round(n / 1024) + 'k';
    return n + 'B';
  }
  function attIcon(a) {
    if (a.kind === 'text') return '📄';
    return a.mime === 'application/pdf' ? '📕' : '🖼';
  }
  function u8ToB64(u8) {
    let s = '';
    const CH = 0x8000;
    for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return btoa(s);
  }
  function totalBinBytes() {
    return state.attachments.filter((a) => a.kind === 'binary').reduce((s, a) => s + a.size, 0);
  }
  function canAddFile(size, isBin) {
    if (state.attachments.length >= MAX_FILES) return `附件最多 ${MAX_FILES} 个`;
    if (isBin && size > BIN_CAP) return `单个图片/PDF 最大 ${fmtSize(BIN_CAP)}`;
    if (isBin && totalBinBytes() + size > TOTAL_BIN_CAP) return `图片/PDF 合计超过 ${fmtSize(TOTAL_BIN_CAP)}`;
    return null;
  }
  function pushAttachment(a) {
    a.id = ++attSeq;
    state.attachments.push(a);
    renderAttachChips();
  }
  function removeAttachment(id) {
    state.attachments = state.attachments.filter((a) => a.id !== id);
    renderAttachChips();
  }
  function renderAttachChips() {
    const wrap = els.attChips;
    wrap.innerHTML = '';
    for (const a of state.attachments) {
      const chip = document.createElement('span');
      chip.className = 'ole-att-chip';
      chip.innerHTML = `${attIcon(a)} ${escapeHtml(a.name)} · ${fmtSize(a.size)}${a.truncated ? '（截断）' : ''} `;
      const x = document.createElement('button');
      x.textContent = '✕';
      x.title = '移除';
      x.addEventListener('click', () => removeAttachment(a.id));
      chip.appendChild(x);
      wrap.appendChild(chip);
    }
    els.attachBar.classList.toggle('has-atts', state.attachments.length > 0);
  }
  function noteAttErr(msg) { addNote('⚠️ ' + escapeHtml(msg)); }

  // 项目内文件 → 附件（文本抽字符，图片/PDF 抽字节转 b64）
  async function addProjectEntry(entry) {
    const ext = extOf(entry.name);
    const isText = TEXT_EXTS.includes(ext);
    const isBin = !!BIN_EXTS[ext];
    if (!isText && !isBin) { noteAttErr(`暂不支持 .${ext} 文件`); return false; }
    if (state.attachments.some((a) => a.source === 'project' && a.name === entry.name)) return true; // 已添加
    const err = canAddFile(entry.usize, isBin);
    if (err) { noteAttErr(err); return false; }
    try {
      const bytes = await extractZipEntry(state.zipBuf, entry);
      if (isText) {
        let text = new TextDecoder().decode(bytes);
        const truncated = text.length > TEXT_CAP;
        if (truncated) text = text.slice(0, TEXT_CAP) + '\n…（过长已截断）';
        pushAttachment({ source: 'project', name: entry.name, kind: 'text', mime: 'text/plain', text, size: entry.usize, truncated });
      } else {
        pushAttachment({ source: 'project', name: entry.name, kind: 'binary', mime: BIN_EXTS[ext], b64: u8ToB64(bytes), size: bytes.length });
      }
      return true;
    } catch (e) {
      noteAttErr(`读取 ${entry.name} 失败：${e.message}`);
      return false;
    }
  }
  // 本地文件 → 附件
  async function addLocalFiles(fileList) {
    for (const f of fileList) {
      const ext = extOf(f.name);
      const isText = TEXT_EXTS.includes(ext);
      const isBin = !!BIN_EXTS[ext];
      if (!isText && !isBin) { noteAttErr(`暂不支持 ${f.name}（只收 ${TEXT_EXTS.join('/')}/pdf/图片）`); continue; }
      const err = canAddFile(f.size, isBin);
      if (err) { noteAttErr(err); continue; }
      try {
        if (isText) {
          let text = await f.text();
          const truncated = text.length > TEXT_CAP;
          if (truncated) text = text.slice(0, TEXT_CAP) + '\n…（过长已截断）';
          pushAttachment({ source: 'local', name: f.name, kind: 'text', mime: 'text/plain', text, size: f.size, truncated });
        } else {
          const b64 = await new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result).split(',')[1] || '');
            r.onerror = () => reject(new Error('读取失败'));
            r.readAsDataURL(f);
          });
          pushAttachment({ source: 'local', name: f.name, kind: 'binary', mime: BIN_EXTS[ext] || f.type, b64, size: f.size });
        }
      } catch (e) {
        noteAttErr(`读取 ${f.name} 失败：${e.message}`);
      }
    }
  }

  // ---------- 📁 项目文件选择浮层 ----------
  async function openProjView() {
    els.projView.classList.remove('hidden');
    els.projList.innerHTML = '<div class="ole-hist-empty">📦 正在打包下载项目源码…（首次稍慢，之后走缓存）</div>';
    try {
      await ensureZip(false);
      await renderProjList();
    } catch (e) {
      els.projList.innerHTML = `<div class="ole-hist-empty">⚠️ ${escapeHtml(e.message || '拉取失败')}</div>`;
    }
  }
  async function renderProjList() {
    const st = await bridge('status', {}, 2500);
    const curFile = (st.ok && st.fileName) || '';
    const rank = (n) => {
      const e = extOf(n);
      if (e === 'tex') return 0;
      if (e === 'bib') return 1;
      if (TEXT_EXTS.includes(e)) return 2;
      if (BIN_EXTS[e]) return 3;
      return 4;
    };
    const entries = [...state.zipEntries].sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
    const wrap = els.projList;
    wrap.innerHTML = '';
    if (!entries.length) {
      wrap.innerHTML = '<div class="ole-hist-empty">项目里没有文件？</div>';
      return;
    }
    for (const e of entries) {
      const ext = extOf(e.name);
      const supported = TEXT_EXTS.includes(ext) || !!BIN_EXTS[ext];
      const isCur = curFile && e.name.split('/').pop() === curFile;
      const row = document.createElement('div');
      row.className = 'ole-proj-row';
      const icon = TEXT_EXTS.includes(ext) ? '📄' : BIN_EXTS[ext] ? (ext === 'pdf' ? '📕' : '🖼') : '📦';
      row.innerHTML = `<span class="ole-proj-name">${icon} ${escapeHtml(e.name)}</span><span class="ole-proj-size">${fmtSize(e.usize)}</span>`;
      const btn = document.createElement('button');
      btn.className = 'ole-hbtn';
      const added = state.attachments.some((a) => a.source === 'project' && a.name === e.name);
      if (isCur) { btn.textContent = '当前文件'; btn.disabled = true; btn.title = '正在编辑的文件已自动作为全文上下文'; }
      else if (!supported) { btn.textContent = '不支持'; btn.disabled = true; }
      else if (added) { btn.textContent = '✓ 已添加'; btn.disabled = true; }
      else {
        btn.textContent = '＋ 添加';
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          btn.textContent = '读取中…';
          const ok = await addProjectEntry(e);
          btn.textContent = ok ? '✓ 已添加' : '＋ 添加';
          btn.disabled = ok;
        });
      }
      row.appendChild(btn);
      wrap.appendChild(row);
    }
  }

  // ---------- 小工具 ----------
  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
      btn.textContent = ok ? '✓ 已复制' : '✗ 失败';
      setTimeout(() => { btn.textContent = old; }, 1500);
    }
    return ok;
  }

  // 极简 Markdown 渲染（先转义再套格式，防 XSS；围栏代码块渲成 <pre>）
  function renderMarkdown(src) {
    if (!src) return '';
    const codeBlocks = [];
    let s = src.replace(/```([^\n]*)\n([\s\S]*?)```/g, (_, _lang, code) => {
      const i = codeBlocks.length;
      codeBlocks.push(`<pre class="ole-pre"><code>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`);
      return ` CB${i} `;
    });
    s = escapeHtml(s);
    s = s.replace(/`([^`\n]+)`/g, (_, c) => `<code class="ole-code">${c}</code>`);
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

  // ---------- 围栏解析：从回复里抠出"替换用的 LaTeX" ----------
  function parseReplacement(raw) {
    const blocks = [];
    const re = /```([a-zA-Z]*)[^\S\n]*\n([\s\S]*?)```/g;
    let m;
    while ((m = re.exec(raw))) blocks.push({ lang: (m[1] || '').toLowerCase(), code: m[2] });
    if (!blocks.length) return null;
    const latexish = blocks.filter((b) => ['latex', 'tex', ''].includes(b.lang));
    const pool = latexish.length ? latexish : blocks;
    const pick = pool.reduce((a, b) => (b.code.length >= a.code.length ? b : a));
    return pick.code.replace(/\n$/, '');
  }
  // 把围栏从说明文字里去掉（说明单独渲染，围栏用替换卡片展示）
  function stripFence(raw, code) {
    if (code == null) return raw;
    const re = /```([a-zA-Z]*)[^\S\n]*\n([\s\S]*?)```/g;
    let out = raw, m;
    while ((m = re.exec(raw))) {
      if (m[2].replace(/\n$/, '') === code) { out = raw.slice(0, m.index) + raw.slice(m.index + m[0].length); break; }
    }
    return out.trim();
  }

  // 多段回复用明确的选段 ID 对应，缺段、重复 ID 或未知 ID 都不能应用。
  function parseReplacementSet(raw, target) {
    if (!target) return null;
    if (target.ranges.length === 1) {
      const text = parseReplacement(raw);
      return text == null ? null : { edits: [{ id: target.ranges[0].id, text }], note: stripFence(raw, text) };
    }
    const blocks = [...raw.matchAll(/```([^\n]*)\n([\s\S]*?)```/g)];
    if (blocks.length !== target.ranges.length || (raw.match(/```/g) || []).length !== blocks.length * 2) return null;
    const byId = new Map();
    for (const b of blocks) {
      const match = b[1].trim().match(/^(?:latex|tex)\s+id=(s\d+)$/);
      if (!match || byId.has(match[1]) || !target.ranges.some((r) => r.id === match[1])) return null;
      byId.set(match[1], b[2].replace(/\r?\n$/, ''));
    }
    return {
      edits: target.ranges.map((r) => ({ id: r.id, text: byId.get(r.id) })),
      note: raw.replace(/```[^\n]*\n[\s\S]*?```/g, '').trim(),
    };
  }

  // ---------- 词级 diff（LCS，带规模保护）----------
  function diffHtml(aStr, bStr) {
    const tok = (s) => s.split(/(\s+)/).filter((t) => t !== '');
    const a = tok(aStr), b = tok(bStr);
    const n = a.length, m = b.length;
    if (n * m > 500000) return null; // 太大不硬算，退回"只看新文本"
    const W = m + 1;
    const dp = new Uint32Array((n + 1) * W);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * W + j] = a[i] === b[j] ? dp[(i + 1) * W + j + 1] + 1 : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
      }
    }
    const ops = []; // ['='|'-'|'+', text]
    let i = 0, j = 0;
    const push = (t, s) => {
      if (ops.length && ops[ops.length - 1][0] === t) ops[ops.length - 1][1] += s;
      else ops.push([t, s]);
    };
    while (i < n && j < m) {
      if (a[i] === b[j]) { push('=', a[i]); i++; j++; }
      else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) { push('-', a[i]); i++; }
      else { push('+', b[j]); j++; }
    }
    while (i < n) push('-', a[i++]);
    while (j < m) push('+', b[j++]);
    return ops
      .map(([t, s]) => {
        const e = escapeHtml(s);
        if (t === '-') return `<del>${e}</del>`;
        if (t === '+') return `<ins>${e}</ins>`;
        return e;
      })
      .join('');
  }

  // ---------- 构建 UI ----------
  const host = document.createElement('div');
  host.id = 'llm-in-overleaf-host';
  host.style.cssText = 'all:initial;';
  const shadow = host.attachShadow({ mode: 'open' });
  document.documentElement.appendChild(host);

  const style = document.createElement('style');
  style.textContent = CSS_TEXT();
  shadow.appendChild(style);

  const ui = document.createElement('div');
  ui.innerHTML = PANEL_HTML();
  shadow.appendChild(ui);

  const $ = (sel) => shadow.querySelector(sel);
  const els = {
    launcher: $('#ole-launcher'),
    panel: $('#ole-panel'),
    settingsBtn: $('#ole-settings-toggle'),
    settings: $('#ole-settings'),
    readingBtn: $('#ole-reading'),
    readingStop: $('#ole-reading-stop'),
    modeSummary: $('#ole-mode-summary'),
    contextSummary: $('#ole-context-summary'),
    statusDot: $('#ole-status-dot'),
    statusText: $('#ole-status-text'),
    banner: $('#ole-banner'),
    backend: $('#ole-backend'),
    model: $('#ole-model'),
    modelsRefresh: $('#ole-models-refresh'),
    effort: $('#ole-effort'),
    modeEdit: $('#ole-mode-edit'),
    modeAsk: $('#ole-mode-ask'),
    targetBar: $('#ole-target'),
    targetInfo: $('#ole-target-info'),
    targetPrev: $('#ole-target-prev'),
    targetList: $('#ole-target-list'),
    targetReveal: $('#ole-target-reveal'),
    targetClear: $('#ole-target-clear'),
    capture: $('#ole-capture'),
    selectionHint: $('#ole-selection-hint'),
    presets: $('#ole-presets'),
    messages: $('#ole-messages'),
    input: $('#ole-input'),
    send: $('#ole-send'),
    stop: $('#ole-stop'),
    layoutBtn: $('#ole-layout'),
    newBtn: $('#ole-new'),
    histBtn: $('#ole-hist'),
    close: $('#ole-close'),
    resizer: $('#ole-resizer'),
    floatBtn: $('#ole-float-btn'),
    histView: $('#ole-hist-view'),
    histList: $('#ole-hist-list'),
    histClose: $('#ole-hist-close'),
    attachBar: $('#ole-attachbar'),
    attProj: $('#ole-att-proj'),
    attLocal: $('#ole-att-local'),
    attChips: $('#ole-att-chips'),
    fileInput: $('#ole-file-input'),
    projView: $('#ole-proj-view'),
    projList: $('#ole-proj-list'),
    projClose: $('#ole-proj-close'),
    projRefresh: $('#ole-proj-refresh'),
  };

  // ---------- 面板开合 ----------
  let panelOpen = false;
  let reading = false;
  function showSettings(open) {
    els.settings.classList.toggle('hidden', !open);
    els.settingsBtn.setAttribute('aria-expanded', String(open));
  }
  function setReading(value) {
    const scrollTop = els.messages.scrollTop;
    const followOutput = state.followOutput;
    reading = value;
    showSettings(false);
    els.panel.classList.toggle('reading', value);
    els.readingBtn.textContent = value ? '返回' : '阅读';
    els.readingBtn.title = value ? '退出最大化阅读（Esc）' : '最大化阅读：展开输出区域';
    els.readingBtn.setAttribute('aria-label', els.readingBtn.title);
    els.readingBtn.setAttribute('aria-pressed', String(value));
    // 改布局只调整可见空间，不跳回正在阅读的回复底部。
    requestAnimationFrame(() => {
      els.messages.scrollTop = followOutput ? els.messages.scrollHeight : scrollTop;
      state.followOutput = followOutput;
    });
    if (value) els.messages.focus({ preventScroll: true });
    else els.input.focus({ preventScroll: true });
  }
  function openPanel() {
    panelOpen = true;
    els.panel.classList.add('open');
    els.launcher.classList.add('hidden');
    applyWidth();
    (reading ? els.messages : els.input).focus();
    refreshStatus();
  }
  function closePanel() {
    showSettings(false);
    panelOpen = false;
    els.panel.classList.remove('open');
    els.launcher.classList.remove('hidden');
    applyPagePush(0);
  }
  function applyWidth() {
    const maxByWin = window.innerWidth < 700 ? window.innerWidth : Math.max(360, Math.floor(window.innerWidth * 0.6));
    const w = Math.min(maxByWin, Math.max(340, Math.min(860, state.cfg.width || 480)));
    els.panel.style.width = w + 'px';
    applyPagePush(w);
  }
  // 推挤模式：把 Overleaf 整页挤窄，面板占右侧空出来的条，互不遮挡。
  // 注意 Overleaf 给 <html> 设了 position:fixed（宽度锚死视口），margin 推不动，
  // 必须直接改它的 width（2026-07 真实页面实测：分栏/编辑器/PDF 都会自动重排，无横向滚动条）。
  let resizeKick = 0;
  const originalRootWidth = document.documentElement.style.getPropertyValue('width');
  const originalRootPriority = document.documentElement.style.getPropertyPriority('width');
  let pushedWidth = null;
  function applyPagePush(w) {
    const root = document.documentElement;
    const nextWidth = panelOpen && state.cfg.layout !== 'overlay' && w > 0 && window.innerWidth >= 700 ? w : 0;
    if (pushedWidth === nextWidth) return;
    pushedWidth = nextWidth;
    if (nextWidth) {
      root.style.setProperty('width', `calc(100% - ${w}px)`, 'important');
    } else {
      if (originalRootWidth) root.style.setProperty('width', originalRootWidth, originalRootPriority);
      else root.style.removeProperty('width');
    }
    // 踢一脚 resize 让 Overleaf 重新排版；拖拽改宽时做节流，免得 PDF 反复重绘
    clearTimeout(resizeKick);
    resizeKick = setTimeout(() => { try { window.dispatchEvent(new Event('resize')); } catch {} }, 120);
  }
  function updateLayoutBtn() {
    const push = state.cfg.layout !== 'overlay';
    els.layoutBtn.textContent = push ? '📌' : '🪟';
    els.layoutBtn.title = push
      ? '当前：推挤页面（Overleaf 整体变窄，不遮挡）。点击切换为悬浮覆盖'
      : '当前：悬浮覆盖（会盖住 PDF 侧）。点击切换为推挤页面';
  }

  // ---------- 状态检查（编辑器桥 + 本机桥）----------
  let statusSeq = 0;
  async function refreshStatus() {
    const seq = ++statusSeq;
    const backend = state.cfg.backend;
    els.statusText.textContent = `正在检查 ${backend === 'codex' ? 'Codex' : 'Claude'}…`;
    const st = await bridge('status', {}, 2500);
    state.editorOk = !!(st.ok && st.ready);
    let nativeMsg = '';
    try {
      const h = await chrome.runtime.sendMessage({ type: 'health', backend });
      if (seq !== statusSeq) return;
      state.nativeOk = !!(h && h.ok);
      if (!state.nativeOk) nativeMsg = (h && h.error) || '本机桥未安装';
    } catch {
      state.nativeOk = false;
      nativeMsg = '无法连接扩展后台，刷新页面试试';
    }
    if (seq !== statusSeq) return;
    const okAll = state.editorOk && state.nativeOk;
    els.statusDot.className = 'ole-dot ' + (okAll ? 'ok' : 'bad');
    els.statusText.textContent = okAll
      ? `编辑器已连接 · ${backend === 'codex' ? 'Codex' : 'Claude'} 就绪`
      : !state.editorOk
        ? '未连接源码编辑器'
        : `${backend === 'codex' ? 'Codex' : 'Claude'} 需要检查`;
    els.statusDot.title = els.statusText.textContent;
    els.statusDot.setAttribute('aria-label', els.statusText.textContent);
    if (!state.editorOk || (!state.nativeOk && nativeMsg)) {
      els.banner.textContent = !state.editorOk ? (st.error || '请打开 .tex 文件，切换到 Code Editor（源码编辑）后重试。') : nativeMsg;
      els.banner.classList.remove('hidden');
    } else {
      els.banner.classList.add('hidden');
    }
  }

  // ---------- 目标条（同一文件中的多个独立选段） ----------
  function makeTarget(ranges, fileName, docChars) {
    const sorted = [...ranges].sort((a, b) => a.from - b.from);
    return { ...sorted[0], ranges: sorted, fileName, docChars,
      text: sorted.map((r) => r.text).join('\n\n'), applied: false };
  }
  function targetSpec(t) {
    return { fileName: t.fileName, ranges: t.ranges.map((r) => ({ id: r.id, from: r.from, to: r.to, oldText: r.text })) };
  }
  function targetBusy() { return state.streaming || state.preparing || state.applying || state.capturing; }
  async function targetContext(t) {
    const ctx = await bridge('get_context', { ...targetSpec(t), from: t.from, to: t.to, oldText: t.ranges[0].text }, 10000);
    if (!ctx.ok) return ctx;
    // 单段兼容旧桥响应；多段必须有逐段校准结果。
    if (!ctx.ranges && t.ranges.length === 1) ctx.ranges = [{ ...t.ranges[0], from: ctx.from, to: ctx.to, line1: ctx.line1, line2: ctx.line2 }];
    if (!ctx.ranges || ctx.ranges.length !== t.ranges.length) return { ok: false, error: '选段校准失败，请重新加载扩展并刷新页面。' };
    Object.assign(t, makeTarget(ctx.ranges, t.fileName || ctx.fileName, ctx.docChars));
    return ctx;
  }
  async function revealRange(r) {
    if (targetBusy() || !state.target) return;
    const res = await bridge('reveal', { from: r.from, to: r.to, oldText: r.text, fileName: state.target.fileName }, 4000);
    if (!res.ok) addNote('⚠️ ' + escapeHtml(res.error || '定位失败'));
    else showSettings(false);
  }
  function renderTargetBar() {
    const t = state.target;
    const count = t?.ranges.length || 0;
    els.contextSummary.textContent = t
      ? `${t.fileName || '当前文件'} · ${count > 1 ? count + ' 段' : `${t.line1}${t.line2 !== t.line1 ? '–' + t.line2 : ''} 行`}`
      : state.cfg.mode === 'ask' ? '全文上下文' : '未选择段落';
    els.contextSummary.title = t ? `查看 ${count} 段 · ${t.text.length} 字符；可逐段移除` : '查看上下文与选段设置';
    els.contextSummary.setAttribute('aria-label', els.contextSummary.title);
    els.selectionHint.classList.remove('error');
    els.targetList.replaceChildren();
    els.targetPrev.classList.toggle('hidden', count > 1);
    els.targetReveal.classList.toggle('hidden', count > 1);
    els.floatBtn.textContent = t ? '＋ 加入选段' : '✦ 改这段';
    if (!t) {
      els.targetInfo.innerHTML = '<span class="ole-muted">选中一段源码后点「添加选段」；可继续选择其他位置并累积添加。</span>';
      els.targetPrev.textContent = '';
      els.selectionHint.textContent = '支持逐段添加，也支持编辑器已有的多个不连续选区。';
      els.targetBar.classList.add('empty');
      return;
    }
    els.targetBar.classList.remove('empty');
    const warn = t.text.length > SOFT_SEL_LIMIT ? ' · <b class="ole-warn">选段较多，建议分批</b>' : '';
    const cacheOn = state.cliSession[state.cfg.backend];
    const ctxInfo = cacheOn ? ' · ♻️已缓存全文' : ' · 附全文上下文';
    els.targetInfo.innerHTML = `🎯 ${escapeHtml(t.fileName || '当前文件')} · ${count} 段 · ${t.ranges.reduce((n, r) => n + r.text.length, 0)} 字符${ctxInfo}${warn}`;
    const preview = t.ranges[0].text.replace(/\s+/g, ' ').trim();
    els.targetPrev.textContent = preview.length > 150 ? preview.slice(0, 150) + '…' : preview;
    for (const [i, r] of t.ranges.entries()) {
      const row = document.createElement('div');
      row.className = 'ole-selected-range';
      const caption = document.createElement('span');
      caption.textContent = `${i + 1}. 第 ${r.line1}${r.line2 !== r.line1 ? '–' + r.line2 : ''} 行 · ${r.text.length} 字符`;
      caption.title = r.text.slice(0, 500);
      const reveal = mkBtn('定位', () => revealRange(r));
      const remove = mkBtn('移除', () => {
        if (targetBusy() || state.target !== t) return;
        const rest = t.ranges.filter((x) => x.id !== r.id);
        state.target = rest.length ? makeTarget(rest, t.fileName, t.docChars) : null;
        renderTargetBar();
      });
      reveal.classList.add('ole-range-reveal');
      remove.classList.add('ole-range-remove');
      remove.setAttribute('aria-label', `移除选段 ${i + 1}`);
      reveal.disabled = remove.disabled = targetBusy();
      row.append(caption, reveal, remove);
      els.targetList.appendChild(row);
    }
  }
  function clearTarget() {
    if (state.streaming || state.preparing || state.applying || state.capturing) return;
    state.target = null;
    renderTargetBar();
  }

  // ---------- 消息渲染 ----------
  function addMessageEl(role) {
    const wrap = document.createElement('div');
    wrap.className = `ole-msg ole-${role}`;
    const bubble = document.createElement('div');
    bubble.className = 'ole-bubble';
    wrap.appendChild(bubble);
    els.messages.appendChild(wrap);
    if (state.followOutput) els.messages.scrollTop = els.messages.scrollHeight;
    return bubble;
  }
  function addNote(html) {
    const d = document.createElement('div');
    d.className = 'ole-note';
    d.innerHTML = html;
    els.messages.appendChild(d);
    if (state.followOutput) els.messages.scrollTop = els.messages.scrollHeight;
  }
  function footHtml(via) {
    if (!via) return '';
    return `<div class="ole-foot">${escapeHtml([via.backend, via.model, 'effort ' + via.effort, via.resumed ? '♻️缓存续写' : ''].filter(Boolean).join(' · '))}</div>`;
  }

  function renderWelcome() {
    const welcome = document.createElement('div');
    welcome.className = 'ole-welcome';
    welcome.innerHTML = `<div class="ole-welcome-mark">✦</div><div class="ole-eyebrow">YOUR WRITING COMPANION</div>
      <h2>让想法，表达得更好。</h2><p>专注论文，让助手处理措辞、语法与 LaTeX。</p>
      <div class="ole-steps"><div><b>01</b><span>选中段落<small>在 Code Editor 中选择源码，点击「✦ 改这段」或上方「添加选段」</small></span></div>
      <div><b>02</b><span>告诉我怎么改<small>输入要求，或选择下方快捷指令</small></span></div>
      <div><b>03</b><span>比较，再应用<small>查看修改差异，确认后写回 · ⌘Z 可撤销</small></span></div></div>
      <div class="ole-welcome-tip">也可以切换「问答」，一起梳理论文思路。</div>`;
    els.messages.appendChild(welcome);
  }

  // ---------- 替换卡片（diff 预览 + 应用）----------
  function attachReplacementCard(bubble, replacements, via) {
    const t = state.target;
    const card = document.createElement('div');
    card.className = 'ole-card';
    const parts = t.ranges.map((r, i) => {
      const replacement = replacements.find((e) => e.id === r.id).text;
      const diff = diffHtml(r.text, replacement);
      const heading = t.ranges.length > 1 ? `<span class="ole-edit-heading">选段 ${i + 1} · 第 ${r.line1}${r.line2 !== r.line1 ? '–' + r.line2 : ''} 行</span>` : '';
      return { text: replacement, diff: `<div class="ole-edit-part">${heading}${diff ?? '<i class="ole-muted">内容较大，请切到新文本查看</i>'}</div>`, next: `<div class="ole-edit-part">${heading}${escapeHtml(replacement)}</div>` };
    });
    card.innerHTML =
      `<div class="ole-card-head">` +
      `<span class="ole-card-title">替换预览${parts.length > 1 ? ` · ${parts.length} 段` : ''}</span>` +
      `<span class="ole-tabs"><button class="ole-tab active" data-tab="diff">对比</button><button class="ole-tab" data-tab="new">新文本</button></span>` +
      `</div>` +
      `<div class="ole-card-body ole-diffview">${parts.map((p) => p.diff).join('')}</div>` +
      `<div class="ole-card-body ole-newview hidden">${parts.map((p) => p.next).join('')}</div>` +
      `<div class="ole-card-actions">` +
      `<button class="ole-btn ole-apply">✅ ${parts.length > 1 ? '应用全部选段' : '应用替换'}</button>` +
      `<button class="ole-btn ole-copy">📋 复制</button>` +
      `<button class="ole-btn ole-retry" title="用同样的指令重新生成">🔁 重试</button>` +
      `<span class="ole-card-status"></span>` +
      `</div>`;
    bubble.appendChild(card);

    const diffView = card.querySelector('.ole-diffview');
    const newView = card.querySelector('.ole-newview');
    card.querySelectorAll('.ole-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        card.querySelectorAll('.ole-tab').forEach((x) => x.classList.remove('active'));
        tab.classList.add('active');
        const isDiff = tab.dataset.tab === 'diff';
        diffView.classList.toggle('hidden', !isDiff);
        newView.classList.toggle('hidden', isDiff);
      });
    });

    const statusEl = card.querySelector('.ole-card-status');
    const applyBtn = card.querySelector('.ole-apply');
    applyBtn.addEventListener('click', async () => {
      if (state.streaming || state.preparing || state.applying || state.capturing) return;
      const tgt = state.target;
      if (!tgt) { statusEl.textContent = '目标已清除，请重新选中'; return; }
      if (tgt !== t) { statusEl.textContent = '选区已切换。这张预览属于之前的段落，请为当前选区重新生成。'; return; }
      state.applying = true;
      try {
      applyBtn.disabled = true;
      statusEl.textContent = '应用中…';
      // 防呆：当前打开的文件和选中时不一样就先别写
      const st = await bridge('status', {}, 2500);
      if (st.ok && st.fileName && tgt.fileName && st.fileName !== tgt.fileName) {
        statusEl.textContent = `⚠️ 当前打开的是 ${st.fileName}，请切回 ${tgt.fileName} 再应用`;
        applyBtn.disabled = false;
        return;
      }
      const r = await bridge('apply_edits', { fileName: tgt.fileName, edits: tgt.ranges.map((r) => ({ id: r.id, from: r.from, to: r.to, oldText: r.text, newText: replacements.find((e) => e.id === r.id).text })) }, 8000);
      if (r.ok) {
        // 应用成功即完成该目标：自动移除，下一处改动让用户重新选中（与 word_edit 行为一致）
        if (state.target === tgt) { state.target = null; renderTargetBar(); }
        statusEl.textContent = '✅ 已应用（Cmd+Z 可撤销）· 该目标已完成移除，要改下一处请重新选中';
      } else {
        statusEl.textContent = '⚠️ ' + (r.error || '应用失败');
        applyBtn.disabled = false;
      }
      } finally { state.applying = false; }
    });
    card.querySelector('.ole-copy').addEventListener('click', (e) => copyText(parts.map((p) => p.text).join('\n\n'), e.target));
    card.querySelector('.ole-retry').addEventListener('click', () => {
      if (state.streaming) return;
      const lastUser = [...state.messages].reverse().find((m) => m.role === 'user');
      if (lastUser) sendInstruction(lastUser.content, { isRetry: true });
    });
    if (via) {
      const foot = document.createElement('div');
      foot.innerHTML = footHtml(via);
      bubble.appendChild(foot.firstChild);
    }
  }

  // ---------- 发送 ----------
  function send() {
    const text = els.input.value.trim();
    if (!text || state.streaming || state.preparing || state.applying || state.capturing) return;
    sendInstruction(text, {});
  }

  async function sendInstruction(text, options = {}) {
    if (state.streaming || state.preparing || state.applying || state.capturing) return;
    state.preparing = true;
    for (const el of [els.backend, els.model, els.effort, els.modeEdit, els.modeAsk, els.targetClear, els.capture, els.newBtn, els.histBtn]) el.disabled = true;
    els.send.disabled = true;
    try { await performSend(text, options); }
    catch (e) {
      if (state.stopCurrent) state.stopCurrent();
      setStreaming(false);
      addNote('发送失败：' + escapeHtml(String(e?.message || e)));
      if (!els.input.value) els.input.value = text;
      autoGrow();
    } finally {
      state.preparing = false; els.send.disabled = false;
      if (!state.streaming) setStreaming(false);
    }
  }

  async function performSend(text, { isRetry = false } = {}) {
    const mode = state.cfg.mode;
    if (mode === 'edit' && !state.target) {
      addNote('⚠️ 改写模式需要先有目标：在 Code Editor 里选中一段 LaTeX，点「添加选段」或浮标「✦ 改这段」。<br>（只是想提问的话，切上面的「💬 问答」模式）');
      return;
    }

    // 组文档上下文：整份当前文件全文 +（有目标时）选区及行号，超长文件由桥智能截取
    let doc = null;
    if (state.target) {
      const t = state.target;
      const ctx = await targetContext(t);
      if (!ctx.ok) { addNote('⚠️ ' + escapeHtml(ctx.error || '拿不到上下文')); return; }
      renderTargetBar();
      doc = {
        projectName: ctx.projectName, fileName: ctx.fileName, docChars: ctx.docChars,
        fullText: ctx.fullText, truncated: ctx.truncated,
        selections: t.ranges.map((r) => ({ id: r.id, text: r.text, line1: r.line1, line2: r.line2 })),
        ...(t.ranges.length === 1 ? { selection: t.text, selLine1: t.line1, selLine2: t.line2 } : {}),
      };
    }
    if (!doc) {
      const d = await bridge('get_doc', { cap: 110000 }, 10000);
      if (d.ok) doc = { projectName: d.projectName, fileName: d.fileName, docChars: d.docChars, fullText: d.text, truncated: d.truncated };
      else doc = {};
    }

    // 附件：文本类进 doc.extraFiles（拼进 prompt），图片/PDF 走 payload.attachments（落盘给 CLI）
    const sendBackend = state.cfg.backend;
    const textAtts = state.attachments.filter((a) => a.kind === 'text');
    const binAtts = state.attachments.filter((a) => a.kind === 'binary');
    if (textAtts.length) doc.extraFiles = textAtts.map((a) => ({ name: a.name, text: a.text, truncated: a.truncated }));
    // 续写模式下本轮 prompt 只带"新增附件"（旧的已在 CLI 会话记忆里）；
    // 完整附件仍随 payload 带上，供续写失效时回退重建用
    const sentIds = state.sentAtts[sendBackend] || [];
    doc.newExtraNames = textAtts.filter((a) => !sentIds.includes(a.id)).map((a) => a.name);
    const newAttIdx = [];
    binAtts.forEach((a, i) => { if (!sentIds.includes(a.id)) newAttIdx.push(i); });

    if (els.input.value.trim() === text) { els.input.value = ''; autoGrow(); }
    state.followOutput = true;
    els.messages.querySelector('.ole-welcome')?.remove();
    // 用户气泡
    const uBubble = addMessageEl('user');
    let uHtml = `<div>${(isRetry ? '🔁 ' : '') + escapeHtml(text).replace(/\n/g, '<br>')}</div>`;
    if (state.attachments.length) {
      uHtml += `<div class="ole-att-line">📎 ${state.attachments.map((a) => escapeHtml(a.name.split('/').pop())).join(' · ')}</div>`;
    }
    uBubble.innerHTML = uHtml;
    state.messages.push({ role: 'user', content: text });

    const aBubble = addMessageEl('assistant');
    aBubble.innerHTML = '<span class="ole-typing">思考中<span>.</span><span>.</span><span>.</span></span>';

    let raw = '';
    let thinking = '';
    let rafPending = false;
    let renderFrame = null;
    let streamFailed = false;
    const via = {
      backend: state.cfg.backend,
      model: state.cfg.backend === 'codex' ? state.cfg.model_codex : state.cfg.model_claude,
      effort: state.cfg.effort,
    };
    if (via.backend === 'codex' && via.model === '(default)') via.model = 'CLI 配置默认';

    const scheduleRender = (final) => {
      if (rafPending && !final) return;
      rafPending = true;
      renderFrame = requestAnimationFrame(() => {
        if (finished) return;
        rafPending = false;
        let html = '';
        if (thinking.trim()) {
          html += `<details class="ole-think"><summary>💭 思考过程</summary><div>${escapeHtml(thinking)}</div></details>`;
        }
        // 流式途中：未闭合的围栏先补上，防止渲染成一坨
        let show = raw;
        if ((raw.match(/```/g) || []).length % 2 === 1) show = raw + '\n```';
        html += renderMarkdown(show) || '<span class="ole-typing">思考中<span>.</span><span>.</span><span>.</span></span>';
        aBubble.innerHTML = html;
        if (state.followOutput) els.messages.scrollTop = els.messages.scrollHeight;
      });
    };

    const port = chrome.runtime.connect({ name: 'ol_edit_chat' });
    state.port = port;
    setStreaming(true);
    // 长时间没输出时显示已等待秒数，免得"思考中…"看起来像卡死
    const startedAt = Date.now();
    const ticker = setInterval(() => {
      if (!state.streaming || raw || thinking.trim()) return;
      const s = Math.round((Date.now() - startedAt) / 1000);
      if (s >= 5) {
        aBubble.innerHTML = '<span class="ole-typing">思考中<span>.</span><span>.</span><span>.</span></span>' +
          ` <span style="color:#748078;font-size:11px">${s}s${s >= 30 ? ' · effort 高时要几分钟，可点停止' : ''}</span>`;
      }
    }, 1000);
    const payload = {
      backend: state.cfg.backend,
      model: state.cfg.backend === 'codex' ? state.cfg.model_codex : state.cfg.model_claude,
      effort: state.cfg.effort,
      mode,
      doc,
      attachments: binAtts.map((a) => ({ name: a.name, mime: a.mime, b64: a.b64 })),
      cliSession: { ...state.cliSession },
      newAttIdx,
      messages: state.messages.map((m) => ({ role: m.role, content: m.content })),
    };
    let sawDelta = false;

    let finished = false;
    const finishStream = () => {
      if (finished) return;
      finished = true;
      if (renderFrame != null) cancelAnimationFrame(renderFrame);
      clearInterval(ticker);
      state.stopCurrent = null;
      setStreaming(false);
      state.messages.push({ role: 'assistant', content: raw || '（无输出）', via: { ...via } });
      // 本轮成功且 CLI 会话在册 → 当前所有附件都已进入该会话的记忆，下轮不必重发
      if (sawDelta && !streamFailed && state.cliSession[sendBackend]) {
        state.sentAtts[sendBackend] = state.attachments.map((a) => a.id);
      }
      saveHistory();
      renderTargetBar(); // 刷新 ♻️ 缓存标识
      // 聊太长提醒（每会话一次）：历史会整段进 prompt，太长又贵又容易带偏
      if (!state.longNoteShown && state.messages.length >= LONG_SESSION_MSGS) {
        state.longNoteShown = true;
        setTimeout(() => addNote('💡 这个会话有点长了。建议点右上角 <b>🆕</b> 开新会话：旧会话自动归档到 🕘，并<b>重新读取全文上下文</b>，回复会更快更准。'), 400);
      }
      // 最终渲染：edit 模式抠围栏 → 说明 + 替换卡片；ask 模式纯 Markdown
      const replacement = mode === 'edit' && !streamFailed ? parseReplacementSet(raw, state.target) : null;
      let html = '';
      if (thinking.trim()) {
        html += `<details class="ole-think"><summary>💭 思考过程</summary><div>${escapeHtml(thinking)}</div></details>`;
      }
      if (replacement != null) {
        const note = replacement.note;
        if (note) html += renderMarkdown(note);
        aBubble.innerHTML = html;
        attachReplacementCard(aBubble, replacement.edits, via);
      } else {
        html += renderMarkdown(raw) || '<i class="ole-muted">（无输出）</i>';
        if (mode === 'edit' && raw.trim()) {
          html += `<div class="ole-warnbox">替换稿与当前选段不完整对应，暂时无法应用。请重试，让助手重新生成各段的替换稿。</div>`;
        }
        html += footHtml(via);
        aBubble.innerHTML = html;
        if (mode === 'edit' && raw.trim()) {
          const retryBtn = document.createElement('button');
          retryBtn.className = 'ole-btn';
          retryBtn.textContent = '🔁 重试';
          retryBtn.addEventListener('click', () => {
            if (state.streaming) return;
            const lastUser = [...state.messages].reverse().find((m) => m.role === 'user');
            if (lastUser) sendInstruction(lastUser.content, { isRetry: true });
          });
          aBubble.appendChild(retryBtn);
        }
      }
      if (state.followOutput) els.messages.scrollTop = els.messages.scrollHeight;
      try { port.disconnect(); } catch {}
      state.port = null;
    };

    port.onMessage.addListener((evt) => {
      if (evt.type === 'delta') { sawDelta = true; raw += evt.text; scheduleRender(); }
      else if (evt.type === 'thinking') { thinking += evt.text; scheduleRender(); }
      else if (evt.type === 'model') { if (evt.model) via.model = evt.model; }
      else if (evt.type === 'meta') { via.resumed = !!evt.resume; }
      else if (evt.type === 'cli_session') { if (evt.backend) { state.cliSession[evt.backend] = evt.id || null; } }
      else if (evt.type === 'note') { via.resumed = false; if (evt.text) addNote(escapeHtml(evt.text)); }
      else if (evt.type === 'error') { streamFailed = true; raw += (raw ? '\n\n' : '') + `⚠️ **出错了**：\n\n${evt.error}`; scheduleRender(); }
      else if (evt.type === 'aborted') { streamFailed = true; raw += raw ? '\n\n_（已停止）_' : '_（已停止）_'; scheduleRender(); }
      else if (evt.type === 'done') finishStream();
    });
    port.onDisconnect.addListener(() => {
      if (!finished) { streamFailed = true; raw += '\n\n连接中断，请检查本机桥后重试。'; finishStream(); }
    });
    // Chrome 的坑：自己调 port.disconnect() 只通知对端，自己这端的 onDisconnect 不会触发。
    // 所以把"停止收尾"挂到 state 上，stopStream 手动调——否则点停止后界面永远卡在流式态。
    state.stopCurrent = () => {
      if (finished) return;
      streamFailed = true;
      raw += raw ? '\n\n_（已停止）_' : '_（已停止）_';
      finishStream();
    };
    port.postMessage({ type: 'start', payload });
  }

  function stopStream() {
    if (state.port) { try { state.port.disconnect(); } catch {} } // 通知后台中止 CLI 进程
    if (state.stopCurrent) state.stopCurrent(); // 自己这端手动收尾（自身 onDisconnect 不触发）
  }
  function setStreaming(v) {
    const returnReadingFocus = !v && reading && shadow.activeElement === els.readingStop;
    state.streaming = v;
    els.send.classList.toggle('hidden', v);
    els.stop.classList.toggle('hidden', !v);
    for (const el of [els.backend, els.model, els.effort, els.modeEdit, els.modeAsk, els.targetClear, els.capture, els.newBtn, els.histBtn]) el.disabled = v;
    els.panel.setAttribute('aria-busy', String(v));
    els.panel.classList.toggle('streaming', v);
    els.targetList.querySelectorAll('button').forEach((b) => { b.disabled = v; });
    if (returnReadingFocus) els.messages.focus({ preventScroll: true });
  }

  // ---------- 会话管理 ----------
  // 🆕 开新会话：旧会话自动归档到 🕘，然后"重新读取 LaTeX 上下文"——
  // 目标还在文档里就重新校准位置/行号/全文大小，不在了就清掉让用户重选。
  async function newSession() {
    if (state.preparing || state.applying || state.capturing) return;
    // 正在流式就先停掉，等 onDisconnect 里的收尾（补写最后一条消息）跑完再归档，避免竞态丢消息
    if (state.streaming) { stopStream(); await new Promise((r) => setTimeout(r, 250)); }
    if (state.messages.length) {
      const list = await getArchive();
      list.unshift(sessionEntry(state.messages));
      setArchive(list);
    }
    state.messages = [];
    state.longNoteShown = false;
    state.cliSession = { claude: null, codex: null }; // 清掉 CLI 会话：下一轮重新读全文、重建缓存
    state.sentAtts = { claude: [], codex: [] };
    els.messages.innerHTML = '';
    clearHistory();
    renderWelcome();

    // 重新读取 LaTeX 上下文
    if (state.target) {
      const t = state.target;
      const ctx = await targetContext(t);
      if (ctx.ok) {
        state.target = t;
        renderTargetBar();
        addNote(`🆕 新会话已开启（旧会话在 🕘 里）。已重新读取 <b>${escapeHtml(ctx.fileName || '当前文件')}</b> 全文 ~${Math.round(ctx.docChars / 1000)}k 字符，已校准 ${t.ranges.length} 个选段。`);
      } else {
        clearTarget();
        addNote('🆕 新会话已开启（旧会话在 🕘 里）。原目标片段在文档里找不到了（内容已变化），请重新选中一段。');
      }
    } else {
      const st = await bridge('status', {}, 2500);
      if (st.ok && st.ready) {
        addNote(`🆕 新会话已开启（旧会话在 🕘 里）。当前文件 <b>${escapeHtml(st.fileName || '')}</b> ~${Math.round((st.docLen || 0) / 1000)}k 字符，下次提问会重新读取全文。`);
      } else {
        addNote('🆕 新会话已开启（旧会话在 🕘 里）。');
      }
    }
  }

  // ---------- 🕘 会话历史浮层 ----------
  function mkBtn(label, onClick) {
    const b = document.createElement('button');
    b.className = 'ole-hbtn';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }
  async function openHistView() {
    const list = await getArchive();
    const wrap = els.histList;
    wrap.innerHTML = '';

    const cur = document.createElement('div');
    cur.className = 'ole-hist-item ole-hist-cur';
    const curMeta = document.createElement('div');
    curMeta.className = 'ole-hist-meta';
    curMeta.textContent = `当前会话 · ${state.messages.length} 条消息`;
    cur.appendChild(curMeta);
    const curBtns = document.createElement('div');
    curBtns.className = 'ole-hist-btns';
    const curCopy = mkBtn('📋 复制整段', () => copyText(sessionMarkdown(state.messages), curCopy));
    curBtns.appendChild(curCopy);
    cur.appendChild(curBtns);
    wrap.appendChild(cur);

    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'ole-hist-empty';
      empty.textContent = '还没有归档的会话。点 🆕 开新会话时，旧会话会自动归档到这里（每个项目最多留 10 段）。';
      wrap.appendChild(empty);
    }

    list.forEach((s, i) => {
      const item = document.createElement('div');
      item.className = 'ole-hist-item';
      const meta = document.createElement('div');
      meta.className = 'ole-hist-meta';
      meta.textContent = `${fmtTime(s.ts)} · ${s.messages.length} 条消息`;
      const prev = document.createElement('div');
      prev.className = 'ole-hist-prev';
      prev.textContent = s.preview || '（无预览）';
      const btns = document.createElement('div');
      btns.className = 'ole-hist-btns';
      const openB = mkBtn('打开', () => openSession(i));
      const copyB = mkBtn('📋 复制整段', () => copyText(sessionMarkdown(s.messages), copyB));
      const delB = mkBtn('🗑', async () => {
        const l = await getArchive();
        l.splice(i, 1);
        setArchive(l);
        openHistView(); // 重新渲染列表
      });
      btns.append(openB, copyB, delB);
      item.append(meta, prev, btns);
      wrap.appendChild(item);
    });

    els.histView.classList.remove('hidden');
  }
  // 切回某段历史会话：当前会话先归档防丢；目标沿用当前的（历史里的位置早过期了）
  async function openSession(i) {
    if (state.streaming) { stopStream(); await new Promise((r) => setTimeout(r, 250)); }
    const list = await getArchive();
    const s = list[i];
    if (!s) return;
    list.splice(i, 1);
    if (state.messages.length) list.unshift(sessionEntry(state.messages));
    setArchive(list);
    state.messages = s.messages;
    state.longNoteShown = false;
    state.cliSession = { claude: null, codex: null, ...(s.cliSession || {}) };
    state.sentAtts = { claude: [], codex: [], ...(s.sentAtts || {}) };
    els.messages.innerHTML = '';
    renderHistoryMsgs();
    renderTargetBar();
    saveHistory();
    els.histView.classList.add('hidden');
    addNote('🕘 已切回历史会话（它的缓存会话一并恢复：能续写就续写，失效则自动重读全文）。改写前请确认目标条里的目标还是你想改的那段。');
  }
  // 把已存的会话消息渲染出来（历史里的围栏就按代码块显示，不再挂应用卡片——位置早失效了）
  function renderHistoryMsgs() {
    for (const m of state.messages) {
      const b = addMessageEl(m.role === 'assistant' ? 'assistant' : 'user');
      if (m.role === 'assistant') b.innerHTML = renderMarkdown(m.content) + footHtml(m.via);
      else b.innerHTML = `<div>${escapeHtml(m.content).replace(/\n/g, '<br>')}</div>`;
    }
  }

  // ---------- 选中检测 & 浮标 ----------
  let selTimer = 0;
  let selectionSeq = 0;
  let selectionPending = false;
  function editorFocused() {
    return !!document.activeElement?.closest?.('.cm-editor');
  }
  function scheduleSelectionCheck() {
    clearTimeout(selTimer);
    // 使旧选区的慢响应失效，避免光标移动之后浮标重新出现。
    selectionSeq++;
    selTimer = setTimeout(updateFloatBtn, 100);
  }
  async function updateFloatBtn() {
    if (document.hidden || !editorFocused() || state.capturing) { hideFloatBtn(); return; }
    const seq = ++selectionSeq;
    selectionPending = true;
    const s = await bridge('get_selection', {}, 1500);
    selectionPending = false;
    if (seq !== selectionSeq || !editorFocused() || state.capturing) return;
    if (!s.ok || !s.len || !s.preview?.trim() || !s.rect) { hideFloatBtn(); return; }
    const rect = s.rect;
    const btn = els.floatBtn;
    btn.classList.remove('hidden');
    const maxRight = panelOpen ? els.panel.getBoundingClientRect().left : window.innerWidth;
    const availableRight = maxRight > 140 ? maxRight : window.innerWidth;
    const top = rect.bottom + 8 + btn.offsetHeight <= window.innerHeight
      ? rect.bottom + 8 : rect.top - btn.offsetHeight - 8;
    btn.style.top = Math.max(8, Math.min(window.innerHeight - btn.offsetHeight - 8, top)) + 'px';
    btn.style.left = Math.max(8, Math.min(availableRight - btn.offsetWidth - 8, rect.right - 40)) + 'px';
  }
  function hideFloatBtn() {
    selectionSeq++;
    els.floatBtn.classList.add('hidden');
  }

  async function captureTarget({ allowEmpty = false } = {}) {
    if (state.streaming || state.preparing || state.applying || state.capturing) return;
    state.capturing = true;
    els.capture.disabled = true;
    els.capture.textContent = '读取选区…';
    els.send.disabled = true;
    hideFloatBtn();
    try {
      const s = await bridge('get_target', {}, 4000);
      if (!s.ok || !s.len) {
        setReading(false);
        els.selectionHint.textContent = !s.ok ? (s.error || '读取选区失败，请重试。')
          : allowEmpty ? '在源码编辑器中选中段落后，点击「添加选段」。'
          : '没有读取到选区。请在左侧 Code Editor 中选择一段或多段源码，再点此按钮；PDF 预览中的选区不能改写。';
        els.selectionHint.classList.toggle('error', !s.ok || !allowEmpty);
        openPanel();
        return;
      }
      const incoming = (s.ranges?.length ? s.ranges : [s]).map((r) => ({
        ...r, id: 's' + ++targetSeq,
      }));
      let merged = { ok: true, ranges: incoming, fileName: s.fileName, docChars: s.docLen || 0 };
      if (state.target) {
        if (state.target.fileName !== (s.fileName || '')) {
          els.selectionHint.textContent = '请在同一文件中添加选段；要切换文件，请先在设置里清空已有选段。';
          els.selectionHint.classList.add('error'); openPanel(); return;
        }
        merged = await bridge('merge_targets', { existing: state.target.ranges, incoming, fileName: state.target.fileName }, 4000);
        if (!merged.ok) {
          els.selectionHint.textContent = merged.error || '添加选段失败';
          els.selectionHint.classList.add('error'); openPanel(); return;
        }
      }
      state.target = makeTarget(merged.ranges, merged.fileName || '', merged.docChars);
      renderTargetBar();
      els.selectionHint.textContent = `已添加 ${state.target.ranges.length} 段。可继续选择其他位置并点击「添加选段」。`;
      await bridge('collapse', { pos: incoming.at(-1).to }, 1500);
      setReading(false);
      if (!panelOpen) openPanel();
      els.input.focus();
    } finally {
      state.capturing = false;
      els.capture.disabled = false;
      els.capture.textContent = '＋ 添加选段';
      els.send.disabled = false;
      els.targetList.querySelectorAll('button').forEach((b) => { b.disabled = targetBusy(); });
    }
  }

  async function openWithSelection() {
    // 先读取再聚焦输入框，防止开启面板时丢失编辑器选区。
    if (state.streaming || state.preparing || state.applying) { openPanel(); return; }
    await captureTarget({ allowEmpty: true });
  }

  // ---------- 事件绑定 ----------
  function fillModelOptions() {
    const list = [...(MODELS[state.cfg.backend] || MODELS.claude)];
    const want = state.cfg.backend === 'codex' ? state.cfg.model_codex : state.cfg.model_claude;
    if (want && !list.some(([v]) => v === want)) list.push([want, want + '（已保存）']);
    els.model.replaceChildren(...list.map(([v, label]) => new Option(label, v)));
    els.model.value = list.some(([v]) => v === want) ? want : list[0][0];
    // 列表刷新后原选择可能已不存在，把实际生效的值写回配置，防止发请求时用到失效模型名
    if (state.cfg.backend === 'codex') state.cfg.model_codex = els.model.value;
    else state.cfg.model_claude = els.model.value;
  }
  // 🔄 实测获取最新模型列表（后台转发给本机桥探测，见 server/models.js）
  async function refreshModelList() {
    const backend = state.cfg.backend;
    const btn = els.modelsRefresh;
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = '⏳';
    try {
      const r = await chrome.runtime.sendMessage({ type: 'models', backend });
      if (!r) throw new Error('后台无响应');
      const got = [];
      if (Array.isArray(r.claude) && r.claude.length) { MODELS.claude = r.claude; got.push('claude ' + r.claude.length + ' 个'); }
      if (Array.isArray(r.codex) && r.codex.length) { MODELS.codex = r.codex; got.push('codex ' + r.codex.length + ' 个'); }
      if (!got.length) throw new Error(r.error || '两个后端都没探测到模型（CLI 没装好或网络不通？）');
      try { chrome.storage.local.set({ modelList: { claude: MODELS.claude, codex: MODELS.codex, fetchedAt: r.fetchedAt } }); } catch {}
      fillModelOptions();
      saveCfg();
      const cur = MODELS[state.cfg.backend].find(([v]) => v === els.model.value);
      addNote(`🔄 模型列表已更新（${got.join('、')}，实测当前可用）。当前选用：${escapeHtml(cur ? cur[1] : els.model.value)}`);
    } catch (e) {
      addNote('⚠️ 获取模型列表失败：' + escapeHtml(String(e?.message || e)));
    }
    btn.disabled = false;
    btn.textContent = '↻';
  }
  function setMode(mode) {
    state.cfg.mode = mode;
    els.modeEdit.classList.toggle('active', mode === 'edit');
    els.modeAsk.classList.toggle('active', mode === 'ask');
    els.presets.classList.toggle('hidden', mode !== 'edit');
    els.modeSummary.textContent = mode === 'edit' ? '改写 ▾' : '问答 ▾';
    els.input.placeholder = mode === 'edit'
      ? '输入改写要求…'
      : '针对选区或全文提问…';
    renderTargetBar();
    saveCfg();
  }
  function bindEvents() {
    els.settingsBtn.addEventListener('click', () => showSettings(els.settings.classList.contains('hidden')));
    els.modeSummary.addEventListener('click', () => { showSettings(true); (state.cfg.mode === 'ask' ? els.modeAsk : els.modeEdit).focus(); });
    els.contextSummary.addEventListener('click', () => showSettings(true));
    els.readingBtn.addEventListener('click', () => setReading(!reading));
    els.readingStop.addEventListener('click', stopStream);
    ui.addEventListener('pointerdown', (e) => {
      if (!els.settings.contains(e.target) && ![els.settingsBtn, els.modeSummary, els.contextSummary].includes(e.target)) showSettings(false);
    });
    els.launcher.addEventListener('mousedown', (e) => e.preventDefault());
    els.launcher.addEventListener('click', openWithSelection);
    els.capture.addEventListener('mousedown', (e) => e.preventDefault());
    els.capture.addEventListener('click', () => captureTarget());
    els.close.addEventListener('click', closePanel);
    els.layoutBtn.addEventListener('click', () => {
      state.cfg.layout = state.cfg.layout === 'overlay' ? 'push' : 'overlay';
      updateLayoutBtn();
      applyWidth();
      saveCfg();
    });
    els.newBtn.addEventListener('click', newSession);
    els.histBtn.addEventListener('click', openHistView);
    els.histClose.addEventListener('click', () => els.histView.classList.add('hidden'));
    els.attProj.addEventListener('click', openProjView);
    els.projClose.addEventListener('click', () => els.projView.classList.add('hidden'));
    els.projRefresh.addEventListener('click', async () => {
      els.projList.innerHTML = '<div class="ole-hist-empty">📦 重新打包下载中…</div>';
      try { await ensureZip(true); await renderProjList(); }
      catch (e) { els.projList.innerHTML = `<div class="ole-hist-empty">⚠️ ${escapeHtml(e.message || '拉取失败')}</div>`; }
    });
    els.attLocal.addEventListener('click', () => els.fileInput.click());
    els.fileInput.addEventListener('change', async () => {
      const files = [...(els.fileInput.files || [])];
      els.fileInput.value = '';
      if (files.length) await addLocalFiles(files);
    });
    els.send.addEventListener('click', send);
    els.stop.addEventListener('click', stopStream);
    els.targetClear.addEventListener('click', () => { clearTarget(); showSettings(false); });
    els.targetReveal.addEventListener('click', () => { if (state.target) revealRange(state.target.ranges[0]); });

    els.backend.value = state.cfg.backend;
    els.backend.addEventListener('change', () => {
      state.cfg.backend = els.backend.value;
      fillModelOptions();
      renderTargetBar(); // ♻️ 缓存标识按后端分别显示
      refreshStatus();
      saveCfg();
    });
    els.effort.innerHTML = EFFORTS.map((e) => `<option value="${e}">${EFFORT_LABELS[e]}</option>`).join('');
    els.effort.value = state.cfg.effort;
    els.effort.addEventListener('change', () => { state.cfg.effort = els.effort.value; saveCfg(); });
    els.modelsRefresh.addEventListener('click', refreshModelList);
    els.model.addEventListener('change', () => {
      if (state.cfg.backend === 'codex') state.cfg.model_codex = els.model.value;
      else state.cfg.model_claude = els.model.value;
      saveCfg();
    });
    els.modeEdit.addEventListener('click', () => { setMode('edit'); showSettings(false); });
    els.modeAsk.addEventListener('click', () => { setMode('ask'); showSettings(false); });

    // 快捷指令
    els.presets.innerHTML = PRESETS.map(([label], i) => `<button class="ole-chip" data-i="${i}">${label}</button>`).join('');
    els.presets.querySelectorAll('.ole-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        els.input.value = PRESETS[Number(chip.dataset.i)][1];
        autoGrow();
        els.input.focus();
      });
    });

    els.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); send(); }
    });
    els.input.addEventListener('input', autoGrow);
    els.messages.addEventListener('scroll', () => {
      state.followOutput = els.messages.scrollHeight - els.messages.scrollTop - els.messages.clientHeight < 60;
    });
    ui.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || e.isComposing) return;
      if (!els.projView.classList.contains('hidden')) els.projView.classList.add('hidden');
      else if (!els.histView.classList.contains('hidden')) els.histView.classList.add('hidden');
      else if (!els.settings.classList.contains('hidden')) { showSettings(false); els.settingsBtn.focus(); }
      else if (reading) setReading(false);
      else closePanel();
    });
    ui.querySelectorAll('button[title], select[title]').forEach((el) => el.setAttribute('aria-label', el.title));

    els.floatBtn.addEventListener('mousedown', (e) => e.preventDefault()); // 别让点击清掉选区
    els.floatBtn.addEventListener('click', () => captureTarget());

    document.addEventListener('selectionchange', scheduleSelectionCheck);
    document.addEventListener('pointerup', (e) => {
      if (e.target.closest?.('.cm-editor')) scheduleSelectionCheck();
    }, true);
    document.addEventListener('keyup', (e) => {
      if (e.target.closest?.('.cm-editor')) scheduleSelectionCheck();
    }, true);
    document.addEventListener('pointerdown', (e) => {
      if (e.target !== host && !e.target.closest?.('.cm-editor')) hideFloatBtn();
    }, true);
    document.addEventListener('focusin', () => { if (!editorFocused()) hideFloatBtn(); }, true);
    document.addEventListener('scroll', scheduleSelectionCheck, true);
    document.addEventListener('visibilitychange', () => { if (document.hidden) hideFloatBtn(); });
    // 补上程序化选区变化、编辑器重新挂载以及没有原生 selectionchange 的情况。
    setInterval(() => {
      if (!document.hidden && editorFocused() && !selectionPending && !state.capturing) updateFloatBtn();
    }, 650);

    window.addEventListener('resize', () => { if (panelOpen) applyWidth(); scheduleSelectionCheck(); });

    // 侧栏拖拽改宽度
    let dragging = false;
    els.resizer.addEventListener('mousedown', (e) => { dragging = true; e.preventDefault(); document.body.style.userSelect = 'none'; });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      state.cfg.width = window.innerWidth - e.clientX;
      applyWidth();
    });
    window.addEventListener('mouseup', () => { if (dragging) { dragging = false; document.body.style.userSelect = ''; saveCfg(); } });

  }

  // Popup / 快捷键都能打开；等待初始化完成后再响应，支持刚注入脚本的页面。
  try {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!['open_panel', 'toggle_panel'].includes(msg?.type)) return false;
      uiReady.then(async () => {
        if (msg.type === 'toggle_panel' && panelOpen) closePanel();
        else await openWithSelection();
        sendResponse({ ok: true });
      }).catch((e) => sendResponse({ ok: false, error: String(e.message || e) }));
      return true;
    });
  } catch {}

  function autoGrow() {
    els.input.style.height = 'auto';
    els.input.style.height = Math.min(110, els.input.scrollHeight) + 'px';
  }

  // ---------- 启动 ----------
  const uiReady = (async function init() {
    await loadCfg();
    await loadHistory();
    fillModelOptions();
    bindEvents();
    setMode(state.cfg.mode === 'ask' ? 'ask' : 'edit');
    updateLayoutBtn();
    applyWidth();
    renderTargetBar();
    if (state.messages.length) {
      renderHistoryMsgs();
      addNote('↩️ 已恢复上次会话（刷新过页面，目标需重新选中）。想从头来就点 🆕。');
    } else {
      renderWelcome();
    }
    // 编辑器加载是异步的：前 60 秒轻量重试探测，好让状态点尽快变绿
    let tries = 0;
    const timer = setInterval(async () => {
      tries++;
      const st = await bridge('status', {}, 1500);
      if (st.ok && st.ready) { state.editorOk = true; if (panelOpen) refreshStatus(); clearInterval(timer); }
      else if (tries > 30) clearInterval(timer);
    }, 2000);
  })();

  // ---------- 模板 ----------
  function PANEL_HTML() {
    return `
      <button id="ole-launcher" title="打开写作助手（⌘⇧E / Ctrl⇧E）"><span aria-hidden="true">✦</span> 写作助手</button>
      <div id="ole-panel" role="complementary" aria-label="论文写作助手">
        <div id="ole-resizer"></div>
        <header id="ole-header">
          <div class="ole-head-top">
            <div class="ole-brand"><span id="ole-status-dot" class="ole-dot" role="img" aria-label="检查连接中"></span><span>LLM_in_Overleaf</span></div>
            <div class="ole-head-btns">
              <button id="ole-settings-toggle" aria-expanded="false" aria-controls="ole-settings" title="模型、模式与选区设置">设置</button>
              <button id="ole-reading" aria-pressed="false" title="最大化阅读：展开输出区域">阅读</button>
              <button id="ole-reading-stop" title="停止生成">停止</button>
              <button id="ole-new" title="开新会话（旧会话自动归档，并重新读取全文上下文）">＋</button>
              <button id="ole-hist" title="会话历史">◷</button>
              <button id="ole-close" title="收起（⌘⇧E）">✕</button>
            </div>
          </div>
        </header>
        <div id="ole-settings" class="hidden" role="region" aria-label="写作设置">
          <div class="ole-settings-heading"><b>写作设置</b><button id="ole-layout" title="切换面板布局：推挤页面 / 悬浮覆盖">📌</button></div>
          <div class="ole-statusline" role="status"><span id="ole-status-text">检查中…</span></div>
          <div class="ole-controls">
            <select id="ole-backend" title="后端">
              <option value="claude">Claude</option>
              <option value="codex">Codex</option>
            </select>
            <select id="ole-model" title="模型"></select>
            <select id="ole-effort" title="思考强度 effort"></select>
            <button id="ole-models-refresh" class="ole-mrefresh" title="获取当前后端的最新模型列表">↻</button>
          </div>
          <div class="ole-modes">
            <button id="ole-mode-edit" class="ole-mode active">改写段落</button>
            <button id="ole-mode-ask" class="ole-mode">论文问答</button>
          </div>
          <div id="ole-target" class="empty">
            <div class="ole-target-main">
              <div id="ole-target-info"></div>
              <div id="ole-target-prev"></div>
              <div id="ole-target-list"></div>
            </div>
            <div class="ole-target-btns">
              <button id="ole-target-reveal" title="在编辑器里定位">🎯</button>
              <button id="ole-target-clear" title="清空所有选段">✕</button>
            </div>
          </div>
        </div>
        <div id="ole-banner" class="hidden"></div>
        <div id="ole-selection-actions">
          <button id="ole-mode-summary" title="切换改写或问答模式">改写 ▾</button>
          <button id="ole-context-summary" title="查看上下文与选区设置">未选择段落</button>
          <button id="ole-capture" type="button">＋ 添加选段</button>
        </div>
        <div id="ole-selection-hint" role="status">支持拖选、双击或 Shift + 方向键选择源码。</div>
        <div id="ole-messages" tabindex="0" role="region" aria-label="对话与输出"></div>
        <div id="ole-attachbar">
          <button id="ole-att-proj" title="把项目里的其他文件（章节/main.tex/.bib/图表）加进上下文">📁 项目文件</button>
          <button id="ole-att-local" title="附加本地 PDF / 图片 / 文本文件">📎 本地文件</button>
          <div id="ole-att-chips"></div>
        </div>
        <input type="file" id="ole-file-input" multiple class="hidden"
          accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.tex,.bib,.txt,.md,.cls,.sty,.bst,.csv">
        <div id="ole-presets"></div>
        <div id="ole-inputbar">
          <textarea aria-label="输入改写要求或问题" id="ole-input" rows="1" placeholder="下达改写指令…（Enter 发送，Shift+Enter 换行）"></textarea>
          <button id="ole-send" title="发送">发送</button>
          <button id="ole-stop" class="hidden" title="停止">停止</button>
        </div>
        <div class="ole-input-hint">Enter 发送 <span>Shift + Enter 换行 · Esc 收起</span></div>
        <div id="ole-hist-view" class="hidden">
          <div class="ole-hist-head">
            <b>🕘 本项目的会话历史</b>
            <button id="ole-hist-close" title="返回">✕</button>
          </div>
          <div id="ole-hist-list"></div>
        </div>
        <div id="ole-proj-view" class="hidden">
          <div class="ole-hist-head">
            <b>📁 项目文件（加进上下文）</b>
            <span>
              <button id="ole-proj-refresh" title="重新下载项目源码">↻</button>
              <button id="ole-proj-close" title="返回">✕</button>
            </span>
          </div>
          <div id="ole-proj-list"></div>
        </div>
      </div>
      <button id="ole-float-btn" class="hidden">✦ 改这段</button>
    `;
  }

  function CSS_TEXT() {
    return `
      :host { all: initial; color-scheme: light; }
      button, select, textarea { font: inherit; }
      button:focus-visible, select:focus-visible, textarea:focus-visible { outline: 3px solid #86b3a6; outline-offset: 3px; }
      button:disabled { opacity: .5; cursor: not-allowed !important; }
      .ole-brand { display: flex; align-items: center; gap: 10px; letter-spacing: -.3px; }
      .ole-brand-mark { display: grid; place-items: center; width: 34px; height: 34px; background: #217566; color: white; border-radius: 10px; font-size: 23px; }
      .ole-brand-light { font-weight: 400; color: #76817b; }
      .ole-brand small { display: block; margin-top: 3px; font-weight: 400; font-size: 10px; color: #76817b; letter-spacing: 2px; }
      .ole-welcome { padding: 24px 4px; color: #25352f; }
      .ole-welcome-mark { font-size: 32px; color: #217566; margin-bottom: 16px; }
      .ole-eyebrow { font-size: 9px; letter-spacing: 2px; color: #76817b; }
      .ole-welcome h2 { font-size: 23px; font-weight: 600; margin: 12px 0; letter-spacing: -.8px; }
      .ole-welcome p { font-size: 13px; line-height: 1.8; color: #76817b; margin-bottom: 24px; }
      .ole-steps { display: grid; gap: 20px; }
      .ole-steps > div { display: flex; align-items: baseline; gap: 15px; font-size: 13px; }
      .ole-steps b { font-family: ui-monospace, monospace; font-size: 11px; color: #217566; }
      .ole-steps small { display: block; font-size: 11px; color: #76817b; line-height: 1.8; margin-top: 3px; }
      .ole-welcome-tip { border-top: 1px solid #e4e9e3; margin-top: 25px; padding-top: 16px; font-size: 11px; color: #76817b; }
      .ole-input-hint { padding: 0 20px 14px; display: flex; justify-content: space-between; gap: 8px; color: #76817b; font-size: 10px; }
      .ole-input-hint span { text-align: right; }
      * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
      .hidden { display: none !important; }
      .ole-muted { color: #76817b; }
      .ole-warn { color: #b45309; }
      .ole-applied { color: #217566; }

      #ole-launcher {
        position: fixed; right: 18px; bottom: 22px; z-index: 2147483647;
        min-height: 42px; padding: 10px 16px; border-radius: 12px; border: 1px solid #ffffff50; cursor: pointer;
        background: #217566; color: #fff; font-size: 13px; font-weight: 600; box-shadow: 0 4px 18px #203c2e30;
      }
      #ole-launcher:hover { background: #18594e; }
      #ole-launcher span { margin-right: 6px; }
      #ole-selection-actions { padding: 10px 20px 0; flex-shrink: 0; }
      #ole-capture { border: 1px solid #c5dbd1; background: #edf5f1; color: #18594e; border-radius: 8px; padding: 7px 11px; cursor: pointer; font-size: 12px; }
      #ole-capture:hover { background: #e0eee7; }
      #ole-selection-hint { margin-top: 7px; font-size: 11px; line-height: 1.6; color: #68776d; }


      #ole-panel {
        position: fixed; top: 0; right: 0; height: 100vh; width: 480px;
        background: #fff; color: #25352f; z-index: 2147483647;
        display: none; flex-direction: column; box-shadow: -2px 0 24px rgba(0,0,0,.16);
        border-left: 1px solid #e6e8ef;
      }
      #ole-panel.open { display: flex; }
      #ole-resizer { position: absolute; left: -3px; top: 0; width: 6px; height: 100%; cursor: ew-resize; }

      #ole-header { padding: 12px 14px 10px; border-bottom: 1px solid #eef0f5; background: #fbfcfa; }
      .ole-head-top { display: flex; justify-content: space-between; align-items: center; }
      .ole-brand { font-weight: 700; font-size: 14px; color: #217566; }
      .ole-head-btns button {
        border: none; background: transparent; cursor: pointer; font-size: 15px; color: #6b7280;
        padding: 4px 6px; border-radius: 6px;
      }
      .ole-head-btns button:hover { background: #e8f0e6; color: #25352f; }
      .ole-statusline { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: #76817b; margin: 6px 0; }
      .ole-dot { width: 8px; height: 8px; border-radius: 50%; background: #cbd0dd; display: inline-block; }
      .ole-dot.ok { background: #22c55e; }
      .ole-dot.bad { background: #ef4444; }
      #ole-banner {
        font-size: 12px; color: #7a5b12; background: #fff7e6; border: 1px solid #ffe0a3;
        border-radius: 8px; padding: 7px 10px; margin-bottom: 8px; line-height: 1.7;
      }
      #ole-banner code { background: #f3ead1; padding: 1px 5px; border-radius: 4px; font-family: ui-monospace, Menlo, monospace; font-size: 11px; }
      .ole-controls { display: flex; gap: 6px; margin-bottom: 8px; }
      .ole-controls select {
        flex: 1; min-width: 0; font-size: 12px; padding: 5px 6px; border: 1px solid #dfe2ec; border-radius: 7px;
        background: #fff; color: #25352f; cursor: pointer;
      }
      .ole-mrefresh {
        flex: 0 0 auto; border: 1px solid #dfe2ec; background: #fff; border-radius: 7px;
        font-size: 12px; padding: 5px 7px; cursor: pointer; color: #6b7280;
      }
      .ole-mrefresh:hover { background: #edf5f1; }
      .ole-mrefresh:disabled { opacity: .6; cursor: default; }
      .ole-modes { display: flex; gap: 6px; }
      .ole-mode {
        flex: 1; border: 1px solid #dfe2ec; background: #fff; border-radius: 8px; padding: 5px 0;
        font-size: 12.5px; cursor: pointer; color: #6b7280;
      }
      .ole-mode.active { border-color: #217566; color: #217566; background: #edf5f1; font-weight: 600; }

      #ole-target {
        display: flex; gap: 8px; align-items: flex-start; margin: 10px 14px 0; padding: 8px 10px;
        background: #f1f6f2; border: 1px solid #d7e5dc; border-radius: 10px; font-size: 12px;
      }
      #ole-target.empty { background: #f7f8fb; border-color: #e6e8ef; }
      .ole-target-main { flex: 1; min-width: 0; }
      #ole-target-info { color: #365e51; line-height: 1.5; }
      #ole-target.empty #ole-target-info { color: #76817b; }
      #ole-target-prev {
        margin-top: 3px; color: #55607a; font-family: ui-monospace, Menlo, monospace; font-size: 11px;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      #ole-target-list { display: grid; gap: 6px; margin-top: 8px; }
      .ole-selected-range { display: flex; align-items: center; gap: 4px; font-size: 11px; }
      .ole-selected-range > span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .ole-selected-range .ole-hbtn { padding: 3px 5px; font-size: 11px; }
      .ole-edit-heading { display: block; font: 600 11px/1.5 -apple-system, sans-serif; color: #365e51; margin: 4px 0 8px; }
      .ole-edit-part + .ole-edit-part { border-top: 1px dashed #d7e5dc; margin-top: 14px; padding-top: 10px; }
      .ole-target-btns { display: flex; gap: 2px; }
      .ole-target-btns button { border: none; background: transparent; cursor: pointer; font-size: 13px; color: #6b7280; padding: 2px 4px; border-radius: 5px; }
      .ole-target-btns button:hover { background: #e2ecdf; }

      #ole-messages { flex: 1; overflow-y: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 12px; }
      .ole-msg { display: flex; }
      .ole-user { justify-content: flex-end; }
      .ole-bubble {
        max-width: 92%; padding: 9px 12px; border-radius: 12px; font-size: 13px; line-height: 1.6;
        word-break: break-word; overflow-wrap: anywhere;
      }
      .ole-user .ole-bubble { background: #217566; color: #fff; border-bottom-right-radius: 4px; }
      .ole-assistant .ole-bubble { background: #f6f7f4; color: #25352f; border-bottom-left-radius: 4px; max-width: 96%; width: fit-content; min-width: 60%; }
      .ole-bubble p { margin: 6px 0; }
      .ole-bubble p:first-child { margin-top: 0; }
      .ole-bubble p:last-child { margin-bottom: 0; }
      .ole-bubble ul, .ole-bubble ol { margin: 6px 0; padding-left: 20px; }
      .ole-bubble blockquote { margin: 6px 0; padding: 2px 10px; border-left: 3px solid #c9cde0; color: #555b6e; }
      .ole-code { background: #e9ebf3; padding: 1px 5px; border-radius: 4px; font-family: ui-monospace, Menlo, monospace; font-size: 12px; }
      .ole-pre { background: #25352f; color: #e6e8ef; padding: 10px 12px; border-radius: 8px; overflow-x: auto; margin: 8px 0; }
      .ole-pre code { font-family: ui-monospace, Menlo, monospace; font-size: 12px; white-space: pre; }
      .ole-note {
        font-size: 12px; color: #55607a; background: #f7f8fb; border: 1px dashed #dfe2ec;
        border-radius: 10px; padding: 8px 12px; line-height: 1.8;
      }
      .ole-think { margin-bottom: 8px; font-size: 12px; color: #7a8098; }
      .ole-think summary { cursor: pointer; }
      .ole-think > div { white-space: pre-wrap; margin-top: 4px; padding: 6px 8px; background: #eef0f5; border-radius: 6px; max-height: 200px; overflow-y: auto; }
      .ole-foot { margin-top: 8px; font-size: 11px; color: #748078; }
      .ole-warnbox {
        margin-top: 8px; font-size: 12px; color: #7a5b12; background: #fff7e6;
        border: 1px solid #ffe0a3; border-radius: 8px; padding: 6px 9px;
      }

      .ole-card { margin-top: 8px; border: 1px solid #d7e5dc; border-radius: 10px; overflow: hidden; background: #fff; }
      .ole-card-head {
        display: flex; justify-content: space-between; align-items: center;
        padding: 6px 10px; background: #edf5f1; border-bottom: 1px solid #d7e5dc;
      }
      .ole-card-title { font-size: 12px; font-weight: 600; color: #365e51; }
      .ole-tabs { display: flex; gap: 4px; }
      .ole-tab {
        border: 1px solid #cfe0cb; background: #fff; border-radius: 6px; padding: 2px 8px;
        font-size: 11.5px; cursor: pointer; color: #6b7280;
      }
      .ole-tab.active { background: #217566; border-color: #217566; color: #fff; }
      .ole-card-body {
        margin: 0; padding: 10px 12px; font-family: ui-monospace, Menlo, monospace; font-size: 12px;
        line-height: 1.6; white-space: pre-wrap; word-break: break-word; overflow-wrap: anywhere;
        max-height: 320px; overflow-y: auto; background: #fbfdfb;
      }
      .ole-diffview del { background: #ffebe9; color: #b42318; text-decoration: line-through; border-radius: 2px; }
      .ole-diffview ins { background: #dcfce4; color: #166534; text-decoration: none; border-radius: 2px; }
      .ole-card-actions { display: flex; gap: 6px; align-items: center; padding: 8px 10px; border-top: 1px solid #eef0f5; flex-wrap: wrap; }
      .ole-btn {
        border: 1px solid #dfe2ec; background: #fff; border-radius: 7px; padding: 4px 10px;
        font-size: 12px; cursor: pointer; color: #25352f;
      }
      .ole-btn:hover { border-color: #217566; color: #217566; }
      .ole-btn:disabled { opacity: .5; cursor: default; }
      .ole-apply { background: #217566; border-color: #217566; color: #fff; font-weight: 600; }
      .ole-apply:hover { background: #18594e; color: #fff; }
      .ole-apply:disabled { background: #9fc79a; border-color: #9fc79a; }
      .ole-card-status { font-size: 11.5px; color: #55607a; }

      #ole-attachbar { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; padding: 6px 14px 0; }
      #ole-attachbar > button {
        border: 1px dashed #cfd4e2; background: #fff; border-radius: 8px; padding: 3px 10px;
        font-size: 12px; cursor: pointer; color: #55607a;
      }
      #ole-attachbar > button:hover { border-color: #217566; color: #217566; }
      #ole-att-chips { display: flex; gap: 6px; flex-wrap: wrap; }
      .ole-att-chip {
        display: inline-flex; align-items: center; gap: 4px; max-width: 100%;
        background: #edf5f1; border: 1px solid #d7e5dc; border-radius: 999px; padding: 2px 8px;
        font-size: 11.5px; color: #365e51; font-family: ui-monospace, Menlo, monospace;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .ole-att-chip button { border: none; background: transparent; cursor: pointer; color: #6b7280; font-size: 11px; padding: 0 2px; }
      .ole-att-chip button:hover { color: #b42318; }
      .ole-att-line { margin-top: 6px; font-size: 11.5px; opacity: .85; font-family: ui-monospace, Menlo, monospace; }

      #ole-proj-view {
        position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: #fff; z-index: 7;
        display: flex; flex-direction: column;
      }
      #ole-proj-list { flex: 1; overflow-y: auto; padding: 10px 14px; display: flex; flex-direction: column; gap: 6px; }
      .ole-proj-row {
        display: flex; align-items: center; gap: 8px; padding: 6px 8px;
        border: 1px solid #eef0f5; border-radius: 8px; font-size: 12.5px;
      }
      .ole-proj-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: ui-monospace, Menlo, monospace; font-size: 12px; }
      .ole-proj-size { color: #76817b; font-size: 11.5px; white-space: nowrap; }
      .ole-proj-row .ole-hbtn:disabled { opacity: .55; cursor: default; }

      #ole-presets { display: flex; gap: 6px; flex-wrap: wrap; padding: 0 14px 6px; }
      .ole-chip {
        border: 1px solid #dfe2ec; background: #fff; border-radius: 999px; padding: 3px 10px;
        font-size: 12px; cursor: pointer; color: #55607a;
      }
      .ole-chip:hover { border-color: #217566; color: #217566; }

      #ole-hist-view {
        position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: #fff; z-index: 6;
        display: flex; flex-direction: column;
      }
      .ole-hist-head {
        display: flex; justify-content: space-between; align-items: center;
        padding: 12px 14px; border-bottom: 1px solid #eef0f5; background: #fbfcfa;
        font-size: 14px; color: #25352f;
      }
      .ole-hist-head button { border: none; background: transparent; cursor: pointer; font-size: 15px; color: #6b7280; }
      #ole-hist-list { flex: 1; overflow-y: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
      .ole-hist-item { border: 1px solid #e6e8ef; border-radius: 10px; padding: 10px 12px; }
      .ole-hist-cur { border-color: #bfe0ba; background: #f1f6f2; }
      .ole-hist-meta { font-size: 12px; color: #76817b; margin-bottom: 4px; }
      .ole-hist-prev { font-size: 12.5px; color: #25352f; margin-bottom: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .ole-hist-btns { display: flex; gap: 6px; }
      .ole-hbtn {
        border: 1px solid #dfe2ec; background: #fff; border-radius: 7px; padding: 4px 10px;
        font-size: 12px; cursor: pointer; color: #25352f;
      }
      .ole-hbtn:hover { border-color: #217566; color: #217566; }
      .ole-hist-empty { font-size: 12.5px; color: #76817b; line-height: 1.7; padding: 6px 2px; }

      .ole-typing span { animation: ole-blink 1.2s infinite; }
      .ole-typing span:nth-child(2) { animation-delay: .2s; }
      .ole-typing span:nth-child(3) { animation-delay: .4s; }
      @keyframes ole-blink { 0%,60%,100% { opacity: .2 } 30% { opacity: 1 } }

      #ole-inputbar { display: flex; gap: 8px; align-items: flex-end; padding: 8px 12px 14px; border-top: 1px solid #eef0f5; }
      #ole-input {
        flex: 1; resize: none; border: 1px solid #dfe2ec; border-radius: 10px; padding: 9px 11px;
        font-size: 13px; line-height: 1.5; max-height: 160px; outline: none; color: #25352f; background: #fff;
      }
      #ole-input:focus { border-color: #217566; }
      #ole-send, #ole-stop {
        border: none; border-radius: 9px; padding: 9px 14px; cursor: pointer; font-size: 13px; font-weight: 600;
        white-space: nowrap;
      }
      #ole-send { background: #217566; color: #fff; }
      #ole-send:hover { background: #18594e; }
      #ole-stop { background: #ef4444; color: #fff; }

      #ole-float-btn {
        position: fixed; z-index: 2147483647; border: none; cursor: pointer;
        background: #25352f; color: #fff; font-size: 12.5px; padding: 6px 12px; border-radius: 8px;
        box-shadow: 0 4px 14px rgba(0,0,0,.28);
      }
      #ole-float-btn:hover { background: #217566; }
      /* 默认优先显示回复：顶部两行，设置浮层按需打开。 */
      #ole-panel { height: 100dvh; background: #fdfefc; box-shadow: -8px 0 36px #203c2e12; }
      #ole-header { padding: 7px 12px; flex-shrink: 0; }
      .ole-head-top { gap: 8px; min-height: 32px; }
      .ole-brand { gap: 7px; white-space: nowrap; min-width: 0; font-size: 14px; }
      .ole-dot { flex-shrink: 0; }
      .ole-head-btns { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }
      .ole-head-btns button { min-width: 28px; min-height: 30px; }
      #ole-settings-toggle, #ole-reading, #ole-reading-stop { font-size: 11px; padding: 5px 7px; }
      #ole-reading { background: #edf5f1; color: #18594e; }
      #ole-settings-toggle[aria-expanded="true"] { background: #e8f0e6; color: #18594e; }
      #ole-reading-stop { display: none; color: #b42318; background: #fff2ec; }
      #ole-settings {
        position: absolute; z-index: 5; top: 84px; left: 10px; right: 10px; padding: 14px;
        border: 1px solid #d7e5dc; border-radius: 12px; background: #fff;
        box-shadow: 0 12px 36px #203c2e26; max-height: calc(100dvh - 96px); overflow-y: auto;
      }
      .ole-settings-heading { display: flex; justify-content: space-between; align-items: center; color: #365e51; font-size: 13px; }
      #ole-layout { padding: 4px 8px; border: 1px solid #d7e5dc; border-radius: 6px; background: #f1f6f2; cursor: pointer; }
      .ole-statusline { margin: 8px 0 12px; font-size: 11px; }
      .ole-controls { display: grid; grid-template-columns: 70px minmax(70px,1fr) 70px 28px; gap: 5px; margin: 0 0 12px; }
      .ole-controls select { width: 100%; padding: 7px 5px; font-size: 11px; }
      .ole-modes { background: #edf0eb; padding: 4px; border-radius: 10px; gap: 3px; }
      .ole-mode { border: 0; background: transparent; padding: 7px 0; }
      .ole-mode.active { background: white; color: #217566; box-shadow: 0 1px 4px #203c2e12; }
      #ole-target { margin: 12px 0 0; padding: 10px; border-radius: 8px; }
      #ole-target.empty .ole-target-btns { display: none; }
      #ole-target-prev { white-space: normal; overflow-wrap: anywhere; max-height: 80px; overflow-y: auto; }
      #ole-selection-actions { display: flex; align-items: center; gap: 6px; padding: 5px 12px; flex-shrink: 0; border-bottom: 1px solid #edf0eb; }
      #ole-mode-summary, #ole-context-summary { border: 0; background: transparent; font-size: 11px; cursor: pointer; padding: 5px 0; text-align: left; }
      #ole-mode-summary { color: #217566; white-space: nowrap; }
      #ole-context-summary { flex: 1; min-width: 0; color: #76817b; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
      #ole-mode-summary:hover, #ole-context-summary:hover { color: #18594e; }
      #ole-capture { padding: 5px 8px; font-size: 11px; white-space: nowrap; }
      #ole-selection-hint:not(.error) { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
      #ole-selection-hint.error { margin: 0; padding: 6px 12px; color: #8a5c16; background: #fff7e6; max-height: 72px; overflow-y: auto; flex-shrink: 0; }
      #ole-banner { margin: 6px 12px 0; max-height: 84px; overflow-y: auto; flex-shrink: 0; }
      #ole-messages { flex: 1 1 0; min-height: 0; padding: 14px 16px; gap: 18px; overscroll-behavior: contain; scrollbar-width: thin; outline-offset: -3px; }
      #ole-messages > * { flex-shrink: 0; }
      .ole-bubble { font-size: 13px; line-height: 1.85; padding: 10px 12px; }
      .ole-assistant .ole-bubble { background: transparent; max-width: 100%; width: 100%; padding: 0; }
      .ole-user .ole-bubble { background: #eaf2ed; color: #25352f; border-radius: 12px 12px 3px 12px; }
      .ole-note { background: #f4f6f1; border: 1px solid #e5e9df; font-size: 11px; }
      .ole-card { border-radius: 12px; box-shadow: 0 2px 6px #203c2e06; }
      .ole-card-head, .ole-card-actions { padding: 10px 12px; }
      .ole-card-body { padding: 14px; line-height: 1.85; }
      #ole-attachbar { padding: 5px 12px; border-top: 1px solid #e8ece5; flex-shrink: 0; max-height: 70px; overflow-y: auto; gap: 5px; }
      #ole-attachbar > button { border: 0; background: #f0f3ed; padding: 4px 7px; font-size: 11px; }
      #ole-presets { padding: 0 12px 5px; gap: 5px; flex-shrink: 0; flex-wrap: nowrap; overflow-x: auto; scrollbar-width: thin; }
      .ole-chip { padding: 4px 8px; font-size: 11px; border-color: #e0e6dc; white-space: nowrap; }
      #ole-inputbar { margin: 0 12px 4px; padding: 5px; border: 1px solid #dbe3d8; border-radius: 10px; background: white; flex-shrink: 0; align-items: flex-end; }
      #ole-inputbar:focus-within { border-color: #7da899; box-shadow: 0 0 0 3px #2175660a; }
      #ole-input { border: 0; min-width: 0; min-height: 32px; max-height: 110px; padding: 5px; background: transparent; outline: none; }
      #ole-send, #ole-stop { padding: 7px 10px; font-size: 12px; }
      .ole-input-hint { padding: 0 12px 6px; font-size: 10px; flex-shrink: 0; }
      #ole-panel.reading #ole-selection-actions,
      #ole-panel.reading #ole-selection-hint,
      #ole-panel.reading #ole-attachbar,
      #ole-panel.reading #ole-presets,
      #ole-panel.reading #ole-inputbar,
      #ole-panel.reading .ole-input-hint,
      #ole-panel.reading #ole-settings-toggle { display: none; }
      #ole-panel.reading.streaming #ole-reading-stop { display: inline-block; }
      #ole-panel.reading .ole-card-body { max-height: none; overflow-y: visible; }
      @media (max-width: 420px) { .ole-brand-light { display: none; } }
      @media (max-height: 660px) {
        .ole-welcome { padding-top: 5px; }
        .ole-welcome-mark, .ole-eyebrow { display: none; }
        .ole-steps { gap: 10px; }
      }
      @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
    `;
  }
})();
