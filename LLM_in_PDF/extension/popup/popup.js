import { openCurrentPdf, readCurrentPage, openPdf } from '../shared/open-document.js';
const DEFAULT_BACKEND = 'http://localhost:8765';
const $ = (id) => document.getElementById(id);

async function load() {
  const cfg = await chrome.storage.local.get(['backendUrl', 'backend', 'effort', 'pdfReaderEnabled']);
  $('backendUrl').value = cfg.backendUrl || DEFAULT_BACKEND;
  $('backend').value = cfg.backend || 'claude';
  $('effort').value = cfg.effort || 'medium';
  $('pdfReaderEnabled').checked = cfg.pdfReaderEnabled !== false;
}

async function save() {
  await chrome.storage.local.set({
    backendUrl: $('backendUrl').value.trim() || DEFAULT_BACKEND,
    backend: $('backend').value,
    effort: $('effort').value,
    pdfReaderEnabled: $('pdfReaderEnabled').checked,
  });
}

function setStatus(text, kind) {
  const el = $('status');
  el.textContent = text;
  el.className = 'status ' + (kind || '');
}

async function testConnection() {
  await save();
  setStatus('连接中…', '');
  try {
    const res = await chrome.runtime.sendMessage({ type: 'health' });
    if (res?.ok && res.data?.ok) {
      if (res.transport === 'native') {
        setStatus('✅ 已连接 · 原生桥模式（零后端，无需手动启动）', 'ok');
      } else {
        setStatus(`✅ 已连接 · HTTP 备用模式 · ${res.base} · v${res.data.version}`, 'ok');
      }
    } else {
      setStatus(`❌ 连不上：${res?.error || '先在项目目录跑一次 ./install.sh'}`, 'err');
    }
  } catch (e) {
    setStatus(`❌ ${String(e?.message || e)}`, 'err');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  load();
  $('test').addEventListener('click', testConnection);
  ['backendUrl', 'backend', 'effort', 'pdfReaderEnabled'].forEach((id) => $(id).addEventListener('change', save));
  const action = (id, run) => $(id).addEventListener('click', async () => {
    try { await run(); window.close(); }
    catch (error) { setStatus(error.message, 'err'); }
  });
  action('openPdf', async () => openCurrentPdf((await chrome.tabs.query({ active: true, currentWindow: true }))[0]));
  action('readPage', async () => readCurrentPage((await chrome.tabs.query({ active: true, currentWindow: true }))[0]));
  action('openLocal', () => chrome.tabs.create({ url: chrome.runtime.getURL('reader/reader.html') }));
  action('openUrl', () => openPdf($('pdfUrl').value.trim()));
});

// Store and unpacked extensions may have different IDs. Show the actual one.
if (/^[a-p]{32}$/.test(chrome.runtime.id || "")) {
  document.getElementById("install-command").textContent = `./install.sh --extension-id ${chrome.runtime.id}`;
  document.getElementById("http-command").textContent = `$env:LLM_IN_PDF_EXTENSION_ID='${chrome.runtime.id}'; npm start`;
}
