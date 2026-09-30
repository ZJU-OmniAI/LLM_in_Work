// A small in-memory stand-in for the parts of the Excel JavaScript API that the pane uses.
// Writing a string through range.formulas / range.values behaves like typing it (observed in Excel 16.109 for Mac):
//   "00123" → number 123; "'00123" → text "00123"; "15%" → 0.15 (General becomes 0%); "2026-10-01" → date
//   (General becomes m/d/yy); "1,234.5" → 1234.5 (General becomes #,##0.00); "¥1,300" → text; text-formatted (@)
//   cells keep text; lowercase function names are upper-cased; unknown functions give #NAME?.
// Writes apply immediately (the real API queues them until sync, in the same order).
await import('../../taskpane/grid-utils.js'); // UMD: attaches globalThis.GridUtils
const G = globalThis.GridUtils;

const nullObject = () => ({ isNullObject: true, load() { return this; } });
const DAY = 86400000, EPOCH = Date.UTC(1899, 11, 30);
const toSerial = (y, m, d) => Math.round((Date.UTC(y, m - 1, d) - EPOCH) / DAY);
const fromSerial = (n) => { const d = new Date(EPOCH + n * DAY); return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()]; };
const pad = (n) => String(n).padStart(2, '0');
const withCommas = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const KNOWN_FUNCS = ['SUM', 'AVERAGE', 'COUNT', 'MAX', 'MIN', 'IF', 'ROUND', 'VLOOKUP', 'XLOOKUP', 'TEXT', 'IFERROR', 'SUMIF', 'COUNTIF', 'LEFT', 'RIGHT', 'LEN', 'UPPER', 'PROPER', 'TRIM'];

function display(cell) {
  if (!cell || cell.type === 'Empty') return '';
  if (cell.type === 'Error') return cell.value;
  if (cell.type === 'Boolean') return cell.value ? 'TRUE' : 'FALSE';
  if (cell.type === 'String') return cell.value;
  const v = cell.value, nf = cell.nf || 'General';
  if (nf === '#,##0.00') return (v < 0 ? '-' : '') + withCommas(Math.abs(v).toFixed(2));
  if (nf === '#,##0') return (v < 0 ? '-' : '') + withCommas(String(Math.round(Math.abs(v))));
  if (nf === '"¥"#,##0') return '¥' + withCommas(String(Math.round(v)));
  if (nf === '0%') return Math.round(v * 100) + '%';
  if (nf === 'yyyy-mm-dd') { const [y, m, d] = fromSerial(v); return `${y}-${pad(m)}-${pad(d)}`; }
  if (nf === 'm/d/yy') { const [y, m, d] = fromSerial(v); return `${y}/${m}/${d}`; }
  return String(v);
}

