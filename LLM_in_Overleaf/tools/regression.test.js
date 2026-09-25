import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { access } from 'node:fs/promises';
const fixture = fileURLToPath(new URL('./fixtures/codex.cjs', import.meta.url));
process.env.OVERLEAF_EDIT_CODEX_BIN = fixture;
const { runCodex } = await import('../server/cli.js');
const { getModels } = await import('../server/models.js');
const { getHealth } = await import('../server/health.js');
const { resolveBinary } = await import('../server/config.js');
async function run(prompt, options = {}) {
  const events = [];
  await runCodex({ prompt, ...options }, (e) => events.push(e));
  return events;
}
const text = (events) => events.filter((e) => e.kind === 'text').map((e) => e.data).join('');
test('explicit CLI path wins', () => assert.equal(resolveBinary('codex', '/custom/codex'), '/custom/codex'));
test('health checks executable and login', async () => assert.equal((await getHealth('codex')).ok, true));
test('model/list follows pagination and uses model rather than display id', async () => {
  const result = await getModels('codex');
  assert.ok(result.codex.some(([id]) => id === 'model-first'));
  assert.ok(result.codex.some(([id]) => id === 'model-second'));
  assert.ok(!result.codex.some(([id]) => id === 'ui-first'));
  assert.equal(result.claude, null);
});
test('JSON updated/completed text is emitted once', async () => {
  const events = await run('normal');
  assert.equal(text(events), '```latex\nCorrected text.\n```');
  assert.equal(events.find((e) => e.kind === 'session').data, 'fixture-session');
});
test('resume keeps read-only sandbox, stdin, model and images', async () => {
  const result = JSON.parse(text(await run('ARGS', { resume: 'session-id', model: 'custom-model', effort: 'max', images: ['/tmp/a b.png'] })));
  assert.deepEqual(result.args.slice(0, 3), ['exec', 'resume', 'session-id']);
  assert.ok(result.args.includes('sandbox_mode="read-only"'));
  assert.ok(result.args.includes('model_reasoning_effort="xhigh"'));
  assert.ok(result.args.includes('custom-model'));
  assert.ok(result.args.includes('/tmp/a b.png'));
  assert.equal(result.args.at(-1), '-');
  assert.equal(result.prompt, 'ARGS');
  await assert.rejects(access(result.args[result.args.indexOf('-o') + 1]));
});
test('default model stays delegated to CLI configuration', async () => {
  const result = JSON.parse(text(await run('ARGS', { model: '(default)' })));
  assert.ok(!result.args.includes('-m'));
});
test('last-message file is a fallback when JSON body is missing', async () => assert.equal(text(await run('FALLBACK')), '最终答案'));
test('empty success reports an actionable error', async () => assert.equal((await run('EMPTY')).filter((e) => e.kind === 'error').length, 1));
test('partial output followed by failure is not swallowed or duplicated', async () => assert.equal((await run('FAIL_PARTIAL')).filter((e) => e.kind === 'error').length, 1));
test('already aborted request never starts', async () => assert.deepEqual(await run('normal', { signal: AbortSignal.abort() }), []));
test('abort terminates a running CLI without a spurious failure', async () => {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 150);
  const events = await run('WAIT', { signal: ac.signal });
  clearTimeout(timer);
  assert.equal(events.filter((e) => e.kind === 'error').length, 0);
});
async function nativeChat(resume) {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../server/native-host.js', import.meta.url))], { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
  const result = []; let buf = Buffer.alloc(0);
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('host timed out')), 5000);
      child.once('error', reject);
      child.stdout.on('data', (part) => {
        buf = Buffer.concat([buf, part]);
        while (buf.length >= 4 && buf.length >= 4 + buf.readUInt32LE(0)) {
          const len = buf.readUInt32LE(0); const msg = JSON.parse(buf.subarray(4, 4 + len)); buf = buf.subarray(4 + len); result.push(msg);
          if (msg.type === 'done') { clearTimeout(timer); resolve(result); }
        }
      });
      const body = Buffer.from(JSON.stringify({ type: 'chat_start', reqId: 'test', payload: { backend: 'codex', cliSession: { codex: resume }, mode: 'ask', messages: [{ role: 'user', content: 'normal' }] } }));
      const head = Buffer.alloc(4); head.writeUInt32LE(body.length);
      child.stdin.write(Buffer.concat([head, body]));
    });
  } finally { child.kill(); }
}
test('missing session retries with full context', async () => {
  const events = await nativeChat('missing');
  assert.equal(events.filter((e) => e.type === 'note').length, 1);
  assert.ok(events.some((e) => e.type === 'cli_session'));
  assert.ok(events.some((e) => e.type === 'delta'));
});
test('authentication failure is surfaced once without futile fresh-session retry', async () => {
  const events = await nativeChat('auth-fail');
  assert.equal(events.filter((e) => e.type === 'error').length, 1);
  assert.ok(!events.some((e) => e.type === 'note' || e.type === 'delta'));
});
