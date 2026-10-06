// 后台脚本：优先走 Chrome 原生消息（Chrome 按需自动拉起本机桥程序，零后端零端口），
// 桥没安装时自动退回 HTTP 后端（node server/server.js）。内容脚本对此无感知。

import { pdfRules } from '../shared/arxiv.js';
import { isPdfUrl, readerUrl, sourceUrl } from '../shared/documents.js';

const HOST_NAME = 'com.paper_read.host';
const DEFAULT_BACKEND = 'http://localhost:8765';

async function configurePdfReader() {
  const { pdfReaderEnabled = true } = await chrome.storage.local.get('pdfReaderEnabled');
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [6101, 6102],
    addRules: pdfReaderEnabled ? pdfRules(chrome.runtime.getURL('reader/reader.html')) : [] });
}
chrome.runtime.onInstalled.addListener(() => configurePdfReader().catch(console.error));
chrome.runtime.onStartup.addListener(() => configurePdfReader().catch(console.error));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.pdfReaderEnabled) configurePdfReader().catch(console.error);
});
configurePdfReader().catch(console.error);

// MIME detection also handles PDF endpoints without a .pdf suffix (e.g. /download?id=...).
// Restrict this to top-level navigation: PDF.js's own fetches must not reopen the reader.
const detectedPdfs = new Map();
const openingPdf = new Set();
async function maybeOpenPdf(tabId, value) {
  if (tabId < 0 || !sourceUrl(value)) return;
  const url = new URL(value);
  if (/(^|\.)arxiv\.org$/i.test(url.hostname)) return; // existing DNR rules and native escape hatch
  const { pdfReaderEnabled = true } = await chrome.storage.local.get('pdfReaderEnabled');
  if (!pdfReaderEnabled) return;
  const bypassKey = `native-pdf:${tabId}`;
  const bypass = (await chrome.storage.session.get(bypassKey))[bypassKey];
  url.hash = '';
  if (bypass === url.href) return;
  const tab = await chrome.tabs.get(tabId);
  if (tab.url?.startsWith(chrome.runtime.getURL('reader/reader.html')) && !tab.pendingUrl) return;
  // An async permission/storage lookup must not hijack a later unrelated navigation.
  const active = sourceUrl(tab.pendingUrl || tab.url);
  if (!active) return;
  const activeUrl = new URL(active); activeUrl.hash = '';
  if (activeUrl.href !== url.href) return;
  if (openingPdf.has(tabId)) return;
  openingPdf.add(tabId);
  try {
    await chrome.tabs.update(tabId, { url: readerUrl(chrome.runtime.getURL('reader/reader.html'), active) });
    detectedPdfs.delete(tabId);
  } finally { openingPdf.delete(tabId); }
}
chrome.webRequest.onHeadersReceived.addListener((details) => {
  const type = details.responseHeaders?.find((header) => header.name.toLowerCase() === 'content-type')?.value || '';
  const disposition = details.responseHeaders?.find((header) => header.name.toLowerCase() === 'content-disposition')?.value || '';
  if (details.method === 'GET' && details.statusCode >= 200 && details.statusCode < 300 && /^application\/pdf(?:\s*;|$)/i.test(type) && !/^attachment/i.test(disposition)) {
    // On redirect chains, pendingUrl can still be the pre-redirect address here.
    // Retry when Chrome commits the final tab URL instead of overriding another navigation.
    detectedPdfs.set(details.tabId, { url: details.url, at: Date.now() });
    maybeOpenPdf(details.tabId, details.url).catch(console.warn);
  }
}, { urls: ['http://*/*', 'https://*/*'], types: ['main_frame'] }, ['responseHeaders']);
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.url?.startsWith('file:') && isPdfUrl(change.url)) {
    chrome.extension.isAllowedFileSchemeAccess().then((allowed) => {
      if (allowed) return maybeOpenPdf(tabId, change.url);
    }).catch(console.warn);
  } else {
    const detected = detectedPdfs.get(tabId);
    if (detected && Date.now() - detected.at < 30000) maybeOpenPdf(tabId, detected.url).catch(console.warn);
    else if (detected) detectedPdfs.delete(tabId);
  }
});
chrome.tabs.onRemoved.addListener((tabId) => {
  detectedPdfs.delete(tabId); openingPdf.delete(tabId);
  chrome.storage.session.remove(`native-pdf:${tabId}`).catch(console.warn);
});

