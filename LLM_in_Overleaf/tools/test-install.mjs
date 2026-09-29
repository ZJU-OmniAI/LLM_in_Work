// Installer smoke test: install → registration files → launcher answers a native-messaging ping → uninstall.
// Uses a temporary HOME (macOS / Linux) or LOCALAPPDATA (Windows); never touches a real installation,
// except the per-user registry keys on Windows, which the test removes again. No model account needed.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const hostName = 'com.llm_in_overleaf.host';
const origin = 'chrome-extension://fabclfbbpmgoojaccbpmopjfkocoaoik/';
const temp = mkdtempSync(path.join(os.tmpdir(), 'llm-in-overleaf-install-'));
const run = (cmd, args, env) => {
  const result = spawnSync(cmd, args, { cwd: project, env: { ...process.env, ...env }, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${result.status})\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
};
const ping = (launcher) => run(process.execPath, [path.join(project, 'tools/ping-host.mjs'), launcher], {});

if (process.platform === 'win32') {
  const env = { LOCALAPPDATA: temp };
  const ps = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(project, 'install.ps1')];
  console.log(run('powershell.exe', ps, env));
  const base = path.join(temp, 'LLM_in_Overleaf');
  const manifestPath = path.join(base, `${hostName}.json`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.name, hostName);
  assert.deepEqual(manifest.allowed_origins, [origin]);
  assert.equal(manifest.path, path.join(base, 'host.cmd'));
  const key = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${hostName}`;
  assert.ok(execFileSync('reg.exe', ['query', key, '/ve'], { encoding: 'utf8' }).includes(manifestPath), 'Chrome registry entry points to the manifest');
  assert.match(ping(manifest.path), /Native host v\d+\.\d+\.\d+ responded/);
  console.log(run('powershell.exe', [...ps, '-Uninstall'], env));
  assert.notEqual(spawnSync('reg.exe', ['query', key]).status, 0, 'registry entry removed');
  assert.equal(existsSync(manifest.path), false);
} else {
  const env = { HOME: temp, XDG_CONFIG_HOME: '' };
  console.log(run('bash', [path.join(project, 'install.sh')], env));
  const root = process.platform === 'darwin'
    ? path.join(temp, 'Library/Application Support/Google/Chrome/NativeMessagingHosts')
    : path.join(temp, '.config/google-chrome/NativeMessagingHosts');
  const manifest = JSON.parse(readFileSync(path.join(root, `${hostName}.json`), 'utf8'));
  assert.equal(manifest.path, path.join(temp, '.llm_in_overleaf/host.sh'));
  assert.deepEqual(manifest.allowed_origins, [origin]);
  assert.equal(statSync(manifest.path).mode & 0o777, 0o700, 'launcher is private to the user');
  const launcher = readFileSync(manifest.path, 'utf8');
  assert.doesNotMatch(launcher, /\/var\/folders\/|codex-arg0/, 'temporary PATH entries are not recorded');
  assert.match(ping(manifest.path), /Native host v\d+\.\d+\.\d+ responded/);
  console.log(run('bash', [path.join(project, 'install.sh'), '--uninstall'], env));
  assert.equal(existsSync(path.join(root, `${hostName}.json`)), false);
  assert.equal(existsSync(manifest.path), false);
}
console.log(`Installer PASS (${process.platform}): registration, private launcher, native-messaging ping and uninstall.`);
