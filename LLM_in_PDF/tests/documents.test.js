import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceUrl, isPdfUrl, documentInfo, readerUrl } from '../extension/shared/documents.js';

test('document sources allow HTTP(S) and local files, reject active schemes and credentials', () => {
  for (const value of ['https://publisher.example/download?id=17&key=a%2Bb', 'file:///Users/test/My%20Paper.pdf', 'http://localhost:8000/paper.pdf']) assert.ok(sourceUrl(value));
  for (const value of ['javascript:alert(1)', 'data:application/pdf;base64,AA==', 'chrome://settings', 'chrome-extension://other/private', 'file://remote-host/share/file.pdf', 'https://user:pass@example.com/paper.pdf', null, 'not-a-url']) assert.equal(sourceUrl(value), null);
  assert.equal(isPdfUrl('https://openreview.net/pdf?id=test'), true);
  assert.equal(isPdfUrl('file:///Users/test/PAPER.PDF#page=3'), true);
});

test('source identity preserves arXiv history, separates URLs and ignores only page fragments', async () => {
  assert.equal((await documentInfo('https://arxiv.org/pdf/1706.03762#page=3')).id, '1706.03762');
  assert.equal((await documentInfo('https://example.com/paper.pdf#page=2')).id, (await documentInfo('https://example.com/paper.pdf')).id);
  assert.notEqual((await documentInfo('https://example.com/download?id=1')).id, (await documentInfo('https://example.com/download?id=2')).id);
  assert.equal((await documentInfo('file:///tmp/%E8%AE%BA%E6%96%87.pdf')).title, '论文.pdf');
});

test('reader URLs preserve signed queries, Unicode names, plus signs and page numbers', () => {
  const source = 'https://example.com/download?name=%E8%AE%BA%E6%96%87.pdf&token=x%2By&v=2#page=4';
  const target = new URL(readerUrl('chrome-extension://test/reader/reader.html', source));
  assert.equal(target.searchParams.get('url'), source);
  assert.equal(target.hash, '#page=4');
  assert.equal(new URL(readerUrl('chrome-extension://test/reader/reader.html', 'https://arxiv.org/abs/1706.03762')).searchParams.get('id'), '1706.03762');
  assert.throws(() => readerUrl('chrome-extension://test/reader/reader.html', 'javascript:alert(1)'));
});