let nativeAvailable = null; // null=还没探测过
let reqSeq = 0;

async function getBackendUrl() {
  const { backendUrl } = await chrome.storage.local.get('backendUrl');
  return (backendUrl || DEFAULT_BACKEND).replace(/\/+$/, '');
}

function safePost(port, msg) {
  try { port.postMessage(msg); } catch {}
}

// —— 一问一答式的原生请求（ping / 抓论文用）——
function nativeRequest(msg, timeoutMs) {
  return new Promise((resolve, reject) => {
    let port;
    try { port = chrome.runtime.connectNative(HOST_NAME); } catch (e) { return reject(e); }
    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { port.disconnect(); } catch {}
      fn(arg);
    };
    const timer = setTimeout(() => finish(reject, new Error('本机桥程序响应超时')), timeoutMs);
    port.onMessage.addListener((m) => {
      if (['pong', 'paper_result', 'models'].includes(m?.type)) finish(resolve, m);
      else if (m?.type === 'error') finish(reject, new Error(m.error));
    });
    port.onDisconnect.addListener(() => {
      finish(reject, new Error(chrome.runtime.lastError?.message || '本机桥程序断开'));
    });
    port.postMessage(msg);
  });
}

async function detectNative() {
  try {
    await nativeRequest({ type: 'ping' }, 2000);
    nativeAvailable = true;
  } catch {
    nativeAvailable = false;
  }
  return nativeAvailable;
}

async function transport() {
  if (nativeAvailable === null) await detectNative();
  return nativeAvailable ? 'native' : 'http';
}

// —— 普通请求：健康检查 / 抓论文 ——
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'openOriginalPdf') {
    (async () => {
      if (!_sender.url?.startsWith(chrome.runtime.getURL('reader/reader.html')) || !sourceUrl(msg.url)) throw new Error('无效的 PDF 来源');
      const url = new URL(msg.url);
      if (/(^|\.)arxiv\.org$/i.test(url.hostname)) url.searchParams.set('paper_read_native', '1');
      const tab = await chrome.tabs.create({ url: 'about:blank' });
      const match = new URL(url); match.hash = '';
      await chrome.storage.session.set({ [`native-pdf:${tab.id}`]: match.href });
      await chrome.tabs.update(tab.id, { url: url.href });
      return { ok: true };
    })().then(sendResponse, (error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (msg?.type === 'models') {
    modelCatalog(!!msg.force).then(sendResponse, (error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (msg?.type === 'health') {
    (async () => {
      // 每次健康检查都重新探测，方便"刚跑完 install.sh"立即生效
      if (await detectNative()) {
        sendResponse({ ok: true, transport: 'native', data: { ok: true, version: 'native' } });
        return;
      }
      try {
        const base = await getBackendUrl();
        const res = await fetch(`${base}/health`);
        const data = await res.json();
        sendResponse({ ok: true, transport: 'http', data, base });
      } catch (e) {
        sendResponse({
          ok: false,
          error:
            `原生模式未安装（在项目目录跑一次 ./install.sh），HTTP 后端也没连上（${String(e?.message || e)}）`,
        });
      }
    })();
    return true; // 异步响应
  }

  if (msg?.type === 'fetchPaper') {
    (async () => {
      if ((await transport()) === 'native') {
        try {
          const m = await nativeRequest(
            { type: 'paper', reqId: 'p' + ++reqSeq, id: msg.id, url: msg.url, fallbackText: msg.fallbackText || '' },
            120000
          );
          sendResponse({ ok: m.ok, paper: m.paper, error: m.error });
          return;
        } catch {
          nativeAvailable = null; // 桥可能被卸了，下次重新探测；这次退回 HTTP
        }
      }
      try {
        const base = await getBackendUrl();
        const res = await fetch(`${base}/api/paper`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: msg.id, url: msg.url, fallbackText: msg.fallbackText || '' }),
        });
        sendResponse(await res.json());
      } catch (e) {
        sendResponse({ ok: false, error: String(e?.message || e) + '（原生桥和 HTTP 后端都不可用，先跑一次 ./install.sh）' });
      }
    })();
    return true;
  }

  return false;
});

let modelsInflight = null;
async function modelCatalog(force) {
  const { modelCatalogCache } = await chrome.storage.local.get('modelCatalogCache');
  if (!force && modelCatalogCache && Date.now() - modelCatalogCache.at < 300000) return modelCatalogCache.data;
  if (modelsInflight) return modelsInflight;
  modelsInflight = (async () => {
    let data;
    if ((await transport()) === 'native') {
      try { data = await nativeRequest({ type: 'models', reqId: 'm' + ++reqSeq, force }, 25000); }
      catch { nativeAvailable = null; }
    }
    if (!data?.ok) {
      const base = await getBackendUrl();
      const response = await fetch(`${base}/api/models${force ? '?force=1' : ''}`, { signal: AbortSignal.timeout(25000) });
      data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || '无法读取模型目录');
    }
    for (const backend of ['claude', 'codex']) {
      if (!data[backend] && modelCatalogCache?.data?.[backend]) {
        data[backend] = modelCatalogCache.data[backend];
        data.efforts ||= {};
        data.efforts[backend] = modelCatalogCache.data.efforts?.[backend] || {};
        data.sources ||= {};
        data.sources[backend] = 'cache';
      }
    }
    await chrome.storage.local.set({ modelCatalogCache: { at: Date.now(), data } });
    return data;
  })().finally(() => { modelsInflight = null; });
  return modelsInflight;
}

