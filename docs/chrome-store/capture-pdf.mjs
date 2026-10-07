// Real extension, synthetic PDF, live CLI answers. No model replies are mocked.
// From the repository root: node docs/chrome-store/capture-pdf.mjs
import { chromium } from '../../LLM_in_PDF/node_modules/playwright-core/index.mjs';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const root = path.resolve('LLM_in_PDF'), out = path.resolve('docs/chrome-store/pdf/assets/zh_CN');
await mkdir(out, { recursive: true });
const profile = await mkdtemp(path.join(os.tmpdir(), 'llm-pdf-record-'));
const server = spawn(process.execPath, ['server/server.js'], { cwd: root, env: { ...process.env, LLM_IN_PDF_PORT: '28765' }, stdio: ['ignore', 'pipe', 'pipe'] });
await once(server.stdout, 'data');
let context;
const marks = []; let began;
const mark = (label) => { const entry = { label, t: (Date.now() - began) / 1000 }; marks.push(entry); console.log(entry); };
try {
  context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${root}/extension`, `--load-extension=${root}/extension`],
    viewport: { width: 1280, height: 800 } });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  await worker.evaluate(async () => {
    // Use the real local HTTP service so this isolated profile does not depend on the user's installed bridge.
    chrome.runtime.connectNative = () => { throw new Error('Recording uses HTTP transport'); };
    await chrome.storage.local.set({ backendUrl: 'http://127.0.0.1:28765', backend: 'claude', model: 'sonnet', effort: 'low' });
  });
  const generator = await context.newPage();
  await generator.setContent(await readFile('docs/video/demo-paper.html', 'utf8'));
  const pdf = await generator.pdf({ preferCSSPageSize: true, printBackground: true });
  await generator.close();
  const page = await context.newPage(); began = Date.now();

  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`chrome-extension://${id}/reader/reader.html`);
  mark('picker'); await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(out, 'screenshot-import.png') });
  await page.locator('#local-file').setInputFiles({ name: 'Document Context — Demo.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.waitForFunction(() => document.querySelector('#paper-read-host')?.shadowRoot.querySelector('#pr-paper-meta').textContent.includes('local-pdf'));
  await page.locator('#pr-backend').selectOption('claude');
  await page.locator('#pr-model option[value="sonnet"]').waitFor({ state: 'attached', timeout: 30000 });
  await page.locator('#pr-model').selectOption('sonnet');
  await page.locator('#pr-effort').selectOption('low');
  await page.locator('#zoom').selectOption('page-fit');
  mark('reader'); await page.waitForTimeout(2000);
  const span = page.locator('.textLayer span').filter({ hasText: 'Adding document context raises accuracy' }).first();
  const box = await span.boundingBox();
  await page.mouse.move(box.x + 1, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 24 }); await page.mouse.up();
  await page.locator('#pr-ask-btn').click(); mark('selection');
  await page.locator('#pr-input').pressSequentially('用两句话解释这里的提升：百分点和相对提升有什么区别？', { delay: 55 });
  await page.locator('#pr-send').click(); mark('text_sent');
  await page.locator('#pr-stop').waitFor({ state: 'hidden', timeout: 180000 });
  const panelText = await page.locator('#pr-messages').innerText();
  assert.match(panelText, /14/); assert.match(panelText, /19\.4/); assert.doesNotMatch(panelText, /<invoke/);
  mark('text_answer'); await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(out, 'screenshot-text.png') });
  await page.locator('#select-image').click();
  const cb = await page.locator('.canvasWrapper').first().boundingBox();
  // PDF figure occupies x=48..672, y≈402..652 in a 720×920 page.
  await page.mouse.move(cb.x + cb.width * .063, cb.y + cb.height * .48); await page.mouse.down();
  await page.mouse.move(cb.x + cb.width * .94, cb.y + cb.height * .82, { steps: 35 }); await page.mouse.up();
  await page.locator('.pr-image-preview img').waitFor(); mark('crop');
  await page.locator('#pr-input').pressSequentially('用只有「条件」「准确率」两列的表格比较图中两根柱子，再用一句话说明局限。', { delay: 45 });
  await page.locator('#pr-send').click(); mark('image_sent');
  await page.locator('#pr-stop').waitFor({ state: 'hidden', timeout: 180000 });
  const imageText = await page.locator('#pr-messages').innerText();
  assert.match(imageText, /72/); assert.match(imageText, /86/);
  await page.locator('.pr-table-scroll table').waitFor(); mark('image_answer');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(out, 'screenshot-figure.png') });
  await page.reload();
  await page.locator('.pr-table-scroll table').waitFor(); mark('restored'); await page.waitForTimeout(1600);
  await page.locator('#pr-copy').click(); mark('copied'); await page.waitForTimeout(2000);
  assert.deepEqual(errors, []);
  await writeFile('/tmp/llm-store-pdf-capture.json', JSON.stringify({ marks, transport: 'real HTTP bridge', backend: 'claude', model: 'sonnet', syntheticDocument: true, answers: imageText }, null, 2));
  await page.close();
  await mkdir(path.resolve('docs/chrome-store/pdf/assets/en'), { recursive: true });
  for (const name of ['import', 'text', 'figure']) await writeFile(path.resolve(`docs/chrome-store/pdf/assets/en/screenshot-${name}.png`), await readFile(path.join(out, `screenshot-${name}.png`)));
  console.log('Recorded real PDF text/image answers and reload persistence.');
} finally {
  if (context) await context.close();
  server.kill(); await once(server, 'close');
  await rm(profile, { recursive: true, force: true });
}
