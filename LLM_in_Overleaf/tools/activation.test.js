import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const worker = readFileSync(new URL('../extension/background/service-worker.js', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
function setup({ url = 'https://www.overleaf.com/project/abcdef123456', missing = false, injectError = false } = {}) {
  const calls = [];
  let onMessage, onCommand, messages = 0;
  const chrome = {
    runtime: { onMessage: { addListener: (f) => { onMessage = f; } }, onConnect: { addListener() {} } },
    commands: { onCommand: { addListener: (f) => { onCommand = f; } } },
    tabs: {
      query: async () => [{ id: 7, url }],
      sendMessage: async (id, msg) => {
        calls.push({ kind: 'message', id, ...msg });
        if (missing && messages++ === 0) throw new Error('Receiving end does not exist.');
        return { ok: true };
      },
    },
    scripting: { executeScript: async (options) => {
      calls.push({ kind: 'inject', ...options });
      if (injectError) throw new Error('Cannot access page');
    } },
    action: { setBadgeText: async () => {}, setTitle: async () => {} },
  };
  vm.runInNewContext(worker, { chrome, setTimeout, clearTimeout });
  return { calls, open: () => new Promise((resolve) => onMessage({ type: 'open_active_panel' }, {}, resolve)), command: () => onCommand('toggle-panel') };
}

test('popup opens an existing content script without reinjecting', async () => {
  const app = setup();
  assert.equal((await app.open()).ok, true);
  assert.deepEqual(app.calls.map((c) => c.type), ['open_panel']);
});
test('all supported Overleaf domains allow both automatic injection and popup recovery', async () => {
  for (const domain of ['overleaf.com', 'www.overleaf.com', 'cn.overleaf.com']) {
    // Keep the manifest and background allowlist aligned; both must allow the Chinese site.
    for (const script of manifest.content_scripts) {
      assert.ok(script.matches.includes(`https://${domain}/project/*`), `${domain}: ${script.js}`);
    }
    for (const missing of [false, true]) {
      const app = setup({ url: `https://${domain}/project/abcdef123456?x=1#editor`, missing });
      assert.equal((await app.open()).ok, true, `${domain}: missing=${missing}`);
      assert.deepEqual(app.calls.map((c) => c.world || c.type), missing
        ? ['open_panel', 'MAIN', 'ISOLATED', 'open_panel'] : ['open_panel']);
    }
  }
});
test('already-open project receives MAIN bridge before isolated UI', async () => {
  const app = setup({ missing: true, url: 'https://overleaf.com/project/abcdef123456?x=1' });
  assert.equal((await app.open()).ok, true);
  assert.deepEqual(app.calls.map((c) => c.world || c.type), ['open_panel', 'MAIN', 'ISOLATED', 'open_panel']);
});
test('shortcut also recovers a missing content script', async () => {
  const app = setup({ missing: true });
  await app.command();
  assert.deepEqual(app.calls.map((c) => c.world || c.type), ['toggle_panel', 'MAIN', 'ISOLATED', 'toggle_panel']);
});
test('non-project pages never receive an injection', async () => {
  for (const url of ['https://www.overleaf.com/project', 'https://cn.overleaf.com/project', 'https://example.com/project/abcdef', 'https://www.overleaf.com.evil.test/project/abcdef', 'https://cn.overleaf.com.evil.test/project/abcdef', 'https://cn.overleaf.com@evil.test/project/abcdef']) {
    const app = setup({ url });
    assert.match((await app.open()).error, /项目编辑页/);
    assert.equal(app.calls.length, 0);
  }
});
test('failed injection returns actionable feedback', async () => {
  const app = setup({ missing: true, injectError: true });
  const result = await app.open();
  assert.equal(result.ok, false);
  assert.match(result.error, /刷新/);
});
