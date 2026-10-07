// Exercise the actual ZIP artifacts in disposable profiles and installer homes.
// No account, live model call, user browser profile or installed bridge is used.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'LLM_in_PDF/package.json'));
const { chromium } = require('playwright-core');
const temp = await mkdtemp(path.join(os.tmpdir(), 'llm-store-package-'));
const checks = [];
function nativePing(launcher, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(launcher, [], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = Buffer.alloc(0), finished = false;
    const timer = setTimeout(() => finish(new Error('Packaged native host ping timed out')), 30000);
    function finish(error, pong) {
      if (finished) return; finished = true; clearTimeout(timer);
      child.stdin.end(); if (error) child.kill();
      error ? reject(error) : resolve(pong);
    }
    child.on('error', finish);
    child.on('exit', code => { if (!finished) finish(new Error(`Native host exited before reply: ${code}`)); });
    child.stderr.resume();
    child.stdout.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32LE(0)) {
        try { finish(null, JSON.parse(buffer.subarray(4, 4 + buffer.readUInt32LE(0)))); }
        catch (error) { finish(error); }
      }
    });
    const body = Buffer.from(JSON.stringify({ type: 'ping', backend: 'claude' }));
    const head = Buffer.alloc(4); head.writeUInt32LE(body.length);
    child.stdin.write(Buffer.concat([head, body]));
  });
}
async function files(dir, prefix = '') {
  const result = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const name = prefix + item.name;
    if (item.isDirectory()) result.push(...await files(path.join(dir, item.name), name + '/'));
    else result.push(name);
  }
  return result;
}
try {
  for (const project of ['LLM_in_Overleaf', 'LLM_in_PDF']) {
    const version = JSON.parse(await readFile(path.join(root, project, 'package.json'))).version;
    const ext = path.join(temp, project, 'extension');
    const companion = path.join(temp, project, 'companion');
    for (const [kind, dest] of [['chrome', ext], ['companion', companion]]) {
      await mkdir(dest, { recursive: true });
      execFileSync('unzip', ['-q', path.join(root, 'dist/chrome-store', `${project}-${version}-${kind}.zip`), '-d', dest]);
    }
    const manifest = JSON.parse(await readFile(path.join(ext, 'manifest.json')));
    assert.equal(manifest.key, undefined);
    const context = await chromium.launchPersistentContext(path.join(temp, project, 'profile'), {
      channel: 'chromium', headless: true, locale: 'en-US',
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    });
    let id;
    try {
      const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
      id = new URL(worker.url()).host;
      assert.match(id, /^[a-p]{32}$/);
      await worker.evaluate(() => {
        chrome.runtime.connectNative = () => { throw new Error('Native connection disabled in isolated package test'); };
        const realFetch = fetch;
        globalThis.fetch = (url, ...args) => String(url).startsWith('http')
          ? Promise.reject(new Error('External backend disabled in isolated package test')) : realFetch(url, ...args);
      });
      // Every delivered runtime asset must be fetchable, including workers/fonts/WASM.
      const delivered = await files(ext);
      const missing = await worker.evaluate(async (names) => {
        const missing = [];
        for (const name of names) {
          try { const r = await fetch(chrome.runtime.getURL(name)); if (!r.ok) missing.push(name); }
          catch { missing.push(name); }
        }
        return missing;
      }, delivered);
      assert.deepEqual(missing, []);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`chrome-extension://${id}/popup/popup.html`);
      await page.waitForFunction((id) => document.querySelector('#install-command').textContent.includes(id), id);
      assert.match(await page.locator('#install-command').textContent(), new RegExp(`--extension-id ${id}`));
      assert.equal(await page.locator('a[href$="/PRIVACY.md"]').count(), 1);
      assert.equal(await page.evaluate(() => chrome.runtime.getManifest().version), version);
      // Chromium resolves manifest messages at process startup (OS locale), before
      // Playwright's context locale override. Require a real bundled translation.
      const descriptions = await Promise.all(['en', 'zh_CN'].map(async locale => JSON.parse(await readFile(path.join(ext, `_locales/${locale}/messages.json`))).extDescription.message));
      const description = await page.evaluate(() => chrome.i18n.getMessage('extDescription'));
      assert.ok(descriptions.includes(description));
      assert.equal(await page.evaluate(() => chrome.runtime.getManifest().description), description);
      if (project === 'LLM_in_Overleaf') {
        await page.locator('#language').selectOption('en');
        assert.match(await page.locator('.subtitle').textContent(), /local agent/);
        await page.locator('#language').selectOption('zh-CN');
        assert.match(await page.locator('.subtitle').textContent(), /本机 Agent/);
      } else {
        assert.match(await page.locator('#http-command').textContent(), new RegExp(id));
        const generator = await context.newPage();
        await generator.setContent('<h1>Packaged PDF test</h1><p>Bundled worker and text extraction are available.</p>');
        const pdf = await generator.pdf({ format: 'A4' });
        await generator.close();
        await page.goto(`chrome-extension://${id}/reader/reader.html`);
        await page.locator('#local-file').setInputFiles({ name: 'package-test.pdf', mimeType: 'application/pdf', buffer: pdf });
        await page.waitForFunction(() => document.querySelector('#paper-read-host')?.shadowRoot.querySelector('#pr-paper-meta').textContent.includes('local-pdf'));
        await page.getByText('Bundled worker and text extraction are available.', { exact: true }).waitFor();
        await page.reload();
        await page.getByText('Bundled worker and text extraction are available.', { exact: true }).waitFor();
      }
      assert.deepEqual(errors, []);
      checks.push(`${project}: ${delivered.length} packaged assets, service worker, popup, locale, actual ID${project.endsWith('PDF') ? ', PDF import/render/text/reload' : ', English/Chinese UI'}`);
    } finally { await context.close(); }
    // Keep the native registration and any CLI probes entirely within a throwaway HOME.
    if (process.platform !== 'win32') {
      const projectDir = path.join(companion, project);
      const home = path.join(temp, project, 'home');
      const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: '', CODEX_HOME: path.join(home, '.codex'), CLAUDE_CONFIG_DIR: path.join(home, '.claude') };
      execFileSync('bash', ['./install.sh', '--extension-id', id], { cwd: projectDir, env, timeout: 60000, stdio: 'pipe' });
      const hostName = project.endsWith('PDF') ? 'com.paper_read.host' : 'com.llm_in_overleaf.host';
      const location = process.platform === 'darwin' ? 'Library/Application Support/Google/Chrome' : '.config/google-chrome';
      const registration = JSON.parse(await readFile(path.join(home, location, 'NativeMessagingHosts', hostName + '.json')));
      assert.deepEqual(registration.allowed_origins, [`chrome-extension://${id}/`]);
      const pong = await nativePing(registration.path, env);
      assert.equal(pong.type, 'pong'); assert.equal(pong.version, version);
      execFileSync('bash', ['./install.sh', '--uninstall'], { cwd: projectDir, env, timeout: 30000, stdio: 'pipe' });
      checks.push(`${project}: extracted companion install, exact ID authorization, native ping ${version}, uninstall`);
    }
  }
  console.log(checks.join('\n'));
  console.log('Packaged Chrome extensions and companion ZIPs PASS.');
} finally { await rm(temp, { recursive: true, force: true }); }
