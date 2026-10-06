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
