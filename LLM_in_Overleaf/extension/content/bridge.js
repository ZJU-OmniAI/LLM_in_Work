// MAIN world 桥：跑在 Overleaf 页面自己的 JS 世界里，能直接摸到它内部的 CodeMirror 6 实例。
// 原理：CM6 会把内部视图对象挂在 .cm-content 这个 DOM 元素上——旧版属性名叫 cmView，
// 新版（tile 架构重写后）叫 cmTile，两者都有 .view 指回 EditorView ——
// 读选区、读全文、dispatch 修改都靠它。（已在 codemirror.net 最新版实测 cmTile.view 可读写）
// 与内容脚本（isolated world）之间用 window.postMessage 一问一答通信。
(() => {
  'use strict';
  if (window.__llmInOverleafBridge) return;
  window.__llmInOverleafBridge = true;

  const NS = 'LLM_IN_OVERLEAF_BRIDGE';

  let lastView = null;
  function findView() {
    const views = [];
    for (const el of document.querySelectorAll('.cm-content')) {
      // 文件切换、分栏时页面可能保留隐藏的旧编辑器。
      if (!el.getClientRects().length || getComputedStyle(el).visibility === 'hidden') continue;
      for (const holder of [el.cmView, el.cmTile]) {
        const view = holder?.view || holder?.root?.view;
        if (view?.state && typeof view.dispatch === 'function' && !views.includes(view)) views.push(view);
      }
    }
    lastView = views.find((v) => v.hasFocus || v.contentDOM?.contains(document.activeElement))
      || (views.includes(lastView) ? lastView : null) || views[0] || null;
    return lastView;
  }

  const NO_EDITOR = '未连接到源码编辑器。请打开 .tex 文件并切换到 Code Editor（源码编辑），等待加载完成后重试；PDF 预览中的选区不能用于替换源码。';

  function readSelection(v, withText = false) {
    const selected = v.state.selection.ranges.filter((r) => r.to > r.from);
    const ranges = selected.map(({ from, to }) => ({
      from, to,
      ...(withText ? { text: v.state.sliceDoc(from, to) } : {}),
      line1: v.state.doc.lineAt(from).number,
      line2: v.state.doc.lineAt(to - 1).number,
    }));
    const { from, to } = selected[0] || v.state.selection.main;
    const head = v.state.selection.main.head;
    const len = selected.reduce((n, r) => n + r.to - r.from, 0);
    let rect = null;
    try {
      // CM6 的选区可能由编辑器自行绘制，window.getSelection() 不一定包含它。
      const r = v.coordsAtPos(head ?? to) || v.coordsAtPos(from);
      if (r) rect = { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    } catch {}
    const editorRect = v.dom?.getBoundingClientRect();
    if (!rect && editorRect) rect = { top: editorRect.top, bottom: editorRect.top + 32, left: editorRect.left, right: editorRect.right - 16 };
    return {
      ok: true, from, to, len, rect, ranges,
      preview: v.state.sliceDoc(from, Math.min(to, from + 200)),
      ...(withText ? { text: v.state.sliceDoc(from, to) } : {}),
      line1: v.state.doc.lineAt(from).number,
      line2: v.state.doc.lineAt(to > from ? to - 1 : to).number,
      docLen: v.state.doc.length, fileName: currentFileName(),
    };
  }

  // 抠当前打开的文件名。选择器按 2026-07 真实 DOM 实测排序：
  // ① 编辑器文件标签页（最准确反映"正在编辑哪个文件"）② 文件树选中项。抠不到返回空串。
  function currentFileName() {
    const sels = [
      '.editor-file-tab.tab-selected .editor-file-tab-path',
      '.file-tree li.selected .item-name span',
      '[data-testid="file-tree"] li.selected .item-name span',
      '.file-tree .selected .item-name-button span', // 旧版 DOM 兜底
    ];
    for (const s of sels) {
      try {
        const el = document.querySelector(s);
        // 去掉 Overleaf 塞的方向控制符（U+200E 等）和首尾空白
        const t = el && el.textContent && el.textContent.replace(/[‎‏⁦-⁩]/g, '').trim();
        if (t) return t;
      } catch {}
    }
    return '';
  }

  function projectName() {
    try {
      const el = document.querySelector('.project-name .name, [data-testid="project-name"]');
      if (el && el.textContent.trim()) return el.textContent.trim();
    } catch {}
    const t = document.title || '';
    const cut = t.indexOf(' - Overleaf');
    return cut > 0 ? t.slice(0, cut) : '';
  }

  // 文档自选中之后可能被编辑过：按"精确文本匹配"重新定位 [from,to)。
  // 返回 {from,to} 或 null；位置失效时只接受唯一文本匹配。
  function locate(state, from, to, oldText) {
    const len = state.doc.length;
    if (from >= 0 && to <= len && from <= to && state.sliceDoc(from, to) === oldText) {
      return { from, to };
    }
    if (!oldText) return null;
    const s = state.doc.toString();
    const index = s.indexOf(oldText);
    if (index < 0 || s.indexOf(oldText, index + 1) >= 0) return null;
    return { from: index, to: index + oldText.length };
  }

  function resolveRanges(v, ranges, fileName) {
    const current = currentFileName();
    if (fileName && current !== fileName) throw new Error(`请切回 ${fileName} 后再操作选段。`);
    if (!Array.isArray(ranges) || !ranges.length) throw new Error('没有选段，请重新选择。');
    const found = ranges.map((r) => {
      const text = r.oldText ?? r.text;
      if (typeof text !== 'string' || !text) throw new Error('选段内容为空，请重新选择。');
      const loc = locate(v.state, r.from, r.to, text);
      if (!loc) throw new Error('某个选段已被修改或无法唯一定位，请移除该段后重新选择；文档尚未修改。');
      return { ...r, ...loc, text,
        line1: v.state.doc.lineAt(loc.from).number,
        line2: v.state.doc.lineAt(loc.to - 1).number,
      };
    }).sort((a, b) => a.from - b.from);
    for (let i = 1; i < found.length; i++) {
      if (found[i].from < found[i - 1].to) throw new Error('选段有重叠，请先移除重叠的选段再添加。');
    }
    return found;
  }

  function contextFor(v, ranges, cap, headKeep) {
    const st = v.state;
    if (st.doc.length <= cap) return { fullText: st.doc.toString(), truncated: false };
    const selectedChars = ranges.reduce((n, r) => n + r.to - r.from, 0);
    const around = Math.max(0, Math.floor((cap - headKeep - selectedChars) / (2 * ranges.length)));
    const windows = [{ from: 0, to: Math.min(headKeep, st.doc.length) },
      ...ranges.map((r) => ({ from: Math.max(0, r.from - around), to: Math.min(st.doc.length, r.to + around) }))]
      .sort((a, b) => a.from - b.from);
    const merged = [];
    for (const w of windows) {
      const prev = merged.at(-1);
      if (prev && w.from <= prev.to) prev.to = Math.max(prev.to, w.to);
      else merged.push({ ...w });
    }
    let end = 0;
    const chunks = [];
    for (const w of merged) {
      if (w.from > end) chunks.push(`\n%% ……（省略 ${w.from - end} 字符）……\n`);
      chunks.push(st.sliceDoc(w.from, w.to));
      end = w.to;
    }
    if (end < st.doc.length) chunks.push(`\n%% ……（其后省略 ${st.doc.length - end} 字符）……`);
    return { fullText: chunks.join(''), truncated: true };
  }

  const handlers = {
    // 桥和编辑器是否就绪
    status() {
      const v = findView();
      return { ok: true, ready: !!v, error: v ? '' : NO_EDITOR, docLen: v ? v.state.doc.length : 0, fileName: currentFileName(), projectName: projectName() };
    },

    // 轻量读当前选区（拖选过程中会频繁调，只带 200 字预览）
    get_selection() {
      const v = findView();
      if (!v) return { ok: false, error: NO_EDITOR };
      return readSelection(v);
    },

    // 一次读出位置、原文和文件名，避免两次 RPC 之间选区或文件发生切换。
    get_target() {
      const v = findView();
      if (!v) return { ok: false, error: NO_EDITOR };
      return readSelection(v, true);
    },

    // 读一段完整文本（点浮标时把选中内容整段取回）
    get_range({ from, to }) {
      const v = findView();
      if (!v) return { ok: false, error: '找不到编辑器' };
      const len = v.state.doc.length;
      if (!(from >= 0 && to <= len && from < to)) return { ok: false, error: '选区已失效' };
      return { ok: true, from, to, text: v.state.sliceDoc(from, to) };
    },

    // 追加前重新校准旧选段；同一位置去重，不合并跨越空隙的片段。
    merge_targets({ existing = [], incoming = [], fileName }) {
      const v = findView();
      if (!v) return { ok: false, error: NO_EDITOR };
      const old = existing.length ? resolveRanges(v, existing, fileName) : [];
      const added = resolveRanges(v, incoming, fileName);
      const combined = [...old];
      for (const r of added) {
        if (!combined.some((x) => x.from === r.from && x.to === r.to)) combined.push(r);
      }
      const ranges = resolveRanges(v, combined, fileName);
      return { ok: true, ranges, fileName: currentFileName(), docChars: v.state.doc.length };
    },

    // 全文或各选段周边上下文；每一段都独立校准，保持原始文档顺序。
    get_context({ from, to, oldText, ranges, fileName, cap = 110000, headKeep = 4000 }) {
      const v = findView();
      if (!v) return { ok: false, error: NO_EDITOR };
      const found = resolveRanges(v, ranges || [{ from, to, oldText }], fileName);
      return {
        ok: true, ...found[0], ranges: found,
        ...contextFor(v, found, cap, headKeep),
        docChars: v.state.doc.length, docLines: v.state.doc.lines,
        fileName: currentFileName(), projectName: projectName(),
      };
    },

    // 先校验所有段，再用一个编辑事务提交；任一段失效时整组都不写入。
    apply_edits({ edits, fileName }) {
      const v = findView();
      if (!v) return { ok: false, error: NO_EDITOR };
      const found = resolveRanges(v, edits, fileName);
      if (found.some((r) => typeof r.newText !== 'string')) return { ok: false, error: '替换内容不完整。' };
      const changes = found.map((r) => ({ from: r.from, to: r.to, insert: r.newText }));
      const shift = found.slice(0, -1).reduce((n, r) => n + r.newText.length - (r.to - r.from), 0);
      const last = found.at(-1);
      v.dispatch({ changes, selection: { anchor: last.from + shift + last.newText.length }, scrollIntoView: true, userEvent: 'input' });
      try { v.focus(); } catch {}
      return { ok: true, count: found.length };
    },

    // 读全文（问答模式没选中时用），超过 cap 截断
    get_doc({ cap = 120000 } = {}) {
      const v = findView();
      if (!v) return { ok: false, error: '找不到编辑器' };
      const st = v.state;
      const docLen = st.doc.length;
      const truncated = docLen > cap;
      return {
        ok: true,
        text: truncated ? st.sliceDoc(0, cap) : st.doc.toString(),
        docChars: docLen,
        truncated,
        fileName: currentFileName(),
        projectName: projectName(),
      };
    },

    // 应用替换：先按 oldText 精确校验/重定位，再 dispatch。走正常事务 → 进撤销历史，Cmd+Z 可撤。
    apply_edit({ from, to, oldText, newText }) {
      const v = findView();
      if (!v) return { ok: false, error: '找不到编辑器' };
      if (typeof newText !== 'string') return { ok: false, error: '没有可应用的内容' };
      const loc = locate(v.state, from, to, oldText);
      if (!loc) return { ok: false, error: '原选中内容在文档里已被改动，找不到可替换的位置。请重新选中后再试。' };
      v.dispatch({
        changes: { from: loc.from, to: loc.to, insert: newText },
        // 光标收拢到替换内容末尾，不整段选中（用户反馈：改完一直高亮着很碍事）
        selection: { anchor: loc.from + newText.length },
        scrollIntoView: true,
        userEvent: 'input',
      });
      try { v.focus(); } catch {}
      return { ok: true, from: loc.from, to: loc.from + newText.length };
    },

    // 取消编辑器里的选中（光标收拢到 pos）：目标捕获后调用，选区高亮没必要一直留着
    collapse({ pos }) {
      const v = findView();
      if (!v) return { ok: false, error: '找不到编辑器' };
      const p = Math.max(0, Math.min(v.state.doc.length, pos | 0));
      v.dispatch({ selection: { anchor: p }, userEvent: 'select' });
      return { ok: true };
    },

    // 在编辑器里选中并滚动到目标片段（面板上点「定位」）
    reveal({ from, to, oldText, fileName }) {
      const v = findView();
      if (!v) return { ok: false, error: '找不到编辑器' };
      const loc = resolveRanges(v, [{ from, to, oldText }], fileName)[0];
      v.dispatch({ selection: { anchor: loc.from, head: loc.to }, scrollIntoView: true, userEvent: 'select' });
      try { v.focus(); } catch {}
      return { ok: true, from: loc.from, to: loc.to };
    },

    // 在光标处插入（没选中时让 AI 生成片段后插入用；预留）
    insert_at_cursor({ text }) {
      const v = findView();
      if (!v) return { ok: false, error: '找不到编辑器' };
      if (typeof text !== 'string' || !text) return { ok: false, error: '没有可插入的内容' };
      const pos = v.state.selection.main.head;
      v.dispatch({
        changes: { from: pos, to: pos, insert: text },
        selection: { anchor: pos, head: pos + text.length },
        scrollIntoView: true,
        userEvent: 'input',
      });
      try { v.focus(); } catch {}
      return { ok: true, from: pos, to: pos + text.length };
    },
  };

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.ns !== NS || d.dir !== 'req' || !d.op) return;
    let resp;
    try {
      const h = handlers[d.op];
      resp = h ? h(d.args || {}) : { ok: false, error: `未知操作 ${d.op}` };
    } catch (err) {
      resp = { ok: false, error: String((err && err.message) || err) };
    }
    try { window.postMessage({ ns: NS, dir: 'resp', id: d.id, resp }, '*'); } catch {}
  });
})();
