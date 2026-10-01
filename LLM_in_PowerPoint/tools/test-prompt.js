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

test('format prompts carry the slide snapshot, the slide image and the plan format; follow-ups resend the snapshot', () => {
  const fmtDoc = { docTitle: 'deck.pptx', slideCount: 4, format: '【第 2 页（共 4 页）】幻灯片大小 960×540 pt\n可以修改的形状（用户选中的 1 个，每行一个，JSON）：\n{"id":"5","kind":"shape"}' };
  const files = [{ name: 'slide-2.png', path: '/tmp/a/slide-2.png', mime: 'image/png' }];
  const p = buildPrompt({ mode: 'format', uiLanguage: 'en', doc: fmtDoc, messages: [{ role: 'user', content: 'lighter' }, { role: 'assistant', content: 'done' }, { role: 'user', content: 'lighter still' }], files });
  assert.match(p, /版式设计助手/);
  assert.match(p, /```format 围栏，里面是 JSON：\{"changes": \[ … \]\}/);
  assert.match(p, /只能用清单「可以修改的形状」里的 id/);
  assert.match(p, /整页美化 \/ 重新排版：/, 'redesign requests are told apart from small tweaks');
  assert.match(p, /"from": \{"id": "3", "para": "2"\}/, 'text moves into new cards only by copying it');
  assert.match(p, /文字要放得下/);
  assert.match(p, /==== 当前页的格式清单 ====\n【第 2 页（共 4 页）】/);
  assert.match(p, /slide-N\.png 的图片是面板截取的第 N 页渲染图/);
  assert.match(p, /此前的对话（页面可能已按之前的方案改过，一律以上面的清单和截图为准）/);
  assert.match(p, /用户本轮的要求：\nlighter still/);
  assert.match(p.split('\n').at(-1), /^Write the explanation in the language of the request above/);
  assert.doesNotMatch(p, /当前演示文稿的全部文字/, 'format mode does not send the deck text');
  const turn = buildTurnPrompt({ mode: 'format', uiLanguage: 'zh-CN', doc: fmtDoc, instruction: '再浅一点', files });
  assert.match(turn, /当前页的格式清单/);
  assert.match(turn, /用户本轮的要求：\n再浅一点/);
});

test('the self-check prompt shows the result, the geometry problems and asks for a pass or a fix', () => {
  const doc = { docTitle: 'deck.pptx', slideCount: 4, phase: 'check', format: '【第 2 页（共 4 页）】\n{"id":"9","kind":"shape"}', issues: ['形状 3 和形状 9 重叠（约 40 pt 见方）'] };
  const files = [{ name: 'slide-2-after.png', path: '/tmp/a/slide-2-after.png', mime: 'image/png' }];
  const p = buildPrompt({ mode: 'format', uiLanguage: 'zh-CN', doc, messages: [{ role: 'user', content: '整页美化' }], files });
  assert.match(p, /刚才已经按用户的要求改了这一页/);
  assert.match(p, /用户原来的要求：\n整页美化/);
  assert.match(p, /==== 改完后的格式清单 ====\n【第 2 页/);
  assert.match(p, /自动检测到的几何问题：\n- 形状 3 和形状 9 重叠/);
  assert.match(p, /没问题就说"通过"/);
  assert.doesNotMatch(p, /【先判断要做多大的改动】/, 'the design brief is not repeated');
});
