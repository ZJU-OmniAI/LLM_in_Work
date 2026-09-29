// Checks an installed native messaging launcher the way the browser uses it:
// start the launcher, send length-prefixed ping messages, print each backend's status.
// Usage: node tools/ping-host.mjs <launcher> [--quiet]
// Exit code 0 when the host answers (even if a CLI still needs to be installed or signed in).
import { spawn } from 'node:child_process';
// Host messages are written in Chinese; show them in the terminal's language (English unless LANG is zh*).
await import('../extension/shared/i18n.js');
const i18n = globalThis.LLMOverleafI18n;
i18n.setLanguage(i18n.normalize(process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || 'en'));

const launcher = process.argv[2];
const quiet = process.argv.includes('--quiet');
if (!launcher) { console.error('Usage: node tools/ping-host.mjs <launcher>'); process.exit(2); }

// Chrome starts .cmd/.bat hosts through cmd.exe on Windows.
const child = /\.(cmd|bat)$/i.test(launcher)
  // /s strips one pair of quotes, so wrap the quoted path once more (paths may contain spaces).
  ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `""${launcher}""`], { stdio: ['pipe', 'pipe', 'inherit'], windowsVerbatimArguments: true, windowsHide: true })
  : spawn(launcher, [], { stdio: ['pipe', 'pipe', 'inherit'] });

const frame = (value) => {
  const body = Buffer.from(JSON.stringify(value));
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length);
  return Buffer.concat([head, body]);
};
const backends = ['claude', 'codex'];
const replies = [];
let buffer = Buffer.alloc(0);
const timer = setTimeout(() => { console.error('The native host did not answer within 30 seconds.'); child.kill(); process.exit(1); }, 30000);
child.on('error', (error) => { console.error(`Could not start ${launcher}: ${error.message}`); process.exit(1); });
child.stdout.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32LE(0)) {
    const size = buffer.readUInt32LE(0);
    const message = JSON.parse(buffer.subarray(4, 4 + size).toString('utf8'));
    buffer = buffer.subarray(4 + size);
    if (message.type !== 'pong') continue;
    replies.push(message);
    if (replies.length === backends.length) finish();
  }
});
function finish() {
  clearTimeout(timer);
  child.stdin.end();
  const version = replies[0]?.version || '?';
  if (!quiet) {
    console.log(`  Native host v${version} responded.`);
    for (const reply of replies) {
      const name = reply.backend === 'codex' ? 'Codex CLI' : 'Claude Code';
      console.log(reply.ok
        ? `  ✓ ${name} ${reply.cliVersion || ''}${reply.status === 'unknown' ? ' (sign-in status unknown)' : ''}`.trimEnd()
        : `  ! ${name}: ${i18n.known(reply.error) || 'not ready'}`);
    }
    if (!replies.some((reply) => reply.ok)) console.log('  Install and sign in to at least one CLI (claude auth login or codex login), then rerun the installer.');
  }
  process.exit(0);
}
for (const backend of backends) child.stdin.write(frame({ type: 'ping', backend }));
