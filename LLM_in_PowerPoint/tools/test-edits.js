// Pure-function tests: minimal edit planning, reply cleanup, target relocation, deck context and fence parsing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPane } from './pane-harness.js';

const pane = await loadPane({ office: false });
const T = pane.w.__lp_test;
// Values created inside jsdom belong to another realm; compare plain copies.
const plain = (x) => JSON.parse(JSON.stringify(x));
test.after(() => pane.close());

test('planned edits turn the old text into the new text, in both scripts and with line breaks', () => {
  const cases = [
    ['Revenue grew 23% year over year', 'Revenue grew 23% YoY'],
    ['Active users passed 1 million for the first time', 'Active users passed 1.2 million for the first time'],
    ['我们的目标是在明年实现盈利，并把客户满意度提升到九十分以上。', '目标：明年盈利，客户满意度达到 90 分以上。'],
    ['第一条\n第二条\n第三条', '第一条\n新的第二条\n第三条\n第四条'],
    ['a\nb\nc', 'c'],
    ['', 'brand new'],
    ['delete everything', ''],
    ['same', 'same'],
  ];
  for (const [a, b] of cases) {
    const edits = T.planEdits(a, b);
    assert.equal(T.applyEditsToString(a, edits), b, `${a} → ${b}`);
    for (let i = 1; i < edits.length; i++) assert.ok(edits[i].pos >= edits[i - 1].pos + edits[i - 1].del, 'edits are ordered and do not overlap');
  }
});

test('random rewrites always round-trip', () => {
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const alphabet = ['a', 'b', 'c', ' ', '\n', '字', '词', '，', 'Word', '23%'];
  const make = () => Array.from({ length: rnd(30) }, () => alphabet[rnd(alphabet.length)]).join('');
  for (let k = 0; k < 400; k++) {
    const a = make(), b = make();
    assert.equal(T.applyEditsToString(a, T.planEdits(a, b)), b, JSON.stringify([a, b]));
  }
});

test('unchanged words are never rewritten, so their formatting survives', () => {
  const a = 'Active users passed 1 million for the first time';
  const edits = T.planEdits(a, 'Active users passed 1 million for the second time');
  assert.equal(edits.length, 1);
  assert.equal(a.slice(edits[0].pos, edits[0].pos + edits[0].del), 'first');
  assert.equal(edits[0].ins, 'second');
});

test('diffs do not split English words at the shared prefix or suffix', () => {
  const ops = T.diffOps('What we achieved this quarter', 'Breakout Quarter');
  const changed = plain(ops.filter(([t]) => t !== '=').map(([t, s]) => t + s));
  assert.ok(changed.includes('-quarter') && changed.includes('+Quarter'), JSON.stringify(changed));
  for (let i = 1; i < ops.length; i++) assert.ok(!(/\w$/.test(ops[i - 1][1]) && /^\w/.test(ops[i][1]) && (ops[i - 1][0] === '=' || ops[i][0] === '=')), 'no word is split by an unchanged part');
  assert.deepEqual(plain(T.diffOps('grew 23%', 'grew 25%')), [['=', 'grew '], ['-', '23'], ['+', '25'], ['=', '%']]);
  assert.deepEqual(plain(T.diffOps('营收增长了', '营收增长')), [['=', '营收增长'], ['-', '了']]);
});

test('paragraph and line breaks map one-to-one so positions match PowerPoint', () => {
  assert.equal(T.normNL('a\rb\vc'), 'a\nb\nc');
  assert.equal(T.normNL('a\rb').length, 3);
  assert.equal(T.toPptText('one\ntwo\r\nthree'), 'one\rtwo\rthree');
  assert.equal(T.toPptText('a\nb\nc', 'x\vy'), 'a\vb\rc', 'soft line breaks in the replaced text stay soft');
});

test('replies are cleaned up: Markdown bullets and trailing blank lines removed only when they are not in the slide', () => {
  assert.equal(T.cleanReplacement('- First\n- Second\n', 'First point\nSecond point'), 'First\nSecond');
  assert.equal(T.cleanReplacement('• 第一条\n• 第二条', '第一条\n第二条'), '第一条\n第二条');
  assert.equal(T.cleanReplacement('- First\nSecond', 'First\nSecond'), '- First\nSecond', 'mixed lines are kept');
  assert.equal(T.cleanReplacement('- a\n- b', '- a\n- c'), '- a\n- b', 'the slide itself uses dashes');
  assert.equal(T.cleanReplacement('Growth −3%', 'Growth -3%'), 'Growth −3%');
});

test('targets are found again after edits around them', () => {
  const t = { start: 5, length: 5, text: 'world', whole: false };
  assert.deepEqual(plain(T.locateTarget(t, 'hello world')), { start: 6, length: 5, text: 'world' });
  assert.deepEqual(plain(T.locateTarget(t, 'hellworld')), { start: 4, length: 5, text: 'world' });
  assert.equal(T.locateTarget(t, 'hello there'), null);
  const dup = { start: 12, length: 3, text: 'abc', whole: false };
  assert.equal(T.locateTarget(dup, 'abc xx abc yy abc').start, 14, 'nearest copy wins');
  assert.deepEqual(plain(T.locateTarget({ whole: true, start: 0, length: 3, text: 'old' }, 'new text')), { start: 0, length: 8, text: 'new text' });
});

