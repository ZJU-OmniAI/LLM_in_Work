import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnEnv } from './config.js';

// Run npm's official CLI entry point directly. No cmd.exe interpolation: JSON,
// paths, model names and user-controlled arguments stay separate argv values.
export function launchSpec(bin, args, platform = process.platform) {
  if (/\.[cm]?js$/i.test(bin)) return { bin: process.execPath, args: [bin, ...args] };
  if (platform === 'win32' && /\.(cmd|bat|ps1)$/i.test(bin)) {
    const name = path.basename(bin).replace(/\.(cmd|bat|ps1)$/i, '').toLowerCase();
    const entry = { claude: '@anthropic-ai/claude-code/cli.js', codex: '@openai/codex/bin/codex.js' }[name];
    const script = entry && path.join(path.dirname(bin), 'node_modules', ...entry.split('/'));
    if (script && existsSync(script)) return { bin: process.execPath, args: [script, ...args] };
    const error = new Error(`CLI executable not found: ${bin}. Use a native .exe, a .js entry point, or an official npm installation.`);
    error.code = 'ENOENT';
    throw error;
  }
  return { bin, args };
}

export function spawnCli(bin, args, options = {}) {
  const spec = launchSpec(bin, args);
  return spawn(spec.bin, spec.args, {
    env: spawnEnv(), detached: process.platform !== 'win32', windowsHide: true,
    ...options, shell: false,
  });
}

export function killTree(child, signal = 'SIGTERM') {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    // Windows has no POSIX process groups; /T includes npm/native descendants.
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    killer.on('error', () => { try { child.kill(); } catch {} });
  } else {
    try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch {} }
  }
}
