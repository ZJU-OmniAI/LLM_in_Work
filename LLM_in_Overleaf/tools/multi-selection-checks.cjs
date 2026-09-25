const assert = require('node:assert/strict');
const path = require('node:path');

module.exports = async (page, outputDir) => {
  const source = 'First paragraph.\n\nLeave this middle exactly.\n\nLast paragraph.';
  const first = { from: 0, to: 'First paragraph.'.length };
  const last = { from: source.indexOf('Last'), to: source.length };
  const waitCount = (n) => page.waitForFunction((n) => {
    const root = document.querySelector('#overleaf-edit-host').shadowRoot;
    return root.querySelectorAll('.ole-selected-range').length === n && !root.querySelector('#ole-capture').disabled;
  }, n);
  const choose = (ranges) => page.evaluate((ranges) => {
    editor.focus();
    editor.dispatch({ selection: EditorSelection.create(ranges.map((r) => EditorSelection.range(r.from, r.to)), ranges.length - 1) });
  }, ranges);
  const capture = async (ranges, count) => {
    await choose(ranges);
    await page.locator('#ole-capture').click();
    await waitCount(count);
  };
  const clear = async () => {
    await page.locator('#ole-context-summary').click();
    await page.locator('#ole-target-clear').click();
    await waitCount(0);
  };
  const send = async (instruction) => {
    const n = await page.evaluate(() => mockMessages.length);
    await page.locator('#ole-input').fill(instruction);
    await page.locator('#ole-send').click();
    await page.waitForFunction((n) => mockMessages.length === n + 1, n);
    return page.evaluate(() => mockMessages.at(-1).payload);
  };
  const reply = async (text) => {
    await page.evaluate((text) => { const fn = fakeListeners.at(-1); fn({ type: 'delta', text }); fn({ type: 'done' }); }, text);
    await page.waitForFunction(() => document.querySelector('#overleaf-edit-host').shadowRoot.querySelector('#ole-panel').getAttribute('aria-busy') === 'false');
  };
  const validReply = (payload) => {
    const [a, b] = payload.doc.selections;
    // Reversed output order must still map edits by ID, not response order.
    return `已逐段修改。\n\n\`\`\`latex id=${b.id}\nLast revised.\n\`\`\`\n\n\`\`\`latex id=${a.id}\nFirst rewritten paragraph.\n\`\`\``;
  };

  await page.locator('#ole-launcher').click();
  await clear();
  await page.evaluate((text) => resetEditor(text), source);
  await capture([first], 1);
  await capture([last], 2);
  assert.match(await page.locator('#ole-context-summary').innerText(), /2 段/);
  await capture([first], 2); // Duplicate selection must not add a third target.
  await capture([{ from: 2, to: 8 }], 2); // Partial overlap is rejected, old group survives.
  assert.match(await page.locator('#ole-selection-hint').innerText(), /重叠/);

  await page.evaluate(() => { document.querySelector('.editor-file-tab-path').textContent = 'other.tex'; });
  await capture([last], 2);
  assert.match(await page.locator('#ole-selection-hint').innerText(), /同一文件/);
  await page.evaluate(() => { document.querySelector('.editor-file-tab-path').textContent = 'main.tex'; });
  await page.locator('#ole-context-summary').click();
  await page.locator('.ole-range-remove').first().click();
  await waitCount(1);
  await page.locator('#ole-target-clear').click();
  await waitCount(0);

  // Native multi-selection includes both disjoint ranges, never their gap.
  await choose([first, last]);
  const native = await page.evaluate(() => rpc('get_target'));
  assert.deepEqual(native.ranges.map((r) => r.text), ['First paragraph.', 'Last paragraph.']);
  await page.locator('#ole-float-btn').waitFor({ state: 'visible' });
  await page.locator('#ole-float-btn').click();
  await waitCount(2);
  await page.locator('#ole-context-summary').click();
  await page.locator('#ole-panel').screenshot({ path: path.join(outputDir, 'multi-selection-list.png') });
  await page.locator('#ole-settings-toggle').click();

  await page.locator('#ole-mode-summary').click();
  await page.locator('#ole-mode-ask').click();
  const question = await send('比较这两段的逻辑');
  assert.deepEqual(question.doc.selections.map((r) => r.text), ['First paragraph.', 'Last paragraph.']);
  assert.equal(question.doc.selection, undefined, 'never manufacture one continuous selected span');
  assert.ok(question.doc.fullText.includes('Leave this middle exactly.'));
  await reply('第一段提出问题，第二段总结结果。');
  assert.equal(await page.locator('.ole-card').count(), 0);
  await page.locator('#ole-mode-summary').click();
  await page.locator('#ole-mode-edit').click();

  for (const kind of ['missing', 'duplicate', 'unknown']) {
    const payload = await send('分别润色');
    const [a, b] = payload.doc.selections;
    const secondId = kind === 'duplicate' ? a.id : 's999999';
    const bad = `\`\`\`latex id=${a.id}\nPartial\n\`\`\``
      + (kind === 'missing' ? '' : `\n\`\`\`latex id=${secondId}\nOther\n\`\`\``);
    assert.notEqual(secondId, b.id);
    await reply(bad);
    assert.equal(await page.locator('.ole-card').count(), 0, `${kind} range must not create an apply card`);
  }
  let payload = await send('一起润色');
  await reply(validReply(payload));
  assert.equal(await page.locator('.ole-card').count(), 1);
  assert.equal(await page.locator('.ole-diffview .ole-edit-part').count(), 2);
  await page.locator('#ole-panel').screenshot({ path: path.join(outputDir, 'multi-selection-diff.png') });

  // Removing a target invalidates previews generated for the earlier group.
  await page.locator('#ole-context-summary').click();
  await page.locator('.ole-range-remove').first().click();
  await page.locator('#ole-settings-toggle').click();
  await page.locator('.ole-apply').last().click();
  assert.match(await page.locator('.ole-card-status').last().innerText(), /选区已切换/);
  await capture([first], 2);
  payload = await send('重新生成两段');
  await reply(validReply(payload));

  // A concurrent edit in the second range prevents *all* writes, including range one.
  await page.evaluate((r) => editor.dispatch({ changes: { from: r.from, to: r.to, insert: 'Changed by collaborator.' } }), last);
  const modified = await page.evaluate(() => editor.state.doc.toString());
  await page.locator('.ole-apply').last().click();
  await page.waitForFunction(() => [...document.querySelector('#overleaf-edit-host').shadowRoot.querySelectorAll('.ole-card-status')].at(-1).textContent.includes('无法唯一定位'));
  assert.equal(await page.evaluate(() => editor.state.doc.toString()), modified);

  // Restore source with fresh undo history; the group applies as one transaction.
  await page.evaluate((text) => resetEditor(text), source);
  await page.locator('.ole-apply').last().click();
  const expected = 'First rewritten paragraph.\n\nLeave this middle exactly.\n\nLast revised.';
  await page.waitForFunction((text) => editor.state.doc.toString() === text, expected);
  await waitCount(0);
  assert.equal(await page.evaluate(() => undoEditor()), true);
  assert.equal(await page.evaluate(() => editor.state.doc.toString()), source, 'one undo restores both edits and the exact untouched gap');

  // Large documents include each distant selected range in the context excerpt.
  const longDoc = 'First selected.\n' + 'Unselected gap.\n'.repeat(1000) + '\nLast selected.';
  await page.evaluate((text) => resetEditor(text), longDoc);
  const rangeSpec = [
    { id: 's1', from: 0, to: 15, oldText: 'First selected.' },
    { id: 's2', from: longDoc.indexOf('Last selected.'), to: longDoc.length, oldText: 'Last selected.' },
  ];
  const context = await page.evaluate((ranges) => rpc('get_context', { ranges, fileName: 'main.tex', cap: 300, headKeep: 20 }), rangeSpec);
  assert.equal(context.ok, true);
  assert.equal(context.ranges.length, 2);
  assert.ok(context.fullText.includes('First selected.') && context.fullText.includes('Last selected.'));
  assert.ok(context.fullText.length < 500 && context.truncated);
  const wrongFile = await page.evaluate((ranges) => rpc('apply_edits', { edits: ranges.map((r) => ({ ...r, newText: 'no' })), fileName: 'other.tex' }), rangeSpec);
  assert.equal(wrongFile.ok, false);
  assert.equal(await page.evaluate(() => editor.state.doc.toString()), longDoc);
  await page.evaluate(() => resetEditor('Repeat\nGap\nRepeat'));
  const ambiguous = await page.evaluate(() => rpc('apply_edits', { edits: [{ from: 100, to: 106, oldText: 'Repeat', newText: 'No' }], fileName: 'main.tex' }));
  assert.equal(ambiguous.ok, false);
  assert.equal(await page.evaluate(() => editor.state.doc.toString()), 'Repeat\nGap\nRepeat');

  await page.locator('#ole-close').click();
  console.log('Multi-selection PASS: append, deduplicate, overlap/file rejection, remove, native ranges, ask/edit payload, strict IDs, stale previews, atomic apply, untouched gaps, one undo, distant context and ambiguous relocation.');
};
