import { spawnCli, killTree } from './launch.js';
import { REQUEST_TIMEOUT_MS } from './config.js';

export function lineParser(onLine) {
  let buffer = '';
  return {
    push(chunk) {
      buffer += chunk;
      let at;
      while ((at = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        if (line.trim()) onLine(line);
      }
    },
    flush() { if (buffer.trim()) onLine(buffer); buffer = ''; },
  };
}

// 所有 CLI 共用有界生命周期；停止会清理整个子进程组，并处理已取消的 signal。
export function runProcess(bin, args, { cwd, input = '', signal, timeoutMs = REQUEST_TIMEOUT_MS, onLine, onSpawn } = {}) {
  if (signal?.aborted) return Promise.resolve({ aborted: true, code: null, stderr: '', stdout: '' });
  return new Promise((resolve) => {
    let child, timer, killTimer, aborted = false, timedOut = false, error = null;
    let stdout = '', stderr = '', finished = false;
    const parser = lineParser((line) => onLine?.(line));
    const kill = (sig) => killTree(child, sig);
    const stop = () => {
      kill('SIGTERM');
      if (!killTimer) killTimer = setTimeout(() => kill('SIGKILL'), 1000);
    };
    const abort = () => { aborted = true; stop(); };
    const finish = (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer); clearTimeout(killTimer);
      // 子进程可能先退出、留下持有管道或忽略 TERM 的孙进程。
      if (aborted || timedOut) kill('SIGKILL');
      signal?.removeEventListener('abort', abort);
      parser.flush();
      resolve({ code, stdout, stderr, error, aborted, timedOut });
    };
    try {
      child = spawnCli(bin, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) { error = e; finish(null); return; }
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout = (stdout + chunk).slice(-65536); parser.push(chunk); });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-8192); });
    child.stdin.on('error', () => {});
    child.on('error', (e) => { error = e; });
    child.on('close', finish);
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    if (signal?.aborted) abort();
    child.on('spawn', () => onSpawn?.(child));
    child.stdin.end(input);
  });
}

export function classifyError(message) {
  const text = String(message || '模型没有返回可用内容');
  let code = 'backend_error', hint = '可重试，或在连接设置中检查后端状态。';
  if (/ENOENT|not found.*executable|executable not found|启动.*失败/i.test(text)) {
    code = 'cli_missing'; hint = '未找到 CLI。安装后运行 npm run update，或设置 LLM_IN_WORD_CLAUDE_BIN / LLM_IN_WORD_CODEX_BIN。';
  } else if (/no conversation found|session.*(not found|does not exist|invalid|expired)|thread.*(not found|does not exist)|failed to (load|resume).*session/i.test(text)) {
    code = 'session_expired'; hint = '会话记录已失效，可以重新读取文档继续。';
  } else if (/401|unauthorized|not logged in|authentication|login required|please.*log.?in|invalid.*(?:api.key|token)/i.test(text)) {
    code = 'auth'; hint = '请在终端运行 claude auth login 或 codex login 完成登录，再点重新检测。';
  } else if (/429|rate.?limit|quota|usage limit|credit|hit your limit/i.test(text)) {
    code = 'rate_limit'; hint = '当前账户额度或请求频率受限，请稍后重试，或手动切换后端。';
  } else if (/model.*(?:not found|not supported|unavailable|does not exist)|unsupported.*(?:model|effort)/i.test(text)) {
    code = 'model'; hint = '请刷新模型列表，选择默认模型或较低思考强度后重试。';
  } else if (/timeout|timed out|ETIMEDOUT|ECONN|ENOTFOUND|fetch failed|403|network|connection/i.test(text)) {
    code = 'network'; hint = '请检查网络和代理；代理端口变化后运行 npm run update。';
  }
  return { code, error: text.slice(-1600), hint };
}
