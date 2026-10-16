import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, buildTurnPrompt } from '../server/prompt.js';

const doc = { selection: '原文', fullText: '【选中段开始】原文【选中段结束】' };
test('explanations follow the instruction language, falling back to the interface language', () => {
  for (const build of [
    (lang) => buildPrompt({ mode: 'edit', uiLanguage: lang, doc, messages: [{ role: 'user', content: 'polish' }] }),
    (lang) => buildTurnPrompt({ mode: 'edit', uiLanguage: lang, doc, instruction: 'polish' }),
  ]) {
    assert.match(build('en'), /【回复语言】[^\n]*用户本轮指令所用的语言[^\n]*英文（English）/);
    assert.match(build('zh-CN'), /【回复语言】[^\n]*难以判断时使用中文/);
    assert.match(build('en'), /替换内容本身保持原文的语言/);
    assert.doesNotMatch(build('en'), /中文写作助手|中文说明/);
  }
  assert.match(buildPrompt({ mode: 'ask', uiLanguage: 'en', doc, messages: [{ role: 'user', content: 'Summarize' }] }), /使用用户本轮提问所用的语言回答；难以判断时使用英文/);
});

test('targets with citation fields ask the model to keep the citations exactly', () => {
  const withFields = { ...doc, targets: [{ k: 1, text: 'Adoption grew (1).', kind: 'text', fields: 1 }, { k: 2, text: 'Grids were weak (2)(3).', kind: 'text', fields: 2 }] };
  for (const p of [buildPrompt({ mode: 'edit', uiLanguage: 'zh-CN', doc: withFields, messages: [{ role: 'user', content: '润色' }] }), buildTurnPrompt({ mode: 'edit', uiLanguage: 'zh-CN', doc: withFields, instruction: '润色' })]) {
    assert.match(p, /【文献引用】选中内容里有 3 处文献引用/);
  }
  assert.doesNotMatch(buildPrompt({ mode: 'edit', uiLanguage: 'zh-CN', doc, messages: [{ role: 'user', content: '润色' }] }), /【文献引用】/);
  assert.doesNotMatch(buildPrompt({ mode: 'ask', uiLanguage: 'zh-CN', doc: withFields, messages: [{ role: 'user', content: '总结' }] }), /【文献引用】/);
});
