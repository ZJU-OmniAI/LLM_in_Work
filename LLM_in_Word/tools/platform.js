import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const action = process.argv[2];
let bin, args, env = { ...process.env };
if (action === 'preview') {
  bin = process.execPath; args = ['server/server.js'];
  env.LLM_IN_WORD_PORT = '8380'; env.LLM_IN_WORD_CERT_DIR = path.join(os.tmpdir(), 'llm-in-word-preview-no-cert');
} else if (['install', 'update'].includes(action)) {
  if (process.platform === 'win32') {
    bin = 'powershell.exe'; args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'install.ps1'), ...(action === 'update' ? ['-UpdateOnly'] : [])];
  } else if (process.platform === 'darwin') {
    bin = 'bash'; args = ['install.sh', ...(action === 'update' ? ['--update-only'] : [])];
  } else { throw new Error('Desktop Word installation is available on Windows and macOS. Linux can run the development preview.'); }
} else { throw new Error('Expected install, update, or preview.'); }
const child = spawn(bin, args, { cwd: root, env, stdio: 'inherit' });
child.on('error', e => { console.error(e.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
