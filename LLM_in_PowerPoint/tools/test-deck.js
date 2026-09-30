// End-to-end tests of the pane against a fake PowerPoint: adding targets, deck context,
// writing only what changed (formatting kept), undo, tables, conflicts and restored targets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPane, tick, fence, answer } from './pane-harness.js';

const plain = (x) => JSON.parse(JSON.stringify(x));
const BODY = ['257#0', '3'];
async function settle(n = 6) { for (let i = 0; i < n; i++) await tick(2); }
async function clickApply(t, i = 0) { t.d.querySelectorAll('.apply')[i].click(); await settle(); }

test('a partial selection becomes an anchored target, and applying rewrites only the changed words', async () => {
  const t = await loadPane({ events: answer(fence('Active users passed 1 million in September')) });
  try {
    const full = t.pp.text(...BODY);
    const start = full.indexOf('Active users');
    const sel = 'Active users passed 1 million for the first time';
    t.pp.select({ slide: '257#0', shapes: ['3'], text: { shape: '3', start, length: sel.length } });
    await t.lp.addTarget();
    assert.equal(t.lp.state.targets.length, 1);
    assert.equal(t.lp.state.targets[0].whole, false);
    assert.equal(t.lp.state.targets[0].start, start);
    assert.equal(t.d.querySelector('#context-summary').textContent, '1 个目标 · 48 字 · 第 2 页');
    await t.lp.sendInstruction('更简洁');
    const doc = t.calls[0].doc;
    assert.match(doc.fullText, /\[正文\]\nRevenue grew 23% year over year\n\n【选中段开始】\nActive users passed 1 million for the first time\n【选中段结束】\n\nChurn fell/);
    assert.equal(doc.targets[0].where, '第 2 页的正文（部分文字）');
    assert.equal(doc.slideCount, 4);
    await clickApply(t);
    assert.equal(t.pp.text(...BODY).split('\r')[1], 'Active users passed 1 million in September');
    const shape = t.pp.shape(...BODY);
    const i = t.pp.text(...BODY).indexOf('1 million');
    assert.ok(shape.chars.slice(i, i + 9).every((c) => c.bold), 'the bold run keeps its formatting');
    assert.ok(!shape.chars[i + 10].bold);
    assert.equal(t.lp.state.targets.length, 0, 'applied targets are removed');
    assert.match(t.d.querySelector('.card-status').textContent, /只改了 [12] 处变化的文字/);
    // ↩ undo restores the original text and puts the target back
    t.d.querySelector('.undo').click(); await settle();
    assert.equal(t.pp.text(...BODY), full);
    assert.equal(t.lp.state.targets.length, 1);
    assert.match(t.d.querySelector('.card-status').textContent, /已撤销/);
  } finally { await t.close(); }
});

test('whole text box: unchanged bullets keep level and colour, new bullets become paragraphs, soft line breaks survive', async () => {
  const reply = 'Revenue grew 23% YoY\nActive users passed 1 million for the first time\nChurn fell to 2.1%\nNet retention reached 118%\nNext quarter we will focus on retention\nand on two new markets';
  const t = await loadPane({ events: answer(fence(reply)) });
  try {
    t.pp.select({ slide: '257#0', shapes: ['3'] });
    await t.lp.addTarget();
    assert.equal(t.lp.state.targets[0].whole, true);
    await t.lp.sendInstruction('精简第一条，加一条留存率');
    await clickApply(t);
    const text = t.pp.text(...BODY);
    assert.equal(text, 'Revenue grew 23% YoY\rActive users passed 1 million for the first time\rChurn fell to 2.1%\rNet retention reached 118%\rNext quarter we will focus on retention\vand on two new markets');
    const shape = t.pp.shape(...BODY);
    const levelAt = (s) => shape.chars[text.indexOf(s)].level;
    assert.equal(levelAt('Churn'), 1);
    assert.equal(levelAt('Net retention'), 1, 'a new paragraph takes the level of the one it follows');
    assert.equal(levelAt('Revenue'), 0);
    assert.equal(shape.chars[text.indexOf('two new markets')].color, '#C0392B');
  } finally { await t.close(); }
});

test('rewriting a bullet that contains a line break keeps it one bullet', async () => {
  const t = await loadPane({ events: answer(fence('Revenue grew 23% year over year\nActive users passed 1 million for the first time\nChurn fell to 2.1%\nFocus on retention next quarter\nExpand into two new markets')) });
  try {
    t.pp.select({ slide: '257#0', shapes: ['3'] });
    await t.lp.addTarget();
    await t.lp.sendInstruction('精简最后一条');
    await clickApply(t);
    const text = t.pp.text(...BODY);
    assert.equal(text.split('\r').length, 4, 'still four paragraphs');
    assert.match(text, /Focus on retention next quarter\vExpand into two new markets$/);
  } finally { await t.close(); }
});

