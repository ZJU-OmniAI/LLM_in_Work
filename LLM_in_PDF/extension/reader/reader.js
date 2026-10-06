import * as pdfjs from '../vendor/pdfjs/build/pdf.mjs';
import { validId } from '../shared/arxiv.js';
import { enableImageSelection } from './image-selection.js';
import { documentInfo, readerUrl, sourceUrl } from '../shared/documents.js';
import { importFile, getLocal, listLocal, localInfo, removeLocal } from './local-files.js';

const params = new URLSearchParams(location.search);
const status = document.getElementById('reader-status');
const container = document.getElementById('viewer-container');
const $ = (name) => document.getElementById(name);

async function listFiles() {
  const list = await listLocal();
  $('local-documents').replaceChildren();
  if (!list.length) $('local-documents').textContent = '尚未导入 PDF。';
  for (const info of list) {
    const row = document.createElement('div'); row.className = 'local-document';
    const link = document.createElement('a'); link.textContent = info.title;
    link.href = `reader.html?local=${encodeURIComponent(info.id)}`;
    const remove = document.createElement('button'); remove.textContent = '移除文件'; remove.title = '移除保存的 PDF，保留对话历史';
    remove.onclick = async () => {
      try { await removeLocal(info.id); await listFiles(); }
      catch (error) { $('open-error').textContent = error.message; }
    };
    row.append(link, remove); $('local-documents').append(row);
  }
}
async function selectFile(file) {
  if (!file) return;
  $('open-error').textContent = '正在读取并保存 PDF…';
  try {
    const info = await importFile(file);
    location.href = `reader.html?local=${encodeURIComponent(info.id)}`;
  } catch (error) { $('open-error').textContent = error.message; $('local-file').value = ''; }
}
$('url-form').onsubmit = (event) => {
  event.preventDefault();
  try { location.href = readerUrl(chrome.runtime.getURL('reader/reader.html'), $('document-url').value.trim()); }
  catch (error) { $('open-error').textContent = error.message; }
};
$('local-file').onchange = (event) => selectFile(event.target.files[0]);
$('file-drop').ondragover = (event) => { event.preventDefault(); $('file-drop').classList.add('dragover'); };
$('file-drop').ondragleave = () => $('file-drop').classList.remove('dragover');
$('file-drop').ondrop = (event) => {
  event.preventDefault(); $('file-drop').classList.remove('dragover'); selectFile(event.dataTransfer.files[0]);
};

async function resolveSource() {
  if (params.has('id')) {
    const id = validId(params.get('id'));
    if (!id) throw new Error('无效的 arXiv 论文编号。');
    return { info: await documentInfo(`https://arxiv.org/pdf/${id}`) };
  }
  if (params.has('local')) {
    const id = params.get('local');
    if (!/^local:[a-f0-9]{64}$/.test(id)) throw new Error('无效的本地文档编号。');
    const file = await getLocal(id);
    if (!file) throw new Error('此本地 PDF 已移除，请重新选择文件；已有对话会自动恢复。');
    return { info: { id: file.id, title: file.title, label: file.label, source: file.source }, data: new Uint8Array(file.bytes) };
  }
  const value = sourceUrl(params.get('url'));
  if (!value) throw new Error('无效的 PDF 地址，仅支持 HTTP、HTTPS 或本机 file:// 文件。');
  const info = await documentInfo(value);
  if (value.startsWith('file:')) {
    if (!await chrome.extension.isAllowedFileSchemeAccess()) throw new Error('请在扩展详情开启「允许访问文件网址」，或在下方直接选择本地 PDF。');
    const response = await fetch(info.url);
    if (!response.ok) throw new Error('本地文件无法读取，请重新选择 PDF。');
    const bytes = await response.arrayBuffer();
    return { info: { ...await localInfo(bytes, info.title), url: info.url }, data: new Uint8Array(bytes) };
  }
  return { info };
}

