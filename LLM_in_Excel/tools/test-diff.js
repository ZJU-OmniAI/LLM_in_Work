import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

await import('../taskpane/diff-utils.js'); // UMD 副作用挂到 globalThis
const { ops, diff, changeCount, fold } = globalThis.DiffUtils;
const side = (list, keep) => list.filter(([t]) => t === '=' || t === keep).map(([, x]) => x).join('');
function check(a, b, fn = diff) {
  const list = fn(a, b);
  assert.equal(side(list, '-'), a, 'deletions and equal parts rebuild the old text');
  assert.equal(side(list, '+'), b, 'insertions and equal parts rebuild the new text');
  return list;
}

test('the Word, PowerPoint and Excel copies are identical', () => {
  const mine = readFileSync(new URL('../taskpane/diff-utils.js', import.meta.url), 'utf8');
  for (const other of ['LLM_in_Word', 'LLM_in_PowerPoint', 'LLM_in_Excel']) {
    const file = new URL(`../../${other}/taskpane/diff-utils.js`, import.meta.url);
    if (existsSync(file)) assert.equal(readFileSync(file, 'utf8'), mine, other);
  }
});

test('word-level changes in English', () => {
  assert.deepEqual(check('Deep learning have revolutionized many field.', 'Deep learning has revolutionized many fields.'), [
    ['=', 'Deep learning '], ['-', 'have'], ['+', 'has'], ['=', ' revolutionized many '], ['-', 'field'], ['+', 'fields'], ['=', '.'],
  ]);
});

test('Chinese is compared character by character, not as one block', () => {
  assert.deepEqual(check('实验表明效果很好。', '实验表明效果显著。'), [['=', '实验表明效果'], ['-', '很好'], ['+', '显著'], ['=', '。']]);
});

test('identical and empty texts', () => {
  assert.equal(changeCount(check('Same.', 'Same.')), 0);
  assert.deepEqual(check('', 'New.'), [['+', 'New.']]);
  assert.deepEqual(check('Old.', ''), [['-', 'Old.']]);
});

test('ops keeps short unchanged pieces exact for writing; diff merges them for reading', () => {
  const a = 'The cat sat on a mat.', b = 'The dog sat on the rug.';
  assert.deepEqual(check(a, b, ops), [['=', 'The '], ['-', 'cat'], ['+', 'dog'], ['=', ' sat on '], ['-', 'a'], ['+', 'the'], ['=', ' '], ['-', 'mat'], ['+', 'rug'], ['=', '.']]);
  assert.deepEqual(check(a, b), [['=', 'The '], ['-', 'cat'], ['+', 'dog'], ['=', ' sat on '], ['-', 'a mat'], ['+', 'the rug'], ['=', '.']]);
  for (const list of [ops(a, b), diff(a, b)]) {
    assert.ok(list.every(([t], i) => t !== '+' || i === 0 || list[i - 1][0] !== '+'), 'one insertion per change');
    assert.ok(list.every(([t], i) => t !== '-' || i + 1 >= list.length || list[i + 1][0] !== '-'), 'deletion comes before insertion');
  }
});

test('a new paragraph is inserted after the line break that ends the paragraph before it', () => {
  const a = 'First\nSecond\nLast', b = 'First\nSecond\nAdded\nLast';
  assert.deepEqual(check(a, b, ops), [['=', 'First\nSecond'], ['+', '\nAdded'], ['=', '\nLast']]);
  assert.deepEqual(check('A\n', 'A\nB\n', ops), [['=', 'A'], ['+', '\nB'], ['=', '\n']]);
  assert.deepEqual(check('A\nB\nC', 'A\nC', ops), [['=', 'A\n'], ['-', 'B\n'], ['=', 'C']], 'deleted paragraphs take their own line break');
});

test('a long passage with a few edits gets a precise diff quickly', () => {
  const sentence = (i) => `In experiment ${i}, the proposed method have achieved a accuracy of ${80 + i % 17}.${i % 10}% on the benchmark.`;
  const a = Array.from({ length: 400 }, (_, i) => sentence(i)).join(' ');
  const b = a.replace('experiment 0, the proposed method have', 'experiment 0, the proposed method has').replace('experiment 399, the proposed method have achieved a', 'experiment 399, the proposed method have achieved an');
  assert.ok(a.length > 30000);
  const started = performance.now();
  const list = check(a, b);
  check(a, b, ops);
  assert.ok(performance.now() - started < 1000);
  assert.equal(changeCount(list), 2);
  assert.deepEqual(list.filter(([t]) => t === '+'), [['+', 'has'], ['+', 'an']]);
});

test('a long Chinese passage keeps character-level changes', () => {
  const a = Array.from({ length: 300 }, (_, i) => `第${i}组实验的结果难于复现，原因是数据的的划分不一致。`).join('');
  const b = a.replace('第0组实验的结果难于复现', '第0组实验的结果难以复现').replace('第299组实验的结果难于复现，原因是数据的的划分', '第299组实验的结果难于复现，原因是数据的划分');
  const list = check(a, b);
  assert.equal(changeCount(list), 2);
  assert.deepEqual(list.filter(([t]) => t !== '='), [['-', '于'], ['+', '以'], ['-', '的']]);
});

test('every sentence polished: still word level when the sentence count is kept', () => {
  const a = Array.from({ length: 200 }, (_, i) => `Sentence ${i} have a error and is to long for the reader.`).join(' ');
  const b = Array.from({ length: 200 }, (_, i) => `Sentence ${i} has an error and is too long for readers across all ${i} evaluation settings we report.`).join(' ');
  const list = check(a, b);
  assert.ok(changeCount(list) >= 200);
  assert.ok(list.every(([t, x]) => t === '=' || x.length < 200), 'no whole-passage replacement block');
});

test('a complete rewrite shows one deletion and one insertion', () => {
  const a = Array.from({ length: 3000 }, (_, i) => 'w' + (i % 101)).join(' ');
  const b = Array.from({ length: 3000 }, (_, i) => 'v' + ((i * 7) % 97)).join(' ');
  assert.deepEqual(check(a, b).map(([t]) => t), ['-', '+']);
});

test('long unchanged text folds at whitespace and keeps both ends', () => {
  const s = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ');
  assert.equal(fold('short', false, false), null);
  const [head, mid, tail] = fold(s, false, false);
  assert.equal(head + mid + tail, s);
  assert.ok(head.length >= 160 && head.length < 200 && /\s$/.test(head));
  assert.ok(tail.length >= 160 && tail.length < 200 && /\s$/.test(mid));
  assert.equal(fold(s, true, false)[0], '');
  assert.equal(fold(s, false, true)[2], '');
  const emoji = '😀'.repeat(400);
  for (const part of fold(emoji, false, false)) assert.equal(part.length % 2, 0, 'no split surrogate pair');
});

test('random edits always rebuild both sides', () => {
  let seed = 7;
  const rand = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const alphabet = ['a', 'b', ' ', '中', '文', '。', '.', '\n', 'xy', '_', '😀'];
  const text = (n) => Array.from({ length: n }, () => alphabet[rand(alphabet.length)]).join('');
  for (let k = 0; k < 1500; k++) {
    const a = text(rand(80));
    const b = rand(2) ? text(rand(80)) : a.slice(0, 10) + text(rand(6)) + a.slice(14);
    check(a, b);
    check(a, b, ops);
  }
});
