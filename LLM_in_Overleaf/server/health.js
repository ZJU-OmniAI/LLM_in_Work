// 健康检查：只检查 CLI 能否启动和登录状态，不调用模型生成，不返回账户信息。
import { CLAUDE_BIN, CODEX_BIN } from './config.js';
import { runProcess } from './process.js';

async function inspect(backend, bin) {
  const name = backend === 'codex' ? 'Codex' : 'Claude Code';
  const version = await runProcess(bin, ['--version'], { timeoutMs: 5000 });
  const cliVersion = version.stdout.trim().split('\n').find((line) => /\d+\.\d+/.test(line))?.trim() || '';
  const base = { backend, path: bin, cliVersion };
  if (version.error) {
    return { ...base, ok: false, status: 'missing', label: '未找到 CLI',
      error: `找不到 ${backend} CLI。请安装 ${name}，或设置 LLM_IN_OVERLEAF_${backend.toUpperCase()}_BIN 后重新运行安装脚本。` };
  }
  if (version.code !== 0 || version.timedOut) {
    return { ...base, ok: false, status: 'error', label: 'CLI 启动异常',
      error: `${backend} CLI 无法启动或响应超时，请在终端运行 ${backend} --version 检查。` };
  }
  const auth = await runProcess(bin, backend === 'claude' ? ['auth', 'status', '--json'] : ['login', 'status'], { timeoutMs: 7000 });
  const output = `${auth.stdout}\n${auth.stderr}`;
  let loggedIn = null;
  if (backend === 'claude') {
    try { loggedIn = JSON.parse(auth.stdout).loggedIn; } catch {}
  } else if (/not logged in/i.test(output)) loggedIn = false;
  else if (/logged in/i.test(output)) loggedIn = true;
  if (loggedIn === false) {
    return { ...base, ok: false, status: 'auth', label: '需要登录',
      error: `${name} 尚未登录，请在终端运行 ${backend === 'claude' ? 'claude auth login' : 'codex login'} 后重试。` };
  }
  // 旧版 CLI 不一定能报告登录状态：能启动就放行，实际请求会给出具体错误。
  return { ...base, ok: true, status: loggedIn === true && auth.code === 0 ? 'ready' : 'unknown',
    label: loggedIn === true ? '已登录' : '登录状态待确认' };
}

export function getHealth(backend) {
  return backend === 'codex' ? inspect('codex', CODEX_BIN) : inspect('claude', CLAUDE_BIN);
}
