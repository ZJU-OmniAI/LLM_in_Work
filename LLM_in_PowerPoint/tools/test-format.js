// Format mode: the plan protocol (parse, validate, preview rows) and the whole flow in the pane against the
// PowerPoint stand-in — selected shapes only, apply writes exactly the planned properties, undo restores them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPane, tick, answer } from './pane-harness.js';

await import('../taskpane/format-utils.js');
const F = globalThis.FormatUtils;
const plain = (x) => JSON.parse(JSON.stringify(x));
const plan = (changes, note = 'Lighter border.') => note + '\n```format\n' + JSON.stringify({ changes }, null, 1) + '\n```';
// Open the pane and always close it again, even when an assertion fails (its timers would keep node running).
async function open(t, opts) {
  const p = await loadPane(opts);
  t.after(() => p.close());
  return p;
}
const rowText = (tr) => [...tr.cells].map((c) => c.textContent.trim()).join(' ');

// A slide like the one users asked about: a framed box, a title, a picture with a black border, a table.
const formatDeck = () => ({
  slides: [
    { id: '256#0', shapes: [{ id: '2', type: 'Placeholder', ph: 'CenterTitle', text: 'Cover' }] },
    { id: '257#0', shapes: [
      { id: '2', name: 'Title 1', type: 'Placeholder', ph: 'Title', top: 30, left: 40, width: 880, height: 60, text: 'Quarterly results', font: { size: 36, bold: true, color: '#262626' } },
      { id: '5', name: 'Rectangle 4', type: 'GeometricShape', top: 120, left: 40, width: 420, height: 300, fill: '#FFFFFF', line: { color: '#000000', weight: 2.25 },
        paras: [{ runs: [['Revenue ', { size: 20 }], ['+23%', { size: 28, bold: true, color: '#C00000' }]] }] },
      { id: '6', name: 'Picture 5', type: 'Image', top: 120, left: 500, width: 400, height: 300, line: { color: '#000000', weight: 1.5 } },
      { id: '7', name: 'Table 6', type: 'Table', top: 440, left: 40, width: 880, height: 80, values: [['Region', 'Q3'], ['North', '1.5M'], ['South', '0.9M']], border: { color: '#000000', weight: 1 } },
    ] },
  ],
});

test('colours, transparency and cell ranges are normalized', () => {
  assert.equal(F.normColor('#abc'), '#AABBCC');
  assert.equal(F.normColor('bfbfbf'), '#BFBFBF');
  assert.equal(F.normColor('gray'), '#808080');
  assert.equal(F.normColor('rgb(1,2,3)'), null);
  assert.equal(F.transparency(30), 0.3);
  assert.equal(F.transparency('25%'), 0.25);
  assert.equal(F.transparency(2), 0.02);
  assert.equal(F.transparency(-1), null);
  assert.deepEqual(plain(F.parseCells('header', 3, 2)), { r1: 0, c1: 0, r2: 0, c2: 1, region: 'header' });
  assert.deepEqual(plain(F.parseCells('r2c1:r3c2', 3, 2)), { r1: 1, c1: 0, r2: 2, c2: 1, region: 'r2c1:r3c2' });
  assert.equal(F.parseCells('r4c1', 3, 2), null, 'out of the table');
  assert.deepEqual(plain(F.compressRuns([20, 20, 28, 28, 28, 20])), [[0, 2, 20], [2, 3, 28], [5, 1, 20]]);
});

test('the plan is read from a ```format fence; lenient JSON, other fences and missing plans are handled', () => {
  const ok = F.parseFormatReply('Make it lighter.\n```format\n{"changes": [{"id": "5", "line": {"color": "#BFBFBF",},},]}\n```\nDone.');
  assert.equal(ok.ok, true);
  assert.deepEqual(plain(ok.changes), [{ id: '5', line: { color: '#BFBFBF' } }]);
  assert.equal(F.stripFormatFence('Make it lighter.\n```format\n{"changes": []}\n```\nDone.', F.parseFormatReply('Make it lighter.\n```format\n{"changes": []}\n```\nDone.')), 'Make it lighter.\n\nDone.');
  assert.equal(F.parseFormatReply('```json\n[{"id": "2", "align": "left"}]\n```').ok, true, 'a bare array in a json fence also works');
  assert.equal(F.parseFormatReply('I cannot add animations.').ok, false);
  assert.match(F.parseFormatReply('```format\n{changes: }\n```').error, /JSON/);
});

