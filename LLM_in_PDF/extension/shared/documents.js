import { arxivId } from './arxiv.js';

// Only browser-readable documents; never accept executable or extension URLs.
export function sourceUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:', 'file:'].includes(url.protocol) || url.username || url.password) return null;
    if (url.protocol === 'file:' && url.hostname && url.hostname !== 'localhost') return null;
    return url.href;
  } catch { return null; }
}

export function isPdfUrl(value) {
  const valid = sourceUrl(value);
  if (!valid) return false;
  return /(?:\.pdf|\/pdf(?:\/[^/]*)?)$/i.test(new URL(valid).pathname);
}

export async function digest(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((n) => n.toString(16).padStart(2, '0')).join('');
}

export async function documentInfo(value) {
  const valid = sourceUrl(value);
  if (!valid) throw new Error('仅支持 HTTP、HTTPS 或本机 file:// 文档地址。');
  const url = new URL(valid);
  url.hash = '';
  const id = arxivId(url.href);
  let name;
  try { name = decodeURIComponent(url.pathname.split('/').pop()); } catch { name = url.pathname.split('/').pop(); }
  return {
    id: id || `url:${await digest(new TextEncoder().encode(url.href))}`,
    arxivId: id, url: url.href, title: name || url.hostname || '本地论文',
    label: id ? `arXiv:${id}` : url.protocol === 'file:' ? `本地 PDF · ${name}` : url.hostname,
    source: id ? 'arxiv-pdf' : url.protocol === 'file:' ? 'local-pdf' : 'web-pdf',
  };
}

export function readerUrl(base, value) {
  const valid = sourceUrl(value);
  if (!valid) throw new Error('无效的 PDF 地址。');
  const id = arxivId(valid);
  const url = new URL(base);
  if (id) url.searchParams.set('id', id);
  else url.searchParams.set('url', valid);
  const page = new URLSearchParams(new URL(valid).hash.slice(1)).get('page');
  if (/^[1-9]\d*$/.test(page || '')) url.hash = `page=${page}`;
  return url.href;
}
