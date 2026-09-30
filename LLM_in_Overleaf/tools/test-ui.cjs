const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const os = require('node:os');
const project = path.resolve(__dirname, '..');
const outputDir = process.env.LLM_IN_OVERLEAF_TEST_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'llm-in-overleaf-ui-'));
fs.mkdirSync(outputDir, { recursive: true });
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('https://www.overleaf.com/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><title>Sample paper - Overleaf</title></head><body style="background:#f0f1ee;font-family:Arial;padding:30px"><h3>Sample paper / main.tex</h3><div class="cm-editor"><div class="cm-content" contenteditable="true">Source fixture</div></div><pre>\\section{Introduction}\nDeep learning have revolutionized many field.</pre></body></html>' }));
  await page.goto('https://www.overleaf.com/project/abcdef123456');
  await page.evaluate(() => {
    window.mockMessages = [];
    window.fakeListeners = [];
    window.mockContextFail = false;
    window.mockSelection = false;
    const saved = { backend: 'codex', effort: 'medium', uiLanguage: 'zh-CN' };
    window.chrome = {
      storage: { local: { get: async () => saved, set: async () => {}, remove: async () => {} }, onChanged: { addListener: () => {} } },
      runtime: {
        sendMessage: async (msg) => msg.type === 'health' ? { ok: true, version: '0.7.0' } : { codex: [['(default)', '使用 Codex 配置'], ['demo', 'Demo Model']], fetchedAt: new Date().toISOString() },
        onMessage: { addListener: () => {} },
        connect: () => ({ onMessage: { addListener: (cb) => window.fakeListeners.push(cb) }, onDisconnect: { addListener: () => {} }, disconnect: () => {}, postMessage: (msg) => window.mockMessages.push(msg) }),
      }
    };
    window.addEventListener('message', ({ data }) => {
      if (data.ns !== 'LLM_IN_OVERLEAF_BRIDGE' || data.dir !== 'req') return;
      const text = 'Deep learning have revolutionized many field.';
      if (data.op === 'merge_targets') {
        const ranges = [...data.args.existing];
        for (const r of data.args.incoming) if (!ranges.some((x) => x.from === r.from && x.to === r.to)) ranges.push(r);
        window.postMessage({ ns: data.ns, dir: 'resp', id: data.id, resp: { ok: true, ranges, fileName: 'main.tex', docChars: 3200 } }, '*');
        return;
      }
      const resp = window.mockContextFail && data.op === 'get_context' ? { ok: false, error: '原文已变更' } : {
        ok: true, ready: true, hasSelection: window.mockSelection, len: window.mockSelection ? text.length : 0, preview: text, text, fullText: text, selection: text,
        from: 0, to: text.length, line1: 2, line2: 2, docChars: 3200, fileName: 'main.tex', projectName: 'Sample paper',
        rect: { top: 100, bottom: 120, left: 100, right: 400 },
      };
      window.postMessage({ ns: data.ns, dir: 'resp', id: data.id, resp }, '*');
    });
  });
  await page.addScriptTag({ path: path.join(project, 'extension/shared/i18n.js') });
  await page.addScriptTag({ path: path.join(project, 'extension/content/content.js') });
  await page.locator('#ole-launcher').click();
  await page.waitForFunction(() => document.querySelector('#llm-in-overleaf-host').shadowRoot.querySelector('#ole-status-text').textContent.includes('Codex 就绪'));
  await page.screenshot({ path: path.join(outputDir, 'panel-welcome.png') });
  const input = page.locator('#ole-input');
  await input.fill('请润色');
  await page.locator('#ole-send').click();
  assert.equal(await input.inputValue(), '请润色', 'missing selection must preserve draft');
  await input.evaluate(el => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })));
  assert.equal(await page.evaluate(() => mockMessages.length), 0, 'IME Enter must not send');
  const normalMessages = await page.locator('#ole-messages').boundingBox();
  assert.ok(normalMessages.height / 960 > 0.7, 'default layout reserves most height for output');
  await page.locator('#ole-mode-summary').click();
  assert.equal((await page.locator('#ole-messages').boundingBox()).height, normalMessages.height, 'settings overlay must not shrink output');
  await page.locator('#ole-mode-ask').click();
  await page.locator('#ole-send').dblclick();
  await page.waitForFunction(() => mockMessages.length === 1);
  assert.equal(await page.locator('#ole-backend').isDisabled(), true);
  await page.evaluate(() => { for (const cb of fakeListeners) { cb({ type: 'delta', text: '这段内容可以更清晰。' }); cb({ type: 'done' }); } });
  await page.waitForTimeout(100);
  assert.ok((await page.locator('#ole-messages').innerText()).includes('这段内容可以更清晰。'));
  assert.equal(await page.locator('#ole-backend').isDisabled(), false);
  await page.locator('#ole-mode-summary').click();
  await page.locator('#ole-mode-edit').click();
  // Exercise selection capture through the actual content-script event.
  await page.evaluate(() => { window.mockSelection = true; document.querySelector('.cm-content').focus(); document.dispatchEvent(new Event('selectionchange')); });
  await page.waitForTimeout(350);
  await page.locator('#ole-capture').click();
  await page.waitForTimeout(100);
  await input.fill('修正语法');
  await page.locator('#ole-send').click();
  await page.waitForFunction(() => mockMessages.length === 2);
  await page.evaluate(() => { const cb = fakeListeners.at(-1); cb({ type: 'delta', text: '已修正主谓一致与复数。\n\n```latex\nDeep learning has revolutionized many fields.\n```' }); cb({ type: 'done' }); });
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.ole-card').count(), 1, 'final diff survives pending animation frame');
  await page.screenshot({ path: path.join(outputDir, 'panel-diff.png') });
  await input.fill('继续润色');
  await page.locator('#ole-send').click();
  await page.waitForFunction(() => mockMessages.length === 3);
  await page.evaluate(() => { const cb = fakeListeners.at(-1); cb({ type: 'delta', text: '```latex\nPartial text\n```' }); cb({ type: 'error', error: '连接中断' }); cb({ type: 'done' }); });
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.ole-card').count(), 1, 'failed partial reply must not become an apply card');
  await input.fill('失败时保留这条草稿');
  await page.evaluate(() => { window.mockContextFail = true; });
  await page.locator('#ole-send').click();
  await page.waitForTimeout(100);
  assert.equal(await input.inputValue(), '失败时保留这条草稿');
  await page.evaluate(() => { window.mockContextFail = false; });
  await page.locator('#ole-capture').click();
  await page.waitForTimeout(100);
  await page.locator('.ole-apply').first().click();
  assert.ok((await page.locator('.ole-card-status').first().innerText()).includes('选区已切换'));
  await input.fill('停止测试');
  await page.locator('#ole-send').click();
  await page.waitForFunction(() => mockMessages.length === 4);
  await page.evaluate(() => fakeListeners.at(-1)({ type: 'delta', text: '```latex\nIncomplete\n```' }));
  await page.locator('#ole-stop').click();
  assert.equal(await page.locator('.ole-card').count(), 1, 'stopped partial reply cannot be applied');
  await input.fill('滚动测试');
  await page.locator('#ole-send').click();
  await page.waitForFunction(() => mockMessages.length === 5);
  await page.evaluate(() => fakeListeners.at(-1)({ type: 'delta', text: '段落。\n\n'.repeat(200) }));
  await page.waitForTimeout(100);
  await page.locator('#ole-messages').evaluate(el => { el.scrollTop = 0; });
  await page.waitForTimeout(100);
  await page.evaluate(() => fakeListeners.at(-1)({ type: 'delta', text: '新的段落' }));
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#ole-messages').evaluate(el => el.scrollTop), 0, 'streaming must not steal scroll position');
  // Reading mode keeps the draft and scroll position, and still permits cancellation.
  await input.fill('保留这条草稿');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: path.join(outputDir, 'panel-compact.png') });
  const compactHeight = (await page.locator('#ole-messages').boundingBox()).height;
  await page.locator('#ole-reading').click();
  await page.waitForTimeout(100);
  const readingHeight = (await page.locator('#ole-messages').boundingBox()).height;
  assert.ok(readingHeight / 900 > 0.9, 'reading mode dedicates over 90% of height to output');
  assert.ok(readingHeight > compactHeight + 100);
  assert.equal(await page.locator('#ole-messages').evaluate(el => el.scrollTop), 0);
  assert.equal(await input.isVisible(), false);
  assert.equal(await input.inputValue(), '保留这条草稿');
  assert.equal(await page.locator('#ole-reading-stop').isVisible(), true);
  await page.locator('#ole-reading-stop').click();
  assert.equal(await page.locator('#ole-reading-stop').isVisible(), false);
  await page.screenshot({ path: path.join(outputDir, 'panel-reading.png') });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#ole-panel').isVisible(), true, 'Escape exits reading before closing the panel');
  assert.equal(await input.isVisible(), true);
  assert.equal(await input.inputValue(), '保留这条草稿');
  console.log(`Output height at 900px: compact=${compactHeight}px, reading=${readingHeight}px`);
  await page.setViewportSize({ width: 390, height: 720 });
  await page.waitForTimeout(150);
  assert.ok((await page.locator('#ole-panel').boundingBox()).width <= 390);
  await page.screenshot({ path: path.join(outputDir, 'panel-narrow.png') });
  await page.locator('#ole-settings-toggle').click();
  const settingsBox = await page.locator('#ole-settings').boundingBox();
  assert.ok(settingsBox.x >= 0 && settingsBox.x + settingsBox.width <= 390);
  await page.screenshot({ path: path.join(outputDir, 'panel-settings.png') });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#ole-settings').isVisible(), false);
  await page.setViewportSize({ width: 390, height: 480 });
  await page.locator('#ole-reading').click();
  assert.ok((await page.locator('#ole-messages').boundingBox()).height / 480 > 0.9);
  await page.screenshot({ path: path.join(outputDir, 'panel-short-reading.png') });

  // Popup runs its real script with a minimal Chrome API fixture.
  const popup = await browser.newPage({ viewport: { width: 328, height: 720 } });
  popup.on('pageerror', (e) => errors.push(String(e)));
  await popup.route('https://popup.test/**', async route => {
    const url = new URL(route.request().url());
    const file = url.pathname.startsWith('/shared/') ? path.join(project, 'extension', url.pathname) : path.join(project, 'extension/popup', url.pathname.split('/').pop() || 'popup.html');
    await route.fulfill({ path: file });
  });
  await popup.addInitScript(() => { window.chrome = { storage: { local: { get: async () => ({ backend: 'codex', uiLanguage: 'zh-CN' }), set: async () => {} } }, runtime: { sendMessage: async () => ({ ok: true, version: '0.7.0' }) } }; });
  await popup.goto('https://popup.test/popup/popup.html');
  await popup.waitForFunction(() => document.querySelector('#status').classList.contains('ok'));
  await popup.locator('#open-panel').click();
  await popup.waitForFunction(() => document.querySelector('#page-status').textContent.includes('助手已打开'));
  await popup.evaluate(() => { chrome.runtime.sendMessage = async () => ({ ok: false, error: '请先切到一个 Overleaf 项目编辑页' }); });
  await popup.locator('#open-panel').click();
  await popup.waitForFunction(() => document.querySelector('#page-status').classList.contains('error'));
  await popup.screenshot({ path: path.join(outputDir, 'popup.png') });

  // English interface: static text, presets, status, translated host errors, diff card and live switching.
  const en = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  en.on('pageerror', (e) => errors.push(String(e)));
  await en.route('https://www.overleaf.com/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><title>Sample paper - Overleaf</title></head><body style="background:#f0f1ee;font-family:Arial;padding:30px"><h3>Sample paper / main.tex</h3><div class="cm-editor"><div class="cm-content" contenteditable="true">Source fixture</div></div></body></html>' }));
  await en.goto('https://www.overleaf.com/project/abcdef123456');
  await en.evaluate(() => {
    window.mockMessages = [];
    window.fakeListeners = [];
    window.storageSets = [];
    window.chrome = {
      storage: { local: { get: async () => ({ backend: 'claude', uiLanguage: 'en' }), set: async (value) => { window.storageSets.push(value); }, remove: async () => {} }, onChanged: { addListener: () => {} } },
      runtime: {
        sendMessage: async (msg) => (msg.type === 'health' ? { ok: true, version: '0.9.0' } : {}),
        onMessage: { addListener: () => {} },
        connect: () => ({ onMessage: { addListener: (cb) => window.fakeListeners.push(cb) }, onDisconnect: { addListener: () => {} }, disconnect: () => {}, postMessage: (msg) => window.mockMessages.push(msg) }),
      },
    };
    window.addEventListener('message', ({ data }) => {
      if (data.ns !== 'LLM_IN_OVERLEAF_BRIDGE' || data.dir !== 'req') return;
      const text = 'Deep learning have revolutionized many field.';
      if (data.op === 'merge_targets') {
        const ranges = [...data.args.existing];
        for (const r of data.args.incoming) if (!ranges.some((x) => x.from === r.from && x.to === r.to)) ranges.push(r);
        window.postMessage({ ns: data.ns, dir: 'resp', id: data.id, resp: { ok: true, ranges, fileName: 'main.tex', docChars: 3200 } }, '*');
        return;
      }
      window.postMessage({ ns: data.ns, dir: 'resp', id: data.id, resp: {
        ok: true, ready: true, len: text.length, preview: text, text, fullText: text, from: 0, to: text.length, line1: 2, line2: 2,
        docChars: 3200, fileName: 'main.tex', projectName: 'Sample paper', rect: { top: 100, bottom: 120, left: 100, right: 400 },
      } }, '*');
    });
  });
  await en.addScriptTag({ path: path.join(project, 'extension/shared/i18n.js') });
  await en.addScriptTag({ path: path.join(project, 'extension/content/content.js') });
  assert.equal(await en.locator('#ole-launcher').innerText(), '✦ Writing assistant');
  await en.locator('#ole-launcher').click();
  await en.waitForFunction(() => document.querySelector('#llm-in-overleaf-host').shadowRoot.querySelector('#ole-status-text').textContent.includes('Claude ready'));
  assert.equal(await en.locator('#ole-send').innerText(), 'Send');
  assert.match(await en.locator('#ole-messages').innerText(), /Say what you mean, better\./);
  assert.equal(await en.locator('.ole-chip').first().innerText(), 'Polish');
  assert.equal(await en.locator('#ole-capture').innerText(), '＋ Add selection');
  await en.locator('#ole-capture').click();
  await en.locator('.ole-chip').first().click();
  assert.match(await en.locator('#ole-input').inputValue(), /^Polish this passage/);
  await en.locator('#ole-send').click();
  await en.waitForFunction(() => mockMessages.length === 1);
  assert.equal(await en.evaluate(() => mockMessages[0].payload.uiLanguage), 'en', 'prompt language follows the interface');
  await en.evaluate(() => { const cb = fakeListeners.at(-1); cb({ type: 'status', text: '模型已启动，正在生成' }); cb({ type: 'delta', text: 'Fixed subject-verb agreement.\n\n```latex\nDeep learning has revolutionized many fields.\n```' }); cb({ type: 'done', ok: true }); });
  await en.locator('.ole-apply').waitFor();
  assert.equal(await en.locator('.ole-apply').innerText(), '✅ Apply');
  assert.equal(await en.locator('.ole-tab').first().innerText(), 'Diff');
  await en.screenshot({ path: path.join(outputDir, 'panel-english.png') });
  await en.locator('#ole-input').fill('Try again');
  await en.locator('#ole-send').click();
  await en.waitForFunction(() => mockMessages.length === 2);
  await en.evaluate(() => { const cb = fakeListeners.at(-1); cb({ type: 'error', error: '请求超时：模型超过时限仍未完成，请降低思考强度或缩小选段范围。', hint: '可重试，或在设置中检查后端连接状态。' }); cb({ type: 'done', ok: false }); });
  await en.waitForFunction(() => document.querySelector('#llm-in-overleaf-host').shadowRoot.querySelector('#ole-messages').innerText.includes('Request timed out'));
  assert.match(await en.locator('#ole-messages').innerText(), /Retry, or check the backend connection in Settings\./);
  // Markdown tables in answers render as real tables (models often answer with one).
  await en.locator('#ole-input').fill('Compare the citations');
  await en.locator('#ole-send').click();
  await en.waitForFunction(() => mockMessages.length === 3);
  await en.evaluate(() => { const cb = fakeListeners.at(-1); cb({ type: 'delta', text: 'All keys resolve.\n\n| Key | Used in | Defined |\n| --- | --- | --- |\n| `lee2024` | Introduction | yes |\n| **chen2025** | Method | yes |' }); cb({ type: 'done', ok: true }); });
  await en.waitForFunction(() => document.querySelector('#llm-in-overleaf-host').shadowRoot.querySelectorAll('.ole-md-table tbody tr').length === 2);
  assert.equal(await en.locator('.ole-md-table th').first().innerText(), 'Key');
  assert.equal(await en.locator('.ole-md-table code').first().innerText(), 'lee2024');
  // Switching language updates controls and existing card buttons, never conversation text.
  await en.locator('#ole-settings-toggle').click();
  await en.locator('#ole-language').selectOption('zh-CN');
  assert.equal(await en.locator('#ole-send').innerText(), '发送');
  assert.equal(await en.locator('.ole-apply').innerText(), '✅ 应用替换');
  assert.equal(await en.locator('.ole-chip').first().innerText(), '润色');
  assert.ok((await en.locator('#ole-messages').innerText()).includes('Fixed subject-verb agreement.'));
  assert.ok(await en.evaluate(() => window.storageSets.some((value) => value.uiLanguage === 'zh-CN')), 'language choice is persisted');
  await en.locator('#ole-language').selectOption('en');
  assert.equal(await en.locator('.ole-apply').innerText(), '✅ Apply');
  await en.close();

  const popupEn = await browser.newPage({ viewport: { width: 328, height: 720 } });
  popupEn.on('pageerror', (e) => errors.push(String(e)));
  await popupEn.route('https://popup.test/**', async route => {
    const url = new URL(route.request().url());
    const file = url.pathname.startsWith('/shared/') ? path.join(project, 'extension', url.pathname) : path.join(project, 'extension/popup', url.pathname.split('/').pop() || 'popup.html');
    await route.fulfill({ path: file });
  });
  await popupEn.addInitScript(() => { window.chrome = { storage: { local: { get: async () => ({ backend: 'claude', uiLanguage: 'en' }), set: async () => {} } }, runtime: { sendMessage: async () => ({ ok: true, version: '0.9.0' }) } }; });
  await popupEn.goto('https://popup.test/popup/popup.html');
  await popupEn.waitForFunction(() => document.querySelector('#status').classList.contains('ok'));
  assert.match(await popupEn.locator('#status').innerText(), /Claude ready · native host v0\.9\.0/);
  assert.match(await popupEn.locator('#open-panel').innerText(), /Open writing assistant/);
  await popupEn.screenshot({ path: path.join(outputDir, 'popup-english.png') });
  if (errors.length) console.error('Browser errors:', errors);
  assert.deepEqual(errors, []);
  console.log('UI PASS: draft preservation, IME, duplicate send, streaming controls, final diff, failed partial reply, narrow viewport, context errors, stale target, cancellation, scroll retention, popup, English interface, translated host errors and live language switching; no browser exceptions.');
  console.log('Screenshots:', outputDir);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
