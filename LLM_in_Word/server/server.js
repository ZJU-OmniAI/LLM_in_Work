// LLM_in_Word 本机服务：给 Word 加载项的任务窗格提供页面和 AI 接口。
// 与 overleaf_edit 的区别：Office 加载项没有 Chrome 那种 Native Messaging，
// 所以这里起一个只听本机回环地址（127.0.0.1）的小 HTTPS 服务，面板页面和 API 同源。
//   GET  /                → 跳转 /taskpane.html
//   GET  /taskpane.html…  → 任务窗格静态文件
//   GET  /api/ping        → 健康检查 {ok, version, https}
//   POST /api/chat        → 跑 claude/codex，流式返回 NDJSON（一行一个 JSON 事件）
// 证书由 install.sh 生成并加入钥匙串信任；找不到证书就退回 HTTP（只用于命令行调试，
// Word 网页视图不吃 HTTP，正式使用必须 HTTPS）。

import http from 'node:http';
import https from 'node:https';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { PORT, CERT_DIR } from './config.js';
import { runModel } from './cli.js';
import { buildPrompt, buildTurnPrompt } from './prompt.js';
import { getModels } from './models.js';
import { getHealth } from './health.js';
import { classifyError } from './process.js';

const VERSION = '0.7.0';
const activeRequests = new Set();
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url))); // 项目根目录

// ---- 二进制附件（图片/PDF）：先写进临时目录，再把路径写进 prompt / 传给 codex -i ----
const MAX_ATTACH = 8;
const MAX_ATTACH_BYTES = 15 * 1024 * 1024;
function safeName(name, i) {
  const base = path.basename(String(name || `file${i}`)).replace(/[^\w.\-一-龥]/g, '_');
  return base || `file${i}`;
}
async function writeAttachments(attachments) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'LLM_in_Word-att-'));
  const files = [];
  const seen = new Set();
  try {
    if (attachments.length > MAX_ATTACH) throw new Error(`附件最多 ${MAX_ATTACH} 个`);
    for (let i = 0; i < attachments.length; i++) {
      const a = attachments[i] || {};
      if (typeof a.b64 !== 'string' || !a.b64 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(a.b64)) throw new Error('附件数据无效');
      const buf = Buffer.from(a.b64, 'base64');
      if (!buf.length || buf.length > MAX_ATTACH_BYTES) throw new Error('附件为空或超过大小限制');
      let name = safeName(a.name, i);
      while (seen.has(name)) name = `${i}_${name}`;
      seen.add(name);
      const p = path.join(dir, name);
      await writeFile(p, buf);
      files.push({ name, path: p, mime: a.mime || '', idx: i }); // idx=面板附件数组里的原始序号，续轮按它过滤"新增"
    }
    return { dir, files };
  } catch (error) { await rm(dir, { recursive: true, force: true }); throw error; }
}