export function createFakeExcel(bookSpec, { apiVersion = '1.20' } = {}) {
  const log = [];
  const book = {
    sheets: bookSpec.sheets.map((s, i) => ({ id: `{sheet-${i + 1}}`, name: s.name, visibility: s.hidden ? 'Hidden' : 'Visible', cells: new Map(), merged: (s.merged || []).map((a) => G.parseAddress(a)) })),
    active: 0,
    selection: null,
  };
  const key = (r, c) => `${r},${c}`;
  const getCell = (sheet, r, c) => sheet.cells.get(key(r, c)) || { type: 'Empty', value: '', formula: null, nf: 'General' };
  const putCell = (sheet, r, c, cell) => sheet.cells.set(key(r, c), cell);

  function evaluate(sheet, formula) {
    const m = formula.match(/^=([A-Z]+)\((.*)\)$/);
    if (!m) return { type: 'Double', value: 0 };
    if (!KNOWN_FUNCS.includes(m[1])) return { type: 'Error', value: '#NAME?' };
    const ref = G.parseAddress(m[2]);
    if (!ref || !['SUM', 'AVERAGE', 'COUNT', 'MAX', 'MIN'].includes(m[1])) return { type: 'Double', value: 0 };
    const nums = [];
    for (let r = ref.r1; r <= ref.r2; r++) for (let c = ref.c1; c <= ref.c2; c++) { const x = getCell(sheet, r, c); if (x.type === 'Double') nums.push(x.value); }
    const sum = nums.reduce((a, b) => a + b, 0);
    const value = { SUM: sum, AVERAGE: nums.length ? sum / nums.length : 0, COUNT: nums.length, MAX: Math.max(...nums), MIN: Math.min(...nums) }[m[1]];
    return { type: 'Double', value };
  }
  function recalc(sheet) {
    for (const cell of sheet.cells.values()) if (cell.formula) Object.assign(cell, evaluate(sheet, cell.formula));
  }
  // typing semantics (see header)
  function typeIn(sheet, r, c, input) {
    const cell = { ...getCell(sheet, r, c) };
    cell.formula = null;
    if (typeof input === 'number') Object.assign(cell, { type: 'Double', value: input });
    else if (typeof input === 'boolean') Object.assign(cell, { type: 'Boolean', value: input });
    else {
      const s = String(input == null ? '' : input);
      const plain = s.replace(/,/g, '');
      let m;
      if (s === '') Object.assign(cell, { type: 'Empty', value: '' });
      else if (s.startsWith('=')) {
        cell.formula = '=' + s.slice(1).replace(/[a-z]+(?=\()/g, (f) => f.toUpperCase()).replace(/\b([a-z]{1,3})(\d+)\b/g, (_, col, row) => col.toUpperCase() + row);
      } else if (s.startsWith("'")) Object.assign(cell, { type: 'String', value: s.slice(1) });
      else if (cell.nf === '@') Object.assign(cell, { type: 'String', value: s });
      else if (/^[-+]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/.test(s.trim())) {
        Object.assign(cell, { type: 'Double', value: Number(plain) });
        if (/,/.test(s) && cell.nf === 'General') cell.nf = '#,##0.00';
      } else if ((m = s.trim().match(/^([-+]?\d+(\.\d+)?)%$/))) {
        Object.assign(cell, { type: 'Double', value: Number(m[1]) / 100 });
        if (cell.nf === 'General') cell.nf = '0%';
      } else if ((m = s.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/))) {
        Object.assign(cell, { type: 'Double', value: toSerial(+m[1], +m[2], +m[3]) });
        if (cell.nf === 'General') cell.nf = 'm/d/yy';
      } else if (/^(TRUE|FALSE)$/i.test(s.trim())) Object.assign(cell, { type: 'Boolean', value: /^TRUE$/i.test(s.trim()) });
      else Object.assign(cell, { type: 'String', value: s });
    }
    putCell(sheet, r, c, cell);
    log.push({ op: 'write', sheet: sheet.name, addr: G.cellAddress(r, c), input });
    recalc(sheet);
  }

  function usedRect(sheet) {
    let r1 = Infinity, c1 = Infinity, r2 = 0, c2 = 0;
    for (const [k, cell] of sheet.cells) {
      if (cell.type === 'Empty' && !cell.formula) continue;
      const [r, c] = k.split(',').map(Number);
      r1 = Math.min(r1, r); c1 = Math.min(c1, c); r2 = Math.max(r2, r); c2 = Math.max(c2, c);
    }
    return r2 ? { r1, c1, r2, c2 } : null;
  }

  function rangeApi(sheet, rect) {
    const rows = () => Array.from({ length: rect.r2 - rect.r1 + 1 }, (_, i) => rect.r1 + i);
    const cols = () => Array.from({ length: rect.c2 - rect.c1 + 1 }, (_, j) => rect.c1 + j);
    const matrix = (f) => rows().map((r) => cols().map((c) => f(getCell(sheet, r, c))));
    const setMatrix = (m, fn) => rows().forEach((r, i) => cols().forEach((c, j) => fn(r, c, m[i][j])));
    return {
      isNullObject: false,
      get address() { return `${G.quoteSheet(sheet.name)}!${G.rangeAddress(rect.r1, rect.c1, rect.r2, rect.c2)}`; },
      get rowIndex() { return rect.r1 - 1; }, get columnIndex() { return rect.c1 - 1; },
      get rowCount() { return rect.r2 - rect.r1 + 1; }, get columnCount() { return rect.c2 - rect.c1 + 1; },
      get cellCount() { return (rect.r2 - rect.r1 + 1) * (rect.c2 - rect.c1 + 1); },
      get values() { return matrix((x) => (x.type === 'Empty' ? '' : x.value)); },
      get text() { return matrix(display); },
      get valueTypes() { return matrix((x) => x.type); },
      get numberFormat() { return matrix((x) => x.nf || 'General'); },
      get formulas() { return matrix((x) => (x.formula ? x.formula : x.type === 'Empty' ? '' : x.value)); },
      set formulas(m) { setMatrix(m, (r, c, v) => typeIn(sheet, r, c, v)); },
      set values(m) { setMatrix(m, (r, c, v) => typeIn(sheet, r, c, v)); },
      set numberFormat(m) { setMatrix(m, (r, c, v) => { putCell(sheet, r, c, { ...getCell(sheet, r, c), nf: v }); }); log.push({ op: 'format', addr: G.rangeAddress(rect.r1, rect.c1, rect.r2, rect.c2) }); },
      get worksheet() { return sheetApi(sheet); },
      load() { return this; },
      select() { book.active = book.sheets.indexOf(sheet); book.selection = { sheet, areas: [rect] }; },
      getIntersectionOrNullObject(other) {
        const o = other.__rect;
        const r = { r1: Math.max(rect.r1, o.r1), c1: Math.max(rect.c1, o.c1), r2: Math.min(rect.r2, o.r2), c2: Math.min(rect.c2, o.c2) };
        return r.r1 <= r.r2 && r.c1 <= r.c2 ? rangeApi(sheet, r) : nullObject();
      },
      getMergedAreasOrNullObject() {
        if (Number(String(apiVersion).split('.')[1]) < 13) throw new Error('getMergedAreasOrNullObject requires ExcelApi 1.13');
        const hit = sheet.merged.filter((m) => G.overlaps(m, rect));
        return hit.length ? { isNullObject: false, areaCount: hit.length, load() { return this; } } : nullObject();
      },
      __rect: rect,
    };
  }

  function sheetApi(sheet) {
    return {
      isNullObject: false,
      get id() { return sheet.id; }, get name() { return sheet.name; }, get visibility() { return sheet.visibility; },
      load() { return this; },
      getRange(addr) { const p = G.parseAddress(addr); if (!p) throw Object.assign(new Error('InvalidArgument'), { code: 'InvalidArgument' }); return rangeApi(sheet, p); },
      getRangeByIndexes(r, c, rows, cols) { return rangeApi(sheet, { r1: r + 1, c1: c + 1, r2: r + rows, c2: c + cols }); },
      getUsedRangeOrNullObject() { const u = usedRect(sheet); return u ? rangeApi(sheet, u) : nullObject(); },
      getUsedRange() { return rangeApi(sheet, usedRect(sheet) || { r1: 1, c1: 1, r2: 1, c2: 1 }); },
      activate() { book.active = book.sheets.indexOf(sheet); },
    };
  }
  const findSheet = (k) => book.sheets.find((s) => s.id === k || s.name === k);
  const worksheets = {
    get items() { return book.sheets.map(sheetApi); },
    load() { return this; },
    getItem(k) { const s = findSheet(k); if (!s) throw Object.assign(new Error('ItemNotFound'), { code: 'ItemNotFound' }); return sheetApi(s); },
    getItemOrNullObject(k) { const s = findSheet(k); return s ? sheetApi(s) : nullObject(); },
    getActiveWorksheet() { return sheetApi(book.sheets[book.active]); },
  };
  const workbook = {
    worksheets,
    getSelectedRanges() {
      const sel = book.selection || { sheet: book.sheets[book.active], areas: [{ r1: 1, c1: 1, r2: 1, c2: 1 }] };
      const areas = sel.areas.map((a) => rangeApi(sel.sheet, a));
      return {
        get address() { return areas.map((a) => a.address).join(','); },
        get areaCount() { return areas.length; },
        get cellCount() { return areas.reduce((s, a) => s + a.cellCount, 0); },
        areas: { items: areas, load() { return this; } },
        worksheet: sheetApi(sel.sheet),
        load() { return this; },
      };
    },
  };
  bookSpec.sheets.forEach((spec, i) => {
    const sheet = book.sheets[i];
    for (const [addr, cell] of Object.entries(spec.cells || {})) {
      const p = G.parseAddress(addr);
      const nf = (cell && cell.nf) || 'General';
      putCell(sheet, p.r1, p.c1, { type: 'Empty', value: '', formula: null, nf });
      typeIn(sheet, p.r1, p.c1, cell && Object.prototype.hasOwnProperty.call(cell, 'v') ? cell.v : cell);
    }
    recalc(sheet);
  });
  log.length = 0;
  const api = {
    run: async (fn) => fn({ workbook, sync: async () => {} }),
    // --- test helpers ---
    book, log,
    sheet(name) { return book.sheets.find((s) => s.name === name); },
    cell(name, addr) { const s = api.sheet(name); const p = G.parseAddress(addr); return getCell(s, p.r1, p.c1); },
    text(name, addr) { return display(api.cell(name, addr)); },
    select(name, ...addresses) { const s = api.sheet(name); book.active = book.sheets.indexOf(s); book.selection = { sheet: s, areas: addresses.map((a) => G.parseAddress(a)) }; },
    typeIn(name, addr, input) { const s = api.sheet(name); const p = G.parseAddress(addr); typeIn(s, p.r1, p.c1, input); },
  };
  return api;
}

