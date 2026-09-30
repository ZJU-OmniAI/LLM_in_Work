// End-to-end tests of the pane against a fake Excel: adding ranges, workbook context,
// writing only changed cells (formats and types kept), writing beside the target, undo, conflicts and restored targets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPane, tick, fence, answer } from './pane-harness.js';

const plain = (x) => JSON.parse(JSON.stringify(x));
async function settle(n = 6) { for (let i = 0; i < n; i++) await tick(2); }
async function clickApply(t, i = 0) { t.d.querySelectorAll('.apply')[i].click(); await settle(); }
const status = (t, i = 0) => t.d.querySelectorAll('.card-status')[i].textContent;

test('a selected range becomes a target and the model sees the sheet with coordinates', async () => {
  const t = await loadPane({ events: answer(fence('| | B |\n|---|---|\n| 2 | Acme Corp |\n| 4 | Initech |')) });
  try {
    t.xl.select('Orders', 'B2:B7');
    await t.lx.addTarget();
    const tk = t.lx.state.targets[0];
    assert.equal(tk.address, 'B2:B7');
    assert.equal(t.d.querySelector('#context-summary').textContent, '1 个目标 · B2:B7 · 6 格');
    await t.lx.sendInstruction('整理公司名');
    const doc = t.calls[0].doc;
    assert.equal(doc.targets[0].where, 'Orders!B2:B7，6 行 × 1 列');
    assert.match(doc.targets[0].text, /^\|   \| B \|\n\| --- \| --- \|\n\| 2 \| "acme corp " \|/);
    assert.match(doc.fullText, /【工作表「Orders」 · 已用区域 A1:H8 · 8 行 × 8 列（当前工作表）】/);
    assert.match(doc.fullText, /\| 2 \| '00123 \| "acme corp " \| north \| 1,200.00 \| 2026-07-03 \| 12% \|/);
    assert.match(doc.fullText, /\| 8 \| Total \|  \|  \| =SUM\(D2:D7\) → 9,840.50 \|/);
    assert.match(doc.fullText, /【工作表「Regions」 · 已用区域 A1:B6/);
    assert.equal(doc.sheetCount, 2);
    assert.equal(doc.activeSheet, 'Orders');
    assert.match(t.d.querySelector('.tbl-note').textContent, /改动 2 个单元格/);
    await clickApply(t);
    assert.equal(t.xl.text('Orders', 'B2'), 'Acme Corp');
    assert.equal(t.xl.text('Orders', 'B4'), 'Initech');
    assert.equal(t.xl.text('Orders', 'B3'), 'Globex', 'rows not in the reply stay as they were');
    assert.deepEqual(plain(t.xl.log.filter((e) => e.op === 'write').map((e) => e.addr)), ['B2', 'B4'], 'only changed cells are written');
    assert.match(status(t), /已写入 2 个单元格/);
    assert.equal(t.lx.state.targets.length, 0);
  } finally { await t.close(); }
});

test('numbers stay numbers, IDs stay text, formats are kept and formula errors are reported', async () => {
  const reply = '| | A | D | F |\n|---|---|---|---|\n| 2 | 00123 | ¥1,300 | 15% |\n| 3 | \'00999 | 900.00 | -5% |\n| 4 | 00125 | =SUMME(D2:D3) | 31% |';
  const t = await loadPane({ events: answer(fence(reply)) });
  try {
    t.xl.select('Orders', 'A2:F4');
    await t.lx.addTarget();
    await t.lx.sendInstruction('改数');
    await clickApply(t);
    const c = (a) => t.xl.cell('Orders', a);
    assert.equal(c('A2').value, '00123', 'an ID written without its apostrophe is left alone');
    assert.equal(c('A3').value, '00999');
    assert.equal(c('A3').type, 'String', 'a changed ID stays text');
    assert.equal(c('D2').value, 1300, 'a currency amount in a number cell is written as a number');
    assert.equal(c('D2').type, 'Double');
    assert.equal(c('D2').nf, '#,##0.00', 'the number format is kept');
    assert.equal(t.xl.text('Orders', 'D2'), '1,300.00');
    assert.equal(c('D3').value, 900);
    assert.equal(c('F2').value, 0.15);
    assert.equal(c('D4').type, 'Error');
    assert.match(status(t), /1 个公式计算出错：D4 #NAME\?/);
  } finally { await t.close(); }
});

test('the model can fill a blank column beside the data, but never overwrite cells outside the target', async () => {
  const fill = '| | H |\n|---|---|\n| 2 | Delivery |\n| 3 | Billing |\n| 4 | Product |\n| 5 | Support |\n| 6 | Product |\n| 7 | Product |';
  const t = await loadPane({ events: (_, n) => answer(fence(n === 1 ? fill : '| | D |\n|---|---|\n| 8 | 9,999.00 |')) });
  try {
    t.xl.select('Orders', 'A1:G7');
    await t.lx.addTarget();
    await t.lx.sendInstruction('按反馈分类，填在 H 列');
    assert.match(t.d.querySelector('.tbl-note').textContent, /目标外空白处新增 6 个/);
    assert.ok(t.d.querySelector('.gridprev td.cellnew'));
    await clickApply(t);
    assert.equal(t.xl.text('Orders', 'H2'), 'Delivery');
    assert.equal(t.xl.text('Orders', 'H7'), 'Product');
    assert.match(status(t), /其中 6 个在目标外的空白处/);
    t.xl.select('Orders', 'A1:C7');
    await t.lx.addTarget();
    await t.lx.sendInstruction('把合计改掉');
    await clickApply(t, 1);
    assert.match(status(t, 1), /目标区域外已有内容的单元格（D8）/);
    assert.equal(t.xl.cell('Orders', 'D8').formula, '=SUM(D2:D7)', 'the total formula is untouched');
  } finally { await t.close(); }
});

test('undo restores values, types and number formats', async () => {
  const t = await loadPane({ events: answer(fence('| | A | E | F |\n|---|---|---|---|\n| 2 | \'00777 | 2026-10-15 | 50% |')) });
  try {
    const before = ['A2', 'E2', 'F2'].map((a) => ({ ...t.xl.cell('Orders', a) }));
    t.xl.select('Orders', 'A2:F2');
    await t.lx.addTarget();
    await t.lx.sendInstruction('改');
    await clickApply(t);
    assert.equal(t.xl.cell('Orders', 'A2').value, '00777');
    assert.equal(t.xl.text('Orders', 'E2'), '2026-10-15');
    t.d.querySelector('.undo').click();
    await settle();
    ['A2', 'E2', 'F2'].forEach((a, i) => {
      const now = t.xl.cell('Orders', a);
      assert.equal(now.value, before[i].value, a);
      assert.equal(now.type, before[i].type, a);
      assert.equal(now.nf, before[i].nf, a);
    });
    assert.match(status(t), /已撤销，3 个单元格/);
    assert.equal(t.lx.state.targets.length, 1, 'the target is put back');
  } finally { await t.close(); }
});

test('undo refuses when a written cell was edited afterwards', async () => {
  const t = await loadPane({ events: answer(fence('| | C |\n|---|---|\n| 2 | North |')) });
  try {
    t.xl.select('Orders', 'C2:C3');
    await t.lx.addTarget();
    await t.lx.sendInstruction('首字母大写');
    await clickApply(t);
    t.xl.typeIn('Orders', 'C2', 'Nord');
    t.d.querySelector('.undo').click();
    await settle();
    assert.match(status(t), /有 1 个单元格在写入后又被改过（如 C2）/);
    assert.equal(t.xl.text('Orders', 'C2'), 'Nord');
  } finally { await t.close(); }
});

test('edits made after sending ask for confirmation first', async () => {
  const t = await loadPane({ events: answer(fence('| | C |\n|---|---|\n| 2 | North |')) });
  try {
    t.xl.select('Orders', 'C2:C3');
    await t.lx.addTarget();
    await t.lx.sendInstruction('首字母大写');
    t.xl.typeIn('Orders', 'C3', 'SOUTH');
    await clickApply(t);
    assert.match(status(t), /发送后已变化/);
    assert.equal(t.xl.text('Orders', 'C2'), 'north');
    await clickApply(t);
    assert.equal(t.xl.text('Orders', 'C2'), 'North');
    assert.equal(t.xl.text('Orders', 'C3'), 'SOUTH', 'cells the reply did not mention are not touched');
  } finally { await t.close(); }
});

test('several ranges (Cmd-click) become separate targets and "apply all" writes each one', async () => {
  const reply = '【目标1】\n```table\n| | B |\n|---|---|\n| 2 | Acme Corp |\n```\n【目标2】\n```table\n| | C |\n|---|---|\n| 2 | North |\n| 4 | North |\n```';
  const t = await loadPane({ events: answer(reply) });
  try {
    t.xl.select('Orders', 'B2:B7', 'C2:C7');
    await t.lx.addTarget();
    assert.deepEqual(plain(t.lx.state.targets.map((x) => x.address)), ['B2:B7', 'C2:C7']);
    await t.lx.sendInstruction('规范写法');
    assert.equal(t.calls[0].doc.targets.length, 2);
    t.d.querySelector('.applyall .btn').click();
    await settle(10);
    assert.equal(t.xl.text('Orders', 'B2'), 'Acme Corp');
    assert.equal(t.xl.text('Orders', 'C4'), 'North');
    assert.match(t.d.querySelector('.applyall .btn').textContent, /成功 2\/2/);
  } finally { await t.close(); }
});

test('whole-column selections are cut to the used range; merged cells and overlaps are refused', async () => {
  const t = await loadPane();
  try {
    t.xl.select('Orders', 'G:G');
    await t.lx.addTarget();
    assert.equal(t.lx.state.targets[0].address, 'G1:G8', 'cut to the used range A1:H8');
    t.xl.select('Orders', 'G3:G4');
    await t.lx.addTarget();
    assert.equal(t.lx.state.targets.length, 1);
    assert.match([...t.d.querySelectorAll('.note')].at(-1).textContent, /已经是目标了/);
    t.xl.select('Regions', 'A5:B6');
    await t.lx.addTarget();
    assert.match([...t.d.querySelectorAll('.note')].at(-1).textContent, /A5:B6 含合并单元格/);
    assert.equal(t.lx.state.targets.length, 1);
  } finally { await t.close(); }
});

test('a blank range can be a target', async () => {
  const t = await loadPane();
  try {
    t.xl.select('Orders', 'H2:H7');
    await t.lx.addTarget();
    assert.equal(t.lx.state.targets[0].grid.flat().join(''), '');
    assert.match([...t.d.querySelectorAll('.note')].at(-1).textContent, /已添加空白区域 Orders!H2:H7/);
    const ctx = await t.lx.getEditContext();
    assert.equal(ctx.ok, true);
  } finally { await t.close(); }
});

test('targets are restored for the same workbook; ranges on deleted sheets are dropped', async () => {
  const url = '/Users/test/book.xlsx';
  let h = 0;
  for (let i = 0; i < url.length; i++) h = (h * 31 + url.charCodeAt(i)) >>> 0;
  const saved = [{ sheetId: '{sheet-1}', sheetName: 'Orders', address: 'G2:G7' }, { sheetId: '{sheet-9}', sheetName: 'Gone', address: 'A1:A2' }];
  const t = await loadPane({ url, storage: { ['lx:targets:' + h.toString(36)]: JSON.stringify(saved) } });
  try {
    await settle();
    assert.deepEqual(plain(t.lx.state.targets.map((x) => x.address)), ['G2:G7']);
    assert.equal(t.lx.state.targets[0].grid[0][0], 'Delivery was late but the product works great');
    assert.match(t.d.querySelector('#messages').textContent, /已恢复上次设的 1 个目标（另有 1 个已找不到）/);
  } finally { await t.close(); }
});

test('Q&A without targets sends every sheet; long sheets keep the header and the rows around targets', async () => {
  const cells = { A1: 'Row', B1: 'Value' };
  for (let r = 2; r <= 3001; r++) { cells[`A${r}`] = `row ${r}`; cells[`B${r}`] = r * 10; }
  const t = await loadPane({ book: { sheets: [{ name: 'Big', cells }, { name: 'Notes', cells: { A1: 'hello' } }] }, events: answer('ok') });
  try {
    t.lx.setMode('ask');
    await t.lx.sendInstruction('总结');
    const doc = t.calls[0].doc;
    assert.equal(doc.targets, undefined);
    assert.equal(doc.truncated, true);
    assert.match(doc.fullText, /【工作表「Big」 · 已用区域 A1:B3001 · 3001 行 × 2 列（当前工作表）】/);
    assert.match(doc.fullText, /\| 1 \| Row \| Value \|/);
    assert.match(doc.fullText, /（第 \d+–3001 行省略）/);
    assert.match(doc.fullText, /【工作表「Notes」/);
    assert.ok(doc.fullText.length < 120000);
    t.lx.setMode('edit');
    t.xl.select('Big', 'B2500:B2502');
    await t.lx.addTarget();
    await t.lx.sendInstruction('改');
    const ctx2 = t.calls[1].doc.fullText;
    assert.match(ctx2, /\| 2500 \| row 2500 \| 25000 \|/, 'rows around the target are included');
  } finally { await t.close(); }
});

test('📍 locate activates the sheet and selects the range', async () => {
  const t = await loadPane();
  try {
    t.xl.select('Regions', 'A2:B4');
    await t.lx.addTarget();
    t.xl.select('Orders', 'A1');
    await t.lx.revealTarget(t.lx.state.targets[0].id);
    assert.equal(t.xl.book.selection.sheet.name, 'Regions');
    assert.deepEqual(plain(t.xl.book.selection.areas[0]), { sheet: null, r1: 2, c1: 1, r2: 4, c2: 2 });
  } finally { await t.close(); }
});

test('older Excel without merged-cell checks still adds ranges', async () => {
  const t = await loadPane({ apiVersion: '1.9' });
  try {
    t.xl.select('Orders', 'B2:B3');
    await t.lx.addTarget();
    assert.equal(t.lx.state.targets.length, 1);
  } finally { await t.close(); }
});