// ---- 静态文件 ----
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};
function serveStatic(res, urlPath) {
  // 只允许 taskpane/ 和 assets/ 两个目录，防路径穿越
  const clean = path.normalize(urlPath).replace(/^([/\\]|\.\.)+/, '');
  let file = null;
  if (/^assets\//.test(clean)) file = path.join(ROOT, clean);
  else file = path.join(ROOT, 'taskpane', clean);
  if (!file.startsWith(ROOT + path.sep) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 not found');
    return;
  }
  const ext = path.extname(file).toLowerCase();
  // no-store：Word 的 WKWebView 缓存很顽固（no-cache 有时都刷不动），静态文件干脆禁止缓存
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store, max-age=0' });
  res.end(readFileSync(file));
}

// ---- 请求体读取（附件走 base64 塞 JSON，上限放宽到 64MB）----
function readBody(req, limit = 64 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ---- /api/chat：流式 NDJSON ----
async function handleChat(req, res) {
  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: `请求解析失败：${e.message}` }));
    return;
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !['claude', 'codex'].includes(payload.backend) ||
      !Array.isArray(payload.messages) || !payload.messages.length || payload.messages.some((m) => !m || !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string') ||
      (payload.effort && !(payload.backend === 'codex' ? ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] : ['low', 'medium', 'high', 'xhigh', 'max']).includes(payload.effort)) ||
      (payload.model != null && (typeof payload.model !== 'string' || payload.model.length > 200)) ||
      (payload.cliSession && Object.values(payload.cliSession).some((id) => id != null && (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,120}$/.test(id))))) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: '请求参数无效，请刷新面板后重试。' }));
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  const send = (obj) => { if (!res.destroyed && !res.writableEnded) res.write(JSON.stringify(obj) + '\n'); };
  res.flushHeaders();
  const ac = new AbortController();
  activeRequests.add(ac);
  res.on('close', () => { if (!res.writableEnded) ac.abort(); });
  if (res.destroyed) ac.abort();

  const backend = payload.backend === 'codex' ? 'codex' : 'claude';
  const model = payload.model || (backend === 'codex' ? '(default)' : 'sonnet');
  const effort = payload.effort || 'medium';
  const mode = payload.mode === 'ask' ? 'ask' : 'edit';
  const messages = Array.isArray(payload.messages) ? payload.messages : [];

  // 二进制附件落盘
  let attachDir = null;
  let files = [];
  if (Array.isArray(payload.attachments) && payload.attachments.length) {
    try {
      const r = await writeAttachments(payload.attachments);
      attachDir = r.dir;
      files = r.files;
    } catch (e) {
      send({ type: 'error', error: `附件落盘失败：${String(e?.message || e)}` });
      send({ type: 'done', ok: false }); res.end(); activeRequests.delete(ac); return;
    }
  }

  const images = files.filter((f) => /^image\//.test(f.mime)).map((f) => f.path);
  const resumeId = (payload.cliSession && typeof payload.cliSession === 'object' && payload.cliSession[backend]) || null;
  const lastMsg = messages[messages.length - 1];


  send({ type: 'meta', backend, model, effort, mode, resume: !!resumeId, attachments: files.map((f) => f.name) });

  // 心跳：codex 常有长时间不吐字的静默期，Word 的 WKWebView 对 60 秒没有字节的
  // 连接会按空闲超时掐掉（报 "Load failed"），所以每 15 秒发一行心跳保活（面板会忽略）。
  const heartbeat = setInterval(() => send({ type: 'ping' }), 15000);

  let successful = false;
  const mkEvents = () => {
    let sawText = false, session = null;
    const errors = [];
    return {
      errors, gotText: () => sawText, session: () => session,
      onEvent(ev) {
        if (ev.kind === 'text') { sawText = true; send({ type: 'delta', text: ev.data }); }
        else if (ev.kind === 'thinking') send({ type: 'thinking', text: ev.data });
        else if (ev.kind === 'model') send({ type: 'model', model: ev.data });
        else if (ev.kind === 'status') send({ type: 'status', text: ev.data });
        else if (ev.kind === 'session') session = ev.data;
        else if (ev.kind === 'error') errors.push({ type: 'error', error: ev.data, code: ev.code, hint: ev.hint });
      },
    };
  };
  try {
    let rebuild = !resumeId;
    if (resumeId && !ac.signal.aborted) {
      const newIdx = Array.isArray(payload.newAttIdx) ? payload.newAttIdx : null;
      const filesTurn = newIdx ? files.filter((f) => newIdx.includes(f.idx)) : files;
      const docTurn = { ...(payload.doc || {}) };
      if (Array.isArray(docTurn.newExtraNames) && Array.isArray(docTurn.extraFiles)) {
        docTurn.extraFiles = docTurn.extraFiles.filter((f) => docTurn.newExtraNames.includes(f.name));
      }
      const prompt = buildTurnPrompt({ mode, backend, doc: docTurn, instruction: lastMsg?.content || '', files: filesTurn });
      const ev = mkEvents();
      const result = await runModel(backend, { prompt, model, effort, files: filesTurn,
        images: filesTurn.filter((f) => /^image\//.test(f.mime)).map((f) => f.path), resume: resumeId, signal: ac.signal }, ev.onEvent);
      successful = result.ok;
      // 只有明确的会话失效且没有正文时才自动重建；网络、鉴权、额度失败不重复请求。
      rebuild = !ac.signal.aborted && !ev.gotText() && result.errors?.some((e) => e.code === 'session_expired');
      if (rebuild) send({ type: 'note', text: '会话记录已失效，正在重新读取全文继续…' });
      else for (const error of ev.errors) send(error);
    }
    if (rebuild && !ac.signal.aborted) {
      const newId = backend === 'claude' ? randomUUID() : null;
      const prompt = buildPrompt({ mode, backend, doc: payload.doc || {}, messages, files });
      const ev = mkEvents();
      const result = await runModel(backend, { prompt, model, effort, images, files, sessionId: newId, signal: ac.signal }, ev.onEvent);
      successful = result.ok;
      for (const error of ev.errors) send(error);
      const sid = backend === 'claude' ? newId : ev.session();
      if (sid && successful) send({ type: 'cli_session', backend, id: sid });
    }
  } catch (e) {
    send({ type: 'error', ...classifyError(e?.message || e) });
  } finally {
    clearInterval(heartbeat);
    activeRequests.delete(ac);
    if (!successful) send({ type: 'cli_session', backend, id: null });
    send({ type: 'done', ok: successful, cancelled: ac.signal.aborted });
    res.end();
    if (attachDir) await rm(attachDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---- 路由 ----
async function handler(req, res) {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  const origin = req.headers.origin;
  const expectedOrigin = `${tlsOpts ? 'https' : 'http'}://${req.headers.host}`;
  if ((origin && origin !== expectedOrigin) || (p === '/api/chat' && !/^application\/json(?:;|$)/i.test(req.headers['content-type'] || ''))) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  try {
    if (p === '/' ) {
      res.writeHead(302, { Location: '/taskpane.html' });
      res.end();
    } else if (p === '/api/ping') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, version: VERSION, https: !!tlsOpts }));
    } else if (p === '/api/health' && req.method === 'GET') {
      const health = await getHealth(u.searchParams.get('refresh') === '1');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ...health, version: VERSION, https: !!tlsOpts }));
    } else if (p === '/api/models') {
      // Claude 稳定别名与 Codex model/list，带 5 分钟缓存
      const r = await getModels(u.searchParams.get('refresh') === '1');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: !!(r.claude || r.codex), ...r }));
    } else if (p === '/api/chat' && req.method === 'POST') {
      await handleChat(req, res);
    } else if (req.method === 'GET') {
      serveStatic(res, p.slice(1));
    } else {
      res.writeHead(405); res.end();
    }
  } catch (e) {
    try {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(String(e?.message || e));
    } catch {}
  }
}

