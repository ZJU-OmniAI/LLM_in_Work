// CLI 适配层：把拼好的 prompt 交给本机的 claude 或 codex 命令行跑，
// 并把它们的流式输出统一成事件 onEvent({ kind, data })：
// text（正文增量）| thinking（思考增量）| model（真实模型 ID）| session（codex 会话 ID）| status | error。
// 返回结果明确区分完成、错误、取消和超时，不把部分文本当成成功。
// 与 LLM_in_Word 的 server/cli.js 保持同一套安全约束：不加载用户的 MCP 服务器、
// 不开放执行/编辑/联网工具；只有附件轮才允许 Read，并且只列出本轮附件路径。

import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CLAUDE_BIN, CODEX_BIN, DATA_DIR, codexEffort } from './config.js';
import { runProcess, classifyError } from './process.js';

function eventCollector(onEvent) {
  let sawText = false;
  const errors = [];
  return {
    emit(kind, data) {
      if (kind === 'text' && data) sawText = true;
      if (kind === 'error') errors.push(String(data));
      else onEvent({ kind, data });
    },
    get sawText() { return sawText; },
    finish(result, backend) {
      if (result.aborted) return { ok: false, aborted: true, errors: [] };
      if (result.timedOut) errors.push('请求超时：模型超过时限仍未完成，请降低思考强度或缩小选段范围。');
      else if (result.error) errors.push(`${backend} 启动失败：${result.error.message}`);
      else if (result.code !== 0 && !errors.length) errors.push(`${backend} 退出码 ${result.code}\n${result.stderr.slice(-1200)}`);
      if (!sawText && !errors.length) errors.push(`${backend} 没有返回可用内容，请重试。`);
      const unique = [...new Set(errors)].map(classifyError);
      for (const error of unique) onEvent({ kind: 'error', data: error.error, ...error });
      return { ok: !unique.length && sawText, errors: unique, timedOut: result.timedOut };
    },
  };
}

// claude：-p 打印模式 + stream-json，靠 --include-partial-messages 拿到逐字增量。
// sessionId：首轮用 --session-id 建立可续写的会话；resume：续轮用 --resume 接着聊（走服务端缓存）。
// files：本轮落盘的图片/PDF，允许 Read 这些路径；没有附件时不加载任何工具。
export async function runClaude({ prompt, model, effort, signal, sessionId, resume, files = [] }, onEvent) {
  const events = eventCollector(onEvent);
  if (signal?.aborted) return { ok: false, aborted: true, errors: [] };
  await mkdir(DATA_DIR, { recursive: true });
  const args = ['-p', '--output-format', 'stream-json', '--include-partial-messages', '--verbose',
    '--model', model || 'sonnet', '--effort', effort || 'medium',
    '--permission-mode', 'dontAsk', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
    '--disable-slash-commands', '--tools', files.length ? 'Read' : ''];
  if (files.length) args.push('--allowedTools', ...files.map((file) => `Read(${file.path})`));
  if (resume) args.push('--resume', resume);
  else if (sessionId) args.push('--session-id', sessionId);
  let finalResult = '', resultError = false;
  const result = await runProcess(CLAUDE_BIN, args, {
    cwd: DATA_DIR, input: prompt, signal,
    onSpawn: () => events.emit('status', '模型已启动，正在生成'),
    onLine(line) {
      let obj; try { obj = JSON.parse(line); } catch { return; }
      if (obj.type === 'system' && obj.model) events.emit('model', obj.model);
      if (obj.type === 'stream_event') {
        const ev = obj.event;
        // message_start 里有真实模型 ID（如 claude-sonnet-5），上报给前端展示
        if (ev?.type === 'message_start' && ev.message?.model) events.emit('model', ev.message.model);
        if (ev?.type === 'content_block_delta') {
          if (ev.delta?.type === 'text_delta') events.emit('text', ev.delta.text);
          else if (ev.delta?.type === 'thinking_delta') events.emit('thinking', ev.delta.thinking);
        }
      } else if (obj.type === 'result') {
        resultError = !!obj.is_error;
        finalResult = typeof obj.result === 'string' ? obj.result : '';
        if (resultError) events.emit('error', finalResult || obj.errors?.join('\n') || 'Claude 返回错误');
      }
    },
  });
  // 万一没走增量（比如 CLI 版本差异），用最终结果兜底发一次
  if (!events.sawText && finalResult && !resultError && !result.aborted && !result.timedOut) events.emit('text', finalResult);
  return events.finish(result, 'Claude Code');
}

