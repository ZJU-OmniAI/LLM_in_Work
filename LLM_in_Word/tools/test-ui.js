import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
const html = readFileSync(new URL('../taskpane/taskpane.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../taskpane/taskpane.js', import.meta.url), 'utf8');
const table = readFileSync(new URL('../taskpane/table-utils.js', import.meta.url), 'utf8');
const context = { ok: true, ids: [1], kinds: ['text'], valuesList: [null], targetTexts: ['原文'], fullText: '原文', docChars: 2 };
const answer = '```text\n新文本\n```';
function setup(responseEvents, { trailingNewline = true, hold = false, language = 'zh-CN' } = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://localhost:8377/taskpane.html', pretendToBeVisual: true });
  const w = dom.window, calls = [];
  if (language) w.localStorage.setItem('we:language', language);
  w.TextDecoder = TextDecoder; w.AbortController = AbortController;
  w.Office = { onReady() {} };
  let releaseContext;
  w.__context = hold ? new Promise(r => { releaseContext = r; }) : Promise.resolve({ ...context });
  w.fetch = async (url, options) => {
    if (url === '/api/chat') {
      calls.push(JSON.parse(options.body));
      const text = responseEvents.map(JSON.stringify).join('\n') + (trailingNewline ? '\n' : '');
      return new Response(text, { status: 200 });
    }
    if (url.startsWith('/api/health')) return { ok: true, json: async () => ({ backends: { claude: { label: '已登录', status: 'ready', path: '/mock', hint: 'ok' }, codex: { label: '已登录', status: 'ready', path: '/mock', hint: 'ok' } }, version: 'test', logPath: '/tmp/log' }) };
    if (url.startsWith('/api/models')) return { ok: true, json: async () => ({ claude: [['sonnet', 'Sonnet 5'], ['opus', 'Opus 4.8']], details: { claude: { sonnet: { resolvedModel: 'claude-sonnet-5' }, opus: { resolvedModel: 'claude-opus-4-8' } } }, codex: [['(default)', '默认']], fetchedAt: new Date().toISOString() }) };
    return { ok: true, json: async () => ({ ok: true }) };
  };
  w.eval(readFileSync(new URL('../taskpane/i18n.js', import.meta.url), 'utf8'));
  w.eval(table);
  w.eval(js.replace('  init();', `  init();
    getEditContext = () => window.__context;
    getWholeDoc = () => window.__context;
    window.ui = { state, sendInstruction, renderTargetBar, fillModelOptions, stopStream, contextKey, refreshModelList };
  `));
  w.ui.state.wordReady = true; w.ui.state.serverOk = true;
  w.ui.state.targets = [{ ccId: 1, text: '原文', kind: 'text' }];
  w.ui.renderTargetBar();
  return { w, calls, releaseContext, close: async () => { await new Promise(r => setImmediate(r)); dom.window.close(); }, input: w.document.querySelector('#input') };
}
const good = [{ type: 'delta', text: answer }, { type: 'cli_session', backend: 'claude', id: 'sid' }, { type: 'done', ok: true }];
test('successful stream without final newline creates an apply card', async () => {
  const t = setup(good, { trailingNewline: false });
  try { await t.w.ui.sendInstruction('润色'); assert.ok(t.w.document.querySelector('.apply')); assert.equal(t.w.ui.state.streaming, false); } finally { await t.close(); }
});
for (const [name, events] of [['EOF before done', [{ type: 'delta', text: answer }]], ['error after body', [{ type: 'delta', text: answer }, { type: 'error', error: '失败' }, { type: 'done', ok: false }]]]) {
  test(`${name}: partial fenced output cannot be applied and can be retried`, async () => {
    const t = setup(events);
    try { await t.w.ui.sendInstruction('润色'); assert.equal(t.w.document.querySelector('.apply'), null); assert.ok(t.w.document.querySelector('.warnbox')); assert.equal(t.w.ui.state.cliSession.claude, null); assert.equal(t.w.ui.state.messages.at(-1).failed, true); } finally { await t.close(); }
  });
}
test('missing target or Office preserves the input draft', async () => {
  const t = setup(good);
  try { t.input.value = '不要丢掉我的指令'; t.w.ui.state.wordReady = false; t.w.document.querySelector('#btn-send').click(); assert.equal(t.input.value, '不要丢掉我的指令'); assert.equal(t.calls.length, 0); t.w.ui.state.wordReady = true; t.w.ui.state.targets = []; t.w.document.querySelector('#btn-send').click(); assert.equal(t.input.value, '不要丢掉我的指令'); } finally { await t.close(); }
});
test('composition Enter does not send Chinese input', async () => {
  const t = setup(good);
  try { t.input.value = '中文输入'; t.input.dispatchEvent(new t.w.KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })); assert.equal(t.calls.length, 0); assert.equal(t.input.value, '中文输入'); } finally { await t.close(); }
});
test('context acquisition is locked against double send and cancel prevents generation', async () => {
  const t = setup(good, { hold: true });
  try {
    const first = t.w.ui.sendInstruction('润色');
    await t.w.ui.sendInstruction('重复'); assert.equal(t.w.ui.state.streaming, true);
    t.w.ui.stopStream(); t.releaseContext({ ...context }); await first;
    assert.equal(t.calls.length, 0); assert.equal(t.w.ui.state.streaming, false);
  } finally { await t.close(); }
});
test('same context resumes; changed document rebuilds with full context', async () => {
  const t = setup(good);
  try {
    await t.w.ui.sendInstruction('第一次'); await t.w.ui.sendInstruction('再精简');
    assert.equal(t.calls[1].cliSession.claude, 'sid');
    t.w.__context = Promise.resolve({ ...context, fullText: '正文发生了变化' });
    await t.w.ui.sendInstruction('继续'); assert.equal(t.calls[2].cliSession.claude, null); assert.equal(t.calls[2].doc.fullText, '正文发生了变化');
  } finally { await t.close(); }
});
test('Codex effort options omit unsupported max and settings preserve saved model', async () => {
  const t = setup(good);
  try { t.w.ui.state.cfg.backend = 'codex'; t.w.ui.state.cfg.model_codex = 'my-model'; t.w.ui.fillModelOptions(); assert.equal(t.w.document.querySelector('#sel-model').value, 'my-model'); assert.equal(t.w.document.querySelector('#sel-effort option[value="max"]'), null); } finally { await t.close(); }
});
test('new draft persists while request is generating', async () => {
  const t = setup(good, { hold: true });
  try { t.input.value = '发送的内容'; const req = t.w.ui.sendInstruction('发送的内容'); t.input.value = '下一轮草稿'; t.input.dispatchEvent(new t.w.Event('input')); t.releaseContext({ ...context }); await req; assert.equal(t.input.value, '下一轮草稿'); assert.equal(t.w.localStorage.getItem('we:draft:untitled'), '下一轮草稿'); } finally { await t.close(); }
});

