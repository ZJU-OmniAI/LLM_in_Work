import { execFile } from 'node:child_process';
import { CLAUDE_BIN, CODEX_BIN, spawnEnv } from './config.js';

function probe(bin, args) {
  return new Promise((resolve) => {
    execFile(bin, args, { env: spawnEnv(), timeout: 4000, maxBuffer: 64 * 1024 }, (error, stdout, stderr) => {
      resolve({ ok: !error, missing: error?.code === 'ENOENT', output: `${stdout || ''}\n${stderr || ''}` });
    });
  });
}
export async function getHealth(backend) {
  const name = backend === 'codex' ? 'codex' : 'claude';
  const bin = name === 'codex' ? CODEX_BIN : CLAUDE_BIN;
  const version = await probe(bin, ['--version']);
  if (!version.ok) return { ok: false, backend: name, error: version.missing
    ? `找不到 ${name} CLI。请安装 CLI 或设置 OVERLEAF_EDIT_${name.toUpperCase()}_BIN 后重新运行 install.sh。`
    : `${name} CLI 无法启动或响应超时，请在终端运行 ${name} --version 检查。` };
  if (name === 'codex') {
    const auth = await probe(bin, ['login', 'status']);
    if (!auth.ok) return { ok: false, backend: name, error: 'Codex 登录状态不可用，请在终端运行 codex login 后重试。' };
  }
  return { ok: true, backend: name, cliVersion: version.output.split('\n').find((line) => /\d+\.\d+/.test(line))?.trim() || name };
}
