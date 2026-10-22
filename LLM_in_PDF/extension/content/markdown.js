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
  // ```chart 代码块：回答里给出 JSON 数据，这里直接画成 SVG。只读数字和文字，所有文字都转义。
  const PALETTE = ['#4f46e5', '#0d9488', '#d97706', '#db2777', '#2563eb', '#65a30d'];
  const textWidth = (text, size) => [...String(text)].reduce((width, ch) => width + (/[\u2e80-\uffff]/.test(ch) ? size : size * 0.58), 0);
  const formatNumber = (value) => String(Math.round(value * 100) / 100);
  function clip(text, size, max) {
    let out = String(text);
    if (textWidth(out, size) <= max) return out;
    while (out && textWidth(out + '…', size) > max) out = [...out].slice(0, -1).join('');
    return out + '…';
  }
  function svgText(x, y, text, { anchor = 'start', size = 12, weight = 400, opacity = 1, full = '' } = {}) {
    const title = full && full !== text ? `<title>${escape(full)}</title>` : '';
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" font-size="${size}" font-weight="${weight}" fill="currentColor"${opacity < 1 ? ` fill-opacity="${opacity}"` : ''}>${title}${escape(text)}</text>`;
  }
  function chartSpec(source) {
    let spec;
    try { spec = JSON.parse(source); } catch { return null; }
    if (!spec || typeof spec !== 'object') return null;
    const labels = Array.isArray(spec.labels) ? spec.labels.slice(0, 40).map(String) : [];
    const sets = Array.isArray(spec.datasets) ? spec.datasets.slice(0, 6) : [];
    if (!labels.length || !sets.length) return null;
    const datasets = sets.map((set, i) => {
      const data = Array.isArray(set?.data) ? set.data : Array.isArray(set?.points) ? set.points : [];
      return {
        label: String(set?.label ?? `系列 ${i + 1}`),
        values: labels.map((_, j) => (data[j] === null || data[j] === undefined || data[j] === '' ? null : Number(data[j]))),
      };
    });
    const values = datasets.flatMap((set) => set.values).filter((value) => value !== null);
    if (!values.length || values.some((value) => !Number.isFinite(value))) return null;
    return {
      type: spec.type === 'line' ? 'line' : 'bar',
      title: spec.title ? String(spec.title) : '',
      valueTitle: String(spec.yAxisTitle ?? spec.valueAxisTitle ?? ''),
      labels, datasets, values,
    };
  }
  function scale(values) {
    let min = Math.min(0, ...values), max = Math.max(0, ...values);
    if (max === min) max = min + 1;
    const raw = (max - min) / 4, power = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw);
    min = Math.floor(min / step) * step; max = Math.ceil(max / step) * step;
    const ticks = [];
    for (let t = min; t <= max + step / 2; t += step) ticks.push(Math.round(t / step) * step);
    return { min, max, ticks };
  }
  function legend(chart, y, width) {
    if (chart.datasets.length < 2) return { svg: '', height: 0 };
    let x = 0, row = 0, svg = '';
    for (const [i, set] of chart.datasets.entries()) {
      const label = clip(set.label, 11, 160), w = 18 + textWidth(label, 11) + 14;
      if (x && x + w > width) { x = 0; row++; }
      svg += `<rect x="${x}" y="${y + row * 18}" width="10" height="10" rx="2" fill="${PALETTE[i]}"/>` + svgText(x + 14, y + row * 18 + 9, label, { size: 11, full: set.label });
      x += w;
    }
    return { svg, height: (row + 1) * 18 + 4 };
  }
  // 横向分组柱状图：方法名在左边，侧栏很窄时也放得下长名字。
  function barChart(chart) {
    const W = 560, size = 12, barH = 14, gap = 10, n = chart.datasets.length;
    const labelW = Math.min(190, Math.max(...chart.labels.map((label) => textWidth(label, size))));
    const left = labelW + 14, right = 44, plotW = W - left - right;
    const { min, max, ticks } = scale(chart.values);
    const x = (value) => left + ((value - min) / (max - min)) * plotW;
    let y = 4, svg = '';
    if (chart.title) { svg += svgText(W / 2, y + 13, clip(chart.title, 13, W), { anchor: 'middle', size: 13, weight: 600, full: chart.title }); y += 24; }
    const key = legend(chart, y, W); svg += key.svg; y += key.height;
    const top = y, groupH = n * barH + gap, plotH = chart.labels.length * groupH;
    for (const t of ticks) {
      svg += `<line x1="${x(t).toFixed(1)}" x2="${x(t).toFixed(1)}" y1="${top}" y2="${top + plotH}" stroke="currentColor" stroke-opacity="${t === 0 ? 0.45 : 0.12}"/>`;
      svg += svgText(x(t), top + plotH + 14, formatNumber(t), { anchor: 'middle', size: 10.5, opacity: 0.7 });
    }
    for (const [j, label] of chart.labels.entries()) {
      const groupTop = top + j * groupH + gap / 2;
      svg += svgText(left - 8, groupTop + (n * barH) / 2 + 4, clip(label, size, labelW), { anchor: 'end', size, full: label });
      for (const [i, set] of chart.datasets.entries()) {
        const value = set.values[j];
        if (value === null) continue;
        const x0 = x(Math.min(0, value)), x1 = x(Math.max(0, value)), barY = groupTop + i * barH;
        svg += `<rect x="${x0.toFixed(1)}" y="${barY + 1}" width="${Math.max(1, x1 - x0).toFixed(1)}" height="${barH - 2}" rx="2" fill="${PALETTE[i]}"><title>${escape(`${set.label}：${formatNumber(value)}`)}</title></rect>`;
        svg += svgText(value < 0 ? x0 - 4 : x1 + 4, barY + barH - 3, formatNumber(value), { anchor: value < 0 ? 'end' : 'start', size: 10.5 });
      }
    }
    let height = top + plotH + 20;
    if (chart.valueTitle) { svg += svgText(left + plotW / 2, height + 8, clip(chart.valueTitle, 11, plotW), { anchor: 'middle', size: 11, opacity: 0.75 }); height += 16; }
    return { svg, width: W, height: height + 4 };
  }
  function lineChart(chart) {
    const W = 560, plotH = 220, left = 48, right = 16;
    const rotate = chart.labels.some((label) => textWidth(label, 11) > (W - left - right) / chart.labels.length - 6);
    const { min, max, ticks } = scale(chart.values);
    let y = 4, svg = '';
    if (chart.title) { svg += svgText(W / 2, y + 13, clip(chart.title, 13, W), { anchor: 'middle', size: 13, weight: 600, full: chart.title }); y += 24; }
    const key = legend(chart, y, W); svg += key.svg; y += key.height;
    const top = y + 6, plotW = W - left - right;
    const px = (j) => left + (chart.labels.length === 1 ? plotW / 2 : (j / (chart.labels.length - 1)) * plotW);
    const py = (value) => top + plotH - ((value - min) / (max - min)) * plotH;
    for (const t of ticks) {
      svg += `<line x1="${left}" x2="${W - right}" y1="${py(t).toFixed(1)}" y2="${py(t).toFixed(1)}" stroke="currentColor" stroke-opacity="${t === 0 ? 0.45 : 0.12}"/>`;
      svg += svgText(left - 6, py(t) + 4, formatNumber(t), { anchor: 'end', size: 10.5, opacity: 0.7 });
    }
    for (const [j, label] of chart.labels.entries()) {
      const text = clip(label, 11, rotate ? 110 : plotW / chart.labels.length - 4);
      svg += rotate
        ? `<g transform="translate(${px(j).toFixed(1)} ${top + plotH + 12}) rotate(-35)">${svgText(0, 0, text, { anchor: 'end', size: 11, full: label })}</g>`
        : svgText(px(j), top + plotH + 16, text, { anchor: 'middle', size: 11, full: label });
    }
    for (const [i, set] of chart.datasets.entries()) {
      const points = set.values.map((value, j) => (value === null ? null : [px(j), py(value), value]));
      const path = points.reduce((d, p, j) => (p ? `${d}${d && points[j - 1] ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}` : d), '');
      svg += `<path d="${path}" fill="none" stroke="${PALETTE[i]}" stroke-width="2"/>`;
      for (const p of points) if (p) svg += `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3" fill="${PALETTE[i]}"><title>${escape(`${set.label}：${formatNumber(p[2])}`)}</title></circle>`;
    }
    let height = top + plotH + (rotate ? 76 : 24);
    if (chart.valueTitle) svg += `<g transform="translate(12 ${(top + plotH / 2).toFixed(1)}) rotate(-90)">${svgText(0, 0, clip(chart.valueTitle, 11, plotH), { anchor: 'middle', size: 11, opacity: 0.75 })}</g>`;
    return { svg, width: W, height };
  }
  function renderChart(source) {
    const chart = chartSpec(source);
    if (!chart) return '';
    const { svg, width, height } = chart.type === 'line' ? lineChart(chart) : barChart(chart);
    return `<figure class="pr-chart"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${Math.ceil(height)}" role="img" aria-label="${escape(chart.title || '图表')}">${svg}</svg></figure>\n`;
  }

  // 流式输出时，没写完的 ```mermaid 代码块先按代码显示，等结尾的 ``` 出现后才去画图。
  function closedFence(token, env) {
    if (!env?.lines || !token.map) return true;
    const last = env.lines[token.map[1] - 1] ?? '';
    return token.map[1] - 1 > token.map[0] && last.trim().startsWith(token.markup) && /^\s*(`{3,}|~{3,})\s*$/.test(last);
  }
  const fence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, index, options, env, self) => {
    const token = tokens[index], lang = token.info.trim().split(/\s+/)[0].toLowerCase();
    if (lang === 'chart') { const chart = renderChart(token.content); if (chart) return chart; }
    const html = fence(tokens, index, options, env, self).replace('<pre>', '<pre class="pr-pre">');
    if (lang !== 'mermaid') return html;
    return `<div class="pr-mermaid" data-source="${escape(token.content)}"${closedFence(token, env) ? ' data-ready="1"' : ''}>${html}</div>\n`;
  };
  md.renderer.rules.code_block = (tokens, index) => `<pre class="pr-pre"><code>${escape(tokens[index].content)}</code></pre>\n`;
  md.renderer.rules.code_inline = (tokens, index) => `<code class="pr-code">${escape(tokens[index].content)}</code>`;
  globalThis.paperReadMarkdown = (source) => {
    const text = String(source || '');
    return md.render(text, { lines: text.replace(/\r\n?/g, '\n').split('\n') });
  };

  // Mermaid 体积较大，只在回答里真有流程图时才从扩展内加载；同一段源码只画一次。
  // 画不出来（语法错误等）就保留原来的代码块。
  const diagrams = new Map();
  let mermaidReady = null, diagramId = 0;
  function loadMermaid() {
    mermaidReady ??= import(globalThis.chrome.runtime.getURL('vendor/mermaid/mermaid.esm.min.mjs')).then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false, securityLevel: 'strict', theme: 'neutral', suppressErrorRendering: true, htmlLabels: false,
        flowchart: { htmlLabels: false }, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
      });
      return mermaid;
    });
    return mermaidReady;
  }
  async function drawDiagram(source) {
    try {
      const mermaid = await loadMermaid();
      if (!(await mermaid.parse(source, { suppressErrors: true }))) return { error: true };
      const { svg } = await mermaid.render(`pr-mermaid-${++diagramId}`, source);
      return { svg };
    } catch (error) {
      console.warn('[LLM_in_PDF] 流程图渲染失败：', error);
      return { error: true };
    }
  }
  function place(box, result) {
    if (!result?.svg || !box.isConnected) return;
    box.innerHTML = result.svg;
    box.classList.add('pr-mermaid-done');
    // 宽图最多缩到 70%，再宽就横向滚动，保证字看得清。
    const svg = box.querySelector('svg'), natural = parseFloat(svg?.style.maxWidth) || svg?.viewBox?.baseVal?.width;
    if (svg && natural) {
      svg.style.maxWidth = 'none';
      svg.style.width = `${Math.min(natural, Math.max(box.clientWidth - 18, natural * 0.7))}px`;
    }
  }
  globalThis.paperReadDiagrams = (container) => {
    if (!container || !globalThis.chrome?.runtime?.getURL) return;
    for (const box of container.querySelectorAll('.pr-mermaid[data-ready]')) {
      const source = box.dataset.source;
      let result = diagrams.get(source);
      if (!result) {
        result = drawDiagram(source);
        diagrams.set(source, result);
        result.then((done) => diagrams.set(source, done));
      }
      if (result instanceof Promise) result.then((done) => place(box, done));
      else place(box, result);
    }
  };
})();
