import { CLAUDE_BIN, CODEX_BIN, DATA_DIR, spawnEnv } from './config.js';
import { runProcess } from './process.js';

async function inspect(backend, bin) {
  const version = await runProcess(bin, ['--version'], { timeoutMs: 5000 });
  const base = { backend, path: bin, version: version.stdout.trim().split('\n')[0] || '' };
  if (version.error) return { ...base, status: 'missing', label: '未找到 CLI', hint: `请安装 ${backend === 'claude' ? 'Claude Code' : 'Codex'}，或运行 npm run update 同步 CLI 路径。` };
  if (version.code !== 0 || version.timedOut) return { ...base, status: 'error', label: 'CLI 启动异常', hint: '在终端检查 CLI 是否能正常启动。' };
  const auth = await runProcess(bin, backend === 'claude' ? ['auth', 'status', '--json'] : ['login', 'status'], { timeoutMs: 7000 });
  let loggedIn = null;
  if (backend === 'claude') {
    try { loggedIn = JSON.parse(auth.stdout).loggedIn; } catch {}
  } else if (/not logged in/i.test(auth.stdout + auth.stderr)) loggedIn = false;
  else if (/logged in/i.test(auth.stdout + auth.stderr)) loggedIn = true;
  if (loggedIn === true && auth.code === 0) return { ...base, status: 'ready', label: '已登录', hint: 'CLI 与本机登录状态正常；实际网络连通性以生成结果为准。' };
  if (loggedIn === false) return { ...base, status: 'auth', label: '需要登录', hint: `请在终端运行 ${backend === 'claude' ? 'claude auth login' : 'codex login'}。` };
  return { ...base, status: 'unknown', label: '登录状态待确认', hint: 'CLI 可启动，但当前版本未能返回登录状态。可以直接尝试生成。' };
}
let cache, pending;
export function getHealth(force = false) {
  if (pending) return pending;
  if (!force && cache && Date.now() - cache.at < 30000) return Promise.resolve(cache.data);
  pending = Promise.all([inspect('claude', CLAUDE_BIN), inspect('codex', CODEX_BIN)]).then(([claude, codex]) => {
    const env = spawnEnv();
    // 不返回 token、账户信息或带凭证的代理 URL。
    const data = { ok: true, backends: { claude, codex }, proxyConfigured: !!(env.HTTPS_PROXY || env.https_proxy || env.ALL_PROXY || env.all_proxy),
      logPath: `${DATA_DIR}/server.log`, checkedAt: new Date().toISOString() };
    cache = { at: Date.now(), data }; return data;
  }).finally(() => { pending = null; });
  return pending;
}
