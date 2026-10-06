// Shared by arXiv content scripts and the extension's PDF reader. No remote assets.
(() => {
  const md = globalThis.markdownit({ html: false, linkify: true, breaks: true });
  const escape = md.utils.escapeHtml;
  function math(tex, display) {
    try {
      if (globalThis.katex) return globalThis.katex.renderToString(tex.trim(), {
        displayMode: display, throwOnError: false, trust: false, output: 'html',
      });
    } catch {}
    return `<code class="pr-code">${escape(tex)}</code>`;
  }
  function closing(source, delimiter, start) {
    let at = source.indexOf(delimiter, start);
    while (at !== -1) {
      let backslashes = 0;
      for (let i = at - 1; i >= 0 && source[i] === '\\'; i--) backslashes++;
      if (backslashes % 2 === 0) return at;
      at = source.indexOf(delimiter, at + delimiter.length);
    }
    return -1;
  }
  md.inline.ruler.before('escape', 'paper_math', (state, silent) => {
    const source = state.src, start = state.pos;
    let open, close, display = false;
    if (source.startsWith('$$', start)) { open = close = '$$'; display = true; }
    else if (source[start] === '$') { open = close = '$'; }
    else if (source.startsWith('\\(', start)) { open = '\\('; close = '\\)'; }
    else if (source.startsWith('\\[', start)) { open = '\\['; close = '\\]'; display = true; }
    else return false;
    const end = closing(source, close, start + open.length);
    if (end < 0 || end >= state.posMax) return false;
    const content = source.slice(start + open.length, end);
    if (!content.trim() || (open === '$' && (/^\s|\s$|\n/.test(content) || /\d/.test(source[end + 1] || '')))) return false;
    if (!silent) {
      const token = state.push('paper_math', '', 0);
      token.content = content;
      token.meta = { display };
    }
    state.pos = end + close.length;
    return true;
  });
  md.block.ruler.before('fence', 'paper_math_block', (state, startLine, endLine, silent) => {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const first = state.src.slice(start, state.eMarks[startLine]);
    const open = first.startsWith('$$') ? '$$' : first.startsWith('\\[') ? '\\[' : null;
    if (!open || state.sCount[startLine] - state.blkIndent >= 4) return false;
    const close = open === '$$' ? '$$' : '\\]';
    const lines = [];
    let next = startLine;
    for (; next < endLine; next++) {
      const line = next === startLine ? first.slice(open.length) : state.src.slice(state.bMarks[next] + state.tShift[next], state.eMarks[next]);
      const end = closing(line, close, 0);
      if (end >= 0) {
        if (line.slice(end + close.length).trim()) return false;
        lines.push(line.slice(0, end));
        break;
      }
      lines.push(line);
    }
    if (next === endLine) return false;
    if (silent) return true;
    const token = state.push('paper_math_block', '', 0);
    token.block = true;
    token.content = lines.join('\n');
    token.map = [startLine, next + 1];
    state.line = next + 1;
    return true;
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
  md.renderer.rules.paper_math = (tokens, index) => math(tokens[index].content, tokens[index].meta.display);
  md.renderer.rules.paper_math_block = (tokens, index) => `<div class="pr-math-block">${math(tokens[index].content, true)}</div>\n`;
  const link = md.renderer.rules.link_open || ((tokens, index, options, env, renderer) => renderer.renderToken(tokens, index, options));
  md.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
    tokens[index].attrSet('target', '_blank');
    tokens[index].attrSet('rel', 'noopener noreferrer');
    return link(tokens, index, options, env, renderer);
  };
  // Images in generated answers are links, so rendering never loads remote images automatically.
  md.renderer.rules.image = (tokens, index) => {
    const token = tokens[index], href = token.attrGet('src') || '', label = escape(token.content || '图片');
    return /^https?:\/\//i.test(href) ? `<a href="${escape(href)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label;
  };
  md.renderer.rules.table_open = () => '<div class="pr-table-scroll" role="region" aria-label="表格，可横向滚动" tabindex="0"><table>\n';
  md.renderer.rules.table_close = () => '</table></div>\n';
  const fence = md.renderer.rules.fence;
  md.renderer.rules.fence = (...args) => fence(...args).replace('<pre>', '<pre class="pr-pre">');
  md.renderer.rules.code_block = (tokens, index) => `<pre class="pr-pre"><code>${escape(tokens[index].content)}</code></pre>\n`;
  md.renderer.rules.code_inline = (tokens, index) => `<code class="pr-code">${escape(tokens[index].content)}</code>`;
  globalThis.paperReadMarkdown = (source) => md.render(String(source || ''));
})();
