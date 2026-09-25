// Capture the real extension UI against a disposable CodeMirror demo document.
// Uses the real native host and Claude CLI; this command consumes model quota.
// No Overleaf account, personal document or browser profile is accessed.
const { chromium } = require('playwright-core');
const { build } = require('esbuild');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const project = path.resolve(__dirname, '..');
const output = path.join(project, 'docs/images');
const original = 'Large language models has become useful tools for academic writing. However, their output often contain grammatical errors and redundant expressions. We evaluate a simple review workflow that help authors inspect each change before applying it.';
const source = [
  '\\documentclass{article}', '\\usepackage{amsmath}', '',
  '\\title{Human Review in AI-Assisted Writing}', '\\author{Demo Author}', '',
  '\\begin{document}', '\\maketitle', '', '\\section{Introduction}', original, '',
  '\\section{Method}', 'The author selects a passage, reviews the proposed changes, and applies the accepted revision.', '',
  '\\begin{equation}', '  y = f(x)', '\\end{equation}', '', '\\end{document}',
].join('\n');

function nativeRequest(message, onEvent = () => {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(project, 'server/native-host.js')], { stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = Buffer.alloc(0);
    let finished = false;
    let delivery = Promise.resolve();
    const events = [];
    const finish = (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      child.stdin.end();
      if (error) { child.kill(); reject(error); }
      else delivery.then(() => resolve(events), reject);
    };
    const timer = setTimeout(() => finish(new Error('Native host timed out')), 180000);
    child.on('error', finish);
    child.on('exit', (code) => { if (!finished) finish(new Error(`Native host exited early: ${code}`)); });
    child.stderr.on('data', () => {});
    child.stdout.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32LE(0)) {
        const size = buffer.readUInt32LE(0);
        const event = JSON.parse(buffer.subarray(4, 4 + size));
        buffer = buffer.subarray(4 + size);
        events.push(event);
        delivery = delivery.then(() => onEvent(event));
        if (event.type === 'done' || event.type === 'pong') finish();
      }
    });
    const body = Buffer.from(JSON.stringify(message));
    const header = Buffer.alloc(4); header.writeUInt32LE(body.length);
    child.stdin.write(Buffer.concat([header, body]));
  });
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const fixture = await build({ entryPoints: [path.join(__dirname, 'fixtures/editor.js')], bundle: true, write: false });
  const healthEvents = await nativeRequest({ type: 'ping', backend: 'claude' });
  const health = healthEvents.find((event) => event.type === 'pong');
  assert.equal(health?.ok, true, health?.error || healthEvents.find((event) => event.type === 'error')?.error || 'The real Claude CLI must be ready for this capture.');
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    page.setDefaultTimeout(10000);
    const browserErrors = [];
    const generationErrors = [];
    const generated = [];
    page.on('pageerror', (error) => browserErrors.push(String(error)));
    await page.route('https://llm-in-overleaf.demo/**', (route) => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en"><head><meta charset="UTF-8"><title>Demo paper · LLM_in_Overleaf</title><style>
      *{box-sizing:border-box}body{margin:0;background:#f3f5f2;color:#263e34;font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}header{height:70px;padding:0 26px;background:#173f35;color:#fff;display:flex;align-items:center;justify-content:space-between}.identity{font-weight:650;font-size:18px}.identity small{display:block;font-size:11px;font-weight:400;letter-spacing:1px;color:#b6cdc3}.badge{font-size:11px;border:1px solid #74998b;border-radius:5px;padding:4px 8px}main{display:flex;min-height:830px}aside{width:176px;flex-shrink:0;padding:24px 14px;border-right:1px solid #dce3dc}.label{font-size:10px;letter-spacing:1.5px;color:#728178;margin:0 10px 18px}.file{padding:10px;background:#e2ece6;border-radius:6px;color:#245747;font:13px Menlo,monospace}article{flex:1;min-width:0;padding:24px}.editor-file-tab{padding:12px 18px;background:white;border:1px solid #dae3db;border-radius:9px 9px 0 0;display:flex;justify-content:space-between;font:12px Menlo,monospace}.editor-file-tab small{font:11px -apple-system,sans-serif;color:#76867b}#editor{background:white;border:1px solid #dae3db;border-top:0;border-radius:0 0 9px 9px;overflow:hidden;min-height:610px}.cm-editor{font:14px/1.9 Menlo,Consolas,monospace;min-height:610px}.cm-content{padding:20px}.cm-focused{outline:none!important}.cm-selectionBackground{background:#cce5d8!important}.note{font-size:11px;color:#738479;margin-top:14px;display:flex;gap:18px}
    </style></head><body><header><div class="identity">LLM_in_Overleaf<small>DEMO WORKSPACE · REAL EXTENSION UI</small></div><span class="badge">Code Editor</span></header><main><aside><div class="label">DEMO PAPER</div><div class="file">main.tex</div></aside><article><div class="editor-file-tab tab-selected"><span class="editor-file-tab-path">main.tex</span><small>LaTeX source</small></div><div id="editor"></div><div class="note"><span>Sample text written for this demonstration</span><span>Local CodeMirror editor</span></div></article></main></body></html>` }));
    await page.exposeFunction('demoHealth', () => health);
    await page.exposeFunction('demoGenerate', async (payload) => {
      try {
        const events = await nativeRequest({ type: 'chat_start', reqId: 'documentation', payload }, async (event) => {
          await page.evaluate((value) => window.deliverNativeEvent(value), event);
        });
        generated.push(...events);
        generationErrors.push(...events.filter((event) => event.type === 'error').map((event) => event.error));
      } catch (error) { generationErrors.push(String(error)); }
    });
    await page.goto('https://llm-in-overleaf.demo/project/documentation');
    await page.evaluate(() => {
      const saved = { backend: 'claude', model_claude: 'sonnet', effort: 'low', width: 460, layout: 'push' };
      window.chrome = {
        storage: { local: { get: async () => saved, set: async () => {}, remove: async () => {} }, onChanged: { addListener() {} } },
        runtime: {
          sendMessage: (message) => message.type === 'health' ? window.demoHealth() : Promise.resolve({}),
          onMessage: { addListener() {} },
          connect: () => {
            const listeners = [];
            window.deliverNativeEvent = (event) => listeners.forEach((listener) => listener(event));
            return { onMessage: { addListener: (listener) => listeners.push(listener) }, onDisconnect: { addListener() {} }, disconnect() {}, postMessage: (message) => window.demoGenerate(message.payload) };
          },
        },
      };
    });
    await page.addScriptTag({ content: fixture.outputFiles[0].text });
    await page.evaluate((text) => resetEditor(text), source);
    await page.addScriptTag({ path: path.join(project, 'extension/content/bridge.js') });
    await page.addScriptTag({ path: path.join(project, 'extension/content/content.js') });
    await page.evaluate(({ text, target }) => {
      const from = text.indexOf(target);
      editor.focus(); editor.dispatch({ selection: { anchor: from, head: from + target.length } });
    }, { text: source, target: original });
    await page.locator('#ole-launcher').click();
    await page.waitForFunction(() => document.querySelector('#llm-in-overleaf-host').shadowRoot.querySelector('#ole-status-text').textContent.includes('Claude 就绪'));
    await page.locator('#ole-input').fill('修正这段英文的语法，精简重复表达，保留原意。用一句中文说明修改。');
    await page.evaluate(({ text, target }) => {
      const from = text.indexOf(target);
      editor.focus(); editor.dispatch({ selection: { anchor: from, head: from + target.length } });
    }, { text: source, target: original });
    await page.waitForFunction(() => [...document.querySelectorAll('.cm-selectionBackground')].some((element) => element.getBoundingClientRect().width > 0));
    await page.screenshot({ path: path.join(output, 'overleaf-selection.png') });
    if (process.argv.includes('--selection-only')) { console.log('Captured selection only; no model request.'); return; }
    console.log('Captured selection; requesting a real Claude rewrite.');
    await page.locator('#ole-send').click();
    await page.locator('.ole-apply').first().waitFor({ timeout: 180000 });
    assert.deepEqual(generationErrors, []);
    await page.waitForFunction(() => document.querySelector('#llm-in-overleaf-host').shadowRoot.querySelector('#ole-panel').getAttribute('aria-busy') === 'false');
    await page.screenshot({ path: path.join(output, 'overleaf-diff.png') });
    await page.locator('.ole-apply').first().click();
    await page.waitForFunction((before) => editor.state.doc.toString() !== before, source);
    await page.locator('.ole-card-status').first().filter({ hasText: '已应用' }).waitFor();
    await page.screenshot({ path: path.join(output, 'overleaf-applied.png') });
    const revised = await page.evaluate(() => editor.state.doc.toString());
    assert.ok(revised.includes('y = f(x)'), 'Unselected equation must be unchanged.');
    assert.ok(revised.includes('\\section{Method}'), 'Unselected section must be unchanged.');
    assert.deepEqual(browserErrors, []);
    const model = generated.find((event) => event.type === 'model')?.model || 'sonnet';
    fs.writeFileSync(path.join(output, 'README.md'), `# Screenshot notes / 截图说明\n\nCaptured on ${new Date().toISOString().slice(0, 10)} using the actual LLM_in_Overleaf extension UI and a real CodeMirror editor in a local demo page. The source text is synthetic. The screenshots are not from the hosted Overleaf website.\n\n截图来自本地演示页面中的真实 LLM_in_Overleaf 扩展界面和 CodeMirror 编辑器，使用专门编写的演示文稿；并非 Overleaf 官网实机截图。\n\nThe rewrite was generated by the real local Claude Code CLI (${model}, low effort), through the project's native host. The harness forwards browser messages to that host; it does not exercise Chrome's installed Native Messaging registration. The applied state was captured after the extension wrote the result back into CodeMirror. No personal document, account page or credential appears in the images.\n\n改写由真实 Claude Code CLI（${model}，low）经本项目的本机桥生成。拍摄脚本转发浏览器消息，未覆盖 Chrome 已安装的 Native Messaging 注册链路。应用截图拍摄于扩展实际写回 CodeMirror 之后。\n\n- **overleaf-selection.png** — select source text and enter an instruction / 选中源码并输入要求。\n- **overleaf-diff.png** — review the generated diff before applying / 应用前查看真实模型改写差异。\n- **overleaf-applied.png** — inspect the edited source and success state / 查看写回后的源码和成功提示。\n\nReproduce from this subproject with \`npm ci\` and \`node tools/capture-docs.cjs\`. Requires a signed-in Claude Code CLI and Chrome; makes one real model request and consumes quota. Set \`CHROME_BIN\` for a custom Chrome path.\n`);
    console.log('Captured selection, real-model diff and applied edit.');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