test('with nothing selected, the current slide is added in reading order (footers skipped)', async () => {
  const t = await loadPane();
  try {
    t.pp.selectSlides(['257#0']);
    await t.lp.addTarget();
    assert.deepEqual(plain(t.lp.state.targets.map((x) => [x.shapeId, x.role])), [['2', 'title'], ['3', 'body']]);
    t.pp.selectSlides(['256#0']);
    await t.lp.addTarget();
    assert.deepEqual(plain(t.lp.state.targets.map((x) => x.slideNo)), [1, 1, 2, 2], 'numbered in slide order');
    assert.ok(!t.lp.state.targets.some((x) => x.role === 'footer'));
    // adding the same slide again adds nothing
    await t.lp.addTarget();
    assert.equal(t.lp.state.targets.length, 4);
    assert.match([...t.d.querySelectorAll('.note')].at(-1).textContent, /已经是目标/);
  } finally { await t.close(); }
});

test('a selected group adds each text box inside it; pictures are ignored', async () => {
  const t = await loadPane();
  try {
    t.pp.select({ slide: '259#0', shapes: ['3', '6'] });
    await t.lp.addTarget();
    assert.deepEqual(plain(t.lp.state.targets.map((x) => x.shapeId)), ['4', '5']);
    assert.equal(t.lp.state.targets[0].text, 'Left note inside a group');
    t.lp.clearTargets();
    // a single selected group: PowerPoint refuses to report a text range, which must not break adding
    t.pp.select({ slide: '259#0', shapes: ['3'] });
    await t.lp.addTarget();
    assert.deepEqual(plain(t.lp.state.targets.map((x) => x.shapeId)), ['4', '5']);
    t.lp.onDocSelectionChanged();
    await tick(400);
    assert.equal(t.d.querySelector('#sel-hint').textContent, '已选中 1 个对象 → 点「＋ 添加选中」设为目标');
  } finally { await t.close(); }
});

test('tables: cells change in place, rows are inserted and removed, and undo restores the table', async () => {
  const md = '| Region | Q2 | Q3 |\n| --- | --- | --- |\n| West | 0.4M | 0.6M |\n| North | 1.2M | 1.5M |';
  const t = await loadPane({ events: answer(fence(md, 'table')) });
  try {
    t.pp.select({ slide: '258#0', shapes: ['3'] });
    await t.lp.addTarget();
    assert.equal(t.lp.state.targets[0].kind, 'table');
    await t.lp.sendInstruction('更新');
    assert.equal(t.calls[0].doc.targets[0].rows, 3);
    assert.match(t.d.querySelector('.tbl-note').textContent, /^新增 1 行 · 删除 1 行$/);
    await clickApply(t);
    assert.deepEqual(plain(t.pp.shape('258#0', '3').values), [['Region', 'Q2', 'Q3'], ['West', '0.4M', '0.6M'], ['North', '1.2M', '1.5M']]);
    assert.match(t.d.querySelector('.card-status').textContent, /新增 1 行，删除 1 行/);
    t.d.querySelector('.undo').click(); await settle();
    assert.deepEqual(plain(t.pp.shape('258#0', '3').values), [['Region', 'Q2', 'Q3'], ['North', '1.2M', '1.5M'], ['South', '0.8M', '0.9M']]);
  } finally { await t.close(); }
});

test('table cell edits keep untouched rows and the table style', async () => {
  const md = '| Region | Q2 | Q3 |\n| --- | --- | --- |\n| North | 1.2M | 1.55M |\n| South | 0.8M | 0.9M |';
  const t = await loadPane({ events: answer(fence(md, 'table')) });
  try {
    t.pp.select({ slide: '258#0', shapes: ['3'] });
    await t.lp.addTarget();
    await t.lp.sendInstruction('更新');
    assert.match(t.d.querySelector('.tbl-note').textContent, /^改动 1 个单元格$/);
    await clickApply(t);
    assert.deepEqual(plain(t.pp.log.filter((e) => e.op === 'cell')), [{ op: 'cell', r: 1, c: 2, v: '1.55M' }], 'only the changed cell is written');
  } finally { await t.close(); }
});

test('tables with merged cells or a changed column count are refused', async () => {
  const t = await loadPane({ events: answer(fence('| Region | Q2 |\n| --- | --- |\n| North | 1 |', 'table')) });
  try {
    t.pp.select({ slide: '258#0', shapes: ['4'] });
    await t.lp.addTarget();
    assert.equal(t.lp.state.targets.length, 0);
    assert.match(t.d.querySelector('.note:last-child').textContent, /合并单元格/);
    t.pp.select({ slide: '258#0', shapes: ['3'] });
    await t.lp.addTarget();
    await t.lp.sendInstruction('删一列');
    assert.equal(t.d.querySelector('.apply').disabled, true);
    assert.match(t.d.querySelector('.tbl-note').textContent, /暂不支持增删列/);
  } finally { await t.close(); }
});

