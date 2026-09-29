import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
function load(language) {
  const context = { navigator: { language } };
  context.globalThis = context;
  vm.runInNewContext(read('extension/shared/i18n.js'), context);
  return context.LLMOverleafI18n;
}
const zh = load('zh-CN');
const en = load('en-US');
const catalog = en.catalog;

test('default language follows the browser', () => {
  assert.equal(zh.language, 'zh-CN');
  assert.equal(en.language, 'en');
  assert.equal(en.normalize('zh_TW'), 'zh-CN');
  assert.equal(en.normalize('fr-FR'), 'en');
});

test('every translated UI string used by the panel and popup has an English entry', () => {
  for (const file of ['extension/content/content.js', 'extension/popup/popup.js', 'extension/popup/popup.html']) {
    const source = read(file);
    for (const [, key] of source.matchAll(/(?:\bI18N\.t|\btr|\bt|\be)\(\s*'((?:[^'\\]|\\.)*)'/g)) {
      const value = key.replace(/\\n/g, '\n').replace(/\\'/g, "'");
      if (/[一-鿿]/.test(value)) assert.ok(value in catalog, `${file}: ${value}`);
    }
    for (const [, key] of source.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)) assert.ok(key in catalog, `${file}: ${key}`);
  }
});

test('translations keep every placeholder and contain no Chinese', () => {
  for (const [zhText, enText] of Object.entries(catalog)) {
    const slots = (value) => (value.match(/\{\d+\}/g) || []).sort().join();
    assert.equal(slots(enText), slots(zhText), zhText);
    if (zhText !== '、') assert.doesNotMatch(enText, /[一-鿿]/, zhText);
  }
});

test('messages formatted by the native host are translated in either direction', () => {
  assert.equal(en.known('请求超时：模型超过时限仍未完成，请降低思考强度或缩小选段范围。'), 'Request timed out. Lower the reasoning effort or select a smaller passage.');
  assert.equal(en.known('Claude Code 退出码 1\nboom'), 'Claude Code exited with code 1\nboom');
  assert.equal(en.known('默认 · gpt-5'), 'Default · gpt-5');
  assert.equal(en.known('选段 2 · 第 3–5 行'), 'Selection 2 · lines 3–5');
  assert.equal(zh.known('Selection 2 · lines 3–5'), '选段 2 · 第 3–5 行');
  assert.equal(en.known('Document text is never translated.'), 'Document text is never translated.');
});

test('Chrome store metadata exists in both locales', () => {
  const english = JSON.parse(read('extension/_locales/en/messages.json'));
  const chinese = JSON.parse(read('extension/_locales/zh_CN/messages.json'));
  assert.deepEqual(Object.keys(chinese).sort(), Object.keys(english).sort());
  for (const messages of [english, chinese]) assert.ok(messages.extDescription.message.length <= 132);
});