test('changes are validated: only shapes in scope, sensible values, supported properties', () => {
  const snap = {
    slideNo: 2, size: { w: 960, h: 540 }, canBackground: true, canRotate: true, canZOrder: true, canTableFormat: true,
    shapes: [
      { id: '2', type: 'Placeholder', role: 'title', inScope: false, text: { preview: 'T', font: {} } },
      { id: '5', type: 'GeometricShape', role: 'shape', inScope: true, text: { preview: 'Revenue', font: {} }, fill: { type: 'Solid', color: '#FFFFFF' }, line: { visible: true, color: '#000000', weight: 2.25 } },
      { id: '6', type: 'Image', role: 'shape', inScope: true, text: null },
      { id: '7', type: 'Table', role: 'table', inScope: true, table: { rows: 3, cols: 2 } },
    ],
  };
  const { changes, problems } = F.normalizeChanges([
    { id: '5', line: { color: '#bfbfbf', weight: '1pt', dash: 'dashed' }, width: 400, fill: { color: '#F2F2F2', transparency: 20 } },
    { id: '2', font: { size: 30 } },
    { id: '6', font: { size: 12 }, line: 'none', zOrder: 'back' },
    { id: '7', cells: 'header', fill: '#F2F2F2', font: { bold: true, color: '#262626' } },
    { id: '7', border: { sides: 'outer', color: '#A6A6A6', weight: 0.75 } },
    { id: '9', fill: '#000000' },
    { id: '5', x: 99999, shadow: true },
    { id: 'background', fill: '#FAFAFA' },
  ], snap);
  assert.deepEqual(plain(changes), [
    { id: '5', kind: 'shape', set: { line: { color: '#BFBFBF', weight: 1, dash: 'Dash' }, w: 400, fill: { color: '#F2F2F2', transparency: 0.2 } } },
    { id: '6', kind: 'shape', set: { line: { visible: false }, zOrder: 'SendToBack' } },
    { id: '7', kind: 'cells', range: { r1: 0, c1: 0, r2: 0, c2: 1, region: 'header' }, set: { fill: { color: '#F2F2F2' }, font: { bold: true, color: '#262626' } } },
    { id: '7', kind: 'cells', range: { r1: 0, c1: 0, r2: 2, c2: 1, region: 'all' }, set: { border: { color: '#A6A6A6', weight: 0.75, sides: 'outer' } } },
    { id: 'background', kind: 'background', set: { fill: { color: '#FAFAFA' } } },
  ]);
  const texts = problems.map((p) => `${p.id}: ${p.text}`);
  assert.ok(texts.some((t) => t.startsWith('2: ') && /不在修改范围/.test(t)), 'unselected shapes are not touched');
  assert.ok(texts.some((t) => t.startsWith('6: ') && /没有文字/.test(t)), 'a picture has no text to format');
  assert.ok(texts.some((t) => t.startsWith('9: ') && /找不到/.test(t)));
  assert.ok(texts.some((t) => /x = 99999/.test(t)) && texts.some((t) => /shadow/.test(t)));
});

test('preview rows show old → new values, with colours for swatches', () => {
  const snap = { shapes: [{ id: '5', type: 'GeometricShape', inScope: true, x: 40, y: 120, w: 420, h: 300, fill: { type: 'Solid', color: '#FFFFFF', transparency: 0 }, line: { visible: true, color: '#000000', weight: 2.25, dash: 'Solid' }, text: { font: { size: null, bold: null } } }] };
  const groups = F.planRows([{ id: '5', kind: 'shape', set: { line: { color: '#BFBFBF', weight: 1 }, w: 400, font: { size: 18 } } }], snap);
  assert.deepEqual(plain(groups[0].rows.map((r) => [r.key, r.old, r.value, r.oldColor || null, r.newColor || null])), [
    ['w', '420 pt', '400 pt', null, null],
    ['line.color', '#000000', '#BFBFBF', '#000000', '#BFBFBF'],
    ['line.weight', '2.25 pt', '1 pt', null, null],
    ['font.size', 'mixed', '18 pt', null, null],
  ]);
});

test('table borders: outer, inner and all pick the right sides of each cell', () => {
  const all = { r1: 0, c1: 0, r2: 1, c2: 1 };
  assert.deepEqual(plain(F.borderPlan(all, 'outer')), [[0, 0, ['top', 'left']], [0, 1, ['top', 'right']], [1, 0, ['bottom', 'left']], [1, 1, ['bottom', 'right']]]);
  assert.deepEqual(plain(F.borderPlan(all, 'inner')), [[0, 0, ['bottom', 'right']], [0, 1, ['bottom', 'left']], [1, 0, ['top', 'right']], [1, 1, ['top', 'left']]]);
  assert.deepEqual(plain(F.borderPlan({ r1: 0, c1: 0, r2: 0, c2: 0 }, 'all')), [[0, 0, ['top', 'bottom', 'left', 'right']]]);
});