test('edits made after sending ask for confirmation; deleted shapes cannot be written', async () => {
  const t = await loadPane({ events: answer(fence('Q3 Product Review 2026')) });
  try {
    t.pp.select({ slide: '256#0', shapes: ['2'] });
    await t.lp.addTarget();
    await t.lp.sendInstruction('加年份');
    // the user edits the title while the answer is on screen
    await t.pp.run(async (ctx) => { ctx.presentation.slides.getItem('256#0').shapes.getItem('2').textFrame.textRange.text = 'Q3 Review'; });
    await clickApply(t);
    assert.match(t.d.querySelector('.card-status').textContent, /发送后已变化/);
    assert.equal(t.pp.text('256#0', '2'), 'Q3 Review');
    await clickApply(t);
    assert.equal(t.pp.text('256#0', '2'), 'Q3 Product Review 2026');

    const u = await loadPane({ events: answer(fence('新的目标')) });
    try {
      u.pp.select({ slide: '259#0', shapes: ['2'] });
      await u.lp.addTarget();
      await u.lp.sendInstruction('改');
      const slide = u.pp.deck.slides.find((s) => s.id === '259#0');
      slide.shapes = slide.shapes.filter((s) => s.id !== '2');
      await clickApply(u);
      assert.match(u.d.querySelector('.card-status').textContent, /找不到这处目标所在的形状/);
    } finally { await u.close(); }
  } finally { await t.close(); }
});

test('several targets are sent together and "apply all" writes each one', async () => {
  const reply = '【目标1】\n```text\nKey results\n```\n【目标2】\n```text\nRegional revenue by quarter\n```';
  const t = await loadPane({ events: answer(reply) });
  try {
    t.pp.select({ slide: '257#0', shapes: ['2'] });
    await t.lp.addTarget();
    t.pp.select({ slide: '258#0', shapes: ['2'] });
    await t.lp.addTarget();
    await t.lp.sendInstruction('标题更短');
    assert.match(t.calls[0].doc.fullText, /【目标1开始】\nKey results this quarter\n【目标1结束】[\s\S]*【目标2开始】\nRegional revenue\n【目标2结束】/);
    t.d.querySelector('.applyall .btn').click();
    await settle(10);
    assert.equal(t.pp.text('257#0', '2'), 'Key results');
    assert.equal(t.pp.text('258#0', '2'), 'Regional revenue by quarter');
    assert.match(t.d.querySelector('.applyall .btn').textContent, /成功 2\/2/);
  } finally { await t.close(); }
});

test('targets are restored for the same presentation and dropped when their text is gone', async () => {
  const url = '/Users/test/deck.pptx';
  let h = 0;
  for (let i = 0; i < url.length; i++) h = (h * 31 + url.charCodeAt(i)) >>> 0;
  const key = 'lp:targets:' + h.toString(36);
  const saved = [
    { slideId: '257#0', shapeId: '2', kind: 'text', start: 0, length: 24, text: 'Key results this quarter', whole: true, role: 'title' },
    { slideId: '257#0', shapeId: '3', kind: 'text', start: 0, length: 12, text: 'no such text', whole: false, role: 'body' },
  ];
  const t = await loadPane({ url, storage: { [key]: JSON.stringify(saved) } });
  try {
    await settle();
    assert.deepEqual(plain(t.lp.state.targets.map((x) => x.shapeId)), ['2']);
    assert.match(t.d.querySelector('#messages').textContent, /已恢复上次设的 1 处目标（另有 1 处已找不到）/);
  } finally { await t.close(); }
});

test('the slide image is attached as slide-N.png and sent with the request', async () => {
  const t = await loadPane({ events: answer('看起来不错') });
  try {
    t.pp.selectSlides(['258#0']);
    await t.lp.attachSlideImage();
    assert.equal(t.lp.state.attachments[0].name, 'slide-3.png');
    assert.match(t.d.querySelector('.att-chip').textContent, /第 3 页截图/);
    t.lp.setMode('ask');
    await t.lp.sendInstruction('这页的版式怎么样？');
    assert.equal(t.calls[0].attachments[0].name, 'slide-3.png');
    assert.equal(t.calls[0].doc.targets, undefined);
    assert.match(t.calls[0].doc.fullText, /【第 4 页】/);
  } finally { await t.close(); }
});

test('older PowerPoint (API 1.5): text shapes still work; tables and slide images are unavailable', async () => {
  const t = await loadPane({ apiVersion: '1.5' });
  try {
    t.pp.selectSlides(['258#0']);
    await t.lp.addTarget();
    assert.deepEqual(plain(t.lp.state.targets.map((x) => x.kind)), ['text']);
    assert.equal(t.d.querySelector('#att-slide').disabled, true);
  } finally { await t.close(); }
});

test('📍 locate selects the slide, the shape and the exact words', async () => {
  const t = await loadPane();
  try {
    const full = t.pp.text(...BODY);
    const start = full.indexOf('1 million');
    t.pp.select({ slide: '257#0', shapes: ['3'], text: { shape: '3', start, length: 9 } });
    await t.lp.addTarget();
    t.pp.selectSlides(['256#0']);
    await t.lp.revealTarget(t.lp.state.targets[0].id);
    const sel = t.pp.deck.selection;
    assert.deepEqual(plain(sel.slides), ['257#0']);
    assert.equal(sel.text.start, start);
    assert.equal(sel.text.length, 9);
  } finally { await t.close(); }
});
