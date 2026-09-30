// Per-user Windows supervisor. The Startup shortcut launches this without a console.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, openSync } from 'node:fs';
import path from 'node:path';
const base = process.argv[2];
const config = JSON.parse(readFileSync(path.join(base, 'runtime.json'), 'utf8'));
writeFileSync(path.join(base, 'runner.pid'), String(process.pid));
const log = openSync(path.join(base, 'server.log'), 'a');
function start() {
  const child = spawn(config.node, [path.join(base, 'app', 'server', 'server.js')], {
    cwd: base, env: { ...process.env, ...config.env }, windowsHide: true, stdio: ['ignore', log, log],
  });
  child.on('error', (error) => writeFileSync(log, `[launcher] ${error.message}\n`));
  child.on('close', () => setTimeout(start, 3000));
}
start();
