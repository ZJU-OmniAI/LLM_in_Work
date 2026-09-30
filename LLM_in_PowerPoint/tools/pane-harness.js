// Loads the task pane into jsdom with a fake PowerPoint (tools/fixtures/fake-powerpoint.js)
// and a mocked local service, and exposes the pane's internals as window.lp for tests.
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createFakePowerPoint, sampleDeck } from './fixtures/fake-powerpoint.js';

const read = (p) => readFileSync(new URL(`../taskpane/${p}`, import.meta.url), 'utf8');
const html = read('taskpane.html'), paneJs = read('taskpane.js'), i18nJs = read('i18n.js'), tableJs = read('table-utils.js');

const EXPOSE = 'state, addTarget, getEditContext, getWholeDeck, applyText, applyTable, undoApply, revealTarget, refreshTargets, restoreTargets, ' +
  'sendInstruction, renderTargetBar, fillModelOptions, stopStream, contextKey, refreshModelList, refreshStatusUI, attachSlideImage, ' +
  'clearTargets, removeTarget, onDocSelectionChanged, setMode';

export const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

// events: NDJSON events returned by /api/chat (array, or function(payload) → array)
export async function loadPane({ deck = sampleDeck(), events = [], language = 'zh-CN', office = true, apiVersion = '1.10', mockContext = false, url = '/Users/test/deck.pptx', storage = {} } = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://localhost:8387/taskpane.html', pretendToBeVisual: true });
  const w = dom.window;
  const calls = [];
  if (language) w.localStorage.setItem('lp:language', language);
  for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, v);
  w.TextDecoder = TextDecoder; w.AbortController = AbortController;
  w.navigator.clipboard = { writeText: async () => {} };
  const pp = createFakePowerPoint(deck, { apiVersion });
  const minor = Number(apiVersion.split('.')[1]);
  if (office) {
    w.Office = {
      HostType: { PowerPoint: 'PowerPoint', Word: 'Word' },
      EventType: { DocumentSelectionChanged: 'documentSelectionChanged' },
      onReady(cb) { setTimeout(() => cb({ host: 'PowerPoint', platform: 'Mac' }), 0); },
      context: {
        displayLanguage: 'zh-CN',
        requirements: { isSetSupported: (name, v) => name === 'PowerPointApi' && Number(v.split('.')[1]) <= minor },
        document: { url, addHandlerAsync() {} },
      },
    };
    w.PowerPoint = pp;
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
  w.eval(tableJs);
  const hook = `  init();
    window.lp = { ${EXPOSE} };
    ${mockContext ? 'getEditContext = () => window.__context; getWholeDeck = () => window.__context;' : ''}
  `;
  if (!paneJs.includes('  init();\n')) throw new Error('init() call not found');
  w.eval(paneJs.replace('  init();\n', hook + '\n'));
  await tick(5); // Office.onReady → restoreTargets
  await tick(5);
  const lp = w.lp;
  if (office) lp.state.serverOk = true;
  return {
    w, lp, pp, calls, d: w.document,
    input: w.document.querySelector('#input'),
    close: async () => { await tick(5); dom.window.close(); },
  };
}

export const fence = (text, lang = 'text') => '```' + lang + '\n' + text + '\n```';
export const answer = (text) => [{ type: 'delta', text }, { type: 'cli_session', backend: 'claude', id: 'sid' }, { type: 'done', ok: true }];