const deck = () => [
  { id: 's1', no: 1, shapes: [
    { id: '2', role: 'title', kind: 'text', text: 'Q3 review', ord: 0 },
    { id: '9', role: 'footer', kind: 'text', text: 'Confidential', ord: 1 },
  ] },
  { id: 's2', no: 2, shapes: [
    { id: '2', role: 'title', kind: 'text', text: 'Results', ord: 0 },
    { id: '3', role: 'body', kind: 'text', text: 'Revenue up\nUsers up', ord: 1 },
    { id: '4', role: 'table', kind: 'table', text: '| a | b |\n| --- | --- |\n| 1 | 2 |', values: [['a', 'b'], ['1', '2']], ord: 2 },
  ] },
];

test('deck context lists slides and marks targets where they are', () => {
  const one = T.buildDeckContext(deck(), [{ slideId: 's2', shapeId: '3', start: 11, length: 8 }]);
  assert.match(one.fullText, /【第 1 页】\n\[标题\] Q3 review/);
  assert.doesNotMatch(one.fullText, /Confidential/, 'footers are left out');
  assert.match(one.fullText, /\[正文\]\nRevenue up\n\n【选中段开始】\nUsers up\n【选中段结束】/);
  assert.match(one.fullText, /\[表格 2×2\]\n\| a \| b \|/);
  assert.equal(one.slideCount, 2);
  const two = T.buildDeckContext(deck(), [{ slideId: 's1', shapeId: '2', start: 0, length: 9 }, { slideId: 's2', shapeId: '4', start: 0, length: 5 }]);
  assert.match(two.fullText, /\[标题\]\n【目标1开始】\nQ3 review\n【目标1结束】\n\n【第 2 页】/);
  assert.match(two.fullText, /\[表格 2×2\]\n【目标2开始】\n\| a \| b \|[\s\S]*【目标2结束】/);
});

test('long decks keep the target slides and say which slides were left out', () => {
  const big = Array.from({ length: 40 }, (_, i) => ({ id: 's' + i, no: i + 1, shapes: [{ id: '2', role: 'body', kind: 'text', text: `Slide ${i + 1} ` + 'x'.repeat(900), ord: 0 }] }));
  const ctx = T.buildDeckContext(big, [{ slideId: 's30', shapeId: '2', start: 0, length: 5 }], 8000);
  assert.equal(ctx.truncated, true);
  assert.match(ctx.fullText, /【第 31 页】/);
  assert.match(ctx.fullText, /【第 1–\d+ 页过长省略】/);
  assert.ok(ctx.fullText.length < 9000);
});

test('targets are renumbered in slide order and lost ones are counted', () => {
  const d = deck();
  const { list, lost } = T.syncTargets(d, [
    { id: 'a', slideId: 's2', shapeId: '3', kind: 'text', start: 0, length: 10, text: 'Revenue up', whole: false },
    { id: 'b', slideId: 's1', shapeId: '2', kind: 'text', start: 0, length: 9, text: 'Q3 review', whole: true },
    { id: 'c', slideId: 's2', shapeId: '3', kind: 'text', start: 0, length: 4, text: 'gone', whole: false },
    { id: 'd', slideId: 'missing', shapeId: '1', kind: 'text', start: 0, length: 1, text: 'x', whole: true },
  ]);
  assert.deepEqual(plain(list.map((t) => t.id)), ['b', 'a']);
  assert.equal(lost, 2);
  assert.equal(list[1].slideNo, 2);
});

test('replacement fences are matched to target numbers', () => {
  const raw = '说明\n【目标2】\n```text\nB\n```\n【目标1】\n```text\nA\n```';
  const reps = T.parseReplacements(raw, 2);
  assert.deepEqual(plain(reps.map((r) => [r.k, r.code])), [[1, 'A'], [2, 'B']]);
  assert.equal(T.stripFences(raw, reps), '说明');
  assert.equal(T.parseReplacements('```text\nx\n```\n```text\ny\n```\n```text\nz\n```', 2), null, 'unlabeled fences that do not match the target count are not guessed');
});

test('shape roles and reading order', () => {
  assert.equal(T.roleOf('Placeholder', 'CenterTitle'), 'title');
  assert.equal(T.roleOf('Placeholder', 'Subtitle'), 'subtitle');
  assert.equal(T.roleOf('Placeholder', 'SlideNumber'), 'footer');
  assert.equal(T.roleOf('Placeholder', 'Content'), 'body');
  assert.equal(T.roleOf('TextBox'), 'textbox');
  assert.equal(T.roleOf('Table'), 'table');
  const sorted = T.sortShapes([{ id: 'c', top: 300, left: 0 }, { id: 'b', top: 22, left: 400 }, { id: 'a', top: 25, left: 30 }]);
  assert.deepEqual(plain(sorted.map((s) => s.id)), ['a', 'b', 'c']);
});
