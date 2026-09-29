#!/usr/bin/env node
// Offline Claude Code fixture: echoes its arguments; no accounts, API calls or user files.
const args = process.argv.slice(2);
const emit = (value) => process.stdout.write(JSON.stringify(value) + '\n');
if (args.includes('--version')) { console.log('2.9.9 (Claude Code)'); process.exit(0); }
if (args[0] === 'auth') { emit({ loggedIn: true }); process.exit(0); }
if (args.includes('--input-format')) {
  // Model catalog: answer the SDK initialize request, never a user prompt.
  let buffer = '';
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const message = JSON.parse(buffer.slice(0, i)); buffer = buffer.slice(i + 1);
      if (message.type !== 'control_request' || message.request?.subtype !== 'initialize') process.exit(2);
      emit({ type: 'control_response', response: { request_id: message.request_id, subtype: 'success', response: { models: [
        { value: 'sonnet', resolvedModel: 'claude-sonnet-5-5' },
        { value: 'opus', resolvedModel: 'claude-opus-5-5' },
        { value: 'haiku', resolvedModel: 'claude-haiku-4-5-20251001' },
      ] } } });
    }
  });
  return;
}
let prompt = '';
process.stdin.on('data', (chunk) => { prompt += chunk; });
process.stdin.on('end', () => {
  const text = prompt.includes('ARGS') ? JSON.stringify({ args, prompt }) : '```latex\nCorrected text.\n```';
  emit({ type: 'system', subtype: 'init', model: 'claude-sonnet-5-5' });
  emit({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } });
  emit({ type: 'result', result: text, is_error: false });
});