test('format mode reads the selected shape, attaches the slide image, previews and applies a lighter border, and undo restores it', async (t) => {
  const reply = plan([{ id: '5', line: { color: '#BFBFBF', weight: 1 } }]);
  const p = await open(t, { deck: formatDeck(), events: answer(reply) });
  p.pp.select({ slide: '257#0', shapes: ['5'] });
  p.lp.setMode('format');
  await p.lp.sendInstruction('把黑框改浅一点');
  await tick(20);
  const payload = p.calls[0];
  assert.equal(payload.mode, 'format');
  assert.deepEqual(payload.attachments.map((a) => a.name), ['slide-2.png'], 'the slide image goes with the request');
  assert.match(payload.doc.format, /用户选中的 1 个/);
  assert.match(payload.doc.format, /"id":"5".*"line":\{"color":"#000000","weight":2.25\}/);
  assert.match(payload.doc.format, /本页其他形状（只作参考，不能修改）[\s\S]*"id":"2"/);
  assert.match(payload.doc.format, /幻灯片大小 960×540 pt/);
  const card = p.d.querySelector('.fmt-card');
  assert.ok(card, 'a format preview card is shown');
  assert.deepEqual([...card.querySelectorAll('.fmt-rows tr')].map(rowText), ['边框颜色 #000000 → #BFBFBF', '边框粗细 2.25 pt → 1 pt']);
  assert.equal(card.querySelectorAll('.sw').length, 2, 'colour swatches for the old and new border colour');
  assert.equal(p.pp.shape('257#0', '5').line.color, '#000000', 'nothing changes before Apply');
  card.querySelector('.apply').click();
  await tick(10);
  assert.match(card.querySelector('.card-status').textContent, /已应用 2 项/);
  assert.deepEqual(plain(p.pp.shape('257#0', '5').line), { visible: true, color: '#BFBFBF', weight: 1, dashStyle: 'Solid', transparency: 0 });
  assert.equal(p.pp.shape('257#0', '6').line.color, '#000000', 'the picture was not selected and keeps its border');
  card.querySelector('.undo').click();
  await tick(10);
  assert.match(card.querySelector('.card-status').textContent, /已撤销/);
  assert.deepEqual(plain(p.pp.shape('257#0', '5').line), { visible: true, color: '#000000', weight: 2.25, dashStyle: 'Solid', transparency: 0 });
});

test('mixed font sizes are restored character by character on undo', async (t) => {
  const reply = plan([{ id: '5', font: { size: 18, color: '#404040' } }]);
  const p = await open(t, { deck: formatDeck(), events: answer(reply) });
  p.pp.select({ slide: '257#0', shapes: ['5'] });
  p.lp.setMode('format');
  await p.lp.sendInstruction('字小一点');
  await tick(20);
  const card = p.d.querySelector('.fmt-card');
  card.querySelector('.apply').click();
  await tick(10);
  const chars = () => p.pp.shape('257#0', '5').chars;
  assert.ok(chars().every((c) => c.size === 18 && c.color === '#404040'));
  card.querySelector('.undo').click();
  await tick(10);
  assert.deepEqual([...new Set(chars().slice(0, 8).map((c) => c.size))], [20]);
  assert.deepEqual([...new Set(chars().slice(8).map((c) => c.size))], [28], '+23% is back at 28 pt');
  assert.equal(chars()[8].color, '#C00000', 'and red');
});

