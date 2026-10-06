import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import http from 'node:http';

const fake = path.resolve('tests/fixtures/fake-cli.cjs');
const env = { ...process.env, LLM_IN_PDF_CLAUDE_BIN: fake, LLM_IN_PDF_CODEX_BIN: fake };
const image = { id: 'fixture-1', name: '第 1 页图表', mime: 'image/png', b64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' };
function frame(msg) {
  const body = Buffer.from(JSON.stringify(msg)), prefix = Buffer.alloc(4);
  prefix.writeUInt32LE(body.length); return Buffer.concat([prefix, body]);
}
function nativeClient(child) {
  let buffer = Buffer.alloc(0);
  const queue = [], waiting = [];
  child.stdout.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4 && buffer.length >= buffer.readUInt32LE(0) + 4) {
      const size = buffer.readUInt32LE(0), msg = JSON.parse(buffer.subarray(4, size + 4));
      buffer = buffer.subarray(size + 4);
      if (waiting.length) waiting.shift()(msg); else queue.push(msg);
    }
  });
  return { send: (msg) => child.stdin.write(frame(msg)), next: () => queue.length ? Promise.resolve(queue.shift()) : new Promise((r) => waiting.push(r)) };
}

test('Native bridge discovers paginated models and streams both CLIs without overriding defaults', { timeout: 15000 }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'paper-read-test-'));
  await writeFile(path.join(dir, 'config.toml'), 'model = "future-model"\n[profiles.other]\nmodel = "wrong-model"\n');
  const child = spawn(process.execPath, ['server/native-host.js'], { env: { ...env, CODEX_HOME: dir }, stdio: ['pipe', 'pipe', 'pipe'] });
  const client = nativeClient(child);
  try {
    client.send({ type: 'ping' }); assert.equal((await client.next()).type, 'pong');
    client.send({ type: 'models', reqId: 'models' }); const catalog = await client.next();
    assert.equal(catalog.ok, true);
    assert.equal(catalog.defaults.codex, 'future-model');
    assert.deepEqual(catalog.codex.map(([id]) => id), ['(default)', 'future-model', 'future-lite']);
    assert.deepEqual(catalog.efforts.codex['(default)'], ['low', 'max', 'ultra']);
    assert.ok(catalog.claude.some(([id]) => id === 'future-claude'));
    for (const backend of ['claude', 'codex']) for (const images of [[], [image]]) {
      client.send({ type: 'chat_start', reqId: backend, payload: { backend, model: '(default)', effort: 'max', paper: { title: 'Test', text: '论文全文' }, messages: [{ role: 'user', content: '问题', images: images.map(({ id, name }) => ({ id, name })) }], selection: '选段', images } });
      let text = ''; const events = [];
      for (;;) { const msg = await client.next(); events.push(msg); if (msg.type === 'delta') text += msg.text; if (msg.type === 'done') break; }
      assert.equal(events.filter((msg) => msg.type === 'error').length, 0);
      const answer = JSON.parse(text);
      assert.match(answer.received, /论文全文/); assert.match(answer.received, /选段/);
      assert.ok(!answer.args.includes('--model') && !answer.args.includes('-m'));
      if (backend === 'codex') assert.ok(answer.args.includes('model_reasoning_effort="max"'));
      else assert.ok(events.some((msg) => msg.type === 'model' && msg.model === 'claude-future-9'));
      if (images.length) {
        assert.equal(answer.images[0].b64, image.b64);
        assert.match(answer.received, /引用编号 fixture-1/);
        if (backend === 'codex') await assert.rejects(access(answer.images[0].path), { code: 'ENOENT' });
        else { assert.ok(answer.args.includes('--input-format')); assert.equal(answer.images[0].mime, image.mime); }
      }
    }
    client.send({ type: 'chat_start', reqId: 'bad', payload: { backend: 'claude', messages: [{ role: 'user', content: 'SIMULATE_ERROR' }] } });
    const events = [];
    for (;;) { const msg = await client.next(); events.push(msg); if (msg.type === 'done') break; }
    assert.ok(events.some((msg) => msg.type === 'error'));
    assert.ok(!events.some((msg) => msg.type === 'delta'));
    client.send({ type: 'chat_start', reqId: 'bad-image', payload: { backend: 'codex', messages: [{ role: 'user', content: '图片' }], images: [{ path: '/private/data.png' }] } });
    const invalid = [];
    for (;;) { const msg = await client.next(); invalid.push(msg); if (msg.type === 'done') break; }
    assert.ok(invalid.some((msg) => msg.type === 'error' && /图片/.test(msg.error)));
    assert.ok(!invalid.some((msg) => msg.type === 'delta'));
  } finally {
    child.stdin.end();
    await once(child, 'close');
    await rm(dir, { recursive: true, force: true });
  }
});

