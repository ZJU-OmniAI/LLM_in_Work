// 从面板源码里找出所有要翻译的界面文字：tr('…')、tr`…${x}…`（插值记成 {0}{1}…）
// 以及 HTML 的 data-i18n / data-i18n-title / data-i18n-aria-label / data-i18n-placeholder。
// tools/test-i18n.js 用它检查英文词表是否齐全。
import { readFileSync } from 'node:fs';

const ESC = { n: '\n', r: '\r', t: '\t', v: '\v', b: '\b', f: '\f', '0': '\0' };
function cook(raw) {
  return raw.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (_, e) => {
    if (e[0] === 'u' || e[0] === 'x') return String.fromCodePoint(parseInt(e.replace(/[ux{}]/g, ''), 16));
    return ESC[e] ?? e;
  });
}

// 从 src[i]（反引号之后）扫描一个模板字符串，返回 { quasis, end }（end 指向结尾反引号之后）
function scanTemplate(src, i) {
  const quasis = [];
  let cur = '';
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') { cur += src.slice(i, i + 2); i += 2; continue; }
    if (c === '`') { quasis.push(cur); return { quasis, end: i + 1 }; }
    if (c === '$' && src[i + 1] === '{') {
      quasis.push(cur); cur = '';
      i = skipExpression(src, i + 2);
      continue;
    }
    cur += c; i++;
  }
  throw new Error('unterminated template literal');
}
// 跳过 ${ … } 里的表达式（可含嵌套模板、字符串、花括号），返回 } 之后的位置
function skipExpression(src, i) {
  let depth = 1;
  while (i < src.length) {
    const c = src[i];
    if (c === '`') { i = scanTemplate(src, i + 1).end; continue; }
    if (c === '\'' || c === '"') { i = skipString(src, i); continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i + 1;
    i++;
  }
  throw new Error('unterminated ${…}');
}
function skipString(src, i) {
  const q = src[i];
  for (i++; i < src.length; i++) {
    if (src[i] === '\\') { i++; continue; }
    if (src[i] === q) return i + 1;
  }
  throw new Error('unterminated string');
}

export function scriptKeys(src) {
  const keys = new Set();
  const re = /\btr(`|\(\s*(['"`]))/g;
  let m;
  while ((m = re.exec(src))) {
    const start = m.index + m[0].length;
    if (m[1] === '`') {
      const { quasis } = scanTemplate(src, start);
      keys.add(cook(quasis.map((q, k) => q + (k < quasis.length - 1 ? `{${k}}` : '')).join('')));
    } else if (m[2] === '`') {
      const { quasis } = scanTemplate(src, start);
      if (quasis.length === 1) keys.add(cook(quasis[0]));
    } else {
      const end = skipString(src, start - 1);
      keys.add(cook(src.slice(start, end - 1)));
    }
  }
  return keys;
}

export function htmlKeys(html) {
  const keys = new Set();
  for (const m of html.matchAll(/data-i18n(?:-title|-aria-label|-placeholder)?="([^"]*)"/g)) keys.add(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  return keys;
}

export function allKeys(root) {
  const js = readFileSync(new URL('taskpane/taskpane.js', root), 'utf8');
  const html = readFileSync(new URL('taskpane/taskpane.html', root), 'utf8');
  return new Set([...scriptKeys(js), ...htmlKeys(html)]);
}
