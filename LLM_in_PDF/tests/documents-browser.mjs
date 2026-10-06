// Universal source integration: run with the same Playwright environment as browser.mjs.
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const profile = await mkdtemp(path.join(os.tmpdir(), 'paper-read-documents-'));
const requests = [], pdfRequests = [];
let pdf, otherPdf, context;
const server = createServer(async (req, res) => {
  if (req.url === '/redirect') { res.writeHead(302, { Location: '/download?id=17&token=x%2By' }); res.end(); return; }
  if (req.url.startsWith('/download') || req.url.endsWith('.pdf')) {
    pdfRequests.push(req.url);
    res.setHeader('Content-Type', 'application/pdf');
    res.end(req.url.includes('other') ? otherPdf : pdf); return;
  }
  if (req.url === '/article') {
    res.setHeader('Content-Type', 'text/html');
    res.end('<html><head><title>Publisher article</title><meta name="citation_pdf_url" content="/download?id=17&amp;token=x%2By"></head><body><nav>Unrelated navigation</nav><article><h1>Publisher paper</h1><p>This HTML paper studies attention and graph learning.</p></article></body></html>'); return;
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.end(); return; }
  if (req.url.startsWith('/api/models')) {
    res.end(JSON.stringify({ ok: true, claude: [['(default)', '默认']], codex: [['(default)', '默认']] })); return;
  }
  if (req.url === '/api/chat') {
    let body = ''; for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    res.setHeader('Content-Type', 'text/event-stream');
    res.end('data: {"type":"delta","text":"Document received."}\n\ndata: {"type":"done"}\n\n'); return;
  }
  res.statusCode = 404; res.end('not found');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
try {
  context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${path.resolve('extension')}`, `--load-extension=${path.resolve('extension')}`], viewport: { width: 1440, height: 1000 } });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host, reader = `chrome-extension://${id}/reader/reader.html`;
  await worker.evaluate(async (base) => {
    chrome.runtime.connectNative = () => { throw new Error('fixture native disabled'); };
    await chrome.storage.local.set({ backendUrl: base });
  }, base);
  const generator = await context.newPage();
  await generator.setContent('<h1>Universal PDF fixture</h1><p>Remote and local document text.</p><svg width="200" height="150"><circle cx="80" cy="80" r="50" fill="red"/></svg>');
  pdf = await generator.pdf({ format: 'A4' });
  await generator.setContent('<h1>Different document</h1><p>Another paper with a different fingerprint.</p>');
  otherPdf = await generator.pdf({ format: 'A4' }); await generator.close();
  const page = await context.newPage();
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  const ready = (target = page, source = 'web-pdf') => target.waitForFunction((source) => document.querySelector('#paper-read-host')?.shadowRoot.querySelector('#pr-paper-meta').textContent.includes(source), source);
  async function ask(text, target = page) {
    await target.locator('#pr-input').fill(text); await target.locator('#pr-send').click();
    await target.locator('#pr-stop').waitFor({ state: 'hidden' });
  }
  // Real HTTP main-frame headers trigger automatic opening, with the entire signed query preserved.
  const url = `${base}/download?id=17&token=x%2By`;
  await page.goto(url).catch((error) => { if (!/ERR_ABORTED|interrupted/.test(error.message)) throw error; });
  await page.waitForURL((value) => value.href.startsWith(reader));
  assert.equal(new URL(page.url()).searchParams.get('url'), url);
  await ready();
  await ask('Remember online document');
  assert.match(requests.at(-1).paper.text, /Remote and local document text/);
  assert.equal(requests.at(-1).paper.source, 'web-pdf');
  assert.ok(pdfRequests.every((url) => url.includes('token=x%2By')));
  await page.reload(); await ready();
  await page.getByText('Remember online document', { exact: true }).waitFor();
  // The original viewer escape must not automatically reopen the extension.
  const nativePromise = context.waitForEvent('page');
  await page.locator('#original').click();
  const native = await nativePromise;
  await native.waitForURL(url); await native.waitForLoadState('load');
  assert.equal(native.url(), url);
  await native.close();
  const redirected = await context.newPage();
  await redirected.goto(`${base}/redirect`).catch((error) => { if (!/ERR_ABORTED|interrupted/.test(error.message)) throw error; });
  await redirected.waitForURL((value) => value.href.startsWith(reader)); await ready(redirected);
  await redirected.getByText('Remember online document', { exact: true }).waitFor();
  await redirected.close();
  // Automatic reading can be disabled; manual opening discovers publisher metadata.
  await worker.evaluate(() => chrome.storage.local.set({ pdfReaderEnabled: false }));
  const manual = await context.newPage();
  await manual.goto(`${base}/article`);
  assert.equal(await manual.locator('#paper-read-host').count(), 0);
  await page.evaluate(async (url) => {
    const tab = (await chrome.tabs.query({})).find((tab) => tab.url === url);
    const { openCurrentPdf } = await import(chrome.runtime.getURL('shared/open-document.js'));
    await openCurrentPdf(tab);
  }, `${base}/article`);
  await manual.waitForURL((value) => value.href.startsWith(reader)); await ready(manual);
  await manual.getByText('Remember online document', { exact: true }).waitFor();
  await manual.goto(`${base}/article`);
  await page.evaluate(async (url) => {
    const tab = (await chrome.tabs.query({})).find((tab) => tab.url === url);
    const { readCurrentPage } = await import(chrome.runtime.getURL('shared/open-document.js'));
    await readCurrentPage(tab);
  }, `${base}/article`);
  await ready(manual, 'web-page'); await ask('Explain the webpage', manual);
  assert.match(requests.at(-1).paper.text, /graph learning/);
  assert.doesNotMatch(requests.at(-1).paper.text, /Unrelated navigation|Remember online document/);
  // File selection needs no file-scheme permission and stores bytes for later reloads.
  await page.goto(reader);
  await page.locator('#local-file').setInputFiles({ name: '本地 论文.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.waitForURL((value) => value.searchParams.has('local')); await ready(page, 'local-pdf');
  const localUrl = page.url();
  assert.equal(await page.getByText('Remember online document', { exact: true }).count(), 0);
  await ask('Remember local document');
  assert.equal(requests.at(-1).paper.source, 'local-pdf');
  await page.reload(); await ready(page, 'local-pdf');
  await page.getByText('Remember local document', { exact: true }).waitFor();
  // Same bytes under a different filename restore history; different PDFs with the same name do not.
  await page.goto(reader);
  const drop = await page.evaluateHandle((bytes) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], 'renamed.pdf', { type: 'application/pdf' }));
    return transfer;
  }, [...pdf]);
  await page.locator('#file-drop').dispatchEvent('drop', { dataTransfer: drop });
  await drop.dispose();
  await ready(page, 'local-pdf'); assert.equal(page.url(), localUrl);
  await page.getByText('Remember local document', { exact: true }).waitFor();
  await page.goto(reader);
  await page.locator('#local-file').setInputFiles({ name: '本地 论文.pdf', mimeType: 'application/pdf', buffer: otherPdf });
  await ready(page, 'local-pdf');
  assert.notEqual(page.url(), localUrl);
  assert.equal(await page.getByText('Remember local document', { exact: true }).count(), 0);
  // Invalid files/URLs fail explicitly without entering the chat reader.
  await page.goto(reader);
  await page.locator('#local-documents a').filter({ hasText: '本地 论文.pdf' }).waitFor();
  await page.locator('.local-document').filter({ has: page.getByText('本地 论文.pdf', { exact: true }) }).getByRole('button', { name: '移除文件' }).click();
  await page.locator('#local-documents a').filter({ hasText: '本地 论文.pdf' }).waitFor({ state: 'detached' });
  await page.screenshot({ path: '/tmp/paper-read-open-document.png' });
  await page.locator('#local-file').setInputFiles({ name: 'fake.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a PDF') });
  await page.locator('#open-error').filter({ hasText: '不是有效' }).waitFor();
  await page.goto(`${reader}?url=${encodeURIComponent('javascript:alert(1)')}`);
  await page.locator('#reader-status.error').waitFor();
  // Local browser file access: check the permission error, then enable Chrome's real extension setting.
  const filename = path.join(profile, '本地 browser.pdf'); await writeFile(filename, pdf);
  const fileUrl = pathToFileURL(filename).href;
  const allowed = await worker.evaluate(() => chrome.extension.isAllowedFileSchemeAccess());
  if (!allowed) {
    await page.goto(`${reader}?url=${encodeURIComponent(fileUrl)}`);
    await page.locator('#reader-status.error').filter({ hasText: '允许访问文件网址' }).waitFor();
    const settings = await context.newPage();
    await settings.goto(`chrome://extensions/?id=${id}`);
    await settings.locator('#allow-on-file-urls').click();
    await settings.close();
  }
  assert.equal(await worker.evaluate(() => chrome.extension.isAllowedFileSchemeAccess()), true);
  await worker.evaluate(() => chrome.storage.local.set({ pdfReaderEnabled: true }));
  await page.goto(fileUrl).catch((error) => { if (!/ERR_ABORTED|interrupted/.test(error.message)) throw error; });
  await page.waitForURL((value) => value.href.startsWith(reader)); await ready(page, 'local-pdf');
  await page.getByText('Remember local document', { exact: true }).waitFor();
  await ask('Read this local browser PDF');
  assert.match(requests.at(-1).paper.text, /Remote and local document text/);
  await page.screenshot({ path: '/tmp/paper-read-universal.png' });
  assert.deepEqual(errors, []);
  console.log('PASS: MIME PDF redirect, signed query, original viewer, platform metadata/webpage, local import/reload/identity, invalid input, file permission and browser file:// PDF.');
} finally {
  await context?.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
