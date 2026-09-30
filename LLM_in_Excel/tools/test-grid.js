// Pure grid helpers: addresses, the coordinate table protocol, cell representation and write planning.
import test from 'node:test';
import assert from 'node:assert/strict';

await import('../taskpane/grid-utils.js');
const G = globalThis.GridUtils;
const plain = (x) => JSON.parse(JSON.stringify(x));

test('column letters and addresses', () => {
  assert.deepEqual([1, 26, 27, 52, 703, 16384].map(G.colName), ['A', 'Z', 'AA', 'AZ', 'AAA', 'XFD']);
  for (let n = 1; n < 2000; n += 37) assert.equal(G.colNumber(G.colName(n)), n);
  assert.deepEqual(plain(G.parseAddress("'Q3 Sales'!$B$2:D5")), { sheet: 'Q3 Sales', r1: 2, c1: 2, r2: 5, c2: 4 });
  assert.deepEqual(plain(G.parseAddress('D5:B2')), { sheet: null, r1: 2, c1: 2, r2: 5, c2: 4 }, 'reversed corners are normalized');
  assert.equal(G.parseAddress('Orders!G:G').r2, G.MAX_ROWS);
  assert.equal(G.parseAddress('2:3').c2, G.MAX_COLS);
  assert.equal(G.parseAddress('not an address'), null);
  assert.equal(G.rangeAddress(2, 4, 7, 4), 'D2:D7');
  assert.equal(G.rangeAddress(3, 3, 3, 3), 'C3');
  assert.equal(G.quoteSheet('Orders'), 'Orders');
  assert.equal(G.quoteSheet("Bob's Q3"), "'Bob''s Q3'");
  assert.ok(G.overlaps({ r1: 1, c1: 1, r2: 3, c2: 3 }, { r1: 3, c1: 3, r2: 5, c2: 5 }));
  assert.ok(!G.overlaps({ r1: 1, c1: 1, r2: 3, c2: 3 }, { r1: 4, c1: 1, r2: 5, c2: 3 }));
});

test('cells are shown the way Excel would need them typed back', () => {
  assert.equal(G.cellRepr('00123', '00123', 'String'), "'00123", 'text that would become a number keeps a leading apostrophe');
  assert.equal(G.cellRepr('2026-07-03', '2026-07-03', 'String'), "'2026-07-03");
  assert.equal(G.cellRepr('North', 'North', 'String'), 'North');
  assert.equal(G.cellRepr(1200, '1,200.00', 'Double', 1200), '1,200.00', 'numbers use their displayed format');
  assert.equal(G.cellRepr(1234567, '#####', 'Double', 1234567), '1234567', 'a column too narrow falls back to the value');
  assert.equal(G.cellRepr('=SUM(D2:D7)', '9,840.50', 'Double', 9840.5), '=SUM(D2:D7)');
  assert.equal(G.contextRepr('=SUM(D2:D7)', '9,840.50', 'Double', 9840.5), '=SUM(D2:D7) → 9,840.50');
  assert.equal(G.cellRepr('acme corp ', 'acme corp ', 'String'), '"acme corp "', 'edge spaces are made visible');
  assert.equal(G.cellRepr('', '', 'Empty'), '');
  assert.equal(G.cellRepr('-inc', '-inc', 'String'), "'-inc", 'text Excel would read as a formula');
});

test('the coordinate table survives a round trip, including pipes, line breaks and edge spaces', () => {
  const grid = [['a|b', 'line 1\nline 2'], ['" padded "', '']];
  const md = G.toGridMarkdown(grid, 4, 3);
  assert.equal(md.split('\n')[0], '|   | C | D |');
  const r = G.parseGridMarkdown(md);
  assert.equal(r.ok, true);
  assert.equal(r.mode, 'coords');
  assert.deepEqual(plain([...r.cells]), [['C4', 'a|b'], ['D4', 'line 1\nline 2'], ['C5', ' padded '], ['D5', '']]);
});