// —— 流式对话 ——
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'paper_read_chat') return;
  const state = { abort: null };
  port.onMessage.addListener((msg) => {
    if (msg?.type === 'start') startChat(port, msg.payload, state);
  });
  port.onDisconnect.addListener(() => {
    if (state.abort) { try { state.abort(); } catch {} }
  });
});

async function startChat(port, payload, state) {
  if ((await transport()) === 'native') {
    const handled = await nativeChat(port, payload, state);
    if (handled) return;
    nativeAvailable = null; // 原生这条路突然不通了，退回 HTTP 再试
  }
  await httpChat(port, payload, state);
}

// 原生流式：一次对话开一条原生连接，结束即断开（桥进程随之退出）
function nativeChat(port, payload, state) {
  return new Promise((resolve) => {
    let nport;
    try { nport = chrome.runtime.connectNative(HOST_NAME); } catch { return resolve(false); }
    const reqId = 'c' + ++reqSeq;
    let gotAny = false;
    let finished = false;

    state.abort = () => {
      try { nport.postMessage({ type: 'chat_stop', reqId }); } catch {}
      try { nport.disconnect(); } catch {}
    };

    nport.onMessage.addListener((m) => {
      if (m?.reqId && m.reqId !== reqId) return;
      gotAny = true;
      if (m.type === 'done') {
        finished = true;
        safePost(port, m);
        try { nport.disconnect(); } catch {}
        resolve(true);
      } else {
        safePost(port, m);
      }
    });

    nport.onDisconnect.addListener(() => {
      if (finished) return;
      finished = true;
      if (!gotAny) { resolve(false); return; } // 一条都没收到就断了 → 桥没装好，让上层退回 HTTP
      safePost(port, { type: 'error', error: '本机桥程序意外断开' });
      safePost(port, { type: 'done' });
      resolve(true);
    });

    nport.postMessage({ type: 'chat_start', reqId, payload });
  });
}

// HTTP 流式（备用路径）：连本地 server 的 SSE
async function httpChat(port, payload, state) {
  const ac = new AbortController();
  state.abort = () => ac.abort();
  try {
    const base = await getBackendUrl();
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });

    if (!res.ok || !res.body) {
      let errText = `后端返回 HTTP ${res.status}`;
      try { const j = await res.json(); if (j?.error) errText = j.error; } catch {}
      safePost(port, { type: 'error', error: errText });
      safePost(port, { type: 'done' });
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let sep;
      while ((sep = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        const dataLine = block.split('\n').find((l) => l.startsWith('data:'));
        if (!dataLine) continue;
        try { safePost(port, JSON.parse(dataLine.slice(5).trim())); } catch {}
      }
    }
    safePost(port, { type: 'done' });
  } catch (e) {
    if (e?.name === 'AbortError') {
      safePost(port, { type: 'aborted' });
    } else {
      safePost(port, {
        type: 'error',
        error:
          `${String(e?.message || e)}\n两条路都不通：推荐在项目目录跑一次 ./install.sh（之后无需手动起服务）；` +
          `或临时用备用方案 node server/server.js。`,
      });
    }
    safePost(port, { type: 'done' });
  }
}
