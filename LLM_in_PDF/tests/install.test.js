import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

for (const platform of ['darwin', 'linux']) test(`install, update, native ping and uninstall (${platform})`, { skip: process.platform === 'win32' }, async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "llm-pdf-中文 ' "));
  const install = (...args) => {
    const result = spawnSync(process.execPath, ['tools/install.mjs', '--home', home, '--platform', platform, ...args], { encoding: 'utf8', env: { ...process.env, https_proxy: "http://example.invalid/a'$(touch NEVER_EXECUTE)" } });
    assert.equal(result.status, 0, result.stderr);
  };
  try {
    install(); install();
    const location = platform === 'darwin' ? 'Library/Application Support/Google/Chrome' : '.config/google-chrome';
    const filename = path.join(home, location, 'NativeMessagingHosts/com.paper_read.host.json');
    const manifest = JSON.parse(await readFile(filename, 'utf8'));
    const extension = JSON.parse(await readFile('extension/manifest.json', 'utf8'));
    const id = createHash('sha256').update(Buffer.from(extension.key, 'base64')).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));
    assert.equal(id, 'acafiedlcaibhilacmadmiklkfhmlhjo');
    assert.deepEqual(manifest.allowed_origins, [`chrome-extension://${id}/`]);
    const body = Buffer.from('{"type":"ping"}'), header = Buffer.alloc(4);
    header.writeUInt32LE(body.length);
    const result = spawnSync(manifest.path, [], { input: Buffer.concat([header, body]), timeout: 5000 });
    assert.equal(result.status, 0, String(result.stderr));
    assert.equal(JSON.parse(result.stdout.subarray(4)).type, 'pong');
    await assert.rejects(access('NEVER_EXECUTE'));
    const storeId = 'abcdefghijklmnopabcdefghijklmnop';
    install('--extension-id', storeId);
    assert.deepEqual(JSON.parse(await readFile(filename, 'utf8')).allowed_origins, [`chrome-extension://${storeId}/`]);
    for (const bad of ['invalid', '*', 'a'.repeat(31), 'q'.repeat(32)]) {
      const invalid = spawnSync(process.execPath, ['tools/install.mjs', '--home', home, '--platform', platform, '--extension-id', bad]);
      assert.notEqual(invalid.status, 0);
    }
    assert.deepEqual(JSON.parse(await readFile(filename, 'utf8')).allowed_origins, [`chrome-extension://${storeId}/`]);
    install('--uninstall');
    await assert.rejects(access(filename), { code: 'ENOENT' });
    await assert.rejects(access(path.join(home, '.llm_in_pdf')), { code: 'ENOENT' });
  } finally { await rm(home, { recursive: true, force: true }); }
});
