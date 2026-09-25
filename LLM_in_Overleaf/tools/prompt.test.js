import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, buildTurnPrompt } from '../server/prompt.js';

const doc = { fileName: 'main.tex', fullText: 'First\nUntouched gap\nLast', selections: [
  { id: 's2', text: 'First', line1: 1, line2: 1 },
  { id: 's7', text: 'Last', line1: 3, line2: 3 },
] };
test('fresh multi edit identifies each range and leaves the gap outside the replacements', () => {
  const prompt = buildPrompt({ mode: 'edit', doc, messages: [{ role: 'user', content: 'polish both' }] });
  assert.match(prompt, /```latex id=s2/);
  assert.match(prompt, /```latex id=s7/);
  assert.match(prompt, /2 个独立代码块/);
  assert.match(prompt, /段间未选中的内容保持不变/);
  assert.doesNotMatch(prompt, /整个回复只允许出现这一个代码块/);
});
test('cached sessions override the earlier single-range format', () => {
  const prompt = buildTurnPrompt({ mode: 'edit', doc, instruction: 'polish both' });
  assert.match(prompt, /覆盖此前所有单段输出约定/);
  assert.match(prompt, /选段 ID: s2/);
  assert.match(prompt, /选段 ID: s7/);
  assert.doesNotMatch(prompt, /Untouched gap/);
});
test('multi-range questions include both excerpts without requesting replacement blocks', () => {
  for (const prompt of [buildPrompt({ mode: 'ask', doc }), buildTurnPrompt({ mode: 'ask', doc })]) {
    assert.match(prompt, /选段 ID: s2/);
    assert.match(prompt, /选段 ID: s7/);
    assert.doesNotMatch(prompt, /```latex id=/);
  }
});
test('returning to one range resets the cached output format', () => {
  const prompt = buildTurnPrompt({ mode: 'edit', doc: { selection: 'First' } });
  assert.match(prompt, /本轮为单段改写/);
  assert.match(prompt, /唯一一个 ```latex/);
});
