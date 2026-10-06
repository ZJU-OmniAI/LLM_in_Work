// Register the fixed extension ID without copying credentials into the repository.
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = 'com.paper_read.host'; // Preserve compatibility with existing extension installations.
const option = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : process.argv[i + 1];
};
// --home/--platform allow installer tests in an isolated directory.
const home = path.resolve(option('--home', os.homedir()));
const platform = option('--platform', process.platform);
if (!['darwin', 'linux'].includes(platform)) throw new Error('Native installation supports macOS/Linux. On Windows use npm start (HTTP fallback).');
const wrap = path.join(home, '.llm_in_pdf');
const dirs = platform === 'darwin'
  ? ['Google/Chrome', 'Google/Chrome Beta', 'Google/Chrome Canary', 'Chromium', 'Microsoft Edge', 'BraveSoftware/Brave-Browser', 'Arc/User Data'].map((name) => path.join(home, 'Library/Application Support', name, 'NativeMessagingHosts'))
  : ['google-chrome', 'google-chrome-beta', 'chromium', 'microsoft-edge', 'BraveSoftware/Brave-Browser'].map((name) => path.join(home, '.config', name, 'NativeMessagingHosts'));
if (process.argv.includes('--uninstall')) {
  for (const dir of dirs) {
    const file = path.join(dir, `${host}.json`);
    try {
      const manifest = JSON.parse(await readFile(file, 'utf8'));
      // Do not remove a host registration belonging to another checkout/legacy installation.
      if (manifest.path === path.join(wrap, 'host.sh')) await rm(file);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  await rm(wrap, { recursive: true, force: true });
  console.log('LLM_in_PDF native bridge removed. Browser documents and conversations are unchanged.');
} else {
  const manifest = JSON.parse(await readFile(path.join(project, 'extension/manifest.json'), 'utf8'));
  const id = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));
  const quote = (value) => "'" + value.replace(/'/g, "'\\''") + "'";
  const exports = ['http_proxy', 'https_proxy', 'all_proxy', 'no_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'LLM_IN_PDF_CLAUDE_BIN', 'LLM_IN_PDF_CODEX_BIN', 'PAPER_READ_CLAUDE_BIN', 'PAPER_READ_CODEX_BIN']
    .filter((key) => process.env[key]).map((key) => `export ${key}=${quote(process.env[key])}`);
  await mkdir(wrap, { recursive: true, mode: 0o700 });
  await writeFile(path.join(wrap, 'host.sh'), ['#!/bin/bash', ...exports, `exec ${quote(process.execPath)} ${quote(path.join(project, 'server/native-host.js'))}`, ''].join('\n'), { mode: 0o700 });
  const registration = JSON.stringify({ name: host, description: 'LLM_in_PDF local Claude Code / Codex bridge', path: path.join(wrap, 'host.sh'), type: 'stdio', allowed_origins: [`chrome-extension://${id}/`] }, null, 2) + '\n';
  for (const dir of dirs) {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${host}.json`), registration, { mode: 0o600 });
  }
  console.log(`LLM_in_PDF installed. Load unpacked extension: ${path.join(project, 'extension')}`);
  console.log('Restart/reload the extension after installation. Re-run install.sh after moving the project or changing Node/proxy settings.');
}
