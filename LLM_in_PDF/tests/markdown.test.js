import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import katex from 'katex';
const context = vm.createContext({ katex, atob });
vm.runInContext(readFileSync('extension/vendor/markdown-it/markdown-it.min.js', 'utf8'), context);
vm.runInContext(readFileSync('extension/content/markdown.js', 'utf8'), context);
const render = context.paperReadMarkdown;

test('Markdown tables support alignment, formatting, escaped pipes and inline math', () => {
  const html = render('| Model | Score | Cost |\n| :--- | ---: | :---: |\n| **A** | 42 | $x^2$ |\n| `B` | 35 | a\\|b |');
  assert.match(html, /pr-table-scroll/);
  assert.match(html, /<thead>/);
  assert.match(html, /text-align:right/);
  assert.match(html, /<strong>A<\/strong>/);
  assert.match(html, /class="pr-code">B/);
  assert.match(html, /class="katex"/);
  assert.match(html, /a\|b/);
  assert.equal((html.match(/<td/g) || []).length, 6);
});

test('Markdown renders nested lists, headings, blockquotes, strikethrough and fenced code', () => {
  const html = render('## Results\n\n1. First\n   - Nested\n2. Second\n\n> **Quoted**\n\n~~old~~\n\n```js\nconst value = "$x$ **plain** <script>";\n```');
  assert.match(html, /<h2>Results<\/h2>/);
  assert.match(html, /<ol>[\s\S]*<ul>/);
  assert.match(html, /<blockquote>/);
  assert.match(html, /<s>old<\/s>/);
  assert.match(html, /<pre class="pr-pre"><code class="language-js">/);
  assert.match(html, /\$x\$ \*\*plain\*\* &lt;script&gt;/);
  assert.doesNotMatch(html, /class="katex"/);
});

test('math stays out of code and supports all existing delimiters', () => {
  for (const source of ['$x^2$', '\\(x^2\\)', '$$\nx^2\n$$', '\\[\nx^2\n\\]']) assert.match(render(source), /class="katex/);
  const html = render('`$x$` and `\\(y\\)` and `$<tag>$`');
  assert.doesNotMatch(html, /class="katex/);
  assert.match(html, /&lt;tag&gt;/);
  assert.doesNotThrow(() => render('| A | B |\n| --- | --- |\n| $unfinished'));
});

test('untrusted Markdown cannot create active HTML or dangerous links', () => {
  const html = render('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[bad](javascript:alert(1))\n\n[good](https://example.com)\n\n![remote](https://example.com/image.png)');
  assert.doesNotMatch(html, /<script|<img|href="javascript:/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /target="_blank"/);
});

test('chart blocks render escaped SVG bar and line charts', () => {
  const spec = { type: 'bar', title: 'UniVTAC <mean>', labels: ['π0.5', 'N0-VTLA', 'PhysWord'], datasets: [{ label: 'SR', data: [49.6, 83.1, 90.3] }], yAxisTitle: '%' };
  const html = render('```chart\n' + JSON.stringify(spec) + '\n```');
  assert.match(html, /<figure class="pr-chart"><svg /);
  assert.equal((html.match(/<rect /g) || []).length, 3);
  assert.match(html, /UniVTAC &lt;mean&gt;/);
  assert.match(html, />90\.3</);
  assert.doesNotMatch(html, /pr-pre/);
  const grouped = render('```chart\n{"labels":["A","B"],"datasets":[{"label":"x","points":[1,2]},{"label":"y","data":[3,null]}]}\n```');
  assert.equal((grouped.match(/<rect x="\d/g) || []).length, 2 + 3); // two legend swatches + three bars
  const line = render('```chart\n{"type":"line","labels":["1","2","4"],"datasets":[{"label":"s","data":[91,93,92]}]}\n```');
  assert.match(line, /<path d="M[\d.,]+L[\d.,]+L[\d.,]+"/);
  assert.equal((line.match(/<circle /g) || []).length, 3);
});

test('invalid or unfinished chart JSON stays a code block', () => {
  for (const body of ['{"labels":["A"],"datasets":[{"data":[', '{"labels":[],"datasets":[]}', '{"labels":["A"],"datasets":[{"data":["x"]}]}', '<svg onload=alert(1)>']) {
    const html = render('```chart\n' + body + '\n```');
    assert.match(html, /<pre class="pr-pre">/);
    assert.doesNotMatch(html, /<svg/);
  }
});

test('mermaid blocks keep their source as code and are drawn only once closed', () => {
  const source = 'flowchart LR\n  A[输入] --> B["<b>x</b>"]';
  const done = render('```mermaid\n' + source + '\n```\n\n后文');
  assert.match(done, /<div class="pr-mermaid" data-source="flowchart LR\n  A\[输入\] --&gt; B\[&quot;&lt;b&gt;x&lt;\/b&gt;&quot;\]\n" data-ready="1">/);
  assert.match(done, /<pre class="pr-pre"><code class="language-mermaid">/);
  assert.doesNotMatch(render('```mermaid\n' + source), /data-ready/);
  assert.match(render('```mermaid\n' + source + '\n```'), /data-ready="1"/);
});
