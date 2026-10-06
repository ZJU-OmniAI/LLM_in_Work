// 论文抓取：给一个 arxiv id，尽量拿到"全文"，拿不到就退回摘要。
// 大白话：arxiv 新论文有网页版全文（/html/），老论文有 ar5iv 转的网页版，
// 实在没有就只能从摘要页抠标题+摘要。这里按这个顺序依次尝试。

import { MAX_PAPER_CHARS, PAPER_CACHE_MS } from './config.js';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36 LLM_in_PDF/0.1';

// 简单内存缓存：{ id -> { data, ts } }
const cache = new Map();

// 从任意 arxiv 相关 URL 里抠出论文 id，如 2401.12345 或 2401.12345v2
export function parseArxivId(input) {
  if (!input) return null;
  const s = String(input);
  // 新式 id：YYMM.NNNNN(vN)
  let m = s.match(/(\d{4}\.\d{4,5})(v\d+)?/);
  if (m) return m[1] + (m[2] || '');
  // 老式 id：如 math/0211159 或 hep-th/9901001
  m = s.match(/([a-z-]+(?:\.[A-Z]{2})?\/\d{7})(v\d+)?/i);
  if (m) return m[1] + (m[2] || '');
  return null;
}

// 去掉版本号，方便拼 html 链接（html 版一般不带 vN）
function idNoVersion(id) {
  return id.replace(/v\d+$/i, '');
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`);
  const html = await res.text();
  return { html, finalUrl: res.url || url };
}

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', ldquo: '“', rdquo: '”',
  lsquo: '‘', rsquo: '’', times: '×', minus: '−', deg: '°',
};

function decodeEntities(str) {
  return str
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => (name in ENTITIES ? ENTITIES[name] : m));
}

function safeCodePoint(cp) {
  try {
    if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return '';
    return String.fromCodePoint(cp);
  } catch {
    return '';
  }
}

// 把 HTML 转成适合喂给大模型的纯文本，尽量保留公式的 LaTeX。
function htmlToText(html) {
  let s = html;

  // arxiv/ar5iv 的正文主体在 <article> 里，先尽量截取主体，去掉页眉页脚/侧栏噪声
  const artMatch = s.match(/<article[\s\S]*?<\/article>/i);
  if (artMatch) s = artMatch[0];

  // LaTeXML 会把公式放进 <math alttext="\\frac{a}{b}"> 里，用 alttext 还原成 $...$
  s = s.replace(/<math[^>]*\balttext="([^"]*)"[^>]*>[\s\S]*?<\/math>/gi, (_, tex) => ` $${decodeEntities(tex)}$ `);

  // 去掉不需要的整块元素
  s = s.replace(/<(script|style|noscript|svg|figure\s+class="ltx_figure_panel")[\s\S]*?<\/\1>/gi, ' ');

  // 结构性标签转换成换行，读起来更像段落
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|section|h[1-6]|li|tr|table|article|blockquote)>/gi, '\n');
  s = s.replace(/<li[^>]*>/gi, '\n- ');
  s = s.replace(/<h([1-6])[^>]*>/gi, '\n\n');

  // 去掉剩余所有标签
  s = s.replace(/<[^>]+>/g, ' ');

  s = decodeEntities(s);

  // 折叠空白
  s = s.replace(/\r/g, '');
  s = s.replace(/[ \t\f\v]+/g, ' ');
  s = s.replace(/ *\n */g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

// 从摘要页抠标题/作者/摘要（当全文抓不到时的退路）
function parseAbsPage(html, id) {
  const titleM = html.match(/<h1[^>]*class="title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i);
  const authorsM = html.match(/<div[^>]*class="authors"[^>]*>([\s\S]*?)<\/div>/i);
  const absM = html.match(/<blockquote[^>]*class="abstract[^"]*"[^>]*>([\s\S]*?)<\/blockquote>/i);
  const clean = (x) => (x ? decodeEntities(x.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).replace(/^\s*(Title:|Abstract:|Authors:)\s*/i, '').trim() : '');
  const title = clean(titleM && titleM[1]) || `arXiv:${id}`;
  const authors = clean(authorsM && authorsM[1]);
  const abstract = clean(absM && absM[1]);
  const text = [
    `Title: ${title}`,
    authors ? `Authors: ${authors}` : '',
    '',
    'Abstract:',
    abstract,
    '',
    '（注：本文暂无网页版全文，仅抓到摘要。可打开 PDF 或 arxiv.org/html 版本获取全文后再问。）',
  ].filter((l) => l !== '').join('\n');
  return { title, authors, text };
}

// 从全文 HTML 里抠一个标题（尽量）
function extractTitleFromHtml(html, id) {
  const h1 = html.match(/<h1[^>]*class="ltx_title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i) || html.match(/<title>([\s\S]*?)<\/title>/i);
  if (h1) return decodeEntities(h1[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim();
  return `arXiv:${id}`;
}

// 主函数：返回 { id, title, authors, text, source, chars, truncated }
export async function fetchPaper(rawId, fallbackText = '') {
  const id = parseArxivId(rawId);
  if (!id) throw new Error(`无法识别的 arxiv id: ${rawId}`);

  const hit = cache.get(id);
  if (hit && Date.now() - hit.ts < PAPER_CACHE_MS) return hit.data;

  const bare = idNoVersion(id);
  const candidates = [
    { url: `https://arxiv.org/html/${id}`, source: 'arxiv-html' },
    { url: `https://arxiv.org/html/${bare}`, source: 'arxiv-html' },
    { url: `https://ar5iv.labs.arxiv.org/html/${bare}`, source: 'ar5iv' },
  ];

  let result = null;
  for (const c of candidates) {
    try {
      const { html, finalUrl } = await fetchText(c.url);
      // ar5iv 未收录时会重定向到 /abs/ 摘要页——那不是全文，跳过交给摘要解析器
      if (/\/abs\//.test(finalUrl)) continue;
      const text = htmlToText(html);
      // 全文正常应该有几千字以上；太短说明这一路没拿到真正的全文
      if (text && text.length > 1200) {
        result = { id, title: extractTitleFromHtml(html, id), authors: '', text, source: c.source };
        break;
      }
    } catch {
      // 换下一个候选
    }
  }

  // 全文都失败 → 退回摘要页
  if (!result) {
    try {
      const { html: absHtml } = await fetchText(`https://arxiv.org/abs/${id}`);
      const parsed = parseAbsPage(absHtml, id);
      result = { id, ...parsed, source: 'arxiv-abs' };
    } catch (e) {
      // 摘要页也挂了 → 用浏览器端传来的兜底文本（当前页面能读到的内容）
      if (fallbackText && fallbackText.length > 100) {
        result = { id, title: `arXiv:${id}`, authors: '', text: fallbackText, source: 'page-fallback' };
      } else {
        throw new Error(`抓取论文失败：${e.message}`);
      }
    }
  }

  // 如果全文明显比页面兜底短，用更长的那个（有些页面本身就是 html 全文）
  if (fallbackText && fallbackText.length > result.text.length * 1.3 && fallbackText.length > 2000) {
    result = { ...result, text: fallbackText, source: result.source + '+page' };
  }

  const full = result.text || '';
  const truncated = full.length > MAX_PAPER_CHARS;
  result.text = truncated ? full.slice(0, MAX_PAPER_CHARS) + '\n\n…（正文过长已截断）' : full;
  result.chars = full.length;
  result.truncated = truncated;

  cache.set(id, { data: result, ts: Date.now() });
  return result;
}
