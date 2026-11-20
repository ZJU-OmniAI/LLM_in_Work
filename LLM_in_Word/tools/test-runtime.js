import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { versionOf, compareVersions, getCliRuntime } from '../server/runtime.js';

test('every assistant ships the same CLI runtime picker', () => {
  const mine = readFileSync(new URL('../server/runtime.js', import.meta.url), 'utf8');
  for (const other of ['LLM_in_Word', 'LLM_in_PowerPoint', 'LLM_in_Excel', 'LLM_in_Overleaf', 'LLM_in_PDF']) {
    const file = new URL(`../../${other}/server/runtime.js`, import.meta.url);
    if (existsSync(file)) assert.equal(readFileSync(file, 'utf8'), mine, other);
  }
});

test('CLI versions are read from --version output and ordered like semantic versions', () => {
  assert.equal(versionOf('codex-cli 0.169.0-alpha.11.1\n'), '0.169.0-alpha.11.1');
  assert.equal(versionOf('2.1.323 (Claude Code)'), '2.1.323');
  assert.equal(versionOf('Error: claude native binary not installed.'), null);
  const ordered = ['0.159.2', '0.169.0-alpha', '0.169.0-alpha.1', '0.169.0-alpha.11.1', '0.169.0-beta',
    '0.169.0-beta.2', '0.169.0-beta.11', '0.169.0-rc.1', '0.169.0', '0.171.0', '2.1.9', '2.1.10', '2.1.323'];
  for (let i = 1; i < ordered.length; i++) {
    assert.ok(compareVersions(ordered[i - 1], ordered[i]) < 0, `${ordered[i - 1]} < ${ordered[i]}`);
    assert.ok(compareVersions(ordered[i], ordered[i - 1]) > 0, `${ordered[i]} > ${ordered[i - 1]}`);
  }
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
  assert.ok(compareVersions('0.0.1', null) > 0);
});

test('the newest working CLI runs, not the first one on PATH or the installer-detected one', { skip: process.platform === 'win32' }, async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'llm-in-work-cli-versions-'));
  const keys = ['PATH', 'LLM_IN_WORD_CODEX_BIN', 'WORD_EDIT_CODEX_BIN', 'LLM_IN_WORD_CODEX_DETECTED', 'WORD_EDIT_CODEX_DETECTED'];
  const saved = keys.map((key) => process.env[key]);
  t.after(async () => {
    keys.forEach((key, i) => { if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i]; });
    await rm(dir, { recursive: true, force: true });
  });
  const install = async (name, script) => {
    await mkdir(path.join(dir, name), { recursive: true });
    const bin = path.join(dir, name, 'codex');
    await writeFile(bin, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
    return bin;
  };
  const broken = await install('broken', 'echo "Error: native binary not installed" >&2; exit 1');
  const npm = await install('npm', 'echo "codex-cli 900.1.0"');
  const app = await install('app', 'echo "codex-cli 900.2.0-alpha.11.1"');
  const detected = await install('detected', 'echo "codex-cli 900.0.5"');
  await mkdir(path.join(dir, 'alias'));
  await symlink(npm, path.join(dir, 'alias', 'codex'));
  for (const key of keys.slice(1)) delete process.env[key];
  process.env.PATH = ['broken', 'alias', 'npm', 'app'].map((name) => path.join(dir, name)).concat(saved[0] || '').join(path.delimiter);
  process.env.LLM_IN_WORD_CODEX_DETECTED = detected;

  assert.deepEqual(await getCliRuntime('codex'), { bin: app, version: '900.2.0-alpha.11.1', available: true, overridden: false });
  // An in-place upgrade of another copy is noticed without restarting the service.
  await writeFile(npm, '#!/bin/sh\necho "codex-cli 900.10.0"\n', { mode: 0o755 });
  assert.equal((await getCliRuntime('codex')).bin, path.join(dir, 'alias', 'codex'));
  // An explicit path always wins, even when it is older or does not start.
  process.env.LLM_IN_WORD_CODEX_BIN = broken;
  assert.deepEqual(await getCliRuntime('codex'), { bin: broken, version: null, available: false, overridden: true });
});
