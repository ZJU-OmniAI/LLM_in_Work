const assert = require('node:assert/strict');
const path = require('node:path');

module.exports = async (page, outputDir, expect) => {
  const source = 'First paragraph.\n\nLeave this middle exactly.\n\nLast paragraph.';
  const first = { from: 0, to: 'First paragraph.'.length };
  const last = { from: source.indexOf('Last'), to: source.length };
  const waitCount = (n) => page.waitForFunction((n) => {
    const root = document.querySelector('#llm-in-overleaf-host').shadowRoot;
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
    await page.waitForFunction(() => document.querySelector('#llm-in-overleaf-host').shadowRoot.querySelector('#ole-panel').getAttribute('aria-busy') === 'false');
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
  assert.match(await page.locator('#ole-context-summary').innerText(), expect.twoSelections);
  await capture([first], 2); // Duplicate selection must not add a third target.
  await capture([{ from: 2, to: 8 }], 2); // Partial overlap is rejected, old group survives.
  assert.match(await page.locator('#ole-selection-hint').innerText(), expect.overlap);

  await page.evaluate(() => { document.querySelector('.editor-file-tab-path').textContent = 'other.tex'; });
  await capture([last], 2);
  assert.match(await page.locator('#ole-selection-hint').innerText(), expect.sameFile);
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

  // Changing the selection hides the earlier card's Clear button; that card keeps its own two passages.
  assert.equal(await page.locator('.ole-card').last().locator('.ole-clear').isVisible(), true);
  await page.locator('#ole-context-summary').click();
  await page.locator('.ole-range-remove').first().click();
  await page.locator('#ole-settings-toggle').click();
  assert.equal(await page.locator('.ole-card').last().locator('.ole-clear').isVisible(), false);
  await capture([first], 2);
  payload = await send('重新生成两段');
  await reply(validReply(payload));

  // A concurrent edit in the second range prevents *all* writes, including range one.
  await page.evaluate((r) => editor.dispatch({ changes: { from: r.from, to: r.to, insert: 'Changed by collaborator.' } }), last);
  const modified = await page.evaluate(() => editor.state.doc.toString());
  await page.locator('.ole-apply').last().click();
  await page.waitForFunction((text) => [...document.querySelector('#llm-in-overleaf-host').shadowRoot.querySelectorAll('.ole-card-status')].at(-1).textContent.includes(text), expect.notUnique);
  assert.equal(await page.evaluate(() => editor.state.doc.toString()), modified);

  // Restore source with fresh undo history; the group applies as one transaction.
  await page.evaluate((text) => resetEditor(text), source);
  await page.locator('.ole-apply').last().click();
  const expected = 'First rewritten paragraph.\n\nLeave this middle exactly.\n\nLast revised.';
  await page.waitForFunction((text) => editor.state.doc.toString() === text, expected);
  await waitCount(0);
  assert.equal(await page.evaluate(() => undoEditor()), true);
  assert.equal(await page.evaluate(() => editor.state.doc.toString()), source, 'one undo restores both edits and the exact untouched gap');

  // Clear selection in the reply card: move on to the next passage without applying, then apply the earlier card.
  await page.evaluate((text) => resetEditor(text), source);
  await capture([first], 1);
  payload = await send('润色第一段');
  await reply('```latex\nFirst paragraph, polished.\n```');
  const firstCard = page.locator('.ole-card').nth(await page.locator('.ole-card').count() - 1); // fixed, not 'last'
  await firstCard.locator('.ole-clear').click();
  await waitCount(0);
  assert.equal(await firstCard.locator('.ole-clear').isVisible(), false);
  assert.match(await firstCard.locator('.ole-card-status').innerText(), expect.cleared);
  assert.equal(await page.locator('#ole-context-clear').isVisible(), false);
  await choose([last]);
  await page.locator('#ole-float-btn').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#ole-float-btn').innerText(), expect.rewrite, 'a cleared selection starts a new group instead of adding to the old one');
  await page.locator('#ole-float-btn').click();
  await waitCount(1);
  assert.equal(await page.locator('#ole-context-clear').isVisible(), true);
  payload = await send('润色最后一段');
  assert.deepEqual(payload.doc.selections.map((r) => r.text), ['Last paragraph.']);
  await reply('```latex\nLast paragraph, polished.\n```');
  await firstCard.locator('.ole-apply').click();
  await page.waitForFunction(() => editor.state.doc.toString().startsWith('First paragraph, polished.'));
  assert.equal(await page.evaluate(() => editor.state.doc.toString()), source.replace('First paragraph.', 'First paragraph, polished.'));
  await waitCount(1); // the current selection (last paragraph) is untouched
  await page.locator('.ole-card').last().locator('.ole-apply').click();
  await page.waitForFunction(() => editor.state.doc.toString().endsWith('Last paragraph, polished.'));
  await waitCount(0);
  // Top-bar ✕ clears too.
  await capture([first], 1);
  await page.locator('#ole-context-clear').click();
  await waitCount(0);

  // A long passage with a few edits still gets a word-level diff, folded around the changes, and applies exactly.
  const sentence = (i) => `In experiment ${i}, the proposed method have achieved a accuracy of ${80 + i % 17}.${i % 10}% on the benchmark, which is better then the baseline.`;
  const longOld = Array.from({ length: 150 }, (_, i) => sentence(i)).join(' ');
  const longNew = longOld.replace('In experiment 3, the proposed method have', 'In experiment 3, the proposed method has').replace('better then the baseline. In experiment 140,', 'better than the baseline. In experiment 140,');
  await page.evaluate((text) => resetEditor(`\\section{Results}\n${text}\n`), longOld);
  const longRange = { from: '\\section{Results}\n'.length, to: '\\section{Results}\n'.length + longOld.length };
  await capture([longRange], 1);
  await send('修语法');
  await reply('只改了两处语法。\n\n```latex\n' + longNew + '\n```');
  const longCard = page.locator('.ole-card').last();
  assert.equal(await longCard.locator('.ole-diffview del').count(), 2);
  assert.deepEqual(await longCard.locator('.ole-diffview ins').allInnerTexts(), ['has', 'than']);
  assert.match(await longCard.locator('.ole-card-title').innerText(), /2/);
  assert.ok(await longCard.locator('.ole-fold').count() >= 2, 'long unchanged text is folded');
  await page.locator('#ole-panel').screenshot({ path: path.join(outputDir, 'long-passage-diff.png') });
  await longCard.locator('.ole-fold').first().click();
  assert.equal(await longCard.locator('.ole-diffview').evaluate((el) => el.textContent.includes('In experiment 70,')), true);
  // Only the two changed words reach the editor, so the rest of the passage is not rewritten (Overleaf track changes
  // marks just these words).
  await page.evaluate(() => { const orig = editor.dispatch.bind(editor); window.dispatched = []; editor.dispatch = (...a) => { window.dispatched.push(a[0]); return orig(...a); }; });
  await longCard.locator('.ole-apply').click();
  await page.waitForFunction((text) => editor.state.doc.toString().includes(text), longNew);
  assert.equal(await page.evaluate(() => editor.state.doc.toString()), `\\section{Results}\n${longNew}\n`);
  assert.deepEqual(await page.evaluate(() => window.dispatched.filter((d) => d.changes).map((d) => d.changes.map((c) => c.insert))), [['has', 'than']]);
  await page.evaluate(() => { delete editor.dispatch; });

  // A rewrite that drops a citation key is flagged on the card.
  const citeOld = 'Deep models \\cite{lecun2015,goodfellow2016} work well.';
  await page.evaluate((text) => resetEditor(`\\section{Intro}\n${text}\n`), citeOld);
  await capture([{ from: '\\section{Intro}\n'.length, to: '\\section{Intro}\n'.length + citeOld.length }], 1);
  await send('精简');
  await reply('```latex\nDeep models \\cite{lecun2015} work well.\n```');
  const citeCard = page.locator('.ole-card').last();
  assert.match(await citeCard.locator('.ole-keys').innerText(), /(去掉了|removed) goodfellow2016/);
  assert.equal(await citeCard.locator('.ole-apply').isDisabled(), false, 'adding or removing citations can be intended, so it is only a warning');

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
  console.log('Multi-selection PASS: append, deduplicate, overlap/file rejection, remove, native ranges, ask/edit payload, strict IDs, independent previews, clear selection from the card, long-passage diff, atomic apply, untouched gaps, one undo, distant context and ambiguous relocation.');
};