// ---- 兜底：任何漏网异常只记日志不退出（launchd 会拉活，但重启会掐断进行中的请求）----
process.on('uncaughtException', (e) => { console.error('[uncaught]', e?.stack || e); });
process.on('unhandledRejection', (e) => { console.error('[unhandledRejection]', e?.stack || e); });

// ---- 启动：有证书走 HTTPS，没有退回 HTTP（仅命令行调试用）----
let tlsOpts = null;
const keyFile = path.join(CERT_DIR, 'localhost-key.pem');
const certFile = path.join(CERT_DIR, 'localhost-cert.pem');
if (existsSync(keyFile) && existsSync(certFile)) {
  tlsOpts = { key: readFileSync(keyFile), cert: readFileSync(certFile) };
}
const pfxFile = path.join(CERT_DIR, 'localhost.pfx');
if (!tlsOpts && existsSync(pfxFile)) {
  tlsOpts = { pfx: readFileSync(pfxFile), passphrase: readFileSync(path.join(CERT_DIR, 'pfx-password.txt'), 'utf8').trim() };
}
const server = tlsOpts ? https.createServer(tlsOpts, handler) : http.createServer(handler);
server.listen(PORT, '127.0.0.1', () => {
  console.log(`LLM_in_Word server ${VERSION} · ${tlsOpts ? 'https' : 'http（无证书，仅调试）'}://127.0.0.1:${server.address().port}`);
});

// launchd 更新或手动重启时，也取消仍在生成的 CLI，避免后台遗留调用。
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    for (const controller of activeRequests) controller.abort();
    server.close();
    server.closeIdleConnections?.();
    setTimeout(() => process.exit(0), 2500).unref();
  });
}
server.on('error', (error) => {
  console.error('[listen]', error.message);
  process.exitCode = 1;
});
