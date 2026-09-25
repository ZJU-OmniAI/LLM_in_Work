// Chrome Native Messaging 桥：插件需要时 Chrome 自动把本进程拉起来，
// 断开连接后自动退出——不需要手动起任何服务、不占任何端口。
// 通信格式（Chrome 规定）：每条消息 = 4字节小端长度前缀 + UTF-8 JSON。
// 注意：stdout 只能写协议消息，日志一律走 stderr，否则会把消息流写坏。

import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { runModel } from './cli.js';
import { buildPrompt, buildTurnPrompt } from './prompt.js';
import { getModels } from './models.js';
import { getHealth } from './health.js';

const VERSION = '0.8.2';

// 二进制附件（图片/PDF）先写进临时目录，再把路径写进 prompt / 传给 codex -i
const MAX_ATTACH = 8;
const MAX_ATTACH_BYTES = 15 * 1024 * 1024; // 单个附件上限 15MB
function safeName(name, i) {
  const base = path.basename(String(name || `file${i}`)).replace(/[^\w.\-一-龥]/g, '_');
  return base || `file${i}`;
}
async function writeAttachments(attachments) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'llm_in_overleaf-att-'));
  const files = [];
  const seen = new Set();
  for (let i = 0; i < Math.min(attachments.length, MAX_ATTACH); i++) {
    const a = attachments[i] || {};
    if (typeof a.b64 !== 'string' || !a.b64) continue;
    const buf = Buffer.from(a.b64, 'base64');
    if (!buf.length || buf.length > MAX_ATTACH_BYTES) continue;
    let name = safeName(a.name, i);
    while (seen.has(name)) name = `${i}_${name}`;
    seen.add(name);
    const p = path.join(dir, name);
    await writeFile(p, buf);
    files.push({ name, path: p, mime: a.mime || '', idx: i }); // idx=面板附件数组里的原始序号，续轮按它过滤"新增"
  }
  return { dir, files };
}

// Chrome 限制：发给插件的单条消息不能超过 1MB
const MAX_MSG_BYTES = 1000 * 1024;

const aborters = new Map(); // reqId -> AbortController

function log(...args) {
  try { process.stderr.write(args.join(' ') + '\n'); } catch {}
}

// ---- 发送：长度前缀 + JSON ----
function send(obj) {
  try {
    const body = Buffer.from(JSON.stringify(obj), 'utf8');
    if (body.length > MAX_MSG_BYTES) return; // 装不下就丢弃，别写坏消息流（增量消息都很小，几乎不可能触发）
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
    if (len > 40 * 1024 * 1024) { log('Native message too large'); shutdown(); return; }
    if (buf.length < 4 + len) break;
    const raw = buf.subarray(4, 4 + len).toString('utf8');
    buf = buf.subarray(4 + len);
    let msg;
    try { msg = JSON.parse(raw); } catch { continue; }
    handle(msg).catch((e) => {
      send({ type: 'error', reqId: msg?.reqId, error: String(e?.message || e) });
      send({ type: 'done', reqId: msg?.reqId });
    });
  }
});

// 插件断开端口 → stdin 关闭 → 中止正在跑的 claude/codex 并退出，不留僵尸进程
function shutdown() {
  for (const ac of aborters.values()) { try { ac.abort(); } catch {} }
  process.exit(0);
}
process.stdin.on('end', shutdown);
process.stdin.on('close', shutdown);

