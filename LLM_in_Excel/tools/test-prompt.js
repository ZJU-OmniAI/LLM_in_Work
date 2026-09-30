import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, buildTurnPrompt } from '../server/prompt.js';

const grid = '|   | H |\n| --- | --- |\n| 2 |  |\n| 3 |  |';
const doc = { docTitle: 'book.xlsx', sheetCount: 2, activeSheet: 'Orders', targets: [{ k: 1, text: grid, where: 'Orders!H2:H3，2 行 × 1 列，目前是空白' }], fullText: '【工作表「Orders」】\n|   | G | H |\n| --- | --- | --- |\n| 1 | Feedback | Category |' };

test('explanations follow the instruction language, falling back to the interface language', () => {
  for (const build of [
    (lang) => buildPrompt({ mode: 'edit', uiLanguage: lang, doc, messages: [{ role: 'user', content: 'fill' }] }),
    (lang) => buildTurnPrompt({ mode: 'edit', uiLanguage: lang, doc, instruction: 'fill' }),
  ]) {
    assert.match(build('en'), /【回复语言】[^\n]*用户本轮指令所用的语言[^\n]*英文（English）/);
    assert.match(build('zh-CN'), /【回复语言】[^\n]*难以判断时使用中文/);
    assert.match(build('en').split('\n').at(-1), /^Write any explanation outside the code fences/);
    assert.doesNotMatch(build('zh-CN'), /Write any explanation/);
  }
  assert.match(buildPrompt({ mode: 'ask', uiLanguage: 'en', doc, messages: [{ role: 'user', content: 'Summarize' }] }).split('\n').at(-1), /^Answer entirely in the language of the question/);
});

test('edit prompts describe the coordinate table protocol and the typing rules', () => {
  const p = buildPrompt({ mode: 'edit', doc, messages: [{ role: 'user', content: '分类' }] });
  assert.match(p, /Microsoft Excel/);
  assert.match(p, /第一行是列字母（第一格留空），每行第一格是行号/);
  assert.match(p, /只需要列出有改动的行和列/);
  assert.match(p, /以英文单引号 ' 开头表示「按文本保存」/);
  assert.match(p, /英文函数名/);
  assert.match(p, /只能写到|不能写到目标区域外已有内容的单元格/);
  assert.match(p, /工作簿：book\.xlsx · 共 2 张工作表 · 当前工作表：Orders/);
  assert.match(p, /---- 目标1（Orders!H2:H3，2 行 × 1 列，目前是空白） ----\n\|   \| H \|/);
  assert.match(p, /整个回复只允许出现这一个围栏/);
  const multi = buildPrompt({ mode: 'edit', doc: { ...doc, targets: [doc.targets[0], { k: 2, text: grid, where: 'Orders!B2:B3' }] }, messages: [{ role: 'user', content: 'x' }] });
  assert.match(multi, /先单独一行写【目标k】/);
  assert.match(multi, /用户选中的 2 个目标区域/);
});

test('ask prompts ask for cell addresses; turn prompts resend the current target ranges', () => {
  const ask = buildPrompt({ mode: 'ask', doc: { ...doc, targets: [] }, messages: [{ role: 'user', content: '总结' }] });
  assert.match(ask, /注明单元格或区域地址/);
  assert.doesNotMatch(ask, /目标区域结束/);
  const turn = buildTurnPrompt({ mode: 'edit', doc, instruction: '再短一点' });
  assert.match(turn, /本轮的目标区域如下/);
  assert.match(turn, /只列出有改动的行和列/);
  const withImage = buildPrompt({ mode: 'ask', backend: 'claude', doc, messages: [{ role: 'user', content: '图表' }], files: [{ name: 'chart.png', path: '/tmp/chart.png', mime: 'image/png' }] });
  assert.match(withImage, /不要输出“我先看一下”之类的过程说明/);
});
