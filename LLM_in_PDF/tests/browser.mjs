// Optional browser integration check: PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/browser.mjs
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const profile = await mkdtemp(path.join(os.tmpdir(), 'paper-read-browser-'));
const extension = path.resolve('extension');
const requests = [];
let finishMarkdown;
const markdownReply = [
  '## Markdown 格式测试', '',
  '| 模型 | 分数 | 公式 | 说明 | 状态 |',
  '| :--- | ---: | :---: | --- | --- |',
  '| **Alpha** | 42 | $x^2$ | `code` | ~~旧版~~ |',
  '| Beta | 35 | $y$ | 很长的表格内容用于验证横向滚动 | 正常 |', '',
  '1. 第一项', '   - 嵌套内容', '2. 第二项', '',
  '> 引用说明', '', '```js', 'const value = "$not_math$";', '```',
].join('\n');
const catalog = { ok: true, claude: [['(default)', 'CLI default'], ['future-claude', 'Future Claude']], codex: [['(default)', 'CLI default'], ['future-model', 'Future Model']], efforts: { codex: { 'future-model': ['low', 'max', 'ultra'] } }, sources: { claude: 'cli', codex: 'cli' }, runtimes: { claude: { version: '9.9.9', bin: 'fixture' }, codex: { version: '9.9.9', bin: 'fixture' } } };
const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.end(); return; }
  if (req.url.startsWith('/api/models')) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(catalog)); return; }
  if (req.url === '/api/chat') {
    let body = ''; for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    res.setHeader('Content-Type', 'text/event-stream');
    if (requests.length === 2) {
      const split = markdownReply.indexOf('| Beta');
      res.write(`data: ${JSON.stringify({ type: 'delta', text: markdownReply.slice(0, split) })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'delta', text: markdownReply.slice(split) })}\n\n`);
      finishMarkdown = () => res.end('data: {"type":"done"}\n\n');
    } else res.end('data: {"type":"delta","text":"PDF selection received."}\n\ndata: {"type":"done"}\n\n');
    return;
  }
  res.end(JSON.stringify({ ok: true, paper: { title: 'Fixture', text: 'Fixture paper text', source: 'test' } }));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let context;
