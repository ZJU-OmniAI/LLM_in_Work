#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const emit = (e) => process.stdout.write(JSON.stringify(e) + '\n');
if (args.includes('--version')) { console.log('mock-cli 1.0'); process.exit(0); }
if (args[0] === 'auth') { emit({ loggedIn: true }); process.exit(0); }
if (args[0] === 'login') { console.error('Not logged in'); process.exit(0); }
if (args[0] === 'app-server') {
  let buffer = '';
  process.stdin.on('data', (c) => {
    buffer += c;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const m = JSON.parse(buffer.slice(0, i)); buffer = buffer.slice(i + 1);
      if (m.method === 'initialize') emit({ id: 1, result: {} });
      if (m.method === 'model/list') emit({ id: 2, result: { data: [{ model: m.params.cursor ? 'mock-second' : 'mock-first', isDefault: !m.params.cursor, supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'medium' }] }], nextCursor: m.params.cursor ? null : 'page2' } });
    }
  });
  return;
}
if (args.includes('--input-format')) {
  let buffer = '';
  process.stdin.on('data', c => {
    buffer += c;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const m = JSON.parse(buffer.slice(0, i)); buffer = buffer.slice(i + 1);
      if (m.type !== 'control_request' || m.request?.subtype !== 'initialize') process.exit(2);
      const response = JSON.stringify({ type: 'control_response', response: { request_id: m.request_id, subtype: 'success', response: { models: [
        { value: 'sonnet', displayName: 'Sonnet', resolvedModel: 'claude-sonnet-5' },
        { value: 'opus', displayName: 'Opus', resolvedModel: 'claude-opus-4-8' },
        { value: 'haiku', displayName: 'Haiku', resolvedModel: 'claude-haiku-4-5-20251001' },
      ] } } });
      process.stdout.write(response.slice(0, 25));
      setTimeout(() => process.stdout.write(response.slice(25) + '\n'), 10);
    }
  });
  return;
}
let prompt = '';
process.stdin.on('data', (c) => { prompt += c; });
process.stdin.on('end', () => {
  const codex = args[0] === 'exec';
  const error = (message) => emit(codex ? { type: 'turn.failed', error: { message } } : { type: 'result', is_error: true, result: message });
  if (args.includes('expired')) { error('session not found'); return; }
  if (/MOCK_WAIT/.test(prompt)) {
    // A child that ignores SIGTERM verifies forced cancellation, including process trees.
    process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); return;
  }
  if (/MOCK_AUTH/.test(prompt)) { error('401 not logged in'); return; }
  if (/MOCK_EMPTY/.test(prompt)) return;
  if (/MOCK_FAIL/.test(prompt)) { error('quota limit reached'); return; }
  const text = '```text\n改写后的文本。\n```';
  if (codex) {
    emit({ type: 'thread.started', thread_id: 'mock-session' });
    emit({ type: 'item.updated', item: { id: 'a', type: 'agent_message', text: text.slice(0, 12) } });
    process.stdout.write(JSON.stringify({ type: 'item.completed', item: { id: 'a', type: 'agent_message', text } }));
  } else {
    const data = JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } });
    process.stdout.write(data.slice(0, 15)); process.stdout.write(data.slice(15) + '\n');
    emit({ type: 'result', result: text, is_error: false });
  }
  if (/MOCK_PARTIAL/.test(prompt)) { process.stderr.write('network connection failed'); process.exitCode = 1; }
});
