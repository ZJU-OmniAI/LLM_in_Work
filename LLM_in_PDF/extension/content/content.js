// 论文网页与 PDF 阅读器共用的对话栏 + 选中提问。
// 用 Shadow DOM 把 UI 和样式跟页面隔离，互不干扰。
(() => {
  'use strict';
  if (window.__paperReadInjected) return;
  window.__paperReadInjected = true;

  // ---------- 识别 arXiv 论文 id ----------
  function detectArxivId() {
    if (!/(^|\.)arxiv\.org$/i.test(location.hostname)) return null;
    const p = location.pathname;
    let m = p.match(/\/(?:abs|pdf|html|format)\/(\d{4}\.\d{4,5}(?:v\d+)?)/i);
    if (m) return m[1];
    m = p.match(/\/(?:abs|pdf|html)\/([a-z-]+(?:\.[A-Z]{2})?\/\d{7}(?:v\d+)?)/i);
    if (m) return m[1];
    return null;
  }
  const PDF_READER = location.protocol === 'chrome-extension:' && location.pathname === '/reader/reader.html' ? window.paperReadPDF : null;
  const ARXIV_ID = PDF_READER?.arxivId || detectArxivId();
  const DOCUMENT = PDF_READER || window.paperReadDocument || (ARXIV_ID ? { id: ARXIV_ID, label: `arXiv:${ARXIV_ID}` } : null);
  if (!DOCUMENT?.id) return; // Other websites require an explicit popup action.

  // PDF 页是 Chrome 内置查看器：面板推不动它、选字也拿不到，特殊处理
  const IS_PDF = !PDF_READER && !!ARXIV_ID && /^\/pdf\//.test(location.pathname);

  // CLI 目录优先；离线时使用稳定别名，不声称具体版本。
  const MODELS = {
    claude: [['(default)', '默认 · 按 Claude Code 配置'], ['sonnet', 'Sonnet · 自动版本'], ['opus', 'Opus · 自动版本'], ['haiku', 'Haiku · 自动版本']],
    codex: [['(default)', '默认 · 按 Codex 配置']],
  };
  let modelCatalog = {};

  const HIST_KEY = 'hist:' + DOCUMENT.id; // 当前对话；arXiv 旧键保持兼容
  const ARCH_KEY = 'arch:' + DOCUMENT.id; // 归档的历史会话（最多留 10 个）

  // ---------- 运行状态 ----------
  const state = {
    cfg: { backend: 'claude', model_claude: '(default)', model_codex: '(default)', effort: 'medium', width: 440 },
    paper: null, // { title, text, source, chars, truncated }
    paperLoading: false,
    messages: [], // { role, content, via? }
    pendingSelection: '',
    pendingImages: [],
    streaming: false,
    draftAssistant: null,
    port: null,
  };

  // ---------- 读取/保存配置 ----------
  async function loadCfg() {
    try {
      const saved = await chrome.storage.local.get(['backend', 'model_claude', 'model_codex', 'effort', 'width']);
      Object.assign(state.cfg, Object.fromEntries(Object.entries(saved).filter(([, v]) => v != null)));
    } catch {}
  }
  function saveCfg() {
    try { chrome.storage.local.set(state.cfg); } catch {}
  }

  // ---------- 每篇论文的历史对话（持久化到 chrome.storage.local）----------
  async function loadHistory() {
    try {
      const o = await chrome.storage.local.get(HIST_KEY);
      const h = o[HIST_KEY];
      if (h && Array.isArray(h.messages)) state.messages = h.messages;
    } catch {}
  }
  function saveHistory() {
    try {
      chrome.storage.local.set({
        [HIST_KEY]: { messages: state.messages, title: state.paper?.title || '', ts: Date.now() },
      }).catch(() => showFeedback('历史保存失败，请先复制整段对话备份。', true));
    } catch { showFeedback('历史保存失败，请先复制整段对话备份。', true); }
  }
  function clearHistory() {
    try { chrome.storage.local.remove(HIST_KEY); } catch {}
  }

  // ---------- 归档会话（开新对话时旧的进这里，不丢）----------
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
    return { ts: Date.now(), preview: (firstUser?.content || '').slice(0, 60), messages };
  }

  // ---------- 导出 / 复制 ----------
  function currentMessages() {
    return state.draftAssistant?.content ? [...state.messages, state.draftAssistant] : [...state.messages];
  }
  function sessionMarkdown(messages, { heading = 2, withTitle = true } = {}) {
    const title = state.paper?.title || els.title.textContent || DOCUMENT.title || '论文';
    const lines = withTitle ? [`# ${title}`, ``, `> ${DOCUMENT.label} · 导出自 LLM_in_PDF · ${new Date().toLocaleString()}`, ''] : [];
    const prefix = '#'.repeat(heading);
    for (const m of messages) {
      if (m.role === 'user') lines.push(`${prefix} 🙋 用户`, '', m.content, '');
      else lines.push(`${prefix} 🤖 助手${m.via ? `（${[m.via.backend, m.via.model, 'effort ' + m.via.effort].filter(Boolean).join(' · ')}）` : ''}${m.partial ? '（生成中，已复制当前内容）' : ''}`, '', m.content, '');
      for (const image of m.images || []) if (imageSource(image)) lines.push(`![${image.name || 'PDF 截图'}](${image.dataUrl})`, '');
    }
    return lines.join('\n');
  }
  function showFeedback(message, error = false) {
    els.feedback.textContent = message;
    els.feedback.classList.remove('hidden');
    els.feedback.classList.toggle('error', error);
  }
  function copyConversation(btn) {
    const messages = currentMessages();
    if (!messages.length) { showFeedback('当前还没有对话可复制。'); return; }
    return copyText(sessionMarkdown(messages), btn, `已复制整段对话（${messages.length} 条消息）`);
  }
  async function copyAllHistory() {
    try {
      const saved = await chrome.storage.local.get(ARCH_KEY);
      const archived = Array.isArray(saved[ARCH_KEY]) ? [...saved[ARCH_KEY]].sort((a, b) => a.ts - b.ts) : [];
      const sessions = archived.map((session, index) => ({ label: `历史对话 ${index + 1} · ${fmtTime(session.ts)}`, messages: session.messages }));
      const current = currentMessages();
      if (current.length) sessions.push({ label: '当前对话', messages: current });
      if (!sessions.length) { showFeedback('本文还没有对话历史可复制。'); return; }
      const parts = [sessionMarkdown([])];
      for (const session of sessions) parts.push(`## ${session.label}\n`, sessionMarkdown(session.messages, { heading: 3, withTitle: false }));
      await copyText(parts.join('\n'), els.copyAllBtn, `已复制本文全部历史（${sessions.length} 段对话）`);
    } catch { showFeedback('读取历史失败，请重试。', true); }
  }
  async function copyText(text, btn, success = '已复制对话') {
    const originalLabel = btn?.textContent;
    if (btn) btn.disabled = true;
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch {}
    if (!ok) {
      let ta;
      const focused = shadow.activeElement || document.activeElement;
      try {
        ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-10000px;top:0;opacity:0;';
        shadow.appendChild(ta);
        ta.focus();
        ta.select();
        ok = document.execCommand('copy');
      } catch {} finally { ta?.remove(); focused?.focus({ preventScroll: true }); }
    }
    showFeedback(ok ? success : '复制失败，请允许剪贴板写入后重试。', !ok);
    if (btn) {
      btn.textContent = ok ? '✓ 已复制' : '✗ 失败';
      setTimeout(() => { btn.textContent = originalLabel; btn.disabled = false; }, 1500);
    }
    return ok;
  }

  // ---------- 从当前页面抠一份兜底正文 ----------
  function grabPageText() {
    if (IS_PDF) return ''; // PDF 查看器里抠不到正文
    const art = document.querySelector('article') || document.querySelector('.ltx_page_content') || document.querySelector('main');
    let t = (art?.innerText || document.body?.innerText || '').trim();
    if (t.length > 600000) t = t.slice(0, 600000);
    return t;
  }
  function grabPageTitle() {
    const el = document.querySelector('h1.title') || document.querySelector('h1.ltx_title') || document.querySelector('h1');
    return (el?.innerText || document.title || '').replace(/^\s*Title:\s*/i, '').trim();
  }

  // ---------- Markdown / 数学公式（HTML 禁用，表格支持横向滚动）----------
  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  const renderMarkdown = window.paperReadMarkdown;

  // ---------- 构建 UI ----------
  const host = document.createElement('div');
  host.id = 'paper-read-host';
  host.style.cssText = 'all:initial;';
  const shadow = host.attachShadow({ mode: 'open' });
  document.documentElement.appendChild(host);

  const style = document.createElement('style');
  style.textContent = CSS_TEXT();
  shadow.appendChild(style);

  // 加载 KaTeX 样式。Chrome 的坑：@font-face 写在 Shadow DOM 里不生效，
  // 所以字体声明剥出来放进页面 <head>，其余排版样式放进 shadow。
  (async function injectKatexCss() {
    try {
      const base = chrome.runtime.getURL('vendor/katex/');
      const css = await (await fetch(base + 'katex.min.css')).text();
      // 字体相对路径改写成扩展内的绝对路径
      const fixed = css.replace(/url\((['"]?)fonts\//g, (_, q) => `url(${q}${base}fonts/`);
      const fontFaces = fixed.match(/@font-face\{[^}]*\}/g) || [];
      if (fontFaces.length) {
        const docStyle = document.createElement('style');
        docStyle.id = 'paper-read-katex-fonts';
        docStyle.textContent = fontFaces.join('\n');
        (document.head || document.documentElement).appendChild(docStyle);
      }
      const shadowStyle = document.createElement('style');
      shadowStyle.textContent = fixed;
      shadow.appendChild(shadowStyle);
    } catch (e) {
      console.warn('[LLM_in_PDF] KaTeX 样式加载失败：', e);
    }
  })();

  const ui = document.createElement('div');
  ui.innerHTML = PANEL_HTML();
  shadow.appendChild(ui);

  const $ = (sel) => shadow.querySelector(sel);
  const els = {
    launcher: $('#pr-launcher'),
    panel: $('#pr-panel'),
    title: $('#pr-title'),
    paperMeta: $('#pr-paper-meta'),
    backend: $('#pr-backend'),
    model: $('#pr-model'),
    effort: $('#pr-effort'),
    messages: $('#pr-messages'),
    selChip: $('#pr-sel-chip'),
    selText: $('#pr-sel-text'),
    selClear: $('#pr-sel-clear'),
    input: $('#pr-input'),
    send: $('#pr-send'),
    stop: $('#pr-stop'),
    clear: $('#pr-clear'),
    close: $('#pr-close'),
    reload: $('#pr-reload'),
    resizer: $('#pr-resizer'),
    askBtn: $('#pr-ask-btn'),
    pdfTip: $('#pr-pdf-tip'),
    gotoHtml: $('#pr-goto-html'),
    modelRefresh: $('#pr-model-refresh'),
    modelStatus: $('#pr-model-status'),
    histBtn: $('#pr-history-btn'),
    copyBtn: $('#pr-copy'),
    copyAllBtn: $('#pr-copy-all'),
    feedback: $('#pr-feedback'),
    imageTray: $('#pr-image-tray'),
    imageList: $('#pr-image-list'),
    histView: $('#pr-hist-view'),
    histList: $('#pr-hist-list'),
    histClose: $('#pr-hist-close'),
  };

  // ---------- 面板开合 & 页面推挤 ----------
  let panelOpen = false;
  function openPanel() {
    panelOpen = true;
    els.panel.classList.add('open');
    els.launcher.classList.add('hidden');
    if (!IS_PDF) document.documentElement.classList.add('paper-read-open');
    applyWidth();
    els.input.focus();
    if (!state.paper && !state.paperLoading) loadPaper();
  }
  function closePanel() {
    panelOpen = false;
    els.panel.classList.remove('open');
    els.launcher.classList.remove('hidden');
    document.documentElement.classList.remove('paper-read-open');
    document.documentElement.style.removeProperty('margin-right');
  }
  function applyWidth() {
    // 面板最宽不超过窗口的 45%，窄窗口下不会把论文挤没
    const maxByWin = Math.max(320, Math.floor(window.innerWidth * 0.45));
    const w = Math.max(320, Math.min(820, Math.min(maxByWin, state.cfg.width || 440)));
    els.panel.style.width = w + 'px';
    if (!IS_PDF) {
      document.documentElement.style.setProperty('--paper-read-width', w + 'px');
      // 双保险：除了样式表规则，再用内联 !important 直接推，防个别页面样式不吃 class 规则
      if (panelOpen) document.documentElement.style.setProperty('margin-right', w + 'px', 'important');
    }
  }

  // ---------- 拉论文 ----------
  function showPaper(paper) {
    state.paper = paper;
    els.title.textContent = paper.title || DOCUMENT.title || '论文';
    const kb = Math.round((paper.chars || paper.text.length) / 1000);
    els.paperMeta.textContent = `已读取 ~${kb}k 字 · 来源 ${paper.source}${paper.truncated ? ' · 已截断' : ''}`;
  }
  async function loadPaper() {
    if (PDF_READER) {
      state.paperLoading = true;
      els.paperMeta.textContent = '正在读取 PDF 全文…';
      try { showPaper(await PDF_READER.ready); }
      catch (error) { els.paperMeta.textContent = `⚠️ ${error.message}`; }
      finally { state.paperLoading = false; }
      return;
    }
    if (!ARXIV_ID) {
      const text = grabPageText();
      if (!text) { els.paperMeta.textContent = '未能读取网页正文，可通过扩展打开 PDF 链接或本地文件。'; return; }
      showPaper({ title: grabPageTitle() || DOCUMENT.title, text, source: 'web-page', chars: text.length, truncated: text.length >= 600000 });
      return;
    }
    state.paperLoading = true;
    els.paperMeta.textContent = '正在读取论文全文…';
    els.title.textContent = grabPageTitle() || DOCUMENT.title || `arXiv:${ARXIV_ID}`;
    chrome.runtime.sendMessage(
      { type: 'fetchPaper', id: ARXIV_ID, url: location.href, fallbackText: grabPageText() },
      (resp) => {
        state.paperLoading = false;
        if (chrome.runtime.lastError) {
          els.paperMeta.textContent = '⚠️ 无法连接扩展后台，试试刷新页面';
          return;
        }
        if (resp?.ok && resp.paper) {
          state.paper = resp.paper;
          els.title.textContent = resp.paper.title || `arXiv:${ARXIV_ID}`;
          const kb = Math.round((resp.paper.chars || resp.paper.text.length) / 1000);
          els.paperMeta.textContent = `已读取 ~${kb}k 字 · 来源 ${resp.paper.source}${resp.paper.truncated ? ' · 已截断' : ''}`;
        } else {
          els.paperMeta.textContent = `⚠️ 读取失败：${resp?.error || '未知错误'}`;
        }
      }
    );
  }

  // ---------- 渲染消息 ----------
  function addMessageEl(role) {
    const wrap = document.createElement('div');
    wrap.className = `pr-msg pr-${role}`;
    const bubble = document.createElement('div');
    bubble.className = 'pr-bubble';
    wrap.appendChild(bubble);
    els.messages.appendChild(wrap);
    els.messages.scrollTop = els.messages.scrollHeight;
    return bubble;
  }
  function imageSource(image) {
    return typeof image?.dataUrl === 'string' && image.dataUrl.length <= 4 * 1024 * 1024 && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(image.dataUrl) ? image.dataUrl : '';
  }
  function renderUserBubble(bubble, text, selection, images = []) {
    let html = '';
    for (const image of images) if (imageSource(image)) html += `<figure class="pr-image"><img src="${imageSource(image)}" alt="${escapeHtml(image.name || 'PDF 截图')}" /><figcaption>${escapeHtml(image.name || 'PDF 截图')}</figcaption></figure>`;
    if (selection) html += `<div class="pr-quote">${escapeHtml(selection)}</div>`;
    html += `<div>${escapeHtml(text).replace(/\n/g, '<br>')}</div>`;
    bubble.innerHTML = html;
  }
  function footHtml(via) {
    if (!via) return '';
    return `<div class="pr-foot">${escapeHtml([via.backend, via.model, 'effort ' + via.effort].filter(Boolean).join(' · '))}</div>`;
  }
  function renderHistory() {
    for (const m of state.messages) {
      const b = addMessageEl(m.role === 'assistant' ? 'assistant' : 'user');
      if (m.role === 'assistant') b.innerHTML = renderMarkdown(m.content) + footHtml(m.via);
      else renderUserBubble(b, m.content, '', m.images);
    }
  }

  // ---------- 发送 ----------
  async function send() {
    const text = els.input.value.trim() || (state.pendingImages.length ? '请结合论文解释这张图片或图表。' : '');
    if (!text || state.streaming) return;
    if (!state.paper) {
      if (!state.paperLoading) await loadPaper();
      if (!state.paper) { els.paperMeta.textContent = state.paperLoading ? '论文仍在读取中，完成后再发送。' : '请先成功读取论文，再发送问题。'; return; }
    }

    const selection = state.pendingSelection;
    const images = state.pendingImages;
    state.pendingImages = [];
    renderPendingImages();
    els.input.value = '';
    autoGrow();
    clearSelection();

    const uBubble = addMessageEl('user');
    renderUserBubble(uBubble, text, selection, images);
    state.messages.push({ role: 'user', content: selection ? `【针对选中片段：「${selection}」】${text}` : text, ...(images.length ? { images } : {}) });

    const aBubble = addMessageEl('assistant');
    aBubble.innerHTML = '<span class="pr-typing">思考中<span>.</span><span>.</span><span>.</span></span>';

    let raw = '';
    let thinking = '';
    let rafPending = false;
    // 实际回答本轮的后端/模型（meta/model 事件回填，claude 会给出真实模型 ID）
    const via = {
      backend: state.cfg.backend,
      model: state.cfg.backend === 'codex' ? state.cfg.model_codex : state.cfg.model_claude,
      effort: state.cfg.effort,
    };
    if (via.model === '(default)') via.model = modelCatalog.defaults?.[via.backend] ? `${modelCatalog.defaults[via.backend]}（本机配置）` : '默认（按本机配置）';

    const scheduleRender = (final) => {
      if (!final) state.draftAssistant = { role: 'assistant', content: raw, via, partial: true };
      if (rafPending && !final) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        let html = '';
        if (thinking.trim()) {
          html += `<details class="pr-think"><summary>💭 思考过程</summary><div>${escapeHtml(thinking)}</div></details>`;
        }
        html += renderMarkdown(raw) || '<span class="pr-typing">思考中<span>.</span><span>.</span><span>.</span></span>';
        if (final) html += footHtml(via);
        aBubble.innerHTML = html;
        els.messages.scrollTop = els.messages.scrollHeight;
      });
    };

    setStreaming(true);
    const port = chrome.runtime.connect({ name: 'paper_read_chat' });
    state.port = port;

    const allImages = state.messages.filter((message) => message.role === 'user').flatMap((message) => message.images || []).filter(imageSource);
    const recentImages = allImages.slice(-4);
    if (allImages.length > 4) showFeedback('本轮附带最近 4 张图片；较早的图片可重新框选。');
    const payload = {
      backend: state.cfg.backend,
      model: state.cfg.backend === 'codex' ? state.cfg.model_codex : state.cfg.model_claude,
      effort: state.cfg.effort,
      paper: state.paper
        ? { title: state.paper.title, text: state.paper.text, source: state.paper.source, truncated: state.paper.truncated }
        : { title: grabPageTitle(), text: grabPageText(), source: 'page' },
      // Pixels are sent once in images; history carries only references and text.
      messages: state.messages.map((message) => ({ role: message.role, content: message.content,
        ...(message.images?.length ? { images: message.images.map(({ id, name, page }) => ({ id, name, page })) } : {}) })),
      images: recentImages.map((image) => ({ id: image.id, name: image.name, page: image.page,
        mime: image.dataUrl.slice(5, image.dataUrl.indexOf(';')), b64: image.dataUrl.slice(image.dataUrl.indexOf(',') + 1) })),
      selection,
    };

    port.onMessage.addListener((evt) => {
      if (evt.type === 'delta') { raw += evt.text; scheduleRender(); }
      else if (evt.type === 'thinking') { thinking += evt.text; scheduleRender(); }
      else if (evt.type === 'model') { if (evt.model) via.model = evt.model; }
      else if (evt.type === 'error') {
        raw += (raw ? '\n\n' : '') + `⚠️ **出错了**：\n\n${evt.error}`;
        scheduleRender();
      } else if (evt.type === 'aborted') {
        raw += raw ? '\n\n_（已停止）_' : '_（已停止）_';
        scheduleRender();
      } else if (evt.type === 'done') {
        finishStream();
      }
    });
    port.onDisconnect.addListener(() => finishStream());

    function finishStream() {
      if (!state.streaming) return;
      state.stopCurrent = null;
      setStreaming(false);
      scheduleRender(true);
      state.messages.push({ role: 'assistant', content: raw || '（无输出）', via: { ...via } });
      state.draftAssistant = null;
      saveHistory();
      try { port.disconnect(); } catch {}
      state.port = null;
    }

    // Chrome 的坑：自己调 port.disconnect() 只通知对端，自己这端的 onDisconnect 不会触发。
    // 所以把"停止收尾"挂到 state 上，stopStream 手动调——否则点停止后界面永远卡在流式态。
    state.stopCurrent = () => {
      if (!state.streaming) return;
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
    state.streaming = v;
    els.send.classList.toggle('hidden', v);
    els.stop.classList.toggle('hidden', !v);
    els.input.disabled = false;
  }

  async function newChat() {
    if (state.streaming) stopStream();
    // 旧对话不删，自动归档到 🕘 历史里
    if (state.messages.length) {
      const list = await getArchive();
      list.unshift(sessionEntry(state.messages));
      setArchive(list);
    }
    state.messages = [];
    els.messages.innerHTML = '';
    clearSelection();
    state.pendingImages = [];
    renderPendingImages();
    clearHistory();
    renderWelcome();
  }

  // ---------- 历史会话浮层 ----------
  function mkBtn(label, onClick) {
    const b = document.createElement('button');
    b.className = 'pr-hbtn';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }
  function fmtTime(ts) {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  async function openHistView() {
    const list = await getArchive();
    const wrap = els.histList;
    wrap.innerHTML = '';

    // 当前对话
    const cur = document.createElement('div');
    cur.className = 'pr-hist-item pr-hist-cur';
    const curMeta = document.createElement('div');
    curMeta.className = 'pr-hist-meta';
    curMeta.textContent = `当前对话 · ${state.messages.length} 条消息`;
    cur.appendChild(curMeta);
    const curBtns = document.createElement('div');
    curBtns.className = 'pr-hist-btns';
    const curCopy = mkBtn('📋 复制整段', () => copyConversation(curCopy));
    curBtns.appendChild(curCopy);
    cur.appendChild(curBtns);
    wrap.appendChild(cur);

    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'pr-hist-empty';
      empty.textContent = '还没有归档的会话。点 🧹 开新对话时，旧对话会自动归档到这里（每篇论文最多留 10 段）。';
      wrap.appendChild(empty);
    }

    list.forEach((s, i) => {
      const item = document.createElement('div');
      item.className = 'pr-hist-item';
      const meta = document.createElement('div');
      meta.className = 'pr-hist-meta';
      meta.textContent = `${fmtTime(s.ts)} · ${s.messages.length} 条消息`;
      const prev = document.createElement('div');
      prev.className = 'pr-hist-prev';
      prev.textContent = s.preview || '（无预览）';
      const btns = document.createElement('div');
      btns.className = 'pr-hist-btns';
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
  async function openSession(i) {
    if (state.streaming) stopStream();
    const list = await getArchive();
    const s = list[i];
    if (!s) return;
    list.splice(i, 1);
    // 当前对话先归档，防丢
    if (state.messages.length) list.unshift(sessionEntry(state.messages));
    setArchive(list);
    state.messages = s.messages;
    state.pendingImages = [];
    renderPendingImages();
    els.messages.innerHTML = '';
    renderHistory();
    saveHistory();
    els.histView.classList.add('hidden');
  }

  function renderWelcome() {
    const b = addMessageEl('assistant');
    b.innerHTML = renderMarkdown(
      '👋 我已经准备好和你一起读这篇论文了。你可以：\n\n' +
      '- 直接问：**这篇论文的核心贡献是什么？**\n' +
      '- 让我讲某一节：**解释一下方法部分**\n' +
      '- 在页面上**用鼠标选中一段文字**，点浮标「问一下」就能针对那段追问\n\n' +
      (PDF_READER ? '- 图片和图表：点击 PDF 顶部的 **框选图片**，拖框选中后在右侧提问\n\n' : '') +
      '右上角可切换 **Claude / Codex**、模型和 **effort**（思考强度）。\n\n' +
      '对话按论文自动保存：🧹 开新对话时旧对话自动归档，点 **🕘** 可找回、继续聊或**一键复制整段**；📋 复制当前对话。'
    );
  }

  // ---------- 选中提问 ----------
  function showSelectionChip(text) {
    state.pendingSelection = text;
    els.selText.textContent = text.length > 160 ? text.slice(0, 160) + '…' : text;
    els.selChip.classList.remove('hidden');
  }
  function clearSelection() {
    state.pendingSelection = '';
    els.selChip.classList.add('hidden');
    els.selText.textContent = '';
  }

  function renderPendingImages() {
    els.imageList.replaceChildren();
    els.imageTray.classList.toggle('hidden', !state.pendingImages.length);
    state.pendingImages.forEach((image, index) => {
      const item = document.createElement('div');
      item.className = 'pr-image-preview';
      const preview = document.createElement('img');
      preview.src = imageSource(image); preview.alt = image.name;
      const label = document.createElement('span'); label.textContent = image.name;
      const remove = document.createElement('button'); remove.textContent = '✕'; remove.title = '移除图片';
      remove.addEventListener('click', () => { state.pendingImages.splice(index, 1); renderPendingImages(); });
      item.append(preview, label, remove); els.imageList.appendChild(item);
    });
  }

  let lastSelText = '';
  let selTimer = 0;

  // 读取当前页面选区（面板内部的选区不算）
  function currentSelectionInfo() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const text = String(sel).trim();
    if (!text || text.length < 2) return null;
    const n = sel.anchorNode;
    const el = n ? (n.nodeType === 1 ? n : n.parentElement) : null;
    if (el && (el === host || host.contains(el) || el.getRootNode() === shadow || shadow.contains(el))) return null;
    if (PDF_READER && !el?.closest('.textLayer')) return null;
    let rect = null;
    try { rect = sel.getRangeAt(0).getBoundingClientRect(); } catch {}
    if (!rect || (!rect.width && !rect.height)) return null;
    return { text, rect };
  }
  function updateAskBtn() {
    const info = currentSelectionInfo();
    if (!info) { hideAskBtn(); return; }
    lastSelText = info.text;
    showAskBtn(info.rect);
  }
  function showAskBtn(rect) {
    const btn = els.askBtn;
    const top = Math.max(8, rect.top - 40);
    const left = Math.min(window.innerWidth - 120, Math.max(8, rect.left + rect.width / 2 - 40));
    btn.style.top = top + 'px';
    btn.style.left = left + 'px';
    btn.classList.remove('hidden');
  }
  function hideAskBtn() {
    els.askBtn.classList.add('hidden');
  }

  // ---------- 事件绑定 ----------
  function fillEffortOptions() {
    const backend = state.cfg.backend;
    const model = state.cfg['model_' + backend];
    const levels = [...(modelCatalog.efforts?.[backend]?.[model] || (backend === 'codex' ? ['low', 'medium', 'high', 'xhigh'] : ['low', 'medium', 'high', 'xhigh', 'max']))];
    // Keep a saved effort until the asynchronous directory has confirmed its capabilities.
    if (!modelCatalog.sources && ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(state.cfg.effort) && !levels.includes(state.cfg.effort)) levels.push(state.cfg.effort);
    els.effort.replaceChildren(...levels.map((value) => new Option(value, value)));
    if (!levels.includes(state.cfg.effort)) state.cfg.effort = levels.includes('medium') ? 'medium' : levels[0];
    els.effort.value = state.cfg.effort;
  }
  function fillModelOptions() {
    const backend = state.cfg.backend;
    const list = [...(MODELS[backend] || MODELS.claude)];
    const key = 'model_' + backend;
    const want = state.cfg[key];
    if (want && !list.some(([v]) => v === want)) list.push([want, `${want}（已保存）`]);
    els.model.replaceChildren(...list.map(([value, label]) => new Option(label, value)));
    els.model.value = want || list[0][0];
    state.cfg[key] = els.model.value;
    fillEffortOptions();
    const runtime = modelCatalog.runtimes?.[backend];
    const source = modelCatalog.sources?.[backend];
    els.modelStatus.textContent = runtime ? `${backend} ${runtime.version || '未找到'} · ${source === 'cli' ? '模型来自本机' : source === 'cache' ? '模型来自上次缓存' : '使用默认配置 / 别名'}` : '模型列表尚未连接';
    els.modelStatus.title = [runtime?.bin, ...(modelCatalog.warnings || [])].filter(Boolean).join('\n');
  }
  async function refreshModels(force = false) {
    els.modelRefresh.disabled = true;
    els.modelStatus.textContent = '正在读取本机模型…';
    try {
      const result = await chrome.runtime.sendMessage({ type: 'models', force });
      if (!result?.ok) throw new Error(result?.error || '无法读取模型');
      modelCatalog = result;
      for (const backend of ['claude', 'codex']) if (Array.isArray(result[backend]) && result[backend].length) MODELS[backend] = result[backend];
      fillModelOptions();
      saveCfg();
    } catch (error) {
      els.modelStatus.textContent = '模型列表未更新 · 点击 ↻ 重试';
      els.modelStatus.title = error.message;
    } finally { els.modelRefresh.disabled = false; }
  }
  function bindEvents() {
    window.addEventListener('paper-read-open', openPanel);
    if (PDF_READER) window.addEventListener('paper-read-image', ({ detail }) => {
      if (!imageSource(detail)) { showFeedback('图片无效，请重新框选。', true); return; }
      if (state.pendingImages.length >= 4) { showFeedback('每次最多发送 4 张图片，请先发送或移除已有图片。', true); return; }
      state.pendingImages.push(detail);
      hideAskBtn();
      if (!panelOpen) openPanel();
      renderPendingImages();
      els.input.focus();
    });
    els.launcher.addEventListener('click', openPanel);
    els.close.addEventListener('click', closePanel);
    els.clear.addEventListener('click', newChat);
    els.histBtn.addEventListener('click', openHistView);
    els.histClose.addEventListener('click', () => els.histView.classList.add('hidden'));
    els.copyBtn.addEventListener('click', () => copyConversation(els.copyBtn));
    els.copyAllBtn.addEventListener('click', copyAllHistory);
    els.reload.addEventListener('click', () => { state.paper = null; loadPaper(); });
    els.send.addEventListener('click', send);
    els.stop.addEventListener('click', stopStream);
    els.selClear.addEventListener('click', clearSelection);
    if (els.gotoHtml) {
      els.gotoHtml.addEventListener('click', () => {
        // html 版不存在时 arxiv 会自动跳回摘要页
        location.href = `https://arxiv.org/html/${ARXIV_ID}`;
      });
    }

    els.backend.value = state.cfg.backend;
    els.backend.addEventListener('change', () => {
      state.cfg.backend = els.backend.value;
      fillModelOptions();
      saveCfg();
    });
    els.modelRefresh.addEventListener('click', () => refreshModels(true));
    fillEffortOptions();
    els.effort.addEventListener('change', () => { state.cfg.effort = els.effort.value; saveCfg(); });
    els.model.addEventListener('change', () => {
      if (state.cfg.backend === 'codex') state.cfg.model_codex = els.model.value;
      else state.cfg.model_claude = els.model.value;
      fillEffortOptions();
      saveCfg();
    });

    els.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    els.input.addEventListener('input', autoGrow);

    els.askBtn.addEventListener('mousedown', (e) => e.preventDefault()); // 别让点击清掉选区
    els.askBtn.addEventListener('click', () => {
      hideAskBtn();
      if (!panelOpen) openPanel();
      showSelectionChip(lastSelText);
      els.input.focus();
    });

    // 选中检测：跟着 selectionchange 走（鼠标、键盘、双击选词都能触发）；
    // 滚动时不再隐藏浮标，而是跟着选区挪位置
    document.addEventListener('selectionchange', () => {
      clearTimeout(selTimer);
      selTimer = setTimeout(updateAskBtn, 150);
    });
    document.addEventListener('scroll', () => {
      if (!els.askBtn.classList.contains('hidden')) updateAskBtn();
    }, true);

    window.addEventListener('resize', () => { if (panelOpen) applyWidth(); });

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

  function autoGrow() {
    els.input.style.height = 'auto';
    els.input.style.height = Math.min(160, els.input.scrollHeight) + 'px';
  }

  // ---------- 启动 ----------
  (async function init() {
    await loadCfg();
    await loadHistory();
    fillModelOptions();
    bindEvents();
    refreshModels();
    applyWidth();
    if (state.messages.length) renderHistory();
    else renderWelcome();
    if (IS_PDF) {
      els.pdfTip.classList.remove('hidden');
      // PDF 页不自动展开（面板会盖住 PDF），点悬浮球再开
    } else {
      openPanel();
    }
  })();

  // ---------- 模板 ----------
  function PANEL_HTML() {
    return `
      <button id="pr-launcher" title="打开 LLM_in_PDF 对话">📄💬</button>
      <div id="pr-panel">
        <div id="pr-resizer"></div>
        <header id="pr-header">
          <div class="pr-head-top">
            <div class="pr-brand">📄 LLM_in_PDF</div>
            <div class="pr-head-btns">
              <button id="pr-history-btn" title="历史对话">🕘</button>
              <button id="pr-reload" title="重新读取论文">↻</button>
              <button id="pr-clear" title="开新对话（旧对话自动归档到 🕘）">🧹</button>
              <button id="pr-close" title="收起">✕</button>
            </div>
          </div>
          <div id="pr-title" class="pr-title">读取中…</div>
          <div id="pr-paper-meta" class="pr-meta">正在读取论文全文…</div>
          <div id="pr-pdf-tip" class="hidden">
            当前是原生 PDF 查看器，可从扩展设置打开可选字阅读器。
            <button id="pr-goto-html">切换 HTML 版阅读 →</button>
          </div>
          <div class="pr-controls">
            <select id="pr-backend" title="后端">
              <option value="claude">Claude</option>
              <option value="codex">Codex</option>
            </select>
            <select id="pr-model" title="模型"></select>
            <select id="pr-effort" title="思考强度 effort"></select>
            <button id="pr-model-refresh" title="刷新本机模型列表">↻</button>
          </div>
          <div id="pr-model-status" class="pr-meta" role="status"></div>
          <div class="pr-copy-actions">
            <button id="pr-copy" title="复制当前完整对话为 Markdown，包含问题、回答和引用片段">📋 复制整段对话</button>
            <button id="pr-copy-all" title="复制本文已保存的全部历史会话和当前对话为 Markdown">复制本文全部历史</button>
          </div>
        </header>
        <div id="pr-feedback" class="hidden" role="status" aria-live="polite"></div>
        <div id="pr-messages"></div>
        <div id="pr-image-tray" class="hidden"><div class="pr-image-label">所选图片 · 输入问题后发送</div><div id="pr-image-list"></div></div>
        <div id="pr-sel-chip" class="hidden">
          <span class="pr-sel-label">选中片段</span>
          <span id="pr-sel-text"></span>
          <button id="pr-sel-clear" title="取消">✕</button>
        </div>
        <div id="pr-inputbar">
          <textarea id="pr-input" rows="1" placeholder="针对这篇论文提问…（Enter 发送，Shift+Enter 换行）"></textarea>
          <button id="pr-send" title="发送">发送</button>
          <button id="pr-stop" class="hidden" title="停止">停止</button>
        </div>
        <div id="pr-hist-view" class="hidden">
          <div class="pr-hist-head">
            <b>🕘 本文的历史对话</b>
            <button id="pr-hist-close" title="返回">✕</button>
          </div>
          <div id="pr-hist-list"></div>
        </div>
      </div>
      <button id="pr-ask-btn" class="hidden">💬 问一下</button>
    `;
  }

  function CSS_TEXT() {
    return `
      :host { all: initial; }
      * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
      .hidden { display: none !important; }

      #pr-launcher {
        position: fixed; right: 18px; bottom: 22px; z-index: 2147483647;
        width: 52px; height: 52px; border-radius: 50%; border: none; cursor: pointer;
        background: #4f46e5; color: #fff; font-size: 20px; box-shadow: 0 6px 20px rgba(79,70,229,.45);
      }
      #pr-launcher:hover { background: #4338ca; }

      #pr-panel {
        position: fixed; top: 0; right: 0; height: 100vh; width: 440px;
        background: #fff; color: #1f2330; z-index: 2147483647;
        display: none; flex-direction: column; box-shadow: -2px 0 24px rgba(0,0,0,.14);
        border-left: 1px solid #e6e8ef;
      }
      #pr-panel.open { display: flex; }

      #pr-resizer { position: absolute; left: -3px; top: 0; width: 6px; height: 100%; cursor: ew-resize; }

      #pr-header { padding: 12px 14px 10px; border-bottom: 1px solid #eef0f5; background: #fafbff; }
      .pr-head-top { display: flex; justify-content: space-between; align-items: center; }
      .pr-brand { font-weight: 700; font-size: 14px; color: #4f46e5; }
      .pr-head-btns button {
        border: none; background: transparent; cursor: pointer; font-size: 15px; color: #6b7280;
        padding: 4px 6px; border-radius: 6px;
      }
      .pr-head-btns button:hover { background: #eef0f5; color: #1f2330; }
      .pr-title { font-weight: 600; font-size: 13.5px; line-height: 1.35; margin: 6px 0 2px; }
      .pr-meta { font-size: 11.5px; color: #8a90a2; margin-bottom: 8px; }
      #pr-pdf-tip {
        font-size: 12px; color: #7a5b12; background: #fff7e6; border: 1px solid #ffe0a3;
        border-radius: 8px; padding: 7px 10px; margin-bottom: 8px; line-height: 1.6;
      }
      #pr-goto-html {
        border: none; background: #b45309; color: #fff; border-radius: 6px; padding: 3px 8px;
        font-size: 12px; cursor: pointer; margin-left: 4px;
      }
      #pr-goto-html:hover { background: #92400e; }
      .pr-controls { display: flex; gap: 6px; }
      .pr-controls select {
        flex: 1; min-width: 0; font-size: 12px; padding: 5px 6px; border: 1px solid #dfe2ec; border-radius: 7px;
        background: #fff; color: #1f2330; cursor: pointer;
      }
      .pr-copy-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
      .pr-copy-actions button { border: 1px solid #dfe2ec; border-radius: 7px; padding: 5px 8px; background: #fff; color: #4f46e5; font-size: 12px; cursor: pointer; }
      .pr-copy-actions button:hover { background: #eef0ff; }
      .pr-copy-actions button:disabled { cursor: default; opacity: .65; }
      #pr-feedback { flex-shrink: 0; padding: 6px 14px; background: #edf8f1; color: #24613c; font-size: 12px; }
      #pr-feedback.error { background: #fff2ed; color: #a23e28; }

      #pr-messages { flex: 1; min-height: 0; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 12px; }
      .pr-msg { display: flex; min-width: 0; }
      .pr-user { justify-content: flex-end; }
      .pr-bubble {
        min-width: 0; max-width: 100%; padding: 9px 12px; border-radius: 12px; font-size: 13.5px; line-height: 1.6;
        word-break: break-word; overflow-wrap: anywhere;
      }
      .pr-user .pr-bubble { max-width: 88%; background: #4f46e5; color: #fff; border-bottom-right-radius: 4px; }
      .pr-assistant .pr-bubble { background: #f4f5fa; color: #1f2330; border-bottom-left-radius: 4px; }
      .pr-bubble p { margin: 6px 0; }
      .pr-bubble p:first-child { margin-top: 0; }
      .pr-bubble p:last-child { margin-bottom: 0; }
      .pr-bubble h1, .pr-bubble h2, .pr-bubble h3, .pr-bubble h4, .pr-bubble h5, .pr-bubble h6 { margin: 12px 0 6px; font-size: 14px; line-height: 1.45; }
      .pr-bubble h1 { font-size: 18px; }
      .pr-bubble h2 { font-size: 16px; }
      .pr-bubble ul, .pr-bubble ol { margin: 6px 0; padding-left: 20px; }
      .pr-bubble li { margin: 2px 0; }
      .pr-bubble blockquote { margin: 6px 0; padding: 2px 10px; border-left: 3px solid #c9cde0; color: #555b6e; }
      .pr-bubble a { color: #4f46e5; }
      .pr-image { margin: 0 0 8px; }
      .pr-image img { display: block; max-width: 100%; max-height: 260px; object-fit: contain; border-radius: 6px; background: white; }
      .pr-image figcaption { font-size: 11px; margin-top: 4px; opacity: .85; }
      #pr-image-tray { flex-shrink: 0; padding: 8px 14px; border-top: 1px solid #eef0f5; background: #fafbff; }
      .pr-image-label { font-size: 11px; color: #6b7280; margin-bottom: 5px; }
      #pr-image-list { display: flex; flex-wrap: wrap; gap: 6px; max-height: 180px; overflow-y: auto; }
      .pr-image-preview { position: relative; width: 84px; font-size: 10px; color: #6b7280; }
      .pr-image-preview img { width: 80px; height: 64px; object-fit: contain; border: 1px solid #dfe2ec; border-radius: 6px; background: white; }
      .pr-image-preview button { position: absolute; top: 0; right: 0; border: none; border-radius: 50%; background: #1f2330; color: white; cursor: pointer; }
      .pr-bubble hr { border: 0; border-top: 1px solid #dfe2ec; margin: 12px 0; }
      .pr-table-scroll { max-width: 100%; overflow-x: auto; margin: 10px 0; border: 1px solid #d9ddea; border-radius: 7px; background: #fff; }
      .pr-table-scroll:focus-visible { outline: 2px solid #4f46e5; outline-offset: 2px; }
      .pr-table-scroll table { width: 100%; border-collapse: collapse; font-size: 12.5px; line-height: 1.5; word-break: normal; overflow-wrap: normal; }
      .pr-table-scroll th, .pr-table-scroll td { min-width: 90px; max-width: 360px; padding: 7px 10px; text-align: left; vertical-align: top; border: 1px solid #e3e6ef; }
      .pr-table-scroll th { font-weight: 600; background: #e9ecf8; }
      .pr-table-scroll tbody tr:nth-child(even) { background: #f7f8fc; }
      .pr-table-scroll td .pr-code { white-space: nowrap; }
      .pr-code { background: #e9ebf3; padding: 1px 5px; border-radius: 4px; font-family: ui-monospace, Menlo, monospace; font-size: 12px; }
      .pr-pre { background: #1f2330; color: #e6e8ef; padding: 10px 12px; border-radius: 8px; overflow-x: auto; margin: 8px 0; }
      .pr-pre code { font-family: ui-monospace, Menlo, monospace; font-size: 12px; white-space: pre; }
      .pr-quote { border-left: 3px solid rgba(255,255,255,.6); padding-left: 8px; margin-bottom: 6px; font-size: 12px; opacity: .92; }
      .pr-think { margin-bottom: 8px; font-size: 12px; color: #7a8098; }
      .pr-think summary { cursor: pointer; }
      .pr-think > div { white-space: pre-wrap; margin-top: 4px; padding: 6px 8px; background: #eef0f5; border-radius: 6px; }
      .pr-foot { margin-top: 8px; font-size: 11px; color: #9aa0b4; }
      .pr-bubble .katex-display { margin: 10px 0; overflow-x: auto; overflow-y: hidden; padding: 2px 0; }
      .pr-bubble .katex { font-size: 1.06em; }

      #pr-hist-view {
        position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: #fff; z-index: 6;
        display: flex; flex-direction: column;
      }
      .pr-hist-head {
        display: flex; justify-content: space-between; align-items: center;
        padding: 12px 14px; border-bottom: 1px solid #eef0f5; background: #fafbff;
        font-size: 14px; color: #1f2330;
      }
      .pr-hist-head button { border: none; background: transparent; cursor: pointer; font-size: 15px; color: #6b7280; }
      #pr-hist-list { flex: 1; overflow-y: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
      .pr-hist-item { border: 1px solid #e6e8ef; border-radius: 10px; padding: 10px 12px; }
      .pr-hist-cur { border-color: #c7c9f5; background: #f7f7ff; }
      .pr-hist-meta { font-size: 12px; color: #8a90a2; margin-bottom: 4px; }
      .pr-hist-prev { font-size: 12.5px; color: #1f2330; margin-bottom: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .pr-hist-btns { display: flex; gap: 6px; }
      .pr-hbtn {
        border: 1px solid #dfe2ec; background: #fff; border-radius: 7px; padding: 4px 10px;
        font-size: 12px; cursor: pointer; color: #1f2330;
      }
      .pr-hbtn:hover { border-color: #4f46e5; color: #4f46e5; }
      .pr-hist-empty { font-size: 12.5px; color: #8a90a2; line-height: 1.7; padding: 6px 2px; }

      .pr-typing span { animation: pr-blink 1.2s infinite; }
      .pr-typing span:nth-child(2) { animation-delay: .2s; }
      .pr-typing span:nth-child(3) { animation-delay: .4s; }
      @keyframes pr-blink { 0%,60%,100% { opacity: .2 } 30% { opacity: 1 } }

      #pr-sel-chip {
        display: flex; align-items: center; gap: 8px; margin: 0 14px 6px; padding: 7px 10px;
        background: #fff7e6; border: 1px solid #ffe0a3; border-radius: 8px; font-size: 12px; color: #7a5b12;
      }
      .pr-sel-label { font-weight: 600; white-space: nowrap; }
      #pr-sel-text { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #pr-sel-clear { border: none; background: transparent; cursor: pointer; color: #b08a2e; }

      #pr-inputbar { display: flex; gap: 8px; align-items: flex-end; padding: 10px 12px 14px; border-top: 1px solid #eef0f5; }
      #pr-input {
        flex: 1; resize: none; border: 1px solid #dfe2ec; border-radius: 10px; padding: 9px 11px;
        font-size: 13.5px; line-height: 1.5; max-height: 160px; outline: none; color: #1f2330;
      }
      #pr-input:focus { border-color: #4f46e5; }
      #pr-send, #pr-stop {
        border: none; border-radius: 9px; padding: 9px 14px; cursor: pointer; font-size: 13px; font-weight: 600;
        white-space: nowrap;
      }
      #pr-send { background: #4f46e5; color: #fff; }
      #pr-send:hover { background: #4338ca; }
      #pr-stop { background: #ef4444; color: #fff; }

      #pr-ask-btn {
        position: fixed; z-index: 2147483647; border: none; cursor: pointer;
        background: #1f2330; color: #fff; font-size: 12.5px; padding: 6px 12px; border-radius: 8px;
        box-shadow: 0 4px 14px rgba(0,0,0,.28);
      }
      #pr-ask-btn:hover { background: #000; }
    `;
  }
})();
