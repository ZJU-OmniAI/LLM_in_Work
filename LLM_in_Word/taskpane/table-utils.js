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

  // 按内容对齐新旧表格的行：完全相同的行作锚点（LCS），锚点之间数量对应的行算"修改"，
  // 多出来的算新增 / 删除。这样在表格中间插入一行只记一次新增，后面的行不会被误判为改动。
  // 返回按新表顺序排列的操作：keep / change（old→new）/ insert（new）/ delete（old）。
  function planRows(oldVals, newVals) {
    const o = oldVals || [], n = newVals || [];
    const key = (row) => JSON.stringify((row || []).map((c) => String(c ?? '')));
    const ok = o.map(key), nk = n.map(key);
    const m = o.length, k = n.length;
    const dp = Array.from({ length: m + 1 }, () => new Uint32Array(k + 1));
    for (let i = m - 1; i >= 0; i--) {
      for (let j = k - 1; j >= 0; j--) dp[i][j] = ok[i] === nk[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
    const anchors = [];
    for (let i = 0, j = 0; i < m && j < k;) {
      if (ok[i] === nk[j]) { anchors.push([i, j]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
      else j++;
    }
    const ops = [];
    let pi = 0, pj = 0;
    for (const [ai, aj] of [...anchors, [m, k]]) {
      const oldGap = ai - pi, newGap = aj - pj, pairs = Math.min(oldGap, newGap);
      for (let t = 0; t < pairs; t++) ops.push({ type: 'change', old: pi + t, new: pj + t });
      for (let t = pairs; t < oldGap; t++) ops.push({ type: 'delete', old: pi + t });
      for (let t = pairs; t < newGap; t++) ops.push({ type: 'insert', new: pj + t });
      if (ai < m) ops.push({ type: 'keep', old: ai, new: aj });
      pi = ai + 1; pj = aj + 1;
    }
    return ops;
  }

  // 新旧值矩阵的单元格级差异统计（供预览高亮与应用提示）；行按内容对齐，见 planRows。
  // changed 里是 [新表行号, 列号]；列数不同时整表重建，不做行对齐。
  function diffCells(oldVals, newVals) {
    const o = oldVals || [], n = newVals || [];
    const oRows = o.length, nRows = n.length;
    const oCols = o[0] ? o[0].length : 0, nCols = n[0] ? n[0].length : 0;
    const colsChanged = oCols !== nCols;
    const changed = [];
    let rowsAdded = 0, rowsRemoved = 0;
    if (colsChanged) {
      const lim = Math.min(oRows, nRows);
      for (let r = 0; r < lim; r++) {
        for (let c = 0; c < Math.min(oCols, nCols); c++) if (String(o[r][c] ?? '') !== String(n[r][c] ?? '')) changed.push([r, c]);
      }
      rowsAdded = Math.max(0, nRows - oRows); rowsRemoved = Math.max(0, oRows - nRows);
    } else {
      for (const op of planRows(o, n)) {
        if (op.type === 'insert') rowsAdded++;
        else if (op.type === 'delete') rowsRemoved++;
        else if (op.type === 'change') {
          for (let c = 0; c < nCols; c++) if (String(o[op.old][c] ?? '') !== String(n[op.new][c] ?? '')) changed.push([op.new, c]);
        }
      }
    }
    return { changed, rowsAdded, rowsRemoved, colsChanged, oRows, oCols, nRows, nCols };
  }

  return { toMarkdown, parseMarkdown, toHTML, planRows, diffCells };
});
