import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const context = {};
context.globalThis = context;
vm.runInNewContext(readFileSync(new URL('../extension/shared/diff.js', import.meta.url), 'utf8'), context);
const { diff, changeCount, edits, keyChanges } = context.LLMOverleafDiff;
const side = (ops, keep) => ops.filter(([t]) => t === '=' || t === keep).map(([, x]) => x).join('');
function check(a, b) {
  const ops = diff(a, b);
  assert.equal(side(ops, '-'), a, 'deletions and equal parts rebuild the old text');
  assert.equal(side(ops, '+'), b, 'insertions and equal parts rebuild the new text');
  return ops;
}
const plain = (ops) => JSON.parse(JSON.stringify(ops)); // arrays from the vm context

test('word-level changes in English', () => {
  assert.deepEqual(plain(check('Deep learning have revolutionized many field.', 'Deep learning has revolutionized many fields.')), [
    ['=', 'Deep learning '], ['-', 'have'], ['+', 'has'], ['=', ' revolutionized many '], ['-', 'field'], ['+', 'fields'], ['=', '.'],
  ]);
});

test('Chinese is compared character by character, not as one block', () => {
  const ops = check('实验表明效果很好。', '实验表明效果显著。');
  assert.deepEqual(plain(ops), [['=', '实验表明效果'], ['-', '很好'], ['+', '显著'], ['=', '。']]);
});

test('LaTeX commands stay whole', () => {
  const ops = check('as shown in \\cite{a} and \\ref{fig:1}', 'as shown in \\citep{a} and \\ref{fig:1}');
  assert.deepEqual(plain(ops.filter(([t]) => t !== '=')), [['-', '\\cite'], ['+', '\\citep']]);
});

test('identical and empty texts', () => {
  assert.equal(changeCount(check('Same.', 'Same.')), 0);
  assert.deepEqual(plain(check('', 'New.')), [['+', 'New.']]);
  assert.deepEqual(plain(check('Old.', '')), [['-', 'Old.']]);
});

test('a long passage with a few edits gets a precise diff quickly', () => {
  const sentence = (i) => `In experiment ${i}, the proposed method have achieved a accuracy of ${80 + i % 17}.${i % 10}% on the benchmark.`;
  const a = Array.from({ length: 400 }, (_, i) => sentence(i)).join(' ');
  const b = a.replace('experiment 5, the proposed method have', 'experiment 5, the proposed method has').replace('experiment 399, the proposed method have achieved a', 'experiment 399, the proposed method have achieved an');
  assert.ok(a.length > 30000);
  const started = performance.now();
  const ops = check(a, b);
  assert.ok(performance.now() - started < 1000);
  assert.equal(changeCount(ops), 2);
  assert.deepEqual(plain(ops.filter(([t]) => t === '+')), [['+', 'has'], ['+', 'an']]);
});

test('every sentence polished: still word level when the sentence count is kept', () => {
  const a = Array.from({ length: 200 }, (_, i) => `Sentence ${i} have a error and is to long for the reader.`).join(' ');
  const b = Array.from({ length: 200 }, (_, i) => `Sentence ${i} has an error and is too long for readers across all ${i} evaluation settings we report.`).join(' ');
  const ops = check(a, b);
  assert.ok(changeCount(ops) >= 200);
  assert.ok(ops.every(([t, x]) => t === '=' || x.length < 200), 'no whole-passage replacement block');
});

test('a complete rewrite shows one deletion and one insertion', () => {
  const a = Array.from({ length: 3000 }, (_, i) => 'w' + (i % 101)).join(' ');
  const b = Array.from({ length: 3000 }, (_, i) => 'v' + ((i * 7) % 97)).join(' ');
  const ops = check(a, b);
  assert.deepEqual(plain(ops.map(([t]) => t)), ['-', '+']);
});

test('random edits always rebuild both sides', () => {
  let seed = 7;
  const rand = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const alphabet = ['a', 'b', ' ', '中', '文', '。', '.', '\n', 'xy', '\\cite', '😀'];
  const text = (n) => Array.from({ length: n }, () => alphabet[rand(alphabet.length)]).join('');
  for (let k = 0; k < 1500; k++) {
    const a = text(rand(80));
    const b = rand(2) ? text(rand(80)) : a.slice(0, 10) + text(rand(6)) + a.slice(14);
    check(a, b);
  }
});

test('edits for writing change only the changed spans and rebuild the new text', () => {
  const apply = (a, list) => [...list].reverse().reduce((s, e) => s.slice(0, e.at) + e.ins + s.slice(e.at + e.del), a);
  const a = 'Deep learning have revolutionized many field \\cite{lecun2015}. We study a new method.';
  const b = 'Deep learning has revolutionized many fields \\cite{lecun2015}. We study a new method.';
  const list = plain(edits(a, b));
  assert.deepEqual(list, [{ at: 14, del: 4, ins: 'has' }, { at: 39, del: 5, ins: 'fields' }]);
  assert.equal(apply(a, list), b);
  assert.deepEqual(plain(edits('same', 'same')), []);
  let seed = 3;
  const rand = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const alphabet = ['a', 'b', ' ', '中', '。', '.', '\n', '\\cite{x}', '😀'];
  const text = (n) => Array.from({ length: n }, () => alphabet[rand(alphabet.length)]).join('');
  for (let k = 0; k < 800; k++) {
    const x = text(rand(60)), y = rand(2) ? text(rand(60)) : x.slice(0, 7) + text(rand(5)) + x.slice(11);
    const list2 = edits(x, y);
    assert.equal(apply(x, list2), y);
    for (let i = 1; i < list2.length; i++) assert.ok(list2[i].at >= list2[i - 1].at + list2[i - 1].del, 'ordered, not overlapping');
  }
});

test('changed citation and reference keys are reported', () => {
  const a = 'As shown \\citep[see][p.~3]{smith2020, wang2021} and in Fig.~\\ref{fig:a}. \\label{sec:x}';
  assert.deepEqual(plain(keyChanges(a, a)), { removed: [], added: [] });
  assert.deepEqual(plain(keyChanges(a, a.replace('wang2021', 'li2022'))), { removed: ['wang2021'], added: ['li2022'] });
  assert.deepEqual(plain(keyChanges(a, 'As shown before.')), { removed: ['smith2020', 'wang2021', 'fig:a', 'sec:x'], added: [] });
  assert.deepEqual(plain(keyChanges('\\href{https://a.org}{site}', '\\href{https://b.org}{site}')), { removed: [], added: [] }, 'links are not citations');
});
