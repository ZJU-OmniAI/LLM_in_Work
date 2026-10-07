// LLM_in_PDF 本地后端：一个零依赖的 HTTP 服务。
// 三个接口：
//   GET  /health         健康检查（插件用来测连通）
//   POST /api/paper      抓论文全文
//   POST /api/chat       针对论文对话，SSE 流式返回
// 大白话：浏览器插件不能直接开本机命令，所以让这个小服务替它跑 claude/codex。

import http from 'node:http';
import { PORT } from './config.js';
import { fetchPaper } from './paper-fetcher.js';
import { runModel } from './cli.js';
import { buildPrompt } from './prompt.js';
import { getModels } from './models.js';

const VERSION = '0.9.1';

const extensionId = process.env.LLM_IN_PDF_EXTENSION_ID || 'acafiedlcaibhilacmadmiklkfhmlhjo';
if (!/^[a-p]{32}$/.test(extensionId)) throw new Error('LLM_IN_PDF_EXTENSION_ID must contain exactly 32 letters a-p.');
const EXTENSION_ORIGIN = `chrome-extension://${extensionId}`;

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', EXTENSION_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req, limit = 30 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error('JSON 解析失败：' + e.message)); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  // The fallback is for this extension, not arbitrary websites on the user's machine.
  const host = req.headers.host || '';
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) || (req.headers.origin && req.headers.origin !== EXTENSION_ORIGIN)) {
    return sendJson(res, 403, { ok: false, error: 'Forbidden origin or host' });
  }
  if (req.method === 'POST' && !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
    return sendJson(res, 415, { ok: false, error: 'Expected application/json' });
  }
  setCors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // 健康检查
  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, { ok: true, service: 'LLM_in_PDF', version: VERSION });
  }

  if (req.method === 'GET' && url.pathname === '/api/models') {
    try { return sendJson(res, 200, { ok: true, ...await getModels(url.searchParams.get('force') === '1') }); }
    catch (e) { return sendJson(res, 500, { ok: false, error: e.message }); }
  }

  // 抓论文
  if (req.method === 'POST' && url.pathname === '/api/paper') {
    try {
      const body = await readBody(req);
      const paper = await fetchPaper(body.id || body.url, body.fallbackText || '');
      return sendJson(res, 200, { ok: true, paper });
    } catch (e) {
      return sendJson(res, 200, { ok: false, error: e.message });
    }
  }

  // 对话（SSE 流式）
  if (req.method === 'POST' && url.pathname === '/api/chat') {
    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      return sendJson(res, 400, { ok: false, error: e.message });
    }

    const backend = body.backend === 'codex' ? 'codex' : 'claude';
    const model = body.model || '(default)';
    const effort = body.effort || 'medium';
    const paper = body.paper || {};
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const selection = body.selection || '';

    if (!messages.length) return sendJson(res, 400, { ok: false, error: '缺少 messages' });

    let prompt;
    try { prompt = buildPrompt({ paper, messages, selection, images: body.images }); }
    catch (error) { return sendJson(res, 400, { ok: false, error: error.message }); }

    // 开 SSE
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (obj) => {
      try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch {}
    };

    // 客户端断开 → 中止子进程
    const ac = new AbortController();
    res.on('close', () => ac.abort());
    const heartbeat = setInterval(() => { if (!res.destroyed) res.write(': heartbeat\n\n'); }, 15000);

    send({ type: 'meta', backend, model, effort });

    const onEvent = (ev) => {
      if (ev.kind === 'text') send({ type: 'delta', text: ev.data });
      else if (ev.kind === 'thinking') send({ type: 'thinking', text: ev.data });
      else if (ev.kind === 'model') send({ type: 'model', model: ev.data });
      else if (ev.kind === 'error') send({ type: 'error', error: ev.data });
    };

    try {
      await runModel(backend, { prompt, model, effort, images: body.images, signal: ac.signal }, onEvent);
    } catch (e) {
      send({ type: 'error', error: e.message });
    } finally {
      clearInterval(heartbeat);
    }
    send({ type: 'done' });
    res.end();
    return;
  }

  sendJson(res, 404, { ok: false, error: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n📄 LLM_in_PDF 后端已启动`);
  console.log(`   地址: http://localhost:${PORT}`);
  console.log(`   健康检查: http://localhost:${PORT}/health`);
  console.log(`   （保持本窗口开着；关掉即停止服务）\n`);
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n❌ 端口 ${PORT} 已被占用。可能是后端已经在跑，或换个端口：LLM_IN_PDF_PORT=8790 node server/server.js\n`);
  } else {
    console.error('服务器错误：', e);
  }
  process.exit(1);
});