test('catalog versions keep aliases in requests; actual response model is shown separately', async () => {
  const t = setup([{ type: 'model', model: 'claude-sonnet-5-1' }, ...good]);
  try {
    await t.w.ui.refreshModelList(true);
    assert.equal(t.w.document.querySelector('#sel-model option[value="opus"]').textContent, 'Opus 4.8');
    assert.match(t.w.document.querySelector('#model-detail').textContent, /CLI 当前解析：claude-sonnet-5/);
    await t.w.ui.sendInstruction('润色');
    assert.equal(t.calls[0].model, 'sonnet');
    assert.match(t.w.document.querySelector('#model-detail').textContent, /最近调用实际模型：claude-sonnet-5-1/);
    assert.match(t.w.document.querySelector('.foot').textContent, /claude-sonnet-5-1/);
    t.w.ui.state.cfg.model_claude = 'opus'; t.w.ui.fillModelOptions();
    assert.match(t.w.document.querySelector('#model-detail').textContent, /CLI 当前解析：claude-opus-4-8/);
    t.w.ui.state.cfg.backend = 'codex'; t.w.ui.fillModelOptions();
    assert.doesNotMatch(t.w.document.querySelector('#model-detail').textContent, /claude-/);
  } finally { await t.close(); }
});

test('English UI covers static labels, dynamic previews, model details, and presets', async () => {
  const t = setup(good, { language: 'en' });
  try {
    const d = t.w.document;
    assert.equal(d.documentElement.lang, 'en');
    assert.equal(d.querySelector('#mode-ask').textContent, 'Document Q&A');
    assert.equal(d.querySelector('#btn-capture').textContent.trim(), '＋Add Word selection');
    assert.equal(d.querySelector('#btn-hist').getAttribute('aria-label'), 'Chat history');
    assert.match(d.querySelector('#input').placeholder, /Shorten this/);
    d.querySelector('#presets .chip').click();
    assert.match(t.input.value, /Polish this text/);
    await t.w.ui.refreshModelList(true);
    assert.match(d.querySelector('#model-detail').textContent, /CLI resolves to:/);
    await t.w.ui.sendInstruction('中文原始指令');
    assert.equal(t.calls[0].messages[0].content, '中文原始指令');
    assert.equal(t.w.ui.state.messages.at(-1).content, answer);
    assert.equal(d.querySelector('.apply').textContent, '✅ Apply');
    assert.equal(d.querySelector('.tab[data-tab="new"]').textContent, 'New text');
    assert.match(d.querySelector('.newview').textContent, /新文本/);
  } finally { await t.close(); }
});
test('live language switching preserves draft, attachments, targets, response text, and preview actions', async () => {
  const t = setup(good);
  try {
    await t.w.ui.sendInstruction('原始内容');
    t.input.value = '未发送的草稿';
    const attachment = { id:'a', name:'中文附件.txt', kind:'text', text:'保留内容', size:12 };
    t.w.ui.state.attachments.push(attachment);
    const before = t.w.ui.state.messages.at(-1).content;
    const apply = t.w.document.querySelector('.apply');
    const select = t.w.document.querySelector('#sel-language');
    select.value = 'en'; select.dispatchEvent(new t.w.Event('change'));
    assert.equal(t.w.localStorage.getItem('we:language'), 'en');
    assert.equal(t.input.value, '未发送的草稿');
    assert.equal(t.w.ui.state.attachments[0], attachment);
    assert.equal(t.w.ui.state.targets.length, 1);
    assert.equal(t.w.ui.state.messages.at(-1).content, before);
    assert.equal(t.w.document.querySelector('.apply'), apply);
    assert.equal(apply.textContent, '✅ Apply');
    assert.equal(t.w.document.querySelector('.card-title').textContent, 'Replacement preview');
    select.value = 'zh-CN'; select.dispatchEvent(new t.w.Event('change'));
    assert.equal(t.w.document.documentElement.lang, 'zh-CN');
    assert.equal(apply.textContent, '✅ 应用');
    assert.equal(t.input.value, '未发送的草稿');
  } finally { await t.close(); }
});
test('English backend messages translate without changing unknown diagnostic details', async () => {
  const t = setup([{ type:'error', error:'请求超时：模型超过时限仍未完成，请降低思考强度或缩小目标范围。', hint:'请检查网络和代理；代理端口变化后运行 npm run update。' }, { type:'done', ok:false }], { language:'en' });
  try {
    const i = t.w.WordI18n;
    assert.equal(i.known('已登录'), 'Signed in');
    assert.equal(i.known('请在终端运行 codex login。'), 'Run codex login in your terminal.');
    assert.equal(i.known('默认 · gpt-example'), 'Default · gpt-example');
    assert.equal(i.known('unchanged diagnostic /tmp/中文.txt'), 'unchanged diagnostic /tmp/中文.txt');
    await t.w.ui.sendInstruction('Test');
    assert.match(t.w.ui.state.messages.at(-1).content, /Request timed out/);
    assert.match(t.w.document.querySelector('.warnbox').textContent, /did not complete/);
  } finally { await t.close(); }
});
test('language cannot change mid-generation', async () => {
  const t = setup(good, { hold:true });
  try {
    const request = t.w.ui.sendInstruction('测试');
    const select = t.w.document.querySelector('#sel-language');
    assert.equal(select.disabled, true);
    select.value = 'en'; select.dispatchEvent(new t.w.Event('change'));
    assert.equal(t.w.WordI18n.language, 'zh-CN');
    t.releaseContext({ ...context }); await request;
    assert.equal(select.disabled, false);
  } finally { await t.close(); }
});
test('locale preference overrides Office language; catalog placeholders stay intact', async () => {
  for (const [saved, office, expected] of [[null,'en-US','en'],[null,'zh-TW','zh-CN'],['en','zh-CN','en'],['zh-CN','en-US','zh-CN']]) {
    const dom = new JSDOM('', {runScripts:'outside-only', url:'https://localhost:8377'});
    try {
      if (saved) dom.window.localStorage.setItem('we:language', saved);
      dom.window.Office = {context:{displayLanguage:office}};
      dom.window.eval(readFileSync(new URL('../taskpane/i18n.js', import.meta.url), 'utf8'));
      const i = dom.window.WordI18n;
      assert.equal(i.language, expected);
      for (const [zh,en] of Object.entries(i.catalog)) {
        assert.deepEqual((zh.match(/\{\d+\}/g)||[]).sort(), (en.match(/\{\d+\}/g)||[]).sort(), zh);
      }
    } finally { dom.window.close(); }
  }
});
