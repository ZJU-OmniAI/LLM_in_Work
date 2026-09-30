import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, buildTurnPrompt } from '../server/prompt.js';

const doc = { docTitle: 'deck.pptx', slideCount: 3, targets: [{ k: 1, text: '原文', where: '第 2 页的正文' }], fullText: '【第 2 页】\n[正文]\n【选中段开始】\n原文\n【选中段结束】' };

test('explanations follow the instruction language, falling back to the interface language', () => {
  for (const build of [
    (lang) => buildPrompt({ mode: 'edit', uiLanguage: lang, doc, messages: [{ role: 'user', content: 'polish' }] }),
    (lang) => buildTurnPrompt({ mode: 'edit', uiLanguage: lang, doc, instruction: 'polish' }),
  ]) {
    assert.match(build('en'), /【回复语言】[^\n]*用户本轮指令所用的语言[^\n]*英文（English）/);
    assert.match(build('zh-CN'), /【回复语言】[^\n]*难以判断时使用中文/);
    assert.match(build('en'), /替换内容本身保持原文的语言/);
  }
  assert.match(buildPrompt({ mode: 'ask', uiLanguage: 'en', doc, messages: [{ role: 'user', content: 'Summarize' }] }), /使用用户本轮提问所用的语言回答；难以判断时使用英文/);
  const enAsk = buildPrompt({ mode: 'ask', uiLanguage: 'en', doc, messages: [{ role: 'user', content: 'Summarize' }] });
  assert.match(enAsk.split('\n').at(-1), /^Answer entirely in the language of the question above/, 'English reminder comes last');
  assert.match(buildTurnPrompt({ mode: 'edit', uiLanguage: 'en', doc, instruction: 'polish' }).split('\n').at(-1), /^Write any explanation outside the code fences/);
  assert.doesNotMatch(buildPrompt({ mode: 'ask', uiLanguage: 'zh-CN', doc, messages: [{ role: 'user', content: '总结' }] }), /Answer entirely/);
});

test('edit prompts describe slides: one line per bullet, no bullet symbols, keep text short', () => {
  const p = buildPrompt({ mode: 'edit', doc, messages: [{ role: 'user', content: '精简' }] });
  assert.match(p, /Microsoft PowerPoint/);
  assert.match(p, /一行就是文本框里的一个段落/);
  assert.match(p, /项目符号是 PowerPoint 的段落格式/);
  assert.match(p, /不要明显加长文字/);
  assert.match(p, /演示文稿：deck\.pptx · 共 3 页/);
  assert.match(p, /不含演讲者备注/);
  assert.match(p, /用户选中的文字（第 2 页的正文；/);
  assert.match(p, /列数必须保持不变/);
  const multi = buildPrompt({ mode: 'edit', doc: { ...doc, targets: [{ k: 1, text: 'a', where: '第 1 页的标题' }, { k: 2, kind: 'table', rows: 2, cols: 2, text: '| a | b |', where: '第 3 页的表格' }] }, messages: [{ role: 'user', content: 'x' }] });
  assert.match(multi, /【目标1开始】【目标1结束】…【目标2开始】【目标2结束】/);
  assert.match(multi, /---- 目标1（第 1 页的标题） ----/);
  assert.match(multi, /---- 目标2（表格 2×2，第 3 页的表格，Markdown 表示，输出用 ```table） ----/);
});

test('ask prompts ask for slide numbers; the slide-image note appears only with a slide image', () => {
  const ask = buildPrompt({ mode: 'ask', doc: { ...doc, targets: [] }, messages: [{ role: 'user', content: '总结' }] });
  assert.match(ask, /注明页码/);
  assert.doesNotMatch(ask, /slide-N\.png/);
  const withImage = buildPrompt({ mode: 'ask', backend: 'claude', doc, messages: [{ role: 'user', content: '版式' }], files: [{ name: 'slide-2.png', path: '/tmp/slide-2.png', mime: 'image/png' }] });
  assert.match(withImage, /slide-N\.png 的图片是面板截取的第 N 页渲染图/);
  assert.match(withImage, /不要输出“我先看一下”之类的过程说明/);
  const turn = buildTurnPrompt({ mode: 'edit', doc, instruction: '再短一点', files: [{ name: 'photo.png', path: '/tmp/photo.png', mime: 'image/png' }] });
  assert.doesNotMatch(turn, /slide-N\.png/);
  assert.match(turn, /禁 Markdown 记号和项目符号/);
});