// ---- 消息分发 ----
async function handle(msg) {
  const t = msg?.type;

  if (t === 'ping') {
    send({ type: 'pong', version: VERSION, ...(msg.backend ? await getHealth(msg.backend) : { ok: true }) });
    return;
  }

  if (t === 'models') {
    // 实测探测当前可用模型（claude 别名解析 + codex model/list），见 models.js
    const r = await getModels(msg.backend);
    send({ type: 'models', reqId: msg.reqId, ok: !!(r.claude || r.codex), claude: r.claude, codex: r.codex, fetchedAt: r.fetchedAt, error: r.error });
    return;
  }

  if (t === 'chat_start') {
    const p = msg.payload || {};
    const backend = p.backend === 'codex' ? 'codex' : 'claude';
    const model = p.model || (backend === 'codex' ? '(default)' : 'sonnet');
    const effort = p.effort || 'medium';
    const mode = p.mode === 'ask' ? 'ask' : 'edit';
    const messages = Array.isArray(p.messages) ? p.messages : [];
    if (!messages.length) {
      send({ type: 'error', reqId: msg.reqId, error: '缺少 messages' });
      send({ type: 'done', reqId: msg.reqId });
      return;
    }
    // 二进制附件（图片/PDF）→ 临时目录落盘
    let attachDir = null;
    let files = [];
    if (Array.isArray(p.attachments) && p.attachments.length) {
      try {
        const r = await writeAttachments(p.attachments);
        attachDir = r.dir;
        files = r.files;
      } catch (e) {
        send({ type: 'error', reqId: msg.reqId, error: `附件落盘失败：${String(e?.message || e)}` });
      }
    }

    const images = files.filter((f) => /^image\//.test(f.mime)).map((f) => f.path);
    const resumeId = (p.cliSession && typeof p.cliSession === 'object' && p.cliSession[backend]) || null;
    const lastMsg = messages[messages.length - 1];

    const ac = new AbortController();
    aborters.set(msg.reqId, ac);
    send({
      type: 'meta', reqId: msg.reqId, backend, model, effort, mode, transport: 'native',
      resume: !!resumeId, attachments: files.map((f) => f.name),
    });

    const mkEvents = (holdErrors) => {
      const held = [];
      let sawText = false;
      let failed = false;
      let streamSession = null; // codex 的 thread_id（等确认本轮成功再上报，防面板记住失败的空会话）
      const onEvent = (ev) => {
        if (ev.kind === 'text') { sawText = true; send({ type: 'delta', reqId: msg.reqId, text: ev.data }); }
        else if (ev.kind === 'thinking') send({ type: 'thinking', reqId: msg.reqId, text: ev.data });
        else if (ev.kind === 'model') send({ type: 'model', reqId: msg.reqId, model: ev.data });
        else if (ev.kind === 'session') streamSession = ev.data;
        else if (ev.kind === 'error') {
          failed = true;
          // 续轮失败要静默回退重建，错误先扣着；真失败（拿到过正文/回退也失败）才转发
          if (holdErrors) held.push(ev.data);
          else send({ type: 'error', reqId: msg.reqId, error: ev.data });
        }
      };
      return { onEvent, held, gotText: () => sawText, failed: () => failed, session: () => streamSession };
    };

    try {
      let handled = false;
      if (resumeId) {
        // 续轮：短 prompt（选中片段 + 新增附件 + 指令），全文和历史在 CLI 会话里（走服务端缓存）。
        // 附件只带"新增"的：旧附件内容已在会话记忆里，重发既浪费又可能路径失效。
        const newIdx = Array.isArray(p.newAttIdx) ? p.newAttIdx : null;
        const filesTurn = newIdx ? files.filter((f) => newIdx.includes(f.idx)) : files;
        const imagesTurn = filesTurn.filter((f) => /^image\//.test(f.mime)).map((f) => f.path);
        const docTurn = { ...(p.doc || {}) };
        if (Array.isArray(docTurn.newExtraNames) && Array.isArray(docTurn.extraFiles)) {
          docTurn.extraFiles = docTurn.extraFiles.filter((f) => docTurn.newExtraNames.includes(f.name));
        }
        const turnPrompt = buildTurnPrompt({ mode, backend, doc: docTurn, instruction: lastMsg?.content || '', files: filesTurn });
        const ev = mkEvents(true);
        await runModel(backend, { prompt: turnPrompt, model, effort, images: imagesTurn, resume: resumeId, signal: ac.signal }, ev.onEvent);
        if (ev.gotText()) {
          for (const e of ev.held) send({ type: 'error', reqId: msg.reqId, error: e });
          handled = true;
        } else if (!ac.signal.aborted && (!ev.held.length || ev.held.some((e) => /session|thread|会话/i.test(e) && /not found|missing|invalid|expired|不存在|失效/i.test(e)))) {
          send({ type: 'note', reqId: msg.reqId, text: '会话已失效，正在重新读取全文并重建…' });
        } else {
          for (const e of ev.held) send({ type: 'error', reqId: msg.reqId, error: e });
          handled = true;
        }
      }
      if (!handled && !ac.signal.aborted) {
        // 首轮（或续轮失败回退）：完整 prompt + 建新 CLI 会话
        const newId = backend === 'claude' ? randomUUID() : null; // codex 的 id 从事件流里抓
        const prompt = buildPrompt({ mode, backend, doc: p.doc || {}, messages, files });
        const ev = mkEvents(false);
        await runModel(backend, { prompt, model, effort, images, sessionId: newId, signal: ac.signal }, ev.onEvent);
        const sid = backend === 'claude' ? newId : ev.session();
        if (sid && ev.gotText() && !ev.failed()) {
          send({ type: 'cli_session', reqId: msg.reqId, backend, id: sid });
        }
      }
    } catch (e) {
      send({ type: 'error', reqId: msg.reqId, error: String(e?.message || e) });
    }
    aborters.delete(msg.reqId);
    send({ type: 'done', reqId: msg.reqId });
    if (attachDir) { try { await rm(attachDir, { recursive: true, force: true }); } catch {} }
    return;
  }

  if (t === 'chat_stop') {
    const ac = aborters.get(msg.reqId);
    if (ac) { try { ac.abort(); } catch {} }
    return;
  }

  log('unknown message type:', t);
}