test('HTTP models route and SSE survive completion of the request body', { timeout: 15000 }, async () => {
  const child = spawn(process.execPath, ['server/server.js'], { env: { ...env, LLM_IN_PDF_PORT: '18765' }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await once(child.stdout, 'data');
    const catalog = await (await fetch('http://127.0.0.1:18765/api/models')).json();
    assert.equal(catalog.ok, true);
    assert.equal((await (await fetch('http://127.0.0.1:18765/health')).json()).service, 'LLM_in_PDF');
    assert.equal((await fetch('http://127.0.0.1:18765/api/models', { headers: { Origin: 'https://example.com' } })).status, 403);
    assert.equal(await new Promise((resolve, reject) => { const req = http.get('http://127.0.0.1:18765/health', { headers: { Host: 'attacker.example' } }, (res) => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); }), 403);
    assert.equal((await fetch('http://127.0.0.1:18765/api/chat', { method: 'POST', body: '{}' })).status, 415);
    assert.equal((await fetch('http://127.0.0.1:18765/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [null], selection: 42 }) })).status, 400);
    for (const backend of ['claude', 'codex']) {
    const response = await fetch('http://127.0.0.1:18765/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ backend, messages: [{ role: 'user', content: 'Test request' }], images: [image] }) });
    const body = await response.text();
    assert.match(body, /"type":"delta"/);
    assert.match(body, /"type":"done"/);
    assert.doesNotMatch(body, /"type":"error"/);
    const answer = JSON.parse(body.split('\n').filter((line) => line.startsWith('data: ')).map((line) => JSON.parse(line.slice(6))).filter((event) => event.type === 'delta').map((event) => event.text).join(''));
    assert.equal(answer.images[0].b64, image.b64);
    if (backend === 'codex') await assert.rejects(access(answer.images[0].path), { code: 'ENOENT' });
    }
  } finally { child.kill(); await once(child, 'close'); }
});

test('Native cancellation and disconnect both remove temporary images', { timeout: 15000 }, async () => {
  for (const disconnect of [false, true]) {
    const child = spawn(process.execPath, ['server/native-host.js'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    const client = nativeClient(child);
    const closed = once(child, 'close');
    try {
      client.send({ type: 'chat_start', reqId: 'cancel-image', payload: { backend: 'codex', messages: [{ role: 'user', content: 'WAIT_FOR_ABORT' }], images: [image] } });
      let workdir;
      for (;;) { const msg = await client.next(); if (msg.type === 'delta') { workdir = msg.text; break; } }
      await access(path.join(workdir, 'image-1.png'));
      if (disconnect) { child.stdin.end(); await closed; }
      else {
        client.send({ type: 'chat_stop', reqId: 'cancel-image' });
        for (;;) { if ((await client.next()).type === 'done') break; }
      }
      await assert.rejects(access(workdir), { code: 'ENOENT' });
    } finally { if (child.exitCode === null) { child.stdin.end(); await closed; } }
  }
});