async function loadPdf({ info, data }) {
  if (info.arxivId) {
    $('abstract').href = `https://arxiv.org/abs/${info.arxivId}`;
    $('abstract').hidden = false;
  }
  if (info.url) {
    $('original').hidden = false; $('original').href = info.url;
    $('original').onclick = async (event) => {
      event.preventDefault();
      const result = await chrome.runtime.sendMessage({ type: 'openOriginalPdf', url: info.url });
      if (!result.ok) { status.classList.add('error'); status.textContent = result.error; }
    };
  }
  document.title = `${info.title} · LLM_in_PDF`;
  pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdfjs/build/pdf.worker.mjs');
  const { EventBus, PDFViewer, PDFLinkService, PDFFindController } = await import('../vendor/pdfjs/web/pdf_viewer.mjs');
  const eventBus = new EventBus();
  const linkService = new PDFLinkService({ eventBus, externalLinkTarget: 2, externalLinkRel: 'noopener noreferrer' });
  const findController = new PDFFindController({ eventBus, linkService });
  const viewer = new PDFViewer({ container, viewer: $('viewer'), eventBus, linkService, findController,
    textLayerMode: 1, annotationMode: 1 });
  linkService.setViewer(viewer);
  eventBus.on('pagesinit', () => {
    viewer.currentScaleValue = $('zoom').value;
    const page = Number(new URLSearchParams(location.hash.slice(1)).get('page'));
    if (page >= 1 && page <= viewer.pagesCount) viewer.currentPageNumber = page;
  });
  eventBus.on('pagechanging', ({ pageNumber }) => { $('page-number').value = pageNumber; });
  $('previous').onclick = () => { if (viewer.currentPageNumber > 1) viewer.currentPageNumber--; };
  $('next').onclick = () => { if (viewer.currentPageNumber < viewer.pagesCount) viewer.currentPageNumber++; };
  $('page-number').onchange = () => {
    viewer.currentPageNumber = Math.max(1, Math.min(viewer.pagesCount, Number($('page-number').value) || 1));
    $('page-number').value = viewer.currentPageNumber;
  };
  $('zoom').onchange = () => { viewer.currentScaleValue = $('zoom').value; };
  $('find').addEventListener('input', () => eventBus.dispatch('find', { source: window, type: '', query: $('find').value, highlightAll: true }));
  $('find').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') eventBus.dispatch('find', { source: window, type: 'again', query: $('find').value, highlightAll: true, findPrevious: event.shiftKey });
  });
  let resizeTimer;
  new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (viewer.pdfDocument) { viewer.currentScaleValue = $('zoom').value; viewer.update(); } }, 150);
  }).observe(container);
  const task = pdfjs.getDocument({ ...(data ? { data } : { url: info.url, withCredentials: true }), isEvalSupported: false,
    cMapUrl: chrome.runtime.getURL('vendor/pdfjs/cmaps/'), cMapPacked: true,
    standardFontDataUrl: chrome.runtime.getURL('vendor/pdfjs/standard_fonts/'),
    wasmUrl: chrome.runtime.getURL('vendor/pdfjs/wasm/'), iccUrl: chrome.runtime.getURL('vendor/pdfjs/iccs/') });
  task.onProgress = ({ loaded, total }) => { status.textContent = total ? `加载 PDF… ${Math.min(100, Math.round(loaded / total * 100))}%` : '正在加载 PDF…'; };
  const pdf = await task.promise;
  viewer.setDocument(pdf);
  linkService.setDocument(pdf);
  enableImageSelection({ pdf, viewer, container, button: $('select-image'), status });
  $('page-count').textContent = pdf.numPages;
  $('page-number').max = pdf.numPages;
  const metadata = await pdf.getMetadata().catch(() => null);
  const metadataTitle = metadata?.info?.Title?.trim();
  const title = metadataTitle && metadataTitle !== 'about:blank' ? metadataTitle : info.arxivId ? `arXiv:${info.arxivId}` : info.title;
  document.title = `${title} · LLM_in_PDF`;
  // Extract the entire paper once, independent of which pages are currently rendered.
  const parts = [];
  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
    status.textContent = `正在读取全文 ${pageNo}/${pdf.numPages} 页 · 可选中文字后点「问一下」`;
    const page = await pdf.getPage(pageNo);
    const content = await page.getTextContent();
    parts.push(content.items.map((item) => typeof item.str === 'string' ? item.str + (item.hasEOL ? '\n' : ' ') : '').join(''));
  }
  const text = parts.join('\n\n');
  const truncated = text.length > 600000;
  status.textContent = `${pdf.numPages} 页 · ${text.trim() ? '选字提问，或点「框选图片」分析图表' : '无文字层，可点「框选图片」读取扫描内容'}${truncated ? ' · 超长正文已截断' : ''}`;
  return { id: info.id, title, text: text.trim() ? text.slice(0, 600000) : '（此 PDF 没有可提取的文字层，请依据用户提供的截图回答。）', source: info.source, chars: text.length, truncated };
}
function showError(error) {
  status.classList.add('error');
  status.textContent = `PDF 读取失败：${error.message}`;
  $('open-error').textContent = '若链接返回登录页、无权访问或不允许直接读取，请先在原网站打开 / 下载 PDF，再选择文件。';
  $('document-picker').hidden = false;
  listFiles().catch(console.warn);
}
if (!params.has('id') && !params.has('url') && !params.has('local')) {
  status.textContent = '打开在线或本地 PDF，使用文字选择、图片框选和论文对话。';
  $('document-picker').hidden = false;
  listFiles().catch(showError);
} else {
  try {
    const input = await resolveSource();
    const ready = loadPdf(input).catch((error) => { showError(error); throw error; });
    // Only extension pages use this object. Other websites are explicitly opened by the popup.
    window.paperReadPDF = { ...input.info, ready };
    ready.catch(() => {});
    await import('../content/content.js');
  } catch (error) { showError(error); }
}
