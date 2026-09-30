// Loads the task pane into jsdom with a fake Excel (tools/fixtures/fake-excel.js)
// and a mocked local service, and exposes the pane's internals as window.lx for tests.
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createFakeExcel, sampleBook } from './fixtures/fake-excel.js';

const read = (p) => readFileSync(new URL(`../taskpane/${p}`, import.meta.url), 'utf8');
const html = read('taskpane.html'), paneJs = read('taskpane.js'), i18nJs = read('i18n.js'), gridJs = read('grid-utils.js');

const EXPOSE = 'state, addTarget, getEditContext, getWholeBook, applyGrid, undoGrid, revealTarget, refreshTargets, restoreTargets, buildBookContext, ' +
  'sendInstruction, renderTargetBar, fillModelOptions, stopStream, contextKey, refreshModelList, refreshStatusUI, ' +
  'clearTargets, removeTarget, onDocSelectionChanged, setMode';

export const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

// events: NDJSON events returned by /api/chat (array, or function(payload) → array)
export async function loadPane({ book = sampleBook(), events = [], language = 'zh-CN', office = true, apiVersion = '1.20', mockContext = false, url = '/Users/test/book.xlsx', storage = {} } = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://localhost:8397/taskpane.html', pretendToBeVisual: true });
  const w = dom.window;
  const calls = [];
  if (language) w.localStorage.setItem('lx:language', language);
  for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, v);
  w.TextDecoder = TextDecoder; w.AbortController = AbortController;
  w.navigator.clipboard = { writeText: async () => {} };
  const xl = createFakeExcel(book, { apiVersion });
  const minor = Number(apiVersion.split('.')[1]);
  if (office) {
    w.Office = {
      HostType: { Excel: 'Excel', Word: 'Word', PowerPoint: 'PowerPoint' },
      EventType: { DocumentSelectionChanged: 'documentSelectionChanged' },
      onReady(cb) { setTimeout(() => cb({ host: 'Excel', platform: 'Mac' }), 0); },
      context: {
        displayLanguage: 'zh-CN',
        requirements: { isSetSupported: (name, v) => name === 'ExcelApi' && Number(v.split('.')[1]) <= minor },
        document: { url, addHandlerAsync() {} },
      },
    };
    w.Excel = xl;
  } else {
    w.Office = { onReady() {} };
  }
  w.fetch = async (u, options) => {
    if (u === '/api/chat') {
      const payload = JSON.parse(options.body);
      calls.push(payload);
      const list = typeof events === 'function' ? events(payload, calls.length) : events;
      return new Response(list.map((e) => JSON.stringify(e)).join('\n') + '\n', { status: 200 });
    }
    if (u.startsWith('/api/health')) return { ok: true, json: async () => ({ backends: { claude: { label: '已登录', status: 'ready', path: '/mock', hint: 'ok' }, codex: { label: '已登录', status: 'ready', path: '/mock', hint: 'ok' } }, version: 'test', logPath: '/tmp/log' }) };
    if (u.startsWith('/api/models')) return { ok: true, json: async () => ({ claude: [['sonnet', 'Sonnet 5'], ['opus', 'Opus 4.8']], details: { claude: { sonnet: { resolvedModel: 'claude-sonnet-5' }, opus: { resolvedModel: 'claude-opus-4-8' } } }, codex: [['(default)', '默认']], fetchedAt: new Date().toISOString() }) };
    return { ok: true, json: async () => ({ ok: true }) };
  };
  w.eval(i18nJs);
  w.eval(gridJs);
  const hook = `  init();
    window.lx = { ${EXPOSE} };
    ${mockContext ? 'getEditContext = () => window.__context; getWholeBook = () => window.__context;' : ''}
  `;
  if (!paneJs.includes('  init();\n')) throw new Error('init() call not found');
  w.eval(paneJs.replace('  init();\n', hook + '\n'));
  await tick(5);
  await tick(5);
  if (office) w.lx.state.serverOk = true;
  return {
    w, lx: w.lx, xl, calls, d: w.document,
    input: w.document.querySelector('#input'),
    close: async () => { await tick(5); dom.window.close(); },
  };
}

export const fence = (text, lang = 'table') => '```' + lang + '\n' + text + '\n```';
export const answer = (text) => [{ type: 'delta', text }, { type: 'cli_session', backend: 'claude', id: 'sid' }, { type: 'done', ok: true }];
