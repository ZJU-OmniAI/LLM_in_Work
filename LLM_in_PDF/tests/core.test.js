import test from 'node:test';
import assert from 'node:assert/strict';
import { arxivId, validId, pdfRules } from '../extension/shared/arxiv.js';
import { claudeCatalog } from '../server/models.js';
import { compareVersions } from '../server/runtime.js';
import { runProcess } from '../server/process.js';
import { codexEffort, setting } from '../server/config.js';

test('PDF redirect handles modern / legacy IDs, versions and queries only on arXiv', () => {
  const [rule, bypass] = pdfRules('chrome-extension://test/reader/reader.html');
  for (const [url, id] of [
    ['https://arxiv.org/pdf/1706.03762', '1706.03762'],
    ['https://export.arxiv.org/pdf/hep-th/9901001v2.pdf?download=1', 'hep-th/9901001v2'],
    ['http://arxiv.org/pdf/math.AG/0601001v3.pdf', 'math.AG/0601001v3'],
  ]) {
    assert.equal(arxivId(url), id);
    assert.equal(url.match(new RegExp(rule.condition.regexFilter, 'i'))?.[1], id);
  }
  for (const url of ['https://evil.com/pdf/1706.03762', 'https://arxiv.org.evil.com/pdf/1706.03762', 'https://arxiv.org/pdf/../secret', 'file:///1706.03762']) assert.equal(arxivId(url), null);
  assert.equal(validId('1706.03762&url=https://evil.com'), null);
  assert.match('https://arxiv.org/pdf/1706.03762?paper_read_native=1', new RegExp(bypass.condition.regexFilter));
  assert.deepEqual(rule.condition.resourceTypes, ['main_frame']); // fetching PDF bytes must never redirect
});

test('Claude directory accepts future entries without invented versions', () => {
  const { claude, details } = claudeCatalog([{ value: 'new-alias', displayName: 'New alias', resolvedModel: 'claude-new-9-2' }]);
  assert.deepEqual(claude[1], ['new-alias', 'New 9.2']);
  assert.equal(details['new-alias'].resolvedModel, 'claude-new-9-2');
  assert.ok(claudeCatalog(null).claude.every(([, label]) => !/4\.|5\./.test(label)));
});

test('new CLI versions and max / ultra efforts are preserved', () => {
  assert.ok(compareVersions('0.160.0', '0.99.9') > 0);
  assert.ok(compareVersions('2.1.9', '2.1.10') < 0);
  assert.equal(codexEffort('max'), 'max');
  assert.equal(codexEffort('ultra'), 'ultra');
});

test('subprocess reports missing CLI and honors pre-abort, timeout and active cancellation', async () => {
  const missing = await runProcess('/definitely/missing/paper-read-cli', [], { timeoutMs: 1000 });
  assert.equal(missing.error.code, 'ENOENT');
  assert.equal((await runProcess(process.execPath, ['-e', 'process.exit(9)'], { signal: AbortSignal.abort() })).aborted, true);
  const timeout = await runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 80 });
  assert.equal(timeout.timedOut, true);
  const ac = new AbortController();
  const active = await runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { signal: ac.signal, onSpawn: () => ac.abort() });
  assert.equal(active.aborted, true);
});


test('renamed settings take precedence while paper_read environment settings still work', () => {
  process.env.PAPER_READ_TEST_ALIAS = 'legacy';
  try {
    assert.equal(setting('TEST_ALIAS'), 'legacy');
    process.env.LLM_IN_PDF_TEST_ALIAS = 'renamed';
    assert.equal(setting('TEST_ALIAS'), 'renamed');
  } finally {
    delete process.env.LLM_IN_PDF_TEST_ALIAS;
    delete process.env.PAPER_READ_TEST_ALIAS;
  }
});
