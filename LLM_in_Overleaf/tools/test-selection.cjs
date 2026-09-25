const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const { build } = require('esbuild');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const project = path.resolve(__dirname, '..');
const origin = process.argv[2] || 'https://www.overleaf.com';
const outputDir = process.env.OVERLEAF_EDIT_TEST_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'overleaf-edit-selection-'));
fs.mkdirSync(outputDir, { recursive: true });

(async () => {
  const fixture = await build({ entryPoints: [path.join(__dirname, 'fixtures/editor.js')], bundle: true, write: false });
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(8000);
    const clearTargets = async () => {
      await page.locator('#ole-context-summary').click();
      await page.locator('#ole-target-clear').click();
    };
    const waitTarget = (text) => page.waitForFunction((expected) => document.querySelector('#overleaf-edit-host').shadowRoot.querySelector('#ole-target-prev').textContent.includes(expected), text);
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.route(`${origin}/**`, (route) => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><title>Sample paper - Overleaf</title><style>
      body { margin: 0; color: #35423b; font: 14px Arial; background: #eef1ee; }
      header { padding: 16px 24px; background: #253b32; color: white; }
      .editor-file-tab { padding: 16px 24px; background: #fff; border-bottom: 1px solid #ddd; }
      main { display: flex; gap: 24px; padding: 24px; } #editor { width: 56%; background: white; min-height: 580px; }
      .cm-editor { min-height: 300px; font: 15px/1.8 monospace; } .cm-content { padding: 20px; }
      #pdf { flex: 1; padding: 30px; background: white; font-family: Georgia; line-height: 1.8; }
    </style></head><body><header>Sample paper · Code Editor</header>
    <div class="editor-file-tab tab-selected"><span class="editor-file-tab-path">main.tex</span></div>
    <main><div id="editor"></div><div id="pdf" tabindex="0"><h2>Introduction</h2>Deep learning has revolutionized many fields.</div></main></body></html>` }));
    await page.goto(`${origin}/project/abcdef123456`);
    await page.evaluate(() => {
      window.extensionMessage = null;
      window.mockMessages = [];
      window.fakeListeners = [];
      window.chrome = {
        storage: { local: { get: async () => ({ backend: 'codex' }), set: async () => {}, remove: async () => {} }, onChanged: { addListener() {} } },
        runtime: { sendMessage: async () => ({ ok: true, version: 'test' }), onMessage: { addListener: (f) => { window.extensionMessage = f; } },
          connect: () => ({ onMessage: { addListener: (f) => fakeListeners.push(f) }, onDisconnect: { addListener() {} }, disconnect() {}, postMessage: (m) => mockMessages.push(m) }),
        },
      };
      window.rpc = (op, args = {}) => new Promise((resolve) => {
        const id = 'test-' + Math.random();
        const cb = (e) => {
          if (e.data?.ns === 'OVERLEAF_EDIT_BRIDGE' && e.data.dir === 'resp' && e.data.id === id) {
            window.removeEventListener('message', cb); resolve(e.data.resp);
          }
        };
        window.addEventListener('message', cb);
        window.postMessage({ ns: 'OVERLEAF_EDIT_BRIDGE', dir: 'req', id, op, args }, '*');
      });
    });
    await page.addScriptTag({ content: fixture.outputFiles[0].text });
    await page.addScriptTag({ path: path.join(project, 'extension/content/bridge.js') });
    await page.addScriptTag({ path: path.join(project, 'extension/content/content.js') });
    assert.equal((await page.evaluate(() => rpc('status'))).ready, true, 'real CodeMirror must be found');
    await page.locator('#ole-launcher').waitFor({ state: 'visible' });
    await page.screenshot({ path: path.join(outputDir, 'launcher.png') });

    // A real mouse drag must produce a visible, clickable button (no programmatic hidden clicks).
    const points = await page.evaluate(() => ({ a: editor.coordsAtPos(23), b: editor.coordsAtPos(36) }));
    await page.mouse.move(points.a.left, (points.a.top + points.a.bottom) / 2);
    await page.mouse.down();
    await page.mouse.move(points.b.left, (points.b.top + points.b.bottom) / 2, { steps: 8 });
    await page.mouse.up();
    const float = page.locator('#ole-float-btn');
    await float.waitFor({ state: 'visible' });
    await page.screenshot({ path: path.join(outputDir, 'selection-float.png') });
    await float.click();
    await page.locator('#ole-panel.open').waitFor();
    await waitTarget('Deep learning');
    assert.match(await page.locator('#ole-target-prev').innerText(), /Deep learning/);
    await clearTargets();
    await page.locator('#ole-close').click();

    // Missing native selection must not gate a valid editor selection, including a single character.
    await page.evaluate(() => {
      window.savedGetSelection = window.getSelection;
      window.getSelection = () => null;
      editor.focus(); editor.dispatch({ selection: { anchor: 23, head: 24 } });
    });
    await float.waitFor({ state: 'visible' });
    await float.click();
    await page.waitForFunction(() => document.querySelector('#overleaf-edit-host').shadowRoot.querySelector('#ole-target-prev').textContent === 'D');
    assert.equal(await page.locator('#ole-target-prev').innerText(), 'D');
    await page.evaluate(() => { window.getSelection = window.savedGetSelection; });

    await clearTargets();
    // Read current selection manually while the panel is already open.
    await page.evaluate(() => { editor.focus(); editor.dispatch({ selection: { anchor: 23, head: 67 } }); });
    await page.locator('#ole-capture').click();
    await waitTarget('many field');
    assert.match(await page.locator('#ole-target-prev').innerText(), /many field/);
    await page.screenshot({ path: path.join(outputDir, 'panel-captured.png') });
    await page.locator('#ole-context-summary').click();
    await page.locator('#ole-target-clear').click();
    await page.locator('#ole-capture').click();
    await page.waitForFunction(() => document.querySelector('#overleaf-edit-host').shadowRoot.querySelector('#ole-selection-hint').textContent.includes('没有读取到选区'));
    assert.match(await page.locator('#ole-selection-hint').innerText(), /没有读取到选区/);
    await page.locator('#ole-close').click();

    // Shift + Arrow selection and collapse work without relying on mouseup.
    await page.evaluate(() => { editor.focus(); editor.dispatch({ selection: { anchor: 23 } }); });
    await page.keyboard.down('Shift');
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.up('Shift');
    await float.waitFor({ state: 'visible' });
    await page.keyboard.press('ArrowRight');
    await float.waitFor({ state: 'hidden' });

    // Launcher and popup/shortcut preserve selection before focusing the composer.
    await page.evaluate(() => { editor.focus(); editor.dispatch({ selection: { anchor: 23, head: 27 } }); });
    await page.locator('#ole-launcher').click();
    await waitTarget('Deep');
    assert.equal(await page.locator('#ole-target-prev').innerText(), 'Deep');
    await clearTargets();
    await page.locator('#ole-close').click();
    await page.evaluate(async () => {
      editor.focus(); editor.dispatch({ selection: { anchor: 28, head: 36 } });
      await new Promise((resolve) => extensionMessage({ type: 'open_panel' }, {}, resolve));
    });
    assert.equal(await page.locator('#ole-target-prev').innerText(), 'learning');
    await page.locator('#ole-close').click();

    // Ignore a hidden old editor; favor the focused editor when there are multiple visible views.
    await page.evaluate(() => {
      const old = document.createElement('div'); old.style.display = 'none'; document.body.prepend(old);
      window.oldEditor = mountEditor(old, 'HIDDEN DOCUMENT');
      const other = document.createElement('div'); document.body.append(other);
      window.otherEditor = mountEditor(other, 'Second editor');
      otherEditor.focus(); otherEditor.dispatch({ selection: { anchor: 0, head: 6 } });
    });
    assert.equal((await page.evaluate(() => rpc('get_target'))).text, 'Second');
    await page.evaluate(() => { otherEditor.destroy(); oldEditor.destroy(); editor.focus(); editor.dispatch({ selection: { anchor: 23, head: 27 } }); });
    assert.equal((await page.evaluate(() => rpc('get_target'))).text, 'Deep');

    // PDF / unrelated page selection must not bring back a stale source selection.
    await page.locator('#pdf').click();
    await float.waitFor({ state: 'hidden' });
    await page.waitForTimeout(800);
    assert.equal(await float.isVisible(), false);

    await require('./multi-selection-checks.cjs')(page, outputDir);
    await page.evaluate(() => editor.destroy());
    await page.locator('#ole-launcher').click();
    await page.locator('#ole-panel.open').waitFor();
    assert.match(await page.locator('#ole-selection-hint').innerText(), /源码编辑/);
    await page.setViewportSize({ width: 390, height: 720 });
    await page.screenshot({ path: path.join(outputDir, 'selection-narrow.png') });
    assert.ok((await page.locator('#ole-panel').boundingBox()).width <= 390);
    assert.deepEqual(errors, []);
    console.log(`Selection PASS (${origin}): real CodeMirror, mouse, keyboard, absent DOM selection, single character, launcher, manual capture, runtime message, hidden/multiple editors, PDF exclusion and diagnostics.`);
    console.log('Screenshots:', outputDir);
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
