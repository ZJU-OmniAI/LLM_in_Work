// Pane behaviour that does not depend on slide contents: streaming robustness, sessions,
// settings card, model details and the English interface. Slide logic is in test-deck.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { loadPane, tick } from './pane-harness.js';

const target = { id: 't1', slideId: '257#0', shapeId: '2', kind: 'text', start: 0, length: 2, text: '原文', whole: true, role: 'title', slideNo: 2, ord: 0 };
const context = () => ({ ok: true, targets: [{ ...target }], lost: 0, fullText: '【第 2 页】\n[标题] 【选中段开始】\n原文\n【选中段结束】', truncated: false, docChars: 2, slideCount: 3 });
const answer = '```text\n新文本\n```';
const good = [{ type: 'delta', text: answer }, { type: 'cli_session', backend: 'claude', id: 'sid' }, { type: 'done', ok: true }];

async function setup(events, { hold = false, language = 'zh-CN', trailingNewline = true } = {}) {
  const t = await loadPane({ events: trailingNewline ? events : () => events, language, mockContext: true });
  if (!trailingNewline) {
    t.w.fetch = ((orig) => async (u, o) => {
      if (u !== '/api/chat') return orig(u, o);
      t.calls.push(JSON.parse(o.body));
      return new Response(events.map(JSON.stringify).join('\n'), { status: 200 });
    })(t.w.fetch);
  }
  let release;
  t.w.__context = hold ? new Promise((r) => { release = r; }) : Promise.resolve(context());
  t.release = (v) => release(v);
  t.lp.state.targets = [{ ...target }];
  t.lp.renderTargetBar();
  return t;
}

