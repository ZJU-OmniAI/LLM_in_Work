#!/usr/bin/env node
// Offline CLI fixture: no accounts, API calls, or user files.
const fs = require('node:fs');
const args = process.argv.slice(2);
const emit = (value) => process.stdout.write(JSON.stringify(value) + '\n');
if (args.includes('--version')) { console.log('codex-cli 0.0.0-test'); process.exit(0); }
if (args[0] === 'login') { console.log('Logged in'); process.exit(0); }
if (args[0] === 'app-server') {
  let buf = '';
  process.stdin.on('data', (part) => {
    buf += part;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const msg = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
      if (msg.method === 'initialize') emit({ id: msg.id, result: {} });
      if (msg.method === 'model/list') emit({ id: msg.id, result: msg.params.cursor
        ? { data: [{ id: 'ui-second', model: 'model-second', displayName: 'Second' }], nextCursor: null }
        : { data: [{ id: 'ui-first', model: 'model-first', displayName: 'First', isDefault: true }], nextCursor: 'page-2' } });
    }
  });
} else {
  let prompt = '';
  process.stdin.on('data', (d) => { prompt += d; });
  process.stdin.on('end', () => {
    const resume = args[0] === 'exec' && args[1] === 'resume' ? args[2] : null;
    if (resume === 'auth-fail') { emit({ type: 'turn.failed', error: { message: '401 login required' } }); process.exit(1); }
    if (resume === 'missing') { emit({ type: 'turn.failed', error: { message: 'session not found' } }); process.exit(1); }
    if (prompt.includes('WAIT')) { setInterval(() => {}, 1000); return; }
    emit({ type: 'thread.started', thread_id: 'fixture-session' });
    if (prompt.includes('EMPTY')) return;
    if (prompt.includes('FALLBACK')) { fs.writeFileSync(args[args.indexOf('-o') + 1], '最终答案'); return; }
    const answer = prompt.includes('ARGS') ? JSON.stringify({ args, prompt }) : '```latex\nCorrected text.\n```';
    emit({ type: 'item.updated', item: { type: 'agent_message', id: 'one', text: answer.slice(0, 8) } });
    emit({ type: 'item.completed', item: { type: 'agent_message', id: 'one', text: answer } });
    if (prompt.includes('FAIL_PARTIAL')) { emit({ type: 'turn.failed', error: { message: 'network failed' } }); process.exit(1); }
    emit({ type: 'turn.completed' });
  });
}
