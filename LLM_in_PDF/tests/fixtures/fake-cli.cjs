const args = process.argv.slice(2);
const fs = require('node:fs');
const emit = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');
if (args.includes('--version')) { console.log('test-cli 9.9.9'); process.exit(0); }
let buffer = '';
let content;
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  if (!args.includes('app-server') && !args.includes('--input-format')) return;
  let at;
  while ((at = buffer.indexOf('\n')) >= 0) {
    const raw = buffer.slice(0, at); buffer = buffer.slice(at + 1);
    const msg = JSON.parse(raw);
    if (msg.type === 'user') content = msg.message.content;
    if (msg.method === 'initialize') emit({ id: msg.id, result: {} });
    if (msg.method === 'model/list') emit({ id: msg.id, result: { data: msg.params.cursor
      ? [{ id: 'future-lite', displayName: 'Future Lite', supportedReasoningEfforts: ['low', 'high'] }]
      : [{ id: 'future-model', model: 'future-model', displayName: 'Future Model', isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'max' }, { reasoningEffort: 'ultra' }] }, { id: 'hidden', hidden: true }], nextCursor: msg.params.cursor ? null : 'page2' } });
    if (msg.type === 'control_request') emit({ type: 'control_response', response: { request_id: msg.request_id, response: { models: [{ value: 'future-claude', displayName: 'Future Claude', resolvedModel: 'claude-future-9' }] } } });
  }
});
process.stdin.on('end', () => {
  if (args.includes('app-server') || (args.includes('--input-format') && !content)) return;
  if (content) buffer = content.filter((item) => item.type === 'text').map((item) => item.text).join('\n');
  const codex = args.includes('exec');
  if (buffer.includes('WAIT_FOR_ABORT')) {
    // Expose only the fixture workdir so cancellation tests can check cleanup.
    emit({ type: 'thread.started', thread_id: 'fixture' });
    emit({ type: 'item.completed', item: { id: '1', type: 'agent_message', text: process.cwd() } });
    setInterval(() => {}, 1000); return;
  }
  if (buffer.includes('SIMULATE_ERROR')) {
    emit(codex ? { type: 'turn.failed', error: { message: 'fixture failure' } } : { type: 'result', is_error: true, result: 'fixture failure' });
    process.exitCode = 1; return;
  }
  const images = codex ? args.flatMap((arg, i) => arg === '-i' ? [{ path: args[i + 1], b64: fs.readFileSync(args[i + 1]).toString('base64') }] : []) : content?.filter((item) => item.type === 'image').map((item) => ({ b64: item.source.data, mime: item.source.media_type }));
  const text = JSON.stringify({ received: buffer, args, images });
  if (codex) {
    emit({ type: 'item.updated', item: { id: '1', type: 'agent_message', text: text.slice(0, 10) } });
    emit({ type: 'item.completed', item: { id: '1', type: 'agent_message', text } });
  } else {
    emit({ type: 'system', model: 'claude-future-9' });
    emit({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } });
    emit({ type: 'result', result: text });
  }
});