test('successful stream without final newline creates an apply card', async () => {
  const t = await setup(good, { trailingNewline: false });
  try { await t.lp.sendInstruction('润色'); assert.ok(t.d.querySelector('.apply')); assert.equal(t.lp.state.streaming, false); } finally { await t.close(); }
});
for (const [name, events] of [['EOF before done', [{ type: 'delta', text: answer }]], ['error after body', [{ type: 'delta', text: answer }, { type: 'error', error: '失败' }, { type: 'done', ok: false }]]]) {
  test(`${name}: partial fenced output cannot be applied and can be retried`, async () => {
    const t = await setup(events);
    try {
      await t.lp.sendInstruction('润色');
      assert.equal(t.d.querySelector('.apply'), null);
      assert.ok(t.d.querySelector('.warnbox'));
      assert.equal(t.lp.state.cliSession.claude, null);
      assert.equal(t.lp.state.messages.at(-1).failed, true);
    } finally { await t.close(); }
  });
}
test('missing target or PowerPoint preserves the input draft', async () => {
  const t = await setup(good);
  try {
    t.input.value = '不要丢掉我的指令';
    t.lp.state.pptReady = false; t.d.querySelector('#btn-send').click();
    assert.equal(t.input.value, '不要丢掉我的指令'); assert.equal(t.calls.length, 0);
    t.lp.state.pptReady = true; t.lp.state.targets = []; t.d.querySelector('#btn-send').click();
    assert.equal(t.input.value, '不要丢掉我的指令'); assert.equal(t.calls.length, 0);
  } finally { await t.close(); }
});
test('composition Enter does not send Chinese input', async () => {
  const t = await setup(good);
  try {
    t.input.value = '中文输入';
    t.input.dispatchEvent(new t.w.KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }));
    assert.equal(t.calls.length, 0); assert.equal(t.input.value, '中文输入');
  } finally { await t.close(); }
});
test('reading slides is locked against double send and cancel prevents generation', async () => {
  const t = await setup(good, { hold: true });
  try {
    const first = t.lp.sendInstruction('润色');
    await t.lp.sendInstruction('重复'); assert.equal(t.lp.state.streaming, true);
    t.lp.stopStream(); t.release(context()); await first;
    assert.equal(t.calls.length, 0); assert.equal(t.lp.state.streaming, false);
  } finally { await t.close(); }
});
test('same context resumes; changed slides rebuild with full context', async () => {
  const t = await setup(good);
  try {
    await t.lp.sendInstruction('第一次'); await t.lp.sendInstruction('再精简');
    assert.equal(t.calls[1].cliSession.claude, 'sid');
    t.w.__context = Promise.resolve({ ...context(), fullText: '幻灯片发生了变化' });
    await t.lp.sendInstruction('继续');
    assert.equal(t.calls[2].cliSession.claude, null); assert.equal(t.calls[2].doc.fullText, '幻灯片发生了变化');
  } finally { await t.close(); }
});
test('Codex effort options omit unsupported max and settings preserve saved model', async () => {
  const t = await setup(good);
  try {
    t.lp.state.cfg.backend = 'codex'; t.lp.state.cfg.model_codex = 'my-model'; t.lp.fillModelOptions();
    assert.equal(t.d.querySelector('#sel-model').value, 'my-model');
    assert.equal(t.d.querySelector('#sel-effort option[value="max"]'), null);
  } finally { await t.close(); }
});
test('new draft persists while request is generating', async () => {
  const t = await setup(good, { hold: true });
  try {
    t.input.value = '发送的内容'; const req = t.lp.sendInstruction('发送的内容');
    t.input.value = '下一轮草稿'; t.input.dispatchEvent(new t.w.Event('input'));
    t.release(context()); await req;
    assert.equal(t.input.value, '下一轮草稿');
    assert.ok([...Object.keys(t.w.localStorage)].some((k) => k.startsWith('lp:draft:') && t.w.localStorage.getItem(k) === '下一轮草稿'));
  } finally { await t.close(); }
});
test('catalog versions keep aliases in requests; actual response model is shown separately', async () => {
  const t = await setup([{ type: 'model', model: 'claude-sonnet-5-1' }, ...good]);
  try {
    await t.lp.refreshModelList(true);
    assert.equal(t.d.querySelector('#sel-model option[value="opus"]').textContent, 'Opus 4.8');
    assert.match(t.d.querySelector('#model-detail').textContent, /CLI 当前解析：claude-sonnet-5/);
    await t.lp.sendInstruction('润色');
    assert.equal(t.calls[0].model, 'sonnet');
    assert.match(t.d.querySelector('#model-detail').textContent, /最近调用实际模型：claude-sonnet-5-1/);
    assert.match(t.d.querySelector('.foot').textContent, /claude-sonnet-5-1/);
  } finally { await t.close(); }
});
test('English UI covers static labels, dynamic previews, presets and slide wording', async () => {
  const t = await setup(good, { language: 'en' });
  try {
    const d = t.d;
    assert.equal(d.documentElement.lang, 'en');
    assert.equal(d.querySelector('#mode-ask').textContent, 'Presentation Q&A');
    assert.equal(d.querySelector('#btn-capture').textContent.trim(), '＋Add selection');
    assert.equal(d.querySelector('#att-slide').textContent.trim(), 'Slide image');
    assert.match(d.querySelector('#input').placeholder, /one line/);
    assert.equal(d.querySelector('#context-summary').textContent, '1 target · 2 chars · Slide 2');
    d.querySelector('#presets .chip:nth-child(2)').click();
    assert.match(t.input.value, /Tighten these bullets/);
    d.querySelector('#mode-ask').click();
    assert.equal(d.querySelector('#presets .chip').textContent, 'Speaker notes');
    d.querySelector('#mode-edit').click();
    await t.lp.sendInstruction('中文原始指令');
    assert.equal(t.calls[0].messages[0].content, '中文原始指令');
    assert.equal(d.querySelector('.apply').textContent, '✅ Apply');
    assert.equal(d.querySelector('.undo').textContent, '↩ Undo');
    assert.equal(d.querySelector('.tab[data-tab="new"]').textContent, 'New text');
    assert.match(d.querySelector('.card-where').textContent, /Slide 2 · Title/);
  } finally { await t.close(); }
});
test('live language switching preserves draft, attachments, targets and rendered answers', async () => {
  const t = await setup(good);
  try {
    await t.lp.sendInstruction('原始内容');
    t.input.value = '未发送的草稿';
    const before = t.lp.state.messages.at(-1).content;
    const apply = t.d.querySelector('.apply');
    const select = t.d.querySelector('#sel-language');
    select.value = 'en'; select.dispatchEvent(new t.w.Event('change'));
    assert.equal(t.w.localStorage.getItem('lp:language'), 'en');
    assert.equal(t.input.value, '未发送的草稿');
    assert.equal(t.lp.state.targets.length, 1);
    assert.equal(t.lp.state.messages.at(-1).content, before);
    assert.equal(t.d.querySelector('.apply'), apply);
    assert.equal(apply.textContent, '✅ Apply');
    select.value = 'zh-CN'; select.dispatchEvent(new t.w.Event('change'));
    assert.equal(apply.textContent, '✅ 应用');
  } finally { await t.close(); }
});
test('English backend messages translate without changing unknown diagnostic details', async () => {
  const t = await setup([{ type: 'error', error: '请求超时：模型超过时限仍未完成，请降低思考强度或缩小目标范围。', hint: '请检查网络和代理；代理端口变化后运行 npm run update。' }, { type: 'done', ok: false }], { language: 'en' });
  try {
    const i = t.w.PptI18n;
    assert.equal(i.known('已登录'), 'Signed in');
    assert.equal(i.known('请在终端运行 codex login。'), 'Run codex login in your terminal.');
    assert.equal(i.known('默认 · gpt-example'), 'Default · gpt-example');
    assert.equal(i.known('unchanged diagnostic /tmp/中文.txt'), 'unchanged diagnostic /tmp/中文.txt');
    assert.match(i.known('未找到 CLI。安装后运行 npm run update，或设置 LLM_IN_POWERPOINT_CLAUDE_BIN / LLM_IN_POWERPOINT_CODEX_BIN。'), /LLM_IN_POWERPOINT_CLAUDE_BIN/);
    await t.lp.sendInstruction('Test');
    assert.match(t.lp.state.messages.at(-1).content, /Request timed out/);
    assert.match(t.d.querySelector('.warnbox').textContent, /did not complete/);
  } finally { await t.close(); }
});
test('language cannot change mid-generation', async () => {
  const t = await setup(good, { hold: true });
  try {
    const request = t.lp.sendInstruction('测试');
    const select = t.d.querySelector('#sel-language');
    assert.equal(select.disabled, true);
    t.release(context()); await request;
    assert.equal(select.disabled, false);
  } finally { await t.close(); }
});
test('locale preference overrides Office language; catalog placeholders stay intact', async () => {
  for (const [saved, office, expected] of [[null, 'en-US', 'en'], [null, 'zh-TW', 'zh-CN'], ['en', 'zh-CN', 'en'], ['zh-CN', 'en-US', 'zh-CN']]) {
    const dom = new JSDOM('', { runScripts: 'outside-only', url: 'https://localhost:8387' });
    try {
      if (saved) dom.window.localStorage.setItem('lp:language', saved);
      dom.window.Office = { context: { displayLanguage: office } };
      dom.window.eval(readFileSync(new URL('../taskpane/i18n.js', import.meta.url), 'utf8'));
      const i = dom.window.PptI18n;
      assert.equal(i.language, expected);
      for (const [zh, en] of Object.entries(i.catalog)) {
        assert.deepEqual((zh.match(/\{\d+\}/g) || []).sort(), (en.match(/\{\d+\}/g) || []).sort(), zh);
      }
    } finally { dom.window.close(); }
  }
});
test('each request carries the interface language so explanations match it', async () => {
  for (const language of ['en', 'zh-CN']) {
    const t = await setup(good, { language });
    try { await t.lp.sendInstruction(language === 'en' ? 'Polish' : '润色'); assert.equal(t.calls[0].uiLanguage, language); } finally { await t.close(); }
  }
});
test('backend hints from the local service are shown in the interface language', async () => {
  const t = await setup(good, { language: 'en' });
  try {
    t.lp.state.cfg.backend = 'codex';
    t.lp.state.health = { backends: { codex: { status: 'missing', label: '未找到 CLI', hint: '请安装 Codex，或运行 npm run update 同步 CLI 路径。' } } };
    t.lp.refreshStatusUI();
    assert.equal(t.d.querySelector('#banner').textContent, 'Install Codex, or run npm run update to sync CLI paths.');
    assert.equal(t.d.querySelector('#status-text').textContent, 'CLI not found');
  } finally { await t.close(); }
});
test('settings and targets float over the conversation, like the Word and Overleaf panels', async () => {
  const t = await setup(good, { language: 'en' });
  try {
    const d = t.d, pop = d.querySelector('#settings-pop'), btn = d.querySelector('#btn-settings');
    const key = (k) => d.dispatchEvent(new t.w.KeyboardEvent('keydown', { key: k, bubbles: true }));
    assert.equal(pop.classList.contains('hidden'), true);
    assert.equal(d.querySelector('#mode-summary').textContent, 'Rewrite ▾');
    assert.ok(pop.contains(d.querySelector('#target-list')) && pop.contains(d.querySelector('#sel-backend')));
    btn.click();
    assert.equal(pop.classList.contains('hidden'), false);
    assert.equal(btn.getAttribute('aria-expanded'), 'true');
    assert.match(btn.title, /^Model, mode and target settings · Claude Code · .+ · (Light|Balanced|Deep)/);
    assert.match(d.querySelector('.tgt-where').textContent, /^Slide 2 · Title$/);
    d.querySelector('#sel-backend').dispatchEvent(new t.w.Event('pointerdown', { bubbles: true }));
    assert.equal(pop.classList.contains('hidden'), false, 'clicks inside the card keep it open');
    d.querySelector('#messages').dispatchEvent(new t.w.Event('pointerdown', { bubbles: true }));
    assert.equal(pop.classList.contains('hidden'), true, 'clicking the conversation closes it');
    d.querySelector('#mode-summary').click();
    d.querySelector('#mode-ask').click();
    assert.equal(d.querySelector('#mode-summary').textContent, 'Q&A ▾');
    key('Escape');
    assert.equal(pop.classList.contains('hidden'), true);
    t.lp.state.targets = []; t.lp.renderTargetBar();
    assert.equal(d.querySelector('#context-summary').textContent, 'Whole presentation');
    d.querySelector('#mode-edit').click();
    assert.equal(d.querySelector('#context-summary').textContent, 'No selection');
  } finally { await t.close(); }
});
test('Markdown tables in answers render as tables', async () => {
  const t = await setup([{ type: 'delta', text: 'Summary\n\n| Slide | Issue |\n| --- | --- |\n| 3 | **Typo** |\n| 5 | Unit mismatch |' }, { type: 'done', ok: true }], { language: 'en' });
  try {
    t.lp.state.cfg.mode = 'ask';
    await t.lp.sendInstruction('Check');
    const rows = t.d.querySelectorAll('.md-table tbody tr');
    assert.equal(rows.length, 2);
    assert.equal(t.d.querySelector('.md-table th').textContent, 'Slide');
    assert.equal(t.d.querySelector('.md-table strong').textContent, 'Typo');
  } finally { await t.close(); }
});
test('a text target cannot be replaced by a table', async () => {
  const t = await setup([{ type: 'delta', text: '```table\n| a | b |\n| --- | --- |\n| 1 | 2 |\n```' }, { type: 'done', ok: true }]);
  try {
    await t.lp.sendInstruction('做成表格');
    assert.equal(t.d.querySelector('.apply').disabled, true);
    assert.match(t.d.querySelector('.tbl-note').textContent, /不能把文字直接换成表格/);
  } finally { await t.close(); }
});
test('outside PowerPoint the pane explains where to use it', async () => {
  const t = await loadPane({ office: false });
  try {
    await tick(5);
    t.lp.state.serverOk = true; t.lp.refreshStatusUI();
    assert.match(t.d.querySelector('#banner').textContent, /LLM_in_PowerPoint/);
  } finally { await t.close(); }
});