// codex：exec --json 非交互模式，prompt 走 stdin（"-"），只读沙箱、永不请求审批。
// images：本地图片路径，用 -i 直接附给模型；resume：续轮走 `codex exec resume <id>`。
// 首轮从 --json 事件流的 thread.started 抓 thread_id，经 onEvent({kind:'session'}) 上报。
export async function runCodex({ prompt, model, effort, images = [], signal, resume }, onEvent) {
  if (signal?.aborted) return { ok: false, aborted: true, errors: [] };
  const workdir = await mkdtemp(path.join(os.tmpdir(), 'llm_in_overleaf-codex-'));
  try {
    const events = eventCollector(onEvent);
    const output = path.join(workdir, 'last.txt');
    const args = resume ? ['exec', 'resume', resume, '--json'] : ['exec', '--json', '--color', 'never', '-C', workdir];
    args.push('--skip-git-repo-check', '-c', 'sandbox_mode="read-only"', '-c', 'approval_policy="never"',
      '-c', `model_reasoning_effort="${codexEffort(effort)}"`, '-o', output);
    if (model && !['(default)', 'default'].includes(model)) args.push('-m', model);
    for (const img of Array.isArray(images) ? images : []) args.push('-i', img);
    args.push('-');
    const emitted = new Map();
    let turnFailed = false;
    const result = await runProcess(CODEX_BIN, args, {
      cwd: workdir, input: prompt, signal,
      onSpawn: () => events.emit('status', '模型已启动，正在生成'),
      onLine(line) {
        let obj; try { obj = JSON.parse(line); } catch { return; }
        if (['item.completed', 'item.updated', 'item.started'].includes(obj.type) && obj.item) {
          const item = obj.item;
          if (!['agent_message', 'reasoning'].includes(item.type) || typeof item.text !== 'string') return;
          const key = `${item.type}:${item.id || 'default'}`, prev = emitted.get(key) || '';
          if (item.text.startsWith(prev) && item.text.length > prev.length) {
            events.emit(item.type === 'reasoning' ? 'thinking' : 'text', item.text.slice(prev.length));
            emitted.set(key, item.text);
          }
        } else if (obj.type === 'thread.started' && obj.thread_id) events.emit('session', String(obj.thread_id));
        else if (obj.type === 'error' || obj.type === 'turn.failed') {
          // Codex 会在连接重试时发 error；只有 turn.failed 才是终止失败。
          const msg = obj.error?.message || obj.message || obj.error || 'Codex 返回错误';
          if (obj.type === 'error' && /reconnecting|retrying|retry\s+\d/i.test(String(msg))) events.emit('status', '模型正在重新连接');
          else { turnFailed = true; events.emit('error', String(msg)); }
        }
      },
    });
    // 没解析到正文 → 用 -o 落盘的最终答案兜底
    if (!events.sawText && !turnFailed && !result.aborted && !result.timedOut && result.code === 0) {
      try { const last = (await readFile(output, 'utf8')).trim(); if (last) events.emit('text', last); } catch {}
    }
    return events.finish(result, 'Codex');
  } finally { await rm(workdir, { recursive: true, force: true }); }
}

// 统一入口
export function runModel(backend, opts, onEvent) {
  return backend === 'codex' ? runCodex(opts, onEvent) : runClaude(opts, onEvent);
}
