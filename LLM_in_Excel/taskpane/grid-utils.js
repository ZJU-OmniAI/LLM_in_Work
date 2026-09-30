// 单元格区域工具（浏览器里挂 window.GridUtils，node 里 module.exports，tools/test-grid.js 单测用）：
//   A1 地址换算；带坐标的 Markdown 表格（第一行是列字母、每行第一格是行号），发给模型和解析模型回复共用；
//   单元格的「表示法」：公式原样、会被 Excel 误识别的文本前加 '、首尾有空格的内容加双引号；
//   比较新旧内容、规划要写入的单元格，以及写入前的整理（数字单元格去掉货币符号和千位逗号）。
// Excel 写入字符串等同于手动输入（实测 Mac 16.109）：00123 → 数字 123，15% → 0.15，2026-10-01 → 日期，
// 1/2 → 日期，'00123 → 文本 00123，¥1,300 → 文本；写进文本格式（@）的单元格保持文本。
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GridUtils = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const MAX_ROWS = 1048576, MAX_COLS = 16384;

  function colName(n) {
    let s = '';
    for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s;
    return s;
  }
  function colNumber(s) {
    let n = 0;
    for (const ch of String(s).toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n;
  }
  // 'Sheet1!B2:D5' / 'B2' / "'My Sheet'!A1:B2" / 'G:G' / '2:4' → { sheet, r1, c1, r2, c2 }（1 起算）
  function parseAddress(addr) {
    let sheet = null, ref = String(addr || '').trim();
    const bang = ref.lastIndexOf('!');
    if (bang >= 0) {
      sheet = ref.slice(0, bang).replace(/^'(.*)'$/, '$1').replace(/''/g, "'");
      ref = ref.slice(bang + 1);
    }
    ref = ref.replace(/\$/g, '');
    let m = ref.match(/^([A-Z]{1,3})(\d+)(?::([A-Z]{1,3})(\d+))?$/i);
    if (m) {
      const c1 = colNumber(m[1]), r1 = Number(m[2]);
      const c2 = m[3] ? colNumber(m[3]) : c1, r2 = m[4] ? Number(m[4]) : r1;
      return { sheet, r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2) };
    }
    if ((m = ref.match(/^([A-Z]{1,3}):([A-Z]{1,3})$/i))) {
      const a = colNumber(m[1]), b = colNumber(m[2]);
      return { sheet, r1: 1, c1: Math.min(a, b), r2: MAX_ROWS, c2: Math.max(a, b) };
    }
    if ((m = ref.match(/^(\d+):(\d+)$/))) {
      const a = Number(m[1]), b = Number(m[2]);
      return { sheet, r1: Math.min(a, b), c1: 1, r2: Math.max(a, b), c2: MAX_COLS };
    }
    return null;
  }
  function cellAddress(r, c) { return colName(c) + r; }
  function rangeAddress(r1, c1, r2, c2) {
    const a = cellAddress(r1, c1);
    return r1 === r2 && c1 === c2 ? a : a + ':' + cellAddress(r2, c2);
  }
  function quoteSheet(name) {
    return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) ? name : "'" + String(name).replace(/'/g, "''") + "'";
  }
  function overlaps(a, b) {
    return a.r1 <= b.r2 && b.r1 <= a.r2 && a.c1 <= b.c2 && b.c1 <= a.c2;
  }

  // ---------- 单元格的表示法 ----------
  // 手动输入时会被 Excel 识别成数字、百分比、日期、逻辑值或公式的文本
  const TYPED_RE = /^\s*[-+]?(?:\d[\d,]*(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?\s*%?\s*$|^\s*\d{1,4}\s*[-/.]\s*\d{1,2}(?:\s*[-/.]\s*\d{1,4})?\s*$|^\s*(?:TRUE|FALSE)\s*$|^[=+\-@]/i;
  function looksTyped(s) { return TYPED_RE.test(String(s)); }

  // 目标单元格发给模型的样子。formula/text/type/value 来自 range.formulas/text/valueTypes/values。
  function cellRepr(formula, text, type, value) {
    if (typeof formula === 'string' && formula.startsWith('=')) return formula;
    let s = text == null ? '' : String(text);
    if (type === 'Double' && /^#+$/.test(s)) s = String(value); // 列太窄显示成 ####：退回原始数值
    if (type === 'String' && s && looksTyped(s)) s = "'" + s;
    if (/^\s|\s$/.test(s)) s = '"' + s + '"';
    return s;
  }
  // 上下文里的样子：公式同时给出当前结果，便于模型理解（不会被解析回写）
  function contextRepr(formula, text, type, value) {
    const base = cellRepr(formula, text, type, value);
    return typeof formula === 'string' && formula.startsWith('=') ? `${base} → ${text == null ? '' : text}` : base;
  }

  function escapeCell(s) { return String(s).replace(/\|/g, '\\|').replace(/\r\n?|\n/g, '<br>'); }
  function unescapeCell(s) { return String(s).replace(/<br\s*\/?>/gi, '\n').replace(/\\\|/g, '|'); }
  // "  abc " 形式（双引号里首尾有空格）还原成带空格的原文；其他内容原样
  function unquote(s) {
    const m = String(s).match(/^"([\s\S]*)"$/);
    return m && /^\s|\s$/.test(m[1]) ? m[1] : String(s);
  }

  // 带坐标的 Markdown 表格。grid 是二维字符串（已是表示法）；rowNumbers/colNumbers 可选（默认连续）
  function toGridMarkdown(grid, r1, c1, rowNumbers, colNumbers) {
    const cols = colNumbers || Array.from({ length: grid[0] ? grid[0].length : 0 }, (_, j) => c1 + j);
    const rows = rowNumbers || grid.map((_, i) => r1 + i);
    const lines = ['|   | ' + cols.map(colName).join(' | ') + ' |', '| --- |' + ' --- |'.repeat(cols.length)];
    grid.forEach((row, i) => lines.push(`| ${rows[i]} | ` + row.map(escapeCell).join(' | ') + ' |'));
    return lines.join('\n');
  }

  function splitRow(line) {
    const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
    const cells = [];
    let cur = '';
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i];
      if (ch === '\\' && inner[i + 1] === '|') { cur += '\\|'; i++; }
      else if (ch === '|') { cells.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  }

  // 解析模型回复里的表格 → { ok, cells: Map(地址 → 内容), mode }。
  // 带坐标（第一行列字母、每行第一格行号）时可以只给部分行和列；没坐标时只有大小和目标区域完全一致才按位置对应。
  // 行比表头短时，缺的单元格视为「没给出」（保持原样），写成空格才表示清空。
  function parseGridMarkdown(md, target) {
    const lines = String(md || '').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('|') && l.length > 1);
    const rows = lines.map(splitRow).filter((r) => !(r.length && r.every((c) => /^:?-{2,}:?$/.test(c))));
    if (!rows.length) return { ok: false, error: '回复里没有 Markdown 表格' };
    const head = rows[0];
    const coordHead = head.length >= 2 && head[0].replace(/[#\s]/g, '') === '' && head.slice(1).every((c) => /^[A-Z]{1,3}$/i.test(c));
    const body = rows.slice(1);
    const cells = new Map();
    if (coordHead && body.length && body.every((r) => /^\d+$/.test(r[0]))) {
      const colNums = head.slice(1).map(colNumber);
      for (const r of body) {
        const rowNum = Number(r[0]);
        colNums.forEach((c, j) => { if (j + 1 < r.length) cells.set(cellAddress(rowNum, c), unquote(unescapeCell(r[j + 1]))); });
      }
      return { ok: true, cells, mode: 'coords' };
    }
    if (target) {
      const tRows = target.r2 - target.r1 + 1, tCols = target.c2 - target.c1 + 1;
      if (rows.length === tRows && rows.every((r) => r.length === tCols)) {
        rows.forEach((r, i) => r.forEach((v, j) => cells.set(cellAddress(target.r1 + i, target.c1 + j), unquote(unescapeCell(v)))));
        return { ok: true, cells, mode: 'positional' };
      }
    }
    return { ok: false, error: '回复里的表格没有行号和列字母，大小也和目标区域对不上，无法对应到单元格' };
  }

  // 两个表示是否代表同一个值：数字忽略千位逗号、货币符号和格式差异（1,200.00 与 1200），百分比折算。
  function numberOf(s) {
    const t = String(s).trim().replace(/^'/, '');
    const m = t.replace(/[\s,]/g, '').match(/^([-+]?)[¥￥$€£]?([-+]?)(\d+(?:\.\d+)?|\.\d+)(%?)$/);
    if (!m) return null;
    const v = Number((m[1] || m[2]) + m[3]);
    return m[4] ? v / 100 : v;
  }
  function sameValue(a, b) {
    if (a === b) return true;
    if (String(a).startsWith("'") || String(b).startsWith("'") || String(a).startsWith('=') || String(b).startsWith('=')) return false;
    const x = numberOf(a), y = numberOf(b);
    return x != null && y != null && Math.abs(x - y) < 1e-9 * Math.max(1, Math.abs(x));
  }

  // 去掉 ' 后会丢信息的文本：前导零的编号、超过 15 位的数字串（精度丢失）、像日期的文字
  function lossyWithoutMarker(s) {
    const t = String(s).trim();
    return /^[-+]?0\d/.test(t) || t.replace(/\D/g, '').length > 15 || /^\d{1,4}\s*[-/.]\s*\d{1,2}(?:\s*[-/.]\s*\d{1,4})?$/.test(t);
  }
  // 模型给出的新内容和旧内容算不算「没改」：
  //   值相同（含 1,200.00 与 1200 这类格式差异）；只是漏写了 ' 而去掉 ' 会丢信息（如 '00123 → 00123）；
  //   公式单元格被写成了它当前的计算结果（模型照抄了结果，不能因此把公式换成常数）。
  function unchanged(old, value, oldText) {
    if (sameValue(old, value)) return true;
    if (String(old) === "'" + value && lossyWithoutMarker(value)) return true;
    if (String(old).startsWith('=') && oldText != null && oldText !== '' && sameValue(String(oldText), value)) return true;
    return false;
  }

  // 规划写入：target = { r1, c1, r2, c2 }，grid = 目标区域当前的表示（二维），texts = 当前显示文字（二维，可选），
  // cells = 模型给出的单元格。返回 inside（目标内有变化的）、outside（目标外、模型要写的非空单元格，
  // 写之前还要确认那里是空的）。
  function planChanges(target, grid, cells, texts) {
    const inside = [], outside = [];
    for (const [addr, value] of cells) {
      const p = parseAddress(addr);
      if (!p) continue;
      if (p.r1 >= target.r1 && p.r1 <= target.r2 && p.c1 >= target.c1 && p.c1 <= target.c2) {
        const i = p.r1 - target.r1, j = p.c1 - target.c1;
        const old = grid[i][j];
        if (!unchanged(old, value, texts && texts[i] ? texts[i][j] : null)) inside.push({ addr, r: p.r1, c: p.c1, old, value });
      } else if (String(value).trim() !== '') {
        outside.push({ addr, r: p.r1, c: p.c1, old: '', value });
      }
    }
    const order = (a, b) => a.r - b.r || a.c - b.c;
    return { inside: inside.sort(order), outside: outside.sort(order) };
  }

  // 写入前的整理：原来是数字的单元格，去掉货币符号、千位逗号和空格（否则 ¥1,300 会变成文本）
  function toExcelInput(value, oldType) {
    const v = String(value);
    if (v.startsWith('=') || v.startsWith("'")) return v;
    if (oldType === 'Double') {
      let plain = v.trim().replace(/^([-+]?)\s*[¥￥$€£]\s*/, '$1');
      for (let prev = ''; prev !== plain;) { prev = plain; plain = plain.replace(/(\d),(\d{3})(?!\d)/, '$1$2'); }
      if (/^[-+]?(\d+(\.\d+)?|\.\d+)%?$/.test(plain)) return plain;
    }
    return v;
  }
  // 撤销时写回的内容：公式原样；文本若会被误识别就加 '；数字、逻辑值用原始值（不是字符串）
  function restoreInput(formula, type) {
    if (type === 'Empty') return '';
    if (typeof formula === 'string' && formula.startsWith('=')) return formula;
    if (type === 'String') return looksTyped(formula) ? "'" + formula : String(formula);
    return formula;
  }

  return {
    colName, colNumber, parseAddress, cellAddress, rangeAddress, quoteSheet, overlaps,
    looksTyped, cellRepr, contextRepr, escapeCell, unescapeCell, unquote, toGridMarkdown, parseGridMarkdown,
    numberOf, sameValue, lossyWithoutMarker, unchanged, planChanges, toExcelInput, restoreInput, MAX_ROWS, MAX_COLS,
  };
});
