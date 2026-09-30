// Every interface string has an English translation, and English strings contain no leftover Chinese.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { scriptKeys, htmlKeys } from './i18n-keys.js';

const read = (p) => readFileSync(new URL(`../taskpane/${p}`, import.meta.url), 'utf8');
const js = read('taskpane.js');
const ctx = { window: {}, localStorage: { getItem() {}, setItem() {} }, navigator: { language: 'en' } };
vm.createContext(ctx);
vm.runInContext(read('i18n.js'), ctx);
const EN = ctx.window.XlI18n.catalog;

// Strings passed to tr() through variables: presets, effort levels and model labels.
function dynamicKeys() {
  const keys = new Set();
  const block = (start, end) => js.slice(js.indexOf(start), js.indexOf(end, js.indexOf(start)));
  for (const m of block('const PRESETS = {', 'const MAX_TARGETS').matchAll(/\['([^']+)', '([^']+)'\]/g)) { keys.add(m[1]); keys.add(m[2]); }
  for (const m of block('const EFFORT_LABELS = {', '};').matchAll(/:\s*'([^']+)'/g)) keys.add(m[1]);
  for (const m of block('const MODELS = {', 'const EFFORTS').matchAll(/\['[^']+', '([^']+)'\]/g)) keys.add(m[1]);
  return keys;
}

test('every string shown by the pane has an English translation', () => {
  const grid = read('grid-utils.js');
  const gridErrors = [...grid.matchAll(/error: '([^']+)'/g)].map((m) => m[1]);
  const keys = new Set([...scriptKeys(js), ...htmlKeys(read('taskpane.html')), ...dynamicKeys(), ...gridErrors]);
  assert.ok(keys.size > 200, `found ${keys.size} strings`);
  const missing = [...keys].filter((k) => /[一-龥]/.test(k) && !(k in EN));
  assert.deepEqual(missing, []);
});

test('English strings contain no Chinese except the protocol markers the model uses', () => {
  const leftovers = Object.entries(EN).filter(([, en]) => /[一-龥]/.test(en.replace(/【目标k】/g, '')));
  assert.deepEqual(leftovers, []);
});

test('the extractor understands nested templates and escapes', () => {
  const keys = scriptKeys("tr`a ${x ? tr`b ${y}` : ''} c`; tr('d\\n'); tr(\"e\"); tr(`f`); notr('g')");
  assert.deepEqual([...keys].sort(), ['a {0} c', 'b {0}', 'd\n', 'e', 'f']);
});