try {
  context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`], viewport: { width: 1440, height: 1000 } });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  await worker.evaluate(async ({ base }) => {
    chrome.runtime.connectNative = () => { throw new Error('Fixture: native disabled'); };
    await chrome.storage.local.set({ backendUrl: base });
  }, { base: `http://127.0.0.1:${server.address().port}` });
  // Generate a tiny two-page text PDF in Chromium, then serve it as an arXiv response.
  const generator = await context.newPage();
  await generator.setContent('<h1>Selection test paper</h1><p>The Transformer uses attention for sequence modeling.</p><svg width="500" height="160"><circle cx="70" cy="80" r="50" fill="#ed2222"/><rect x="180" y="30" width="100" height="100" fill="#2233ed"/><path d="M380 25 L440 130 L320 130Z" fill="#22bb44"/></svg><div style="break-before:page"></div><h2>Second page</h2><p>Full paper context includes this sentence.</p>');
  const pdf = await generator.pdf({ format: 'A4' });
  await generator.setContent('<svg width="500" height="300"><rect x="40" y="40" width="180" height="180" fill="blue"/></svg>');
  const imageOnlyPdf = await generator.pdf({ format: 'A4' }); await generator.close();
  await context.route('https://arxiv.org/pdf/**', async (route) => {
    if (route.request().resourceType() === 'document') { await route.continue(); return; }
    await route.fulfill({ status: 200, contentType: 'application/pdf', body: route.request().url().includes('1810.09999') ? imageOnlyPdf : pdf });
  });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (msg) => { if (msg.type() === 'error') console.log('browser console:', msg.text()); });
  // Test actual DNR navigation first, not just a direct extension URL.
  await page.goto('https://arxiv.org/pdf/1706.03762');
  await page.waitForURL(`chrome-extension://${id}/reader/reader.html?id=1706.03762`);
  await page.locator('.textLayer span').first().waitFor({ timeout: 20000 }).catch(async (error) => { console.log('Reader status:', await page.locator('#reader-status').textContent(), 'Errors:', errors); await page.screenshot({ path: '/tmp/paper-read-failure.png' }); throw error; });
  await page.waitForFunction(() => document.querySelector('#paper-read-host')?.shadowRoot.querySelector('#pr-paper-meta').textContent.includes('arxiv-pdf'));
  assert.deepEqual(errors, []);
  await page.locator('#pr-backend').selectOption('codex');
  await page.locator('#pr-model option[value="future-model"]').waitFor({ state: 'attached' });
  await page.locator('#pr-model').selectOption('future-model');
  await page.locator('#pr-effort').selectOption('ultra');
  const span = page.locator('.textLayer span').filter({ hasText: 'The Transformer' }).first();
  const box = await span.boundingBox();
  await page.mouse.move(box.x + 1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 15 });
  await page.mouse.up();
  await page.locator('#pr-ask-btn').waitFor({ state: 'visible' });
  await page.locator('#pr-ask-btn').click();
  assert.match(await page.locator('#pr-sel-text').textContent(), /Transformer/);
  await page.locator('#pr-input').fill('Explain this passage');
  await page.locator('#pr-send').click();
  await page.getByText('PDF selection received.', { exact: true }).waitFor();
  assert.equal(requests[0].model, 'future-model');
  assert.equal(requests[0].effort, 'ultra');
  assert.match(requests[0].selection, /Transformer/);
  assert.match(requests[0].paper.text, /Full paper context/);
  assert.equal(requests[0].paper.source, 'arxiv-pdf');
  await page.locator('#zoom').selectOption('1.5');
  await page.locator('#next').click();
  assert.equal(await page.locator('#page-number').inputValue(), '2');
  await page.locator('#previous').click();
  await page.locator('#zoom').selectOption('page-width');
  await page.screenshot({ path: '/tmp/paper-read-reader.png' });
  await page.reload();
  await page.getByText('PDF selection received.', { exact: true }).waitFor();
  assert.equal(await page.locator('#pr-model').inputValue(), 'future-model');
  assert.equal(await page.locator('#pr-effort').inputValue(), 'ultra');
  await page.waitForFunction(() => document.querySelector('#paper-read-host')?.shadowRoot.querySelector('#pr-paper-meta').textContent.includes('arxiv-pdf'));
  // Render streamed Markdown and copy the entire conversation, including the active answer.
  await page.evaluate(() => {
    window.testCopies = [];
    Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async (text) => { window.testCopies.push(text); } });
  });
  await page.locator('#pr-input').fill('请用表格比较模型');
  await page.locator('#pr-send').click();
  await page.locator('.pr-table-scroll table tbody tr').first().waitFor().catch(async (error) => { console.log('Chat requests:', requests.length, 'Errors:', errors, 'Panel:', await page.locator('#pr-panel').innerText()); throw error; });
  assert.equal(await page.locator('.pr-table-scroll th').count(), 5);
  assert.equal(await page.locator('.pr-table-scroll td .katex').count(), 2);
  assert.match(await page.locator('.pr-pre code').textContent(), /\$not_math\$/);
  assert.equal(await page.locator('.pr-pre .katex').count(), 0);
  assert.ok(await page.locator('.pr-table-scroll').evaluate((el) => el.scrollWidth > el.clientWidth));
  assert.ok(await page.locator('#pr-panel').evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
  await page.locator('#pr-copy').click();
  const copied = await page.evaluate(() => window.testCopies.at(-1));
  assert.match(copied, /Explain this passage/);
  assert.match(copied, /Transformer/);
  assert.match(copied, /PDF selection received/);
  assert.match(copied, /请用表格比较模型/);
  assert.match(copied, /生成中/);
  assert.ok(copied.includes(markdownReply));
  finishMarkdown();
  await page.locator('#pr-stop').waitFor({ state: 'hidden' });
  await worker.evaluate(() => chrome.storage.local.set({ 'arch:1706.03762': [
    { ts: 1700000000000, preview: '旧会话', messages: [{ role: 'user', content: '以前的问题' }, { role: 'assistant', content: '以前的回答' }] },
  ] }));
  await page.locator('#pr-copy-all').click();
  const all = await page.evaluate(() => window.testCopies.at(-1));
  assert.match(all, /以前的问题/); assert.match(all, /以前的回答/);
  assert.match(all, /当前对话/); assert.ok(all.includes(markdownReply));
  await page.screenshot({ path: '/tmp/paper-read-markdown.png' });
  // More than 60 messages must survive saving and reloading.
  await worker.evaluate(() => chrome.storage.local.set({ 'hist:1706.03762': {
    messages: Array.from({ length: 64 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `历史消息-${i}` })),
  } }));
  await page.reload();
  await page.getByText('历史消息-0', { exact: true }).waitFor({ state: 'attached' });
  await page.waitForFunction(() => document.querySelector('#paper-read-host')?.shadowRoot.querySelector('#pr-paper-meta').textContent.includes('arxiv-pdf'));
  await page.locator('#pr-input').fill('保留全部历史');
  await page.locator('#pr-send').click();
  await page.getByText('PDF selection received.', { exact: true }).waitFor();
  await page.reload();
  await page.getByText('历史消息-0', { exact: true }).waitFor({ state: 'attached' });
  assert.equal(await page.locator('.pr-msg').count(), 66);
  // Clipboard API failure uses a selected textarea fallback inside the shadow root.
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async () => { throw new Error('fixture denied'); } });
    document.execCommand = (command) => {
      const input = document.querySelector('#paper-read-host').shadowRoot.activeElement;
      window.fallbackCopy = input.value.slice(input.selectionStart, input.selectionEnd);
      return command === 'copy';
    };
  });
  await page.locator('#pr-copy').click();
  assert.match(await page.evaluate(() => window.fallbackCopy), /历史消息-0/);
  assert.match(await page.evaluate(() => window.fallbackCopy), /保留全部历史/);
  // Capture actual PDF pixels (including vectors), cancel/remove/reverse-drag and persist them.
  await page.waitForFunction(() => document.querySelector('#paper-read-host')?.shadowRoot.querySelector('#pr-paper-meta').textContent.includes('arxiv-pdf'));
  const canvasBox = await page.locator('.page').first().locator('.canvasWrapper').boundingBox();
  const start = { x: canvasBox.x + canvasBox.width * .02, y: canvasBox.y + canvasBox.height * .095 };
  const end = { x: canvasBox.x + canvasBox.width * .65, y: canvasBox.y + canvasBox.height * .255 };
  async function crop(reverse = false) {
    await page.locator('#select-image').click();
    const [from, to] = reverse ? [end, start] : [start, end];
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 }); await page.mouse.up();
    await page.locator('.pr-image-preview img').waitFor();
  }
  await page.locator('#select-image').click();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#select-image').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('.pr-image-preview').count(), 0);
  await crop();
  await page.locator('.pr-image-preview button').click();
  assert.equal(await page.locator('.pr-image-preview').count(), 0);
  await crop(true);
  const pixels = await page.locator('.pr-image-preview img').evaluate(async (img) => {
    await img.decode();
    const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let red = 0, blue = 0, green = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 180 && data[i + 1] < 80 && data[i + 2] < 80) red++;
      if (data[i + 2] > 180 && data[i] < 80 && data[i + 1] < 80) blue++;
      if (data[i + 1] > 140 && data[i] < 80 && data[i + 2] < 100) green++;
    }
    return { width: canvas.width, height: canvas.height, red, blue, green };
  });
  assert.ok(pixels.width > 700 && pixels.width <= 1800);
  assert.ok(pixels.red > 1000 && pixels.blue > 1000 && pixels.green > 1000, JSON.stringify(pixels));
  await page.locator('#pr-input').fill('图里有什么？');
  const countBeforeImage = requests.length;
  await page.locator('#pr-send').click();
  await page.locator('.pr-image img').waitFor();
  await page.waitForFunction(() => document.querySelector('#paper-read-host').shadowRoot.querySelector('#pr-stop').classList.contains('hidden'));
  const imageRequest = requests[countBeforeImage];
  assert.equal(imageRequest.images.length, 1);
  assert.equal(imageRequest.images[0].mime, 'image/png');
  assert.equal(imageRequest.messages.at(-1).images[0].id, imageRequest.images[0].id);
  assert.equal(imageRequest.messages.at(-1).images[0].dataUrl, undefined);
  assert.equal(imageRequest.messages.at(-1).images[0].b64, undefined);
  await writeFile('/tmp/paper-read-image-fixture.png', Buffer.from(imageRequest.images[0].b64, 'base64'));
  await page.locator('#pr-copy').click();
  assert.match(await page.evaluate(() => window.fallbackCopy), /!\[PDF 第 1 页截图\]\(data:image\/png;base64,/);
  await page.reload();
  await page.locator('.pr-image img').waitFor();
  await page.waitForFunction(() => document.querySelector('#paper-read-host')?.shadowRoot.querySelector('#pr-paper-meta').textContent.includes('arxiv-pdf'));
  await page.locator('#pr-input').fill('继续解释刚才的图');
  await page.locator('#pr-send').click();
  await page.waitForFunction(() => document.querySelector('#paper-read-host').shadowRoot.querySelector('#pr-stop').classList.contains('hidden'));
  assert.equal(requests.at(-1).images[0].b64, imageRequest.images[0].b64);
  await page.screenshot({ path: '/tmp/paper-read-image-chat.png' });
  assert.deepEqual(errors, []);
  // PDFs without a text layer can still send cropped images with a default question.
  const scan = await context.newPage();
  await scan.goto(`chrome-extension://${id}/reader/reader.html?id=1810.09999`);
  await scan.locator('#reader-status').filter({ hasText: '无文字层' }).waitFor();
  await scan.waitForFunction(() => document.querySelector('#paper-read-host')?.shadowRoot.querySelector('#pr-paper-meta').textContent.includes('arxiv-pdf'));
  await scan.locator('#select-image').click();
  const scanBox = await scan.locator('.canvasWrapper').first().boundingBox();
  await scan.mouse.move(scanBox.x + 20, scanBox.y + 20); await scan.mouse.down();
  await scan.mouse.move(scanBox.x + 310, scanBox.y + 330, { steps: 12 }); await scan.mouse.up();
  await scan.locator('.pr-image-preview img').waitFor();
  await scan.locator('#pr-send').click();
  await scan.getByText('PDF selection received.', { exact: true }).waitFor();
  assert.equal(requests.at(-1).images.length, 1);
  assert.match(requests.at(-1).paper.text, /没有可提取的文字层/);
  assert.match(requests.at(-1).messages.at(-1).content, /解释这张图片/);
  await scan.close();
  // Invalid input is rejected without fetching an arbitrary URL.
  const bad = await context.newPage();
  await bad.goto(`chrome-extension://${id}/reader/reader.html?id=../../private`);
  await bad.locator('#reader-status.error').waitFor();
  assert.match(await bad.locator('#reader-status').textContent(), /无效/);
  console.log('PASS: PDF redirect, text selection, full text, quoted chat, dynamic models/effort, zoom, paging, full history, Markdown tables/math, copying, image cropping/pixels/cancellation/persistence/follow-up and invalid-ID handling.');
} finally {
  await context?.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
