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

test('edit prompts require the whole replacement, even for a long passage with one change', () => {
  const multi = { ...doc, targets: [{ k: 1, text: 'A', kind: 'text' }, { k: 2, text: 'B', kind: 'text' }] };
  assert.match(buildPrompt({ mode: 'edit', uiLanguage: 'zh-CN', doc, messages: [{ role: 'user', content: '改语法' }] }), /必须写出整段完整的替换文本[^\n]*不能只列出改了哪几处/);
  assert.match(buildPrompt({ mode: 'edit', uiLanguage: 'zh-CN', doc: multi, messages: [{ role: 'user', content: '改语法' }] }), /每个围栏都写出该目标完整的替换文本/);
  assert.match(buildTurnPrompt({ mode: 'edit', uiLanguage: 'zh-CN', doc, instruction: '改语法' }), /整段完整写出、不能只列改动/);
  assert.match(buildTurnPrompt({ mode: 'edit', uiLanguage: 'zh-CN', doc: multi, instruction: '改语法' }), /放该目标完整的纯文本[^\n]*不能只列改动/);
});
