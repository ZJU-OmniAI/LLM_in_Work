// CLI 适配层：把拼好的 prompt 交给本机的 claude 或 codex 命令行跑，
// 并把它们的"流式输出"解析成统一的事件回调 onEvent({ kind, data })。
// kind 取值：'text'（正文增量）| 'thinking'（思考增量）| 'model'（真实模型ID）| 'error'。
// 返回一个 Promise，进程结束时 resolve（出错时也会先发 error 事件再 resolve）。
// （从 paper_read 移植，逻辑已在生产验证过。）

import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CLAUDE_BIN, CODEX_BIN, spawnEnv, codexEffort } from './config.js';

// claude 的会话按"工作目录"归档存盘，首轮和续轮必须用同一个 cwd 才能找到会话
const CLAUDE_SESSION_CWD = path.join(os.homedir(), '.llm_in_overleaf');


// 按行切 JSON 流的小工具：喂进来的 chunk 可能半行，攒够一整行再回调。
function makeLineParser(onLine) {
  let buf = '';
  return {
    push(chunk) {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (line.trim()) onLine(line);
      }
    },
    flush() {
      if (buf.trim()) onLine(buf);
      buf = '';
    },
  };
}

// ---------------- claude 适配 ----------------
// 用 -p 打印模式 + stream-json 流式，靠 --include-partial-messages 拿到逐字增量。
// sessionId：首轮用 --session-id 建立可续写的会话；resume：续轮用 --resume 接着聊（走服务端缓存）。
export async function runClaude({ prompt, model, effort, signal, sessionId, resume }, onEvent) {
  if (signal?.aborted) return;
  await mkdir(CLAUDE_SESSION_CWD, { recursive: true });
  return new Promise((resolve) => {
    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--verbose',
      '--model', model || 'sonnet',
      '--effort', effort || 'medium',
      '--dangerously-skip-permissions',
      // 纯文本改写：把联网/执行/改文件这类工具禁掉，防它乱跑
      '--disallowed-tools', 'Bash', 'Edit', 'Write', 'NotebookEdit', 'WebSearch', 'WebFetch', 'Task', 'Agent',
    ];
    if (resume) args.push('--resume', resume);
    else if (sessionId) args.push('--session-id', sessionId);

    let child;
    try {
      child = spawn(CLAUDE_BIN, args, { env: spawnEnv(), cwd: CLAUDE_SESSION_CWD, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      onEvent({ kind: 'error', data: `启动 claude 失败：${e.message}` });
      return resolve();
    }

    let sawText = false;
    let finalResult = '';
    let stderr = '';

    const parser = makeLineParser((line) => {
      let obj;
      try { obj = JSON.parse(line); } catch { return; }
      if (obj.type === 'stream_event' && obj.event) {
        const ev = obj.event;
        // message_start 里有真实模型 ID（如 claude-fable-5），上报给前端展示
        if (ev.type === 'message_start' && ev.message?.model) {
          onEvent({ kind: 'model', data: ev.message.model });
        }
        if (ev.type === 'content_block_delta' && ev.delta) {
          if (ev.delta.type === 'text_delta' && ev.delta.text) {
            sawText = true;
            onEvent({ kind: 'text', data: ev.delta.text });
          } else if (ev.delta.type === 'thinking_delta' && ev.delta.thinking) {
            onEvent({ kind: 'thinking', data: ev.delta.thinking });
          }
        }
      } else if (obj.type === 'result') {
        if (typeof obj.result === 'string') finalResult = obj.result;
        if (obj.is_error) onEvent({ kind: 'error', data: obj.result || 'claude 返回错误' });
      }
    });

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => parser.push(d));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-16000); });
    child.stdin.on('error', () => {});

    let killTimer;
    const onAbort = () => {
      try { child.kill('SIGTERM'); } catch {}
      killTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 1500);
      killTimer.unref();
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();

    child.on('error', (e) => {
      onEvent({ kind: 'error', data: `claude 进程错误：${e.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(killTimer);
      parser.flush();
      if (signal) signal.removeEventListener('abort', onAbort);
      // 万一没走增量（比如版本差异），用最终结果兜底发一次
      if (!sawText && finalResult) onEvent({ kind: 'text', data: finalResult });
      if (!sawText && !finalResult && code !== 0) {
        onEvent({ kind: 'error', data: `claude 退出码 ${code}\n${stderr.slice(-800)}` });
      }
      resolve();
    });

    try { child.stdin.write(prompt); child.stdin.end(); } catch {}
  });
}

// ---------------- codex 适配 ----------------
// 用 exec --json 非交互模式，prompt 通过 stdin（"-"）喂进去避免超长命令行；
// 写完立刻 end() 关闭 stdin，否则 codex 会一直等输入而卡死。
// images: 本地图片路径数组，用 -i 直接附给模型（codex 原生多模态入口）。
// resume: 续轮走 `codex exec resume <id>`（注意该子命令不吃 -s/-C/--color，沙箱用 -c 传）；
// 首轮从 --json 事件流的 thread.started 抓 thread_id，经 onEvent({kind:'session'}) 上报。
export async function runCodex({ prompt, model, effort, images, signal, resume }, onEvent) {
  if (signal?.aborted) return;
  let workdir;
  try {
    workdir = await mkdtemp(path.join(os.tmpdir(), 'llm_in_overleaf-codex-'));
  } catch (e) {
    onEvent({ kind: 'error', data: `创建临时目录失败：${e.message}` });
    return;
  }
  const lastMsgFile = path.join(workdir, 'last.txt');

  const args = resume
    ? [
        'exec', 'resume', resume, '--json',
        '--skip-git-repo-check',
        '-c', 'sandbox_mode="read-only"',
        '-c', `model_reasoning_effort="${codexEffort(effort)}"`,
        '-o', lastMsgFile,
      ]
    : [
        'exec', '--json',
        '-s', 'read-only',
        '--skip-git-repo-check',
        '--color', 'never',
        '-C', workdir,
        '-c', `model_reasoning_effort="${codexEffort(effort)}"`,
        '-o', lastMsgFile,
      ];
  if (model && model !== '(default)' && model !== 'default') args.push('-m', model);
  for (const img of Array.isArray(images) ? images : []) args.push('-i', img);
  args.push('-'); // 从 stdin 读 prompt

  await new Promise((resolve) => {
    let child;
    try {
      child = spawn(CODEX_BIN, args, { env: spawnEnv(), cwd: workdir, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      onEvent({ kind: 'error', data: `启动 codex 失败：${e.message}` });
      return resolve();
    }

    let sawText = false;
    let failed = false;
    const reportError = (message) => { if (!failed && !signal?.aborted) onEvent({ kind: 'error', data: message }); failed = true; };
    let stderr = '';
    // 记录每个 item 已经发出的文本长度，支持增量（updated）或一次性（completed）两种情况
    const emitted = new Map();

    const emitItemText = (item, isThinking) => {
      if (!item || typeof item.text !== 'string') return;
      const id = item.id || 'default';
      const prev = emitted.get(id) || 0;
      if (item.text.length > prev) {
        const delta = item.text.slice(prev);
        emitted.set(id, item.text.length);
        if (isThinking) onEvent({ kind: 'thinking', data: delta });
        else { sawText = true; onEvent({ kind: 'text', data: delta }); }
      }
    };

    const parser = makeLineParser((line) => {
      let obj;
      try { obj = JSON.parse(line); } catch { return; }
      const t = obj.type || '';
      if ((t === 'item.completed' || t === 'item.updated' || t === 'item.started') && obj.item) {
        const it = obj.item;
        if (it.type === 'agent_message') emitItemText(it, false);
        else if (it.type === 'reasoning') emitItemText(it, true);
      } else if (t === 'thread.started' && obj.thread_id) {
        onEvent({ kind: 'session', data: String(obj.thread_id) });
      } else if (t === 'error' || t === 'turn.failed') {
        const msg = (obj.error && (obj.error.message || obj.error)) || obj.message || 'codex 返回错误';
        reportError(String(msg));
      }
    });

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => parser.push(d));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-16000); });
    child.stdin.on('error', () => {});

    let killTimer;
    const onAbort = () => {
      try { child.kill('SIGTERM'); } catch {}
      killTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 1500);
      killTimer.unref();
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();

    child.on('error', (e) => {
      reportError(e.code === 'ENOENT' ? '找不到 Codex CLI，请安装 Codex 或设置 LLM_IN_OVERLEAF_CODEX_BIN 后重试。' : `codex 进程错误：${e.message}`);
    });
    child.on('close', async (code) => {
      clearTimeout(killTimer);
      parser.flush();
      if (signal) signal.removeEventListener('abort', onAbort);
      // 没解析到正文 → 用 -o 落盘的最终答案兜底
      if (!sawText && !failed && !signal?.aborted && code === 0) {
        try {
          const last = (await readFile(lastMsgFile, 'utf8')).trim();
          if (last) { onEvent({ kind: 'text', data: last }); sawText = true; }
        } catch {}
      }
      if (code !== 0 && !signal?.aborted) {
        // 过滤掉 codex 常见的无关噪声（比如某些 MCP 鉴权告警）
        const noise = stderr.split('\n').filter((l) => l && !/rmcp::|worker quit|AuthRequired/i.test(l)).join('\n');
        reportError(`codex 退出码 ${code}\n${(noise || stderr).slice(-1200)}`);
      }
      if (!sawText && code === 0 && !signal?.aborted) reportError('Codex 未返回正文，请检查登录、模型和网络后重试。');
      try { await rm(workdir, { recursive: true, force: true }); } catch {}
      resolve();
    });

    try { child.stdin.write(prompt); child.stdin.end(); } catch {}
  });
}

// 统一入口
export function runModel(backend, opts, onEvent) {
  if (backend === 'codex') return runCodex(opts, onEvent);
  return runClaude(opts, onEvent);
}
