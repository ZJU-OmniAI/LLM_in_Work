import { arxivId } from './arxiv.js';
import { documentInfo, isPdfUrl, readerUrl, sourceUrl } from './documents.js';

export async function openPdf(value, tabId) {
  const url = readerUrl(chrome.runtime.getURL('reader/reader.html'), value);
  if (tabId != null) await chrome.tabs.update(tabId, { url });
  else await chrome.tabs.create({ url });
}

export async function openCurrentPdf(tab) {
  const current = tab?.url;
  if (current?.startsWith(chrome.runtime.getURL('reader/reader.html'))) return;
  if (!sourceUrl(current)) throw new Error('请先打开论文网页或 PDF，或选择本地 PDF 文件。');
  if (arxivId(current) || isPdfUrl(current)) return openPdf(current, tab.id);
  let candidate;
  try {
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => {
      if (document.contentType === 'application/pdf') return location.href;
      const meta = document.querySelector('meta[name="citation_pdf_url" i]')?.content;
      const embedded = document.querySelector('embed[type="application/pdf"], iframe[src*=".pdf" i]')?.src;
      const link = [...document.querySelectorAll('a[href]')].find((a) => a.type === 'application/pdf' || /\.pdf(?:[?#]|$)/i.test(a.href) || (/\bPDF\b/i.test(a.textContent) && /\/pdf(?:[/?]|$)/i.test(a.href)));
      const value = meta || embedded || link?.href;
      try { return value ? new URL(value, location.href).href : null; } catch { return null; }
    } });
    candidate = result?.result;
  } catch { /* Native PDF viewers may not allow script injection; open the URL directly. */
    return openPdf(current, tab.id);
  }
  if (!sourceUrl(candidate)) throw new Error('页面未发现 PDF 链接。可点「读取当前网页」，或粘贴 PDF 地址。');
  return openPdf(candidate, tab.id);
}

export async function readCurrentPage(tab) {
  if (!sourceUrl(tab?.url)) throw new Error('此页面无法读取，请打开论文网页。');
  if (isPdfUrl(tab.url)) return openPdf(tab.url, tab.id);
  const info = await documentInfo(tab.url);
  await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content/content.css'] });
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: (info) => {
    window.paperReadDocument = info;
    if (window.__paperReadInjected) window.dispatchEvent(new Event('paper-read-open'));
  }, args: [info] });
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [
    'vendor/katex/katex.min.js', 'vendor/markdown-it/markdown-it.min.js', 'content/markdown.js', 'content/content.js',
  ] });
}