// The probe workbook, as cells: { addr: value | { v, nf } }
export const sampleBook = () => {
  const rows = [
    ['00123', 'acme corp ', 'north', 1200, '2026-07-03', 0.12, 'Delivery was late but the product works great'],
    ['00124', 'Globex', 'South', 860.5, '2026-07-09', -0.05, 'Invoice had the wrong address'],
    ['00125', 'initech', 'north ', 2400, '2026-08-01', 0.31, 'Love the new dashboard, very fast'],
    ['00126', 'Umbrella Co.', 'West', 530, '2026-08-17', 0.02, 'Support took three days to answer'],
    ['00127', 'hooli', 'south', 1750, '2026-09-02', 0.18, 'Please add an export to CSV'],
    ['00128', 'Stark Industries', 'West', 3100, '2026-09-21', 0.27, 'Setup was confusing at first'],
  ];
  const cells = {};
  ['Order ID', 'Customer', 'Region', 'Amount', 'Date', 'Growth', 'Feedback', 'Category'].forEach((h, j) => { cells[G.cellAddress(1, j + 1)] = h; });
  rows.forEach((row, i) => {
    const r = i + 2;
    cells[`A${r}`] = { v: row[0], nf: '@' };
    cells[`B${r}`] = row[1];
    cells[`C${r}`] = row[2];
    cells[`D${r}`] = { v: row[3], nf: '#,##0.00' };
    cells[`E${r}`] = { v: row[4], nf: 'yyyy-mm-dd' };
    cells[`F${r}`] = { v: row[5], nf: '0%' };
    cells[`G${r}`] = row[6];
  });
  cells.A8 = 'Total';
  cells.D8 = { v: '=SUM(D2:D7)', nf: '#,##0.00' };
  return {
    sheets: [
      { name: 'Orders', cells },
      { name: 'Regions', cells: { A1: 'Region', B1: 'Manager', A2: 'North', B2: 'Li Wei', A3: 'South', B3: 'Maria Garcia', A4: 'West', B4: 'Tom Baker', A6: 'Merged note' }, merged: ['A6:B6'] },
    ],
  };
};