test('with nothing selected the whole slide is in scope; table borders, header fill and the background can change', async (t) => {
  const reply = plan([
    { id: '7', cells: 'all', border: { sides: 'all', color: '#BFBFBF', weight: 0.5 } },
    { id: '7', cells: 'header', fill: '#F2F2F2', font: { color: '#262626' } },
    { id: 'background', fill: '#FAFAFA' },
  ], 'Cleaner table.');
  const p = await open(t, { deck: formatDeck(), events: answer(reply) });
  p.pp.selectSlides(['257#0']);
  p.lp.setMode('format');
  await p.lp.sendInstruction('表格清爽一点');
  await tick(20);
  assert.match(p.calls[0].doc.format, /本页全部 4 个/);
  assert.match(p.calls[0].doc.format, /"id":"7","kind":"table".*"borders":\{"outer":\{"color":"#000000","weight":1\}/);
  const card = p.d.querySelector('.fmt-card');
  const heads = [...card.querySelectorAll('.fmt-shape-head')].map((h) => h.textContent);
  assert.deepEqual(heads, ['表格「Table 6」 · 全部单元格 · 全部边框', '表格「Table 6」 · 表头行', '幻灯片背景']);
  card.querySelector('.apply').click();
  await tick(10);
  const tbl = p.pp.shape('257#0', '7');
  assert.ok(tbl.cellFmt.flat().every((c) => ['top', 'bottom', 'left', 'right'].every((s) => c.borders[s].color === '#BFBFBF' && c.borders[s].weight === 0.5)));
  assert.deepEqual(tbl.cellFmt[0].map((c) => c.fill.color), ['#F2F2F2', '#F2F2F2']);
  assert.equal(tbl.cellFmt[1][0].fill.type, 'NoFill', 'body cells keep their fill');
  assert.deepEqual(plain(p.pp.deck.slides[1].background), { follows: false, fill: { type: 'Solid', color: '#FAFAFA', transparency: 0 } });
  card.querySelector('.undo').click();
  await tick(10);
  assert.ok(tbl.cellFmt.flat().every((c) => c.borders.top.color === '#000000' && c.borders.top.weight === 1));
  assert.deepEqual(tbl.cellFmt[0].map((c) => [c.fill.color, c.font.color]), [['#4472C4', '#FFFFFF'], ['#4472C4', '#FFFFFF']]);
  assert.equal(p.pp.deck.slides[1].background.follows, true, 'the background follows the master again');
});

test('changes made after sending ask for confirmation; z-order moves are undone step by step', async (t) => {
  const reply = plan([{ id: '6', zOrder: 'back', line: 'none' }]);
  const p = await open(t, { deck: formatDeck(), events: answer(reply) });
  p.pp.select({ slide: '257#0', shapes: ['6'] });
  p.lp.setMode('format');
  await p.lp.sendInstruction('去掉图片边框，放到最底层');
  await tick(20);
  const card = p.d.querySelector('.fmt-card');
  p.pp.shape('257#0', '6').line.weight = 3; // the user changes the border meanwhile
  card.querySelector('.apply').click();
  await tick(10);
  assert.match(card.querySelector('.card-status').textContent, /手动改过/);
  assert.equal(p.pp.shape('257#0', '6').line.visible, true);
  card.querySelector('.apply').click();
  await tick(10);
  const order = () => p.pp.deck.slides[1].shapes.map((s) => s.id);
  assert.deepEqual(order(), ['6', '2', '5', '7']);
  assert.equal(p.pp.shape('257#0', '6').line.visible, false);
  card.querySelector('.undo').click();
  await tick(20);
  assert.deepEqual(order(), ['2', '5', '6', '7'], 'back in its old place');
  assert.equal(p.pp.shape('257#0', '6').line.visible, true);
});

test('replies without a plan are shown as text; broken plans can be retried; English labels', async (t) => {
  const p = await open(t, { deck: formatDeck(), language: 'en', events: (_payload, n) => answer(n === 1 ? 'Animations cannot be changed by add-ins.' : '```format\n{oops}\n```') });
  p.lp.setMode('format');
  assert.equal(p.d.querySelector('#btn-send').textContent.trim(), 'Plan ↑');
  assert.equal(p.input.placeholder, 'For example: make the black border light gray and thinner…');
  await p.lp.sendInstruction('add a fade animation');
  await tick(20);
  assert.equal(p.d.querySelector('.fmt-card'), null);
  assert.match(p.d.querySelector('#messages').textContent, /Animations cannot be changed/);
  await p.lp.sendInstruction('lighter border');
  await tick(20);
  const last = [...p.d.querySelectorAll('.msg.assistant')].pop();
  assert.match(last.querySelector('.warnbox').textContent, /format plan could not be read \(the plan is not valid JSON/);
  assert.ok([...last.querySelectorAll('.btn')].some((b) => /Retry/.test(b.textContent)));
});

// Found in real PowerPoint 16.109: alignment reads as an index (0 = Left), so "Left" must survive undo, and the scope
// line names the selected slide (selected slides are read as IDs).
test('alignment read as numbers is shown by name and Left is restored on undo; the scope names the selected slide', async (t) => {
  const deck = formatDeck();
  deck.slides[1].shapes[0].align = 'Left';
  const reply = plan([{ id: '2', align: 'center' }]);
  const p = await open(t, { deck, events: answer(reply) });
  p.lp.setMode('format');
  p.pp.select({ slide: '257#0', shapes: ['2'] });
  p.lp.onDocSelectionChanged();
  await tick(450);
  assert.match(p.d.querySelector('#context-summary').textContent, /第 2 页 · 选中 1 个形状/);
  await p.lp.sendInstruction('标题居中');
  await tick(20);
  assert.match(p.calls[0].doc.format, /"id":"2".*"align":"left"/);
  assert.match(p.calls[0].doc.format, /"id":"5".*"line":\{"color":"#000000"/);
  assert.match(p.calls[0].doc.format, /"id":"6","kind":"picture".*"fill":"none"/, 'a picture without fill reads "" / -1 and is shown as none');
  const card = p.d.querySelector('.fmt-card');
  assert.deepEqual([...card.querySelectorAll('.fmt-rows tr')].map(rowText), ['水平对齐 左对齐 → 居中']);
  card.querySelector('.apply').click();
  await tick(10);
  const aligns = () => [...new Set(p.pp.shape('257#0', '2').chars.map((c) => c.align))];
  assert.deepEqual(aligns(), ['Center']);
  card.querySelector('.undo').click();
  await tick(10);
  assert.deepEqual(aligns(), ['Left'], 'Left (read as 0) comes back');
});

test('a hidden line reads as none; undoing a new border hides it again', async (t) => {
  const deck = formatDeck();
  deck.slides[1].shapes[1].line = 'none';
  const reply = plan([{ id: '5', line: { color: '#BFBFBF', weight: 1 } }]);
  const p = await open(t, { deck, events: answer(reply) });
  p.pp.select({ slide: '257#0', shapes: ['5'] });
  p.lp.setMode('format');
  await p.lp.sendInstruction('加一个浅灰色边框');
  await tick(20);
  assert.match(p.calls[0].doc.format, /"id":"5".*"line":"none"/);
  const card = p.d.querySelector('.fmt-card');
  assert.deepEqual([...card.querySelectorAll('.fmt-rows tr')].map(rowText), ['边框 无 → #BFBFBF', '边框粗细 — → 1 pt']);
  card.querySelector('.apply').click();
  await tick(10);
  assert.equal(p.pp.shape('257#0', '5').line.visible, true);
  card.querySelector('.undo').click();
  await tick(10);
  assert.equal(p.pp.shape('257#0', '5').line.visible, false);
});

// A table drawn by its table style (the usual case): its colours cannot be read, borders cannot be "unset", and
// re-applying the style is the only way back. Border-only plans use that; plans that also change style-drawn text
// colour are undone by restoring the whole slide.
const styledDeck = () => {
  const deck = formatDeck();
  Object.assign(deck.slides[1].shapes[3], { tableStyle: 'MediumStyle2Accent1', border: undefined });
  return deck;
};
test('a table with a table style: style-drawn values are marked, borders are undone by re-applying the style', async (t) => {
  const reply = plan([
    { id: '7', cells: 'all', border: { sides: 'all', color: '#BFBFBF', weight: 0.5 } },
    { id: '7', cells: 'header', fill: '#F2F2F2' },
  ], 'Cleaner table.');
  const p = await open(t, { deck: styledDeck(), events: answer(reply) });
  const tbl = p.pp.shape('257#0', '7');
  tbl.cellFmt[2][1].fill = { type: 'Solid', color: '#FFF2CC', transparency: 0 }; // one cell the user had highlighted
  p.pp.select({ slide: '257#0', shapes: ['7'] });
  p.lp.setMode('format');
  await p.lp.sendInstruction('表格清爽一点，表头浅灰底');
  await tick(20);
  const fmt = p.calls[0].doc.format;
  assert.match(fmt, /"tableStyle":"MediumStyle2Accent1"/);
  assert.match(fmt, /"header":\{"fill":"table-style","font":\{"size":18,"color":"#000000"\}\}/);
  assert.match(fmt, /"borders":\{"outer":"table-style","inner":"table-style"\}/);
  assert.match(fmt, /说明：tableStyle 是表格套用的样式/);
  const card = p.d.querySelector('.fmt-card');
  assert.deepEqual([...card.querySelectorAll('.fmt-rows tr')].map(rowText), ['边框颜色 表格样式 → #BFBFBF', '边框粗细 — → 0.5 pt', '单元格底色 表格样式 → #F2F2F2']);
  card.querySelector('.apply').click();
  await tick(10);
  assert.ok(tbl.cellFmt.flat().every((c) => c.borders.left.color === '#BFBFBF' && c.borders.left.weight === 0.5));
  card.querySelector('.undo').click();
  await tick(20);
  assert.equal(p.pp.deck.slides[1].id, '257#0', 'property undo keeps the slide');
  assert.ok(p.pp.log.some((e) => e.op === 'tableStyle' && e.v === 'MediumStyle2Accent1'), 'the table style is applied again');
  assert.ok(tbl.cellFmt.flat().every((c) => Object.values(c.borders).every((b) => b.weight == null)), 'no direct borders are left');
  assert.deepEqual(tbl.cellFmt[0].map((c) => c.fill.type), ['NoFill', 'NoFill'], 'the header is drawn by the style again');
  assert.deepEqual(plain(tbl.cellFmt[2][1].fill), { type: 'Solid', color: '#FFF2CC', transparency: 0 }, 'a fill set before is written back');
});

test('changing style-drawn table text is undone by restoring the whole slide', async (t) => {
  const reply = plan([{ id: '7', cells: 'header', fill: '#F2F2F2', font: { color: '#262626', bold: true } }]);
  const p = await open(t, { deck: styledDeck(), events: answer(reply) });
  p.pp.select({ slide: '257#0', shapes: ['7'] });
  p.lp.setMode('format');
  const look = () => p.pp.look(1);
  const before = look();
  await p.lp.sendInstruction('表头浅灰底深色字');
  await tick(20);
  const card = p.d.querySelector('.fmt-card');
  assert.equal(card.querySelector('.warnbox'), null, 'no warning: the whole slide can be put back');
  card.querySelector('.apply').click();
  await tick(10);
  assert.equal(p.pp.shape('257#0', '7').cellFmt[0][0].font.color, '#262626');
  assert.match(card.querySelector('.card-status').textContent, /整页恢复到应用前/);
  card.querySelector('.undo').click();
  await tick(20);
  const slide = p.pp.deck.slides[1];
  assert.notEqual(slide.id, '257#0', 'the slide was replaced by its backup');
  assert.equal(look(), before, 'and looks exactly as before');
  assert.equal(slide.shapes.find((x) => x.id === '7').cellFmt[0][0].font.color, '#000000');
  assert.match(card.querySelector('.card-status').textContent, /这一页恢复到应用前的样子/);
  card.querySelector('.apply').click(); // the card still finds its slide
  await tick(10);
  assert.equal(p.pp.deck.slides[1].shapes.find((x) => x.id === '7').cellFmt[0][0].font.color, '#262626');
});

// Whole-slide redesign: a text-heavy slide whose bullets become cards.
const bulletDeck = () => ({
  slides: [
    { id: '256#0', shapes: [{ id: '2', type: 'Placeholder', ph: 'CenterTitle', text: 'Cover' }] },
    { id: '257#0', shapes: [
      { id: '2', name: 'Title 1', type: 'Placeholder', ph: 'Title', top: 20, left: 40, width: 880, height: 70, text: '研究内容', font: { size: 40 } },
      { id: '3', name: 'Content Placeholder 2', type: 'Placeholder', ph: 'Body', top: 110, left: 40, width: 560, height: 400, font: { name: '微软雅黑', size: 24 }, paras: [
        { runs: [['数据层：', { bold: true }], ['构建多模态数据集', {}]] },
        { runs: [['模型层：', { bold: true }], ['训练统一模型', {}]] },
        { runs: [['评测层：', { bold: true }], ['搭建评测基准', { color: '#C00000' }]] },
      ] },
      { id: '4', name: 'Picture 3', type: 'Image', top: 150, left: 620, width: 320, height: 200 },
      { id: '5', name: 'Straight Connector 4', type: 'Line', top: 100, left: 40, width: 880, height: 0, line: { color: '#000000', weight: 2 } },
    ] },
  ],
});
const cardsPlan = (extra = []) => plan([
  { id: '2', x: 48, y: 28, w: 864, h: 60, font: { size: 36, bold: true, color: '#1F3864' } },
  ...[0, 1, 2].map((i) => ({ add: 'roundRect', id: `new${i + 1}`, x: 48 + i * 296, y: 120, w: 272, h: 160, fill: '#F2F5FA', line: 'none', corner: 0.06,
    from: { id: '3', para: String(i + 1) }, font: { size: 16, color: '#262626' }, align: 'left', valign: 'top', margin: 14, autoSize: 'shrink' })),
  { id: '3', delete: true },
  { id: '5', delete: true },
  { id: '4', x: 48, y: 300, w: 320 },
  ...extra,
], 'Three cards.');

test('bullets become cards: text moves with its formatting, the old box goes, a check runs, undo restores the slide', async (t) => {
  const p = await open(t, { deck: bulletDeck(), events: (payload, n) => answer(n === 1 ? cardsPlan() : '通过：卡片对齐，文字都放得下。') });
  p.pp.selectSlides(['257#0']);
  p.lp.setMode('format');
  const look = () => p.pp.look(1);
  const before = look();
  await p.lp.sendInstruction('重新排版');
  await tick(20);
  const fmt = p.calls[0].doc.format;
  assert.match(fmt, /"id":"3".*"paras":\[\{"n":1,"chars":12,"size":24,"bold":"mixed","text":"数据层：构建多模态数据集"\}/, 'paragraphs are listed');
  assert.match(fmt, /"id":"4","kind":"picture".*"ratio":1\.6/);
  assert.match(fmt, /正文主要字体：微软雅黑/);
  const card = p.d.querySelector('.fmt-card');
  const heads = [...card.querySelectorAll('.fmt-shape-head')].map((h) => h.textContent);
  assert.ok(heads.includes('新增圆角矩形') && heads.some((h) => /^正文/.test(h)), heads.join(' | '));
  assert.ok([...card.querySelectorAll('.fmt-rows tr')].map(rowText).includes('文字 — → 形状 3 的第 2 段（原样搬入）'));
  assert.ok(card.querySelector('details.fmt-all'), 'a long plan is folded');
  assert.ok(!card.querySelector('.warnbox') || /保持原来的长宽比/.test(card.querySelector('.warnbox').textContent));
  card.querySelector('.apply').click();
  await tick(40);
  const shapes = p.pp.deck.slides[1].shapes;
  assert.deepEqual(shapes.map((x) => x.id).sort(), ['2', '4', '6', '7', '8'], 'body and line deleted, three cards added');
  const cards = shapes.filter((x) => x.geom === 'RoundRectangle');
  assert.deepEqual(cards.map((c) => c.chars.map((x) => x.ch).join('')), ['数据层：构建多模态数据集', '模型层：训练统一模型', '评测层：搭建评测基准']);
  assert.deepEqual([...new Set(cards[0].chars.map((x) => x.name))], ['微软雅黑'], 'the font comes along (not the 宋体 default)');
  assert.deepEqual(cards[0].chars.slice(0, 4).map((x) => x.bold), [true, true, true, true], 'the bold lead-in stays bold');
  assert.equal(cards[0].chars[5].bold, false);
  assert.equal(cards[2].chars.at(-1).color, '#262626', 'the plan sets the colour of the whole card');
  assert.ok(cards[0].chars.slice(0, 4).every((x) => x.bold), 'bold that the plan does not set stays');
  assert.equal(cards[0].chars[0].size, 16);
  assert.deepEqual(cards[0].adj, [0.06]);
  assert.equal(cards[0].tf.leftMargin, 14);
  assert.equal(cards[0].tf.autoSizeSetting, 'AutoSizeTextToFitShape');
  assert.equal(shapes.find((x) => x.id === '4').height, 200, 'the picture keeps its 1.6 ratio');
  // the check round sees the result
  assert.equal(p.calls.length, 2);
  assert.equal(p.calls[1].doc.phase, 'check');
  assert.deepEqual(p.calls[1].attachments.map((a) => a.name), ['slide-2-after.png']);
  assert.match(p.calls[1].doc.format, /"id":"6","kind":"shape"/, 'the new cards are in scope for fixes');
  assert.ok(Array.isArray(p.calls[1].doc.issues));
  assert.match(card.querySelector('.card-status').textContent, /自查没有发现问题/);
  assert.equal(card.querySelectorAll('.fmt-shots img').length, 2, 'before and after images');
  assert.match(card.querySelector('.fmt-check').textContent, /通过/);
  card.querySelector('.undo').click();
  await tick(20);
  assert.equal(look(), before, 'undo restores the slide exactly');
  assert.deepEqual(p.pp.deck.slides[1].shapes.map((x) => x.id), ['2', '3', '4', '5']);
});

test('the check round can fix the result; a later manual change makes undo ask first', async (t) => {
  const fix = plan([{ id: '6', h: 190 }], '卡片 1 的文字放不下，加高。');
  const p = await open(t, { deck: bulletDeck(), events: (payload, n) => answer(n === 1 ? cardsPlan() : fix) });
  p.pp.selectSlides(['257#0']);
  p.lp.setMode('format');
  await p.lp.sendInstruction('整页美化');
  await tick(20);
  const card = p.d.querySelector('.fmt-card');
  card.querySelector('.apply').click();
  await tick(40);
  assert.match(card.querySelector('.card-status').textContent, /自查后又修正了 1 处/);
  assert.equal(p.pp.deck.slides[1].shapes.find((x) => x.id === '6').height, 190);
  p.pp.deck.slides[1].shapes.find((x) => x.id === '2').left = 60; // the user nudges the title afterwards
  card.querySelector('.undo').click();
  await tick(20);
  assert.match(card.querySelector('.card-status').textContent, /应用后又改过/);
  assert.equal(p.pp.deck.slides[1].id, '257#0');
  card.querySelector('.undo').click();
  await tick(20);
  assert.notEqual(p.pp.deck.slides[1].id, '257#0');
  assert.deepEqual(p.pp.deck.slides[1].shapes.map((x) => x.id), ['2', '3', '4', '5']);
});

test('redesign plans are checked: text cannot be dropped or invented, pictures keep their ratio, shapes stay on the slide', () => {
  const snap = {
    size: { w: 960, h: 540 }, canStructure: true, canZOrder: true, canRotate: true, canTableFormat: true,
    shapes: [
      { id: '2', type: 'Placeholder', role: 'title', inScope: true, text: { preview: 'T', paras: [{}] } },
      { id: '3', type: 'Placeholder', role: 'body', inScope: true, text: { preview: 'a b c', paras: [{}, {}, {}] } },
      { id: '4', type: 'Image', inScope: true, x: 600, y: 100, w: 320, h: 200, ratio: 1.6 },
      { id: '5', type: 'Line', inScope: true },
      { id: '9', type: 'TextBox', inScope: false, text: { preview: 'x', paras: [{}] } },
    ],
  };
  const { changes, problems } = F.normalizeChanges([
    { add: 'card', id: 'new1', x: 40, y: 120, w: 280, h: 150, from: { id: '3', para: '1-2' } },
    { id: '3', delete: true },                                   // paragraph 3 was not moved
    { add: 'textbox', id: 'new2', x: 40, y: 300, w: 200, h: 40, text: '这是一段模型自己编写的很长的正文内容，用来测试新增形状里不能直接写正文，只能写很短的标签，所以这里应该被拒绝' },
    { add: 'textbox', id: 'new3', x: 900, y: 500, w: 200, h: 40, text: '01' },
    { add: 'roundRect', id: 'new4', x: 40, y: 400, w: 100, h: 40, from: { id: '9', para: 1 } },
    { id: '4', w: 400, h: 400 },
    { id: '2', delete: true },
    { id: '4', delete: true },
    { id: '5', delete: true },
    { id: '3', para: '2', font: { bold: true }, bullet: false },
    { id: '3', text: '改写' },
    { add: 'line', id: 'new5', x: 40, y: 100, w: 300, h: 0, line: { color: '#4472C4', weight: 2 } },
  ], snap);
  const kinds = changes.map((c) => `${c.kind}:${c.id}`);
  assert.deepEqual(kinds, ['add:new1', 'add:new3', 'shape:4', 'paras:3', 'add:new5', 'delete:5']);
  assert.deepEqual(plain(changes[0].from), { id: '3', p1: 0, p2: 1 });
  assert.equal(changes[0].type, 'RoundRectangle');
  assert.deepEqual(plain(changes[1].set), { x: 760, y: 500, w: 200, h: 40 }, 'moved back onto the slide');
  assert.deepEqual(plain(changes[2].set), { w: 400, h: 250, x: 560 }, 'the picture keeps its ratio and stays on the slide');
  const texts = problems.map((x) => `${x.id}: ${x.text}`).join('\n');
  assert.match(texts, /3: 删除会丢失第 3 段文字/);
  assert.match(texts, /new2: 新形状里的文字只能是 40 字以内的短标签/);
  assert.match(texts, /new4: 文字来源必须是范围内有文字的形状/);
  assert.match(texts, /2: 标题占位符不能删除/);
  assert.match(texts, /4: 删除图片、表格或分组会丢失内容/);
  assert.match(texts, /3: 版式模式不改文字内容/);
  const without = F.normalizeChanges([{ add: 'rect', id: 'new1', x: 0, y: 0, w: 10, h: 10 }, { id: '5', delete: true }], { ...snap, canStructure: false });
  assert.equal(without.changes.length, 0, 'no whole-slide backup, no structural changes');
});

test('the self-check geometry lists overlaps, off-slide shapes and shapes touching the edge, but not text on its card', () => {
  const s = (id, x, y, w, h, text = true) => ({ id, type: 'TextBox', x, y, w, h, text: text ? { preview: id } : null });
  const issues = F.layoutIssues({ size: { w: 960, h: 540 }, shapes: [
    s('2', 40, 20, 880, 60),
    { id: '6', type: 'GeometricShape', x: 40, y: 120, w: 300, h: 200, text: null },
    s('7', 50, 130, 280, 100),           // on its card
    s('8', 300, 150, 200, 100),          // overlaps 7
    s('9', 900, 300, 100, 50),           // off the slide
    s('10', 4, 400, 200, 40),            // touches the left edge
  ] });
  assert.deepEqual(issues, ['形状 9 超出了页面', '形状 10 离页面边缘太近（不到 12 pt）', '形状 7 和形状 8 重叠（约 49 pt 见方）']);
});

test('Chinese text never falls back to SimSun: Latin fonts go to Latin characters only, new text gets a Chinese font', async (t) => {
  const deck = bulletDeck();
  const body = deck.slides[1].shapes[1];
  body.font = { name: 'Calibri', size: 24 }; // a Latin font name; the Chinese is drawn by the theme
  const reply = plan([
    { add: 'roundRect', id: 'new1', x: 48, y: 120, w: 272, h: 160, from: { id: '3', para: '1' }, font: { size: 16 } },
    { add: 'textbox', id: 'new2', x: 48, y: 300, w: 100, h: 30, text: '第 1 步' },
    { id: '2', font: { name: 'Arial' } },
  ]);
  const p = await open(t, { deck, events: (payload, n) => answer(n === 1 ? reply : '通过') });
  p.pp.selectSlides(['257#0']);
  p.lp.setMode('format');
  await p.lp.sendInstruction('整页美化');
  await tick(20);
  p.d.querySelector('.fmt-card .apply').click();
  await tick(40);
  const shapes = p.pp.deck.slides[1].shapes;
  const card = shapes.find((x) => x.geom === 'RoundRectangle');
  const names = (sh) => [...new Set(sh.chars.map((c) => `${c.ch.match(/[A-Za-z0-9 ]/) ? 'latin' : 'cjk'}:${c.name}`))].sort();
  assert.deepEqual(names(card), ['cjk:微软雅黑'], 'Chinese in the card uses a Chinese font, not 宋体');
  const label = shapes.find((x) => x.type === 'TextBox' && x.chars.map((c) => c.ch).join('') === '第 1 步');
  assert.deepEqual(names(label), ['cjk:微软雅黑', 'latin:Calibri']);
  const title = shapes.find((x) => x.id === '2');
  assert.deepEqual([...new Set(title.chars.map((c) => c.name))], ['Calibri'], 'the Chinese title keeps its font when the plan names a Latin font');
});

test('a check that finds problems but gives no usable fix says so instead of "no problems"', async (t) => {
  const bad = '第 1 张卡片最后一个字掉到了第二行。\n```format\n{"changes": [{"id": "6", "fontSize": 14}]}\n```';
  const p = await open(t, { deck: bulletDeck(), events: (payload, n) => answer(n === 1 ? cardsPlan() : bad) });
  p.pp.selectSlides(['257#0']);
  p.lp.setMode('format');
  await p.lp.sendInstruction('重新排版');
  await tick(20);
  const card = p.d.querySelector('.fmt-card');
  card.querySelector('.apply').click();
  await tick(40);
  assert.match(card.querySelector('.card-status').textContent, /自查发现了问题，但修正方案没能应用/);
  assert.match(card.querySelector('.fmt-check').textContent, /最后一个字掉到了第二行/);
});
