// 表格工具：Word 表格的值矩阵（string[][]）↔ Markdown 表格 ↔ HTML 互转 + 单元格级 diff。
// 浏览器里挂 window.TableUtils，node 里 module.exports（tools/test-table.js 单测用）。
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TableUtils = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  // 值矩阵 → Markdown 表格（第一行当表头，第二行 |---| 分隔线；| 转义、单元格内换行拍成空格）
  function toMarkdown(values) {
    if (!Array.isArray(values) || !values.length) return '';
    const esc = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\s*\r?\n\s*/g, ' ').trim();
    const rows = values.map((r) => '| ' + r.map(esc).join(' | ') + ' |');
    const sep = '| ' + values[0].map(() => '---').join(' | ') + ' |';
    return [rows[0], sep, ...rows.slice(1)].join('\n');
  }

  // Markdown 表格 → 值矩阵。宽容解析：忽略分隔线行、列数不齐右侧补空、\| 反转义。
  function parseMarkdown(str) {
    const lines = String(str || '').split('\n').map((l) => l.trim()).filter((l) => l);
    const rowLines = lines.filter((l) => l.startsWith('|') && l.endsWith('|') && l.length > 1);
    if (!rowLines.length) return { ok: false, error: '内容不是 Markdown 表格（每行应以 | 开头结尾）' };
    const parseRow = (l) => {
      const inner = l.slice(1, -1);
      const cells = [];
      let cur = '';
      for (let i = 0; i < inner.length; i++) {
        const ch = inner[i];
        if (ch === '\\' && inner[i + 1] === '|') { cur += '|'; i++; }
        else if (ch === '|') { cells.push(cur.trim()); cur = ''; }
        else cur += ch;
      }
      cells.push(cur.trim());
      return cells;
    };
    const isSep = (cells) => cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));
    let rows = rowLines.map(parseRow).filter((r) => !isSep(r));
    if (!rows.length) return { ok: false, error: '表格没有内容行' };
    const cols = Math.max(...rows.map((r) => r.length));
    if (!cols) return { ok: false, error: '表格没有列' };
    rows = rows.map((r) => (r.length < cols ? r.concat(Array(cols - r.length).fill('')) : r));
    return { ok: true, values: rows };
  }

  // 值矩阵 → 插入 Word 用的 HTML 表格（带边框；不猜表头样式，忠实按内容来）
  function toHTML(values) {
    const esc = (s) => String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const rows = (values || [])
      .map((r) => '<tr>' + r.map((c) => `<td style="border:1px solid #000;padding:2pt 5pt">${esc(c)}</td>`).join('') + '</tr>')
      .join('');
    return `<table style="border-collapse:collapse">${rows}</table>`;
  }

  // 新旧值矩阵的单元格级差异统计（供预览高亮与应用提示）
  function diffCells(oldVals, newVals) {
    const o = oldVals || [], n = newVals || [];
    const oRows = o.length, nRows = n.length;
    const oCols = o[0] ? o[0].length : 0, nCols = n[0] ? n[0].length : 0;
    const changed = [];
    const lim = Math.min(oRows, nRows);
    for (let r = 0; r < lim; r++) {
      for (let c = 0; c < Math.min(oCols, nCols); c++) {
        if (String(o[r][c] ?? '') !== String(n[r][c] ?? '')) changed.push([r, c]);
      }
    }
    return { changed, rowsAdded: Math.max(0, nRows - oRows), rowsRemoved: Math.max(0, oRows - nRows), colsChanged: oCols !== nCols, oRows, oCols, nRows, nCols };
  }

  return { toMarkdown, parseMarkdown, toHTML, diffCells };
});
