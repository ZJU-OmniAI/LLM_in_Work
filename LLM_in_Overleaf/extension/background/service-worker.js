// 后台脚本：Chrome 原生消息中转（Chrome 按需自动拉起本机桥程序，零后端零端口）。
// 内容脚本 ↔ 这里 ↔ 原生桥（node server/native-host.js）↔ claude/codex CLI。

const HOST_NAME = 'com.llm_in_overleaf.host';

let reqSeq = 0;

// 工具栏弹窗和快捷键共用入口。扩展刚安装/重新加载时，旧页面可能尚未注入脚本。
async function openActivePanel(toggle = false) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https:\/\/((www|cn)\.)?overleaf\.com\/project\/[0-9a-z]{6,}(?:[/?#]|$)/i.test(tab.url || '')) {
    return { ok: false, error: '请先切到一个 Overleaf 项目编辑页，再点击「打开写作助手」。' };
  }
  const message = { type: toggle ? 'toggle_panel' : 'open_panel' };
  try {
    const response = await chrome.tabs.sendMessage(tab.id, message);
    if (response) return response;
  } catch { /* 新安装或重载后的已打开页面：按需注入。 */ }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', files: ['content/bridge.js'] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'ISOLATED', files: ['content/content.js'] });
    return await chrome.tabs.sendMessage(tab.id, message) || { ok: false, error: '页面没有响应，请刷新 Overleaf 项目页后重试。' };
  } catch (e) {
    return { ok: false, error: `无法打开助手，请刷新 Overleaf 项目页后重试。${String(e?.message || e)}` };
  }
}

function safePost(port, msg) {
  try { port.postMessage(msg); } catch {}
}

// —— 一问一答式的原生请求（健康检查 / 模型列表探测用）——
function nativeRequest(msg, timeoutMs, wantType = 'pong') {
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
      if (m?.type === wantType) finish(resolve, m);
    });
    port.onDisconnect.addListener(() => {
      finish(reject, new Error(chrome.runtime.lastError?.message || '本机桥程序断开'));
    });
    port.postMessage(msg);
  });
}

// —— 健康检查：每次都重新探测，方便"刚跑完 install.sh"立即生效 ——
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'open_active_panel') {
    openActivePanel().then(sendResponse).catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
    return true;
  }
  if (msg?.type === 'health') {
    (async () => {
      try {
        const pong = await nativeRequest({ type: 'ping', backend: msg.backend }, 10000);
        sendResponse({ ...pong, ok: pong.ok !== false });
      } catch (e) {
        sendResponse({
          ok: false,
          error: `本机桥未就绪（${String(e?.message || e)}）`,
        });
      }
    })();
    return true; // 异步响应
  }
  if (msg?.type === 'models') {
    // 面板点 🔄 → 桥进程实测探测最新可用模型（探测本身 25 秒兜底超时，这里放宽到 60 秒）
    (async () => {
      try {
        const r = await nativeRequest({ type: 'models', backend: msg.backend }, 60000, 'models');
        sendResponse(r);
      } catch (e) {
        sendResponse({ ok: false, error: String(e?.message || e) });
      }
    })();
    return true; // 异步响应
  }
  return false;
});

// —— 流式对话：一次对话开一条原生连接，结束即断开（桥进程随之退出）——
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'ol_edit_chat') return;
  const state = { abort: null };
  port.onMessage.addListener((msg) => {
    if (msg?.type === 'start') startChat(port, msg.payload, state);
  });
  port.onDisconnect.addListener(() => {
    if (state.abort) { try { state.abort(); } catch {} }
  });
});

function startChat(port, payload, state) {
  let nport;
  try {
    nport = chrome.runtime.connectNative(HOST_NAME);
  } catch (e) {
    safePost(port, { type: 'error', error: `无法启动本机桥：${String(e?.message || e)}。请在项目目录跑一次 ./install.sh` });
    safePost(port, { type: 'done' });
    return;
  }
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
    } else {
      safePost(port, m);
    }
  });

  nport.onDisconnect.addListener(() => {
    if (finished) return;
    finished = true;
    if (!gotAny) {
      safePost(port, {
        type: 'error',
        error: '连不上本机桥。请在下载的 LLM_in_Work 仓库目录执行一次：cd LLM_in_Overleaf && ./install.sh，然后刷新页面重试。',
      });
    } else {
      safePost(port, { type: 'error', error: '本机桥程序意外断开' });
    }
    safePost(port, { type: 'done' });
  });

  nport.postMessage({ type: 'chat_start', reqId, payload });
}

// —— 快捷键：⌘⇧E 开合面板 ——
chrome.commands?.onCommand.addListener(async (command) => {
  if (command !== 'toggle-panel') return;
  try {
    const result = await openActivePanel(true);
    await chrome.action.setBadgeText({ text: result.ok ? '' : '!' });
    await chrome.action.setTitle({ title: result.ok ? 'LLM_in_Overleaf 写作助手' : result.error });
  } catch {}
});