test('replies may list only the rows and columns that change', () => {
  const r = G.parseGridMarkdown('Here you go:\n| | H |\n|---|---|\n| 3 | Product |\n| 7 | Support |\n');
  assert.deepEqual(plain([...r.cells]), [['H3', 'Product'], ['H7', 'Support']]);
  const short = G.parseGridMarkdown('|   | B | C |\n| --- | --- | --- |\n| 2 | x |');
  assert.deepEqual(plain([...short.cells]), [['B2', 'x']], 'cells missing at the end of a row are left alone');
});

test('tables without coordinates are accepted only when the size matches the target exactly', () => {
  const target = { r1: 2, c1: 8, r2: 3, c2: 8 };
  const ok = G.parseGridMarkdown('| Product |\n| --- |\n| Billing |', target);
  assert.equal(ok.mode, 'positional');
  assert.deepEqual(plain([...ok.cells]), [['H2', 'Product'], ['H3', 'Billing']]);
  const bad = G.parseGridMarkdown('| Category |\n| --- |\n| Product |\n| Billing |', target);
  assert.equal(bad.ok, false);
  assert.equal(G.parseGridMarkdown('no table here', target).ok, false);
});

test('numbers compare by value, not by formatting', () => {
  assert.ok(G.sameValue('1,200.00', '1200'));
  assert.ok(G.sameValue('12%', '0.12'));
  assert.ok(G.sameValue('¥1,300', '1300'));
  assert.ok(!G.sameValue('1,200.00', '1300'));
  assert.ok(!G.sameValue("'00123", '123'));
  assert.equal(G.numberOf('-5%'), -0.05);
});

test('changes are planned cell by cell with safety rules', () => {
  const target = { r1: 2, c1: 1, r2: 3, c2: 4 };
  const grid = [["'00123", '"acme corp "', '1,200.00', '=SUM(C2:C3)'], ["'00124", 'Globex', '860.50', '']];
  const texts = [['00123', 'acme corp ', '1,200.00', '2,060.50'], ['00124', 'Globex', '860.50', '']];
  const cells = new Map([
    ['A2', '00123'],          // apostrophe dropped by mistake: keep the ID as text, do not write
    ['B2', 'Acme Corp'],      // real change
    ['C2', '1200'],           // same number: skip
    ['D2', '2,060.50'],       // the formula's result copied back: keep the formula
    ['A3', "'00124"],         // unchanged
    ['D3', '=C3*2'],          // new formula in an empty cell
    ['E3', 'note'],           // outside the target (must be empty when applying)
    ['E4', ''],               // outside and empty: nothing to do
  ]);
  const plan = G.planChanges(target, grid, cells, texts);
  assert.deepEqual(plain(plan.inside.map((c) => [c.addr, c.value])), [['B2', 'Acme Corp'], ['D3', '=C3*2']]);
  assert.deepEqual(plain(plan.outside.map((c) => c.addr)), ['E3']);
  const conv = G.planChanges({ r1: 1, c1: 1, r2: 1, c2: 1 }, [["'123"]], new Map([['A1', '123']]));
  assert.equal(conv.inside.length, 1, 'dropping the apostrophe from a short number is a deliberate conversion');
});

test('values are prepared for typing: numbers stay numbers, text stays text', () => {
  assert.equal(G.toExcelInput('¥1,300', 'Double'), '1300');
  assert.equal(G.toExcelInput('$ 1,234,567.50', 'Double'), '1234567.50');
  assert.equal(G.toExcelInput('-¥2,000', 'Double'), '-2000');
  assert.equal(G.toExcelInput('15%', 'Double'), '15%');
  assert.equal(G.toExcelInput('about 1,300', 'Double'), 'about 1,300', 'words are not stripped');
  assert.equal(G.toExcelInput("'00124", 'String'), "'00124");
  assert.equal(G.toExcelInput('=SUM(A1:A3)', 'Double'), '=SUM(A1:A3)');
  assert.equal(G.restoreInput('00123', 'String'), "'00123");
  assert.equal(G.restoreInput(1200, 'Double'), 1200);
  assert.equal(G.restoreInput(true, 'Boolean'), true);
  assert.equal(G.restoreInput('', 'Empty'), '');
  assert.equal(G.restoreInput('=SUM(D2:D7)', 'Double'), '=SUM(D2:D7)');
});
