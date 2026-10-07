// Chrome Native Messaging 桥：插件需要时 Chrome 自动把本进程拉起来，
// 断开连接后自动退出——不需要手动起任何服务、不占任何端口。
// 通信格式（Chrome 规定）：每条消息 = 4字节小端长度前缀 + UTF-8 JSON。
// 注意：stdout 只能写协议消息，日志一律走 stderr，否则会把消息流写坏。

import { fetchPaper } from './paper-fetcher.js';
import { runModel } from './cli.js';
import { buildPrompt } from './prompt.js';
import { getModels } from './models.js';

const VERSION = '0.9.2';

// Chrome 限制：发给插件的单条消息不能超过 1MB
const MAX_MSG_BYTES = 1000 * 1024;

const aborters = new Map(); // reqId -> AbortController
const pending = new Set();
let closing = false;

function log(...args) {
  try { process.stderr.write(args.join(' ') + '\n'); } catch {}
}

// ---- 发送：长度前缀 + JSON ----
function send(obj) {
  try {
    let body = Buffer.from(JSON.stringify(obj), 'utf8');
    // 超过 1MB 的只有 paper_result 可能出现——把正文再砍短直到装得下
    while (body.length > MAX_MSG_BYTES && obj?.paper?.text) {
      obj.paper.text = obj.paper.text.slice(0, Math.floor(obj.paper.text.length * 0.8)) + '\n\n…（为适配消息大小已再次截断）';
      obj.paper.truncated = true;
      body = Buffer.from(JSON.stringify(obj), 'utf8');
    }
    if (body.length > MAX_MSG_BYTES) return; // 实在装不下就丢弃，别写坏消息流
    const head = Buffer.alloc(4);
    head.writeUInt32LE(body.length, 0);
    process.stdout.write(Buffer.concat([head, body]));
  } catch (e) {
    log('send error:', e.message);
  }
}

// ---- 接收：攒缓冲，凑齐一条解析一条 ----
let buf = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  while (buf.length >= 4) {
    const len = buf.readUInt32LE(0);
    if (buf.length < 4 + len) break;
    const raw = buf.subarray(4, 4 + len).toString('utf8');
    buf = buf.subarray(4 + len);
    let msg;
    try { msg = JSON.parse(raw); } catch { continue; }
    const request = handle(msg).catch((e) => {
      send({ type: 'error', reqId: msg?.reqId, error: String(e?.message || e) });
      send({ type: 'done', reqId: msg?.reqId });
    }).finally(() => pending.delete(request));
    pending.add(request);
  }
});

// 插件断开端口 → stdin 关闭 → 中止正在跑的 claude/codex 并退出，不留僵尸进程
async function shutdown() {
  if (closing) return;
  closing = true;
  for (const ac of aborters.values()) { try { ac.abort(); } catch {} }
  // Let aborted requests remove their temporary images before the host exits.
  const deadline = setTimeout(() => process.exit(0), 5000);
  deadline.unref();
  await Promise.allSettled([...pending]);
  clearTimeout(deadline);
  process.exit(0);
}
process.stdin.on('end', shutdown);
process.stdin.on('close', shutdown);

// ---- 消息分发 ----
async function handle(msg) {
  const t = msg?.type;

  if (t === 'ping') {
    send({ type: 'pong', version: VERSION });
    return;
  }

  if (t === 'paper') {
    try {
      const paper = await fetchPaper(msg.id || msg.url, msg.fallbackText || '');
      send({ type: 'paper_result', reqId: msg.reqId, ok: true, paper });
    } catch (e) {
      send({ type: 'paper_result', reqId: msg.reqId, ok: false, error: String(e?.message || e) });
    }
    return;
  }

  if (t === 'models') {
    send({ type: 'models', reqId: msg.reqId, ok: true, ...await getModels(!!msg.force) });
    return;
  }

  if (t === 'chat_start') {
    const p = msg.payload || {};
    const backend = p.backend === 'codex' ? 'codex' : 'claude';
    const model = p.model || '(default)';
    const effort = p.effort || 'medium';
    const messages = Array.isArray(p.messages) ? p.messages : [];
    if (!messages.length) {
      send({ type: 'error', reqId: msg.reqId, error: '缺少 messages' });
      send({ type: 'done', reqId: msg.reqId });
      return;
    }
    const prompt = buildPrompt({ paper: p.paper || {}, messages, selection: p.selection || '', images: p.images });

    const ac = new AbortController();
    aborters.set(msg.reqId, ac);
    send({ type: 'meta', reqId: msg.reqId, backend, model, effort, transport: 'native' });

    const onEvent = (ev) => {
      if (ev.kind === 'text') send({ type: 'delta', reqId: msg.reqId, text: ev.data });
      else if (ev.kind === 'thinking') send({ type: 'thinking', reqId: msg.reqId, text: ev.data });
      else if (ev.kind === 'model') send({ type: 'model', reqId: msg.reqId, model: ev.data });
      else if (ev.kind === 'error') send({ type: 'error', reqId: msg.reqId, error: ev.data });
    };

    try {
      await runModel(backend, { prompt, model, effort, images: p.images, signal: ac.signal }, onEvent);
    } catch (e) {
      send({ type: 'error', reqId: msg.reqId, error: String(e?.message || e) });
    }
    aborters.delete(msg.reqId);
    send({ type: 'done', reqId: msg.reqId });
    return;
  }

  if (t === 'chat_stop') {
    const ac = aborters.get(msg.reqId);
    if (ac) { try { ac.abort(); } catch {} }
    return;
  }

  log('unknown message type:', t);
}
