import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fixture = path.join(ROOT, 'tools/fixtures/mock-cli.cjs');
const dir = await mkdtemp(path.join(os.tmpdir(), 'word-edit-test-'));
process.env.WORD_EDIT_CLAUDE_BIN = fixture;
process.env.WORD_EDIT_CODEX_BIN = fixture;
process.env.WORD_EDIT_DATA_DIR = dir;
const { runModel } = await import('../server/cli.js');
const { runProcess, classifyError } = await import('../server/process.js');
const { getModels, claudeCatalog } = await import('../server/models.js');
const { getHealth } = await import('../server/health.js');
let server, base;
test.before(async () => {
  server = spawn(process.execPath, ['server/server.js'], { cwd: ROOT, env: { ...process.env, WORD_EDIT_PORT: '0', WORD_EDIT_CERT_DIR: dir }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.setEncoding('utf8');
  base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('test server did not start')), 5000);
    server.stdout.on('data', (chunk) => { const m = chunk.match(/http[^\n]*\/\/127\.0\.0\.1:(\d+)/); if (m) { clearTimeout(timer); resolve('http://127.0.0.1:' + m[1]); } });
    server.on('error', reject);
    server.stderr.on('data', (c) => process.stderr.write(c));
  });
});
test.after(async () => { if (server) { const closed = once(server, 'close'); server.kill(); await closed; } await rm(dir, { recursive: true, force: true }); });
for (const backend of ['claude', 'codex']) {
  test(`${backend}: chunked JSON / no final newline produces exactly one answer`, async () => {
    const events = []; const result = await runModel(backend, { prompt: 'ok' }, (e) => events.push(e));
    assert.equal(result.ok, true);
    assert.equal(events.filter(e => e.kind === 'text').map(e => e.data).join(''), '```text\n改写后的文本。\n```');
  });
  test(`${backend}: result error never becomes body text`, async () => {
    const events = []; const result = await runModel(backend, { prompt: 'MOCK_FAIL' }, (e) => events.push(e));
    assert.equal(result.ok, false); assert.equal(events.filter(e => e.kind === 'text').length, 0); assert.equal(events.filter(e => e.kind === 'error').length, 1);
  });
  test(`${backend}: nonzero exit after partial output is failure`, async () => {
    const result = await runModel(backend, { prompt: 'MOCK_PARTIAL' }, () => {}); assert.equal(result.ok, false);
  });
  test(`${backend}: empty zero exit is failure`, async () => {
    assert.equal((await runModel(backend, { prompt: 'MOCK_EMPTY' }, () => {})).ok, false);
  });
  test(`${backend}: already aborted request never spawns`, async () => {
    const ac = new AbortController(); ac.abort(); const events = [];
    assert.equal((await runModel(backend, { prompt: 'ok', signal: ac.signal }, e => events.push(e))).aborted, true);
    assert.equal(events.length, 0);
  });
}
test('process timeout kills a CLI that ignores SIGTERM', async () => {
  const start = Date.now();
  const result = await runProcess(fixture, [], { input: 'MOCK_WAIT', timeoutMs: 100 });
  assert.equal(result.timedOut, true); assert.ok(Date.now() - start < 2500);
});
test('active cancellation terminates promptly', async () => {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 100);
  try { assert.equal((await runProcess(fixture, [], { input: 'MOCK_WAIT', signal: ac.signal })).aborted, true); } finally { clearTimeout(timer); }
});
test('missing executable returns actionable failure', async () => {
  const result = await runProcess('/no/such/word-edit-cli', []);
  assert.equal(classifyError(result.error.message).code, 'cli_missing');
});
test('model discovery handles pagination and supported efforts', async () => {
  const models = await getModels(true);
  assert.deepEqual(models.claude, [['sonnet', 'Sonnet 5'], ['opus', 'Opus 4.8'], ['haiku', 'Haiku 4.5']]);
  assert.equal(models.details.claude.haiku.resolvedModel, 'claude-haiku-4-5-20251001');
  assert.equal(models.sources.claude, 'cli');
  assert.ok(models.codex.some(([id]) => id === 'mock-second')); assert.deepEqual(models.efforts.codex['mock-first'], ['low', 'medium']);
});
test('health does not mistake Not logged in for Logged in', async () => {
  const h = await getHealth(true); assert.equal(h.backends.codex.status, 'auth'); assert.equal(h.backends.claude.status, 'ready');
  assert.equal(JSON.stringify(h).includes('loggedIn'), false);
});
async function chat(backend, content, resume) {
  const r = await fetch(base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ backend, mode: 'edit', messages: [{ role: 'user', content }], doc: { selection: '原文', fullText: '原文' }, cliSession: resume ? { [backend]: resume } : undefined }) });
  assert.equal(r.status, 200); return (await r.text()).trim().split('\n').map(JSON.parse);
}
for (const backend of ['claude', 'codex']) {
  test(`${backend}: successful API response includes session and done.ok`, async () => {
    const events = await chat(backend, 'ok'); assert.equal(events.at(-1).ok, true); assert.ok(events.some(e => e.type === 'cli_session' && e.id));
  });
  test(`${backend}: explicit missing session rebuilds exactly once`, async () => {
    const events = await chat(backend, 'ok', 'expired'); assert.equal(events.filter(e => e.type === 'note').length, 1); assert.equal(events.at(-1).ok, true);
  });
  test(`${backend}: authentication error does not restart generation`, async () => {
    const events = await chat(backend, 'MOCK_AUTH', 'valid'); assert.equal(events.filter(e => e.type === 'note').length, 0); assert.equal(events.filter(e => e.type === 'error').length, 1); assert.equal(events.at(-1).ok, false);
  });
  test(`${backend}: failed turn invalidates the cached session`, async () => {
    const events = await chat(backend, 'MOCK_PARTIAL'); assert.equal(events.at(-1).ok, false); assert.ok(events.some(e => e.type === 'cli_session' && e.id === null));
  });
}
test('invalid payload and foreign origin cannot start a CLI', async () => {
  for (const body of [null, [], { backend: 'bad' }, { backend: 'claude', messages: [{ role: 'user', content: 42 }] }]) {
    assert.equal((await fetch(base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).status, 400);
  }
  assert.equal((await fetch(base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://foreign.example' }, body: '{}' })).status, 403);
});

test('Claude catalogs without resolved IDs fall back to explicit automatic aliases', () => {
  for (const data of [null, [], [{ value: 'opus', displayName: 'Opus' }]]) {
    const result = claudeCatalog(data);
    assert.deepEqual(result.details, {});
    assert.equal(result.claude.find(([id]) => id === 'opus')[1], 'Opus · 自动版本');
  }
});
