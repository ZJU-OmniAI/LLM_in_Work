// Pane behaviour that does not depend on workbook contents: streaming robustness, sessions,
// settings card, model details and the English interface. Workbook logic is in test-book.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { loadPane, tick } from './pane-harness.js';

const grid = [['原文'], ['第二行']];
const target = { id: 't1', sheetId: '{sheet-1}', sheetName: 'Orders', address: 'B2:B3', r1: 2, c1: 2, r2: 3, c2: 2, grid, texts: grid, types: [['String'], ['String']], text: '|   | B |\n| --- | --- |\n| 2 | 原文 |\n| 3 | 第二行 |' };
const context = () => ({ ok: true, targets: [{ ...target }], lost: 0, fullText: '【工作表「Orders」】\n|   | B |\n| --- | --- |\n| 2 | 原文 |', truncated: false, sheetCount: 2, activeSheet: 'Orders' });
const answer = '```table\n|   | B |\n| --- | --- |\n| 2 | 新文本 |\n```';
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
  t.lx.state.targets = [{ ...target }];
  t.lx.renderTargetBar();
  return t;
}

test('successful stream without final newline creates an apply card', async () => {
  const t = await setup(good, { trailingNewline: false });
  try { await t.lx.sendInstruction('润色'); assert.ok(t.d.querySelector('.apply')); assert.equal(t.lx.state.streaming, false); } finally { await t.close(); }
});
for (const [name, events] of [['EOF before done', [{ type: 'delta', text: answer }]], ['error after body', [{ type: 'delta', text: answer }, { type: 'error', error: '失败' }, { type: 'done', ok: false }]]]) {
  test(`${name}: partial fenced output cannot be applied and can be retried`, async () => {
    const t = await setup(events);
    try {
      await t.lx.sendInstruction('润色');
      assert.equal(t.d.querySelector('.apply'), null);
      assert.ok(t.d.querySelector('.warnbox'));
      assert.equal(t.lx.state.cliSession.claude, null);
      assert.equal(t.lx.state.messages.at(-1).failed, true);
    } finally { await t.close(); }
  });
}
test('missing target or Excel preserves the input draft', async () => {
  const t = await setup(good);
  try {
    t.input.value = '不要丢掉我的指令';
    t.lx.state.xlReady = false; t.d.querySelector('#btn-send').click();
    assert.equal(t.input.value, '不要丢掉我的指令'); assert.equal(t.calls.length, 0);
    t.lx.state.xlReady = true; t.lx.state.targets = []; t.d.querySelector('#btn-send').click();
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
test('reading the workbook is locked against double send and cancel prevents generation', async () => {
  const t = await setup(good, { hold: true });
  try {
    const first = t.lx.sendInstruction('润色');
    await t.lx.sendInstruction('重复'); assert.equal(t.lx.state.streaming, true);
    t.lx.stopStream(); t.release(context()); await first;
    assert.equal(t.calls.length, 0); assert.equal(t.lx.state.streaming, false);
  } finally { await t.close(); }
});
test('same context resumes; a changed workbook rebuilds with full context', async () => {
  const t = await setup(good);
  try {
    await t.lx.sendInstruction('第一次'); await t.lx.sendInstruction('再精简');
    assert.equal(t.calls[1].cliSession.claude, 'sid');
    t.w.__context = Promise.resolve({ ...context(), fullText: '工作簿发生了变化' });
    await t.lx.sendInstruction('继续');
    assert.equal(t.calls[2].cliSession.claude, null); assert.equal(t.calls[2].doc.fullText, '工作簿发生了变化');
  } finally { await t.close(); }
});
test('Codex effort options omit unsupported max and settings preserve saved model', async () => {
  const t = await setup(good);
  try {
    t.lx.state.cfg.backend = 'codex'; t.lx.state.cfg.model_codex = 'my-model'; t.lx.fillModelOptions();
    assert.equal(t.d.querySelector('#sel-model').value, 'my-model');
    assert.equal(t.d.querySelector('#sel-effort option[value="max"]'), null);
  } finally { await t.close(); }
});
test('new draft persists while request is generating', async () => {
  const t = await setup(good, { hold: true });
  try {
    t.input.value = '发送的内容'; const req = t.lx.sendInstruction('发送的内容');
    t.input.value = '下一轮草稿'; t.input.dispatchEvent(new t.w.Event('input'));
    t.release(context()); await req;
    assert.equal(t.input.value, '下一轮草稿');
    assert.ok([...Object.keys(t.w.localStorage)].some((k) => k.startsWith('lx:draft:') && t.w.localStorage.getItem(k) === '下一轮草稿'));
  } finally { await t.close(); }
});
test('catalog versions keep aliases in requests; actual response model is shown separately', async () => {
  const t = await setup([{ type: 'model', model: 'claude-sonnet-5-1' }, ...good]);
  try {
    await t.lx.refreshModelList(true);
    assert.equal(t.d.querySelector('#sel-model option[value="opus"]').textContent, 'Opus 4.8');
    assert.match(t.d.querySelector('#model-detail').textContent, /CLI 当前解析：claude-sonnet-5/);
    await t.lx.sendInstruction('润色');
    assert.equal(t.calls[0].model, 'sonnet');
    assert.match(t.d.querySelector('#model-detail').textContent, /最近调用实际模型：claude-sonnet-5-1/);
    assert.match(t.d.querySelector('.foot').textContent, /claude-sonnet-5-1/);
  } finally { await t.close(); }
});
test('English UI covers static labels, dynamic previews, presets and workbook wording', async () => {
  const t = await setup(good, { language: 'en' });
  try {
    const d = t.d;
    assert.equal(d.documentElement.lang, 'en');
    assert.equal(d.querySelector('#mode-ask').textContent, 'Workbook Q&A');
    assert.equal(d.querySelector('#btn-capture').textContent.trim(), '＋Add selection');
    assert.equal(d.querySelector('#att-slide'), null);
    assert.match(d.querySelector('#input').placeholder, /feedback in column G/);
    assert.equal(d.querySelector('#context-summary').textContent, '1 target · B2:B3 · 2 cells');
    d.querySelector('#presets .chip:nth-child(2)').click();
    assert.match(t.input.value, /Give each row a short category/);
    d.querySelector('#mode-ask').click();
    assert.equal(d.querySelector('#presets .chip').textContent, 'Summarize');
    d.querySelector('#mode-edit').click();
    await t.lx.sendInstruction('中文原始指令');
    assert.equal(t.calls[0].messages[0].content, '中文原始指令');
    assert.equal(d.querySelector('.apply').textContent, '✅ Apply');
    assert.equal(d.querySelector('.undo').textContent, '↩ Undo');
    assert.equal(d.querySelector('.tab[data-tab="new"]').textContent, 'Source');
    assert.match(d.querySelector('.card-where').textContent, /Orders!B2:B3 · 2×1/);
    assert.match(d.querySelector('.tbl-note').textContent, /^Cells changed: 1$/);
  } finally { await t.close(); }
});
test('live language switching preserves draft, attachments, targets and rendered answers', async () => {
  const t = await setup(good);
  try {
    await t.lx.sendInstruction('原始内容');
    t.input.value = '未发送的草稿';
    const before = t.lx.state.messages.at(-1).content;
    const apply = t.d.querySelector('.apply');
    const select = t.d.querySelector('#sel-language');
    select.value = 'en'; select.dispatchEvent(new t.w.Event('change'));
    assert.equal(t.w.localStorage.getItem('lx:language'), 'en');
    assert.equal(t.input.value, '未发送的草稿');
    assert.equal(t.lx.state.targets.length, 1);
    assert.equal(t.lx.state.messages.at(-1).content, before);
    assert.equal(t.d.querySelector('.apply'), apply);
    assert.equal(apply.textContent, '✅ Apply');
    select.value = 'zh-CN'; select.dispatchEvent(new t.w.Event('change'));
    assert.equal(apply.textContent, '✅ 应用');
  } finally { await t.close(); }
});
test('English backend messages translate without changing unknown diagnostic details', async () => {
  const t = await setup([{ type: 'error', error: '请求超时：模型超过时限仍未完成，请降低思考强度或缩小目标范围。', hint: '请检查网络和代理；代理端口变化后运行 npm run update。' }, { type: 'done', ok: false }], { language: 'en' });
  try {
    const i = t.w.XlI18n;
    assert.equal(i.known('已登录'), 'Signed in');
    assert.equal(i.known('请在终端运行 codex login。'), 'Run codex login in your terminal.');
    assert.equal(i.known('默认 · gpt-example'), 'Default · gpt-example');
    assert.equal(i.known('unchanged diagnostic /tmp/中文.txt'), 'unchanged diagnostic /tmp/中文.txt');
    assert.match(i.known('未找到 CLI。安装后运行 npm run update，或设置 LLM_IN_EXCEL_CLAUDE_BIN / LLM_IN_EXCEL_CODEX_BIN。'), /LLM_IN_EXCEL_CLAUDE_BIN/);
    await t.lx.sendInstruction('Test');
    assert.match(t.lx.state.messages.at(-1).content, /Request timed out/);
    assert.match(t.d.querySelector('.warnbox').textContent, /did not complete/);
  } finally { await t.close(); }
});
test('language cannot change mid-generation', async () => {
  const t = await setup(good, { hold: true });
  try {
    const request = t.lx.sendInstruction('测试');
    const select = t.d.querySelector('#sel-language');
    assert.equal(select.disabled, true);
    t.release(context()); await request;
    assert.equal(select.disabled, false);
  } finally { await t.close(); }
});
test('locale preference overrides Office language; catalog placeholders stay intact', async () => {
  for (const [saved, office, expected] of [[null, 'en-US', 'en'], [null, 'zh-TW', 'zh-CN'], ['en', 'zh-CN', 'en'], ['zh-CN', 'en-US', 'zh-CN']]) {
    const dom = new JSDOM('', { runScripts: 'outside-only', url: 'https://localhost:8397' });
    try {
      if (saved) dom.window.localStorage.setItem('lx:language', saved);
      dom.window.Office = { context: { displayLanguage: office } };
      dom.window.eval(readFileSync(new URL('../taskpane/i18n.js', import.meta.url), 'utf8'));
      const i = dom.window.XlI18n;
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
    try { await t.lx.sendInstruction(language === 'en' ? 'Polish' : '润色'); assert.equal(t.calls[0].uiLanguage, language); } finally { await t.close(); }
  }
});
test('backend hints from the local service are shown in the interface language', async () => {
  const t = await setup(good, { language: 'en' });
  try {
    t.lx.state.cfg.backend = 'codex';
    t.lx.state.health = { backends: { codex: { status: 'missing', label: '未找到 CLI', hint: '请安装 Codex，或运行 npm run update 同步 CLI 路径。' } } };
    t.lx.refreshStatusUI();
    assert.equal(t.d.querySelector('#banner').textContent, 'Install Codex, or run npm run update to sync CLI paths.');
    assert.equal(t.d.querySelector('#status-text').textContent, 'CLI not found');
  } finally { await t.close(); }
});
test('settings and targets float over the conversation, like the Word and PowerPoint panes', async () => {
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
    assert.match(d.querySelector('.tgt-where').textContent, /^Orders!B2:B3 · 2×1$/);
    d.querySelector('#sel-backend').dispatchEvent(new t.w.Event('pointerdown', { bubbles: true }));
    assert.equal(pop.classList.contains('hidden'), false, 'clicks inside the card keep it open');
    d.querySelector('#messages').dispatchEvent(new t.w.Event('pointerdown', { bubbles: true }));
    assert.equal(pop.classList.contains('hidden'), true, 'clicking the conversation closes it');
    d.querySelector('#mode-summary').click();
    d.querySelector('#mode-ask').click();
    assert.equal(d.querySelector('#mode-summary').textContent, 'Q&A ▾');
    key('Escape');
    assert.equal(pop.classList.contains('hidden'), true);
    t.lx.state.targets = []; t.lx.renderTargetBar();
    assert.equal(d.querySelector('#context-summary').textContent, 'Whole workbook');
    d.querySelector('#mode-edit').click();
    assert.equal(d.querySelector('#context-summary').textContent, 'No range selected');
  } finally { await t.close(); }
});
test('Markdown tables in answers render as tables', async () => {
  const t = await setup([{ type: 'delta', text: 'Summary\n\n| Sheet | Issue |\n| --- | --- |\n| 3 | **Typo** |\n| 5 | Unit mismatch |' }, { type: 'done', ok: true }], { language: 'en' });
  try {
    t.lx.state.cfg.mode = 'ask';
    await t.lx.sendInstruction('Check');
    const rows = t.d.querySelectorAll('.md-table tbody tr');
    assert.equal(rows.length, 2);
    assert.equal(t.d.querySelector('.md-table th').textContent, 'Sheet');
    assert.equal(t.d.querySelector('.md-table strong').textContent, 'Typo');
  } finally { await t.close(); }
});
test('a reply without coordinates that does not fit the target cannot be applied', async () => {
  const t = await setup([{ type: 'delta', text: '```table\n| a | b |\n| --- | --- |\n| 1 | 2 |\n```' }, { type: 'done', ok: true }]);
  try {
    await t.lx.sendInstruction('改');
    assert.equal(t.d.querySelector('.apply').disabled, true);
    assert.match(t.d.querySelector('.diffview').textContent, /对不上单元格/);
  } finally { await t.close(); }
});
test('outside Excel the pane explains where to use it', async () => {
  const t = await loadPane({ office: false });
  try {
    await tick(5);
    t.lx.state.serverOk = true; t.lx.refreshStatusUI();
    assert.match(t.d.querySelector('#banner').textContent, /LLM_in_Excel/);
  } finally { await t.close(); }
});
