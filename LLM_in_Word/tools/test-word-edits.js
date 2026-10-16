import test from 'node:test';
import assert from 'node:assert/strict';

await import('../taskpane/diff-utils.js'); // UMD 副作用挂到 globalThis
await import('../taskpane/word-edits.js');
const { stripFields, plan, applyToString, touchedFields, escapeSearch } = globalThis.WordEdits;

// A Zotero citation the way getReviewedText returns it: \x13 code \x14 result \x15. The code repeats words of the text,
// because Word's search also finds words inside field codes.
const cite = (n) => `\x13 ADDIN ZOTERO_ITEM CSL_CITATION {"citationID":"c${n}","abstract":"Adoption grew quickly in sunny regions. 光伏装机增长很快。"} \x14(${n})\x15`;
const visible = (raw) => stripFields(raw).text.replace(/\r/g, '\n');
const codes = (raw) => raw.match(/\x13[^\x14\x15]*/g) || [];
function roundTrip(raw, next) {
  const p = plan(raw, next);
  assert.equal(p.ok, true, JSON.stringify(p));
  const out = applyToString(raw, p.steps);
  assert.equal(visible(out).replace(/\n+$/, ''), next.replace(/\n+$/, ''));
  assert.deepEqual(codes(out), codes(raw), 'field codes are untouched');
  return p;
}

test('stripFields keeps citation results and reports where they are', () => {
  const raw = `Adoption grew ${cite(1)} and slowed ${cite(2)}.`;
  const { text, fields } = stripFields(raw);
  assert.equal(text, 'Adoption grew (1) and slowed (2).');
  assert.deepEqual(fields.map(([a, b]) => text.slice(a, b)), ['(1)', '(2)']);
  assert.equal(stripFields('no fields').fields.length, 0);
  assert.equal(stripFields('a\x13 PAGE \x15b').text, 'ab', 'a field without a result leaves nothing');
  assert.equal(stripFields('x\x13 IF \x13 REF a \x14A\x15 = 1 "yes" \x14yes\x15y').text, 'xyesy', 'nested field codes are removed');
});

test('word edits leave the citations alone', () => {
  const raw = `Adoption grew quickly in sunny regions ${cite(1)} and slowed where grids were weak ${cite(2)}.`;
  const p = roundTrip(raw, 'Adoption grew rapidly in sunny regions (1) and slowed where grids were weak and unreliable (2).');
  assert.equal(p.steps.length, 2);
  assert.equal(p.fields, 2);
  for (const st of p.steps) assert.ok(!/[\x13-\x15]|\(\d\)/.test(st.window), 'search words never cross a citation');
});

test('text right next to a citation can still be changed', () => {
  const raw = `Solar grew${cite(1)} fast. Grids lag${cite(2)}`;
  roundTrip(raw, 'Solar adoption grew(1) quickly. Grids lag(2)');
  roundTrip(raw, 'Solar grew(1) fast. Old grids lag behind(2)');
  roundTrip(raw, 'Solar grew(1) fast. Grids lag(2) today');
});

test('changing a citation is refused, not written as plain text', () => {
  const raw = `Adoption grew ${cite(1)} and slowed ${cite(2)}.`;
  for (const next of ['Adoption grew (1, 2) and slowed.', 'Adoption grew and slowed (2).', 'Adoption grew (3) and slowed (2).', 'Adoption grew (x1) and slowed (2).']) {
    const p = plan(raw, next);
    assert.equal(p.ok, false, next);
    assert.equal(p.reason, 'fields');
  }
  assert.equal(touchedFields('Adoption grew (1) and slowed (2).', 'Adoption grew (1, 2) and slowed.', [[14, 17], [29, 32]]), 2);
  assert.equal(touchedFields('Adoption grew (1) and slowed (2).', 'Adoption rose (1) and slowed (2).', [[14, 17], [29, 32]]), 0);
});

test('repeated words are located by their own surroundings', () => {
  const raw = 'the data and the model and the data again';
  const p = roundTrip(raw, 'the data and a model and the data again');
  assert.equal(p.steps.length, 1);
  roundTrip('aaaa aaaa aaaa', 'aaaa aaab aaaa');
});

test('Chinese text, paragraphs and special characters', () => {
  roundTrip(`这个方法在实验中表现的很好${cite(1)}，但是它的的计算开销比较大。\r第二段不变。`, '这个方法在实验中表现得很好(1)，但是它的计算开销比较大。\n第二段不变。');
  roundTrip('First paragraph.\rSecond paragraph.', 'First paragraph.\nAn inserted paragraph.\nSecond paragraph.');
  roundTrip('First paragraph.\rSecond paragraph.\rThird.', 'First paragraph.\nThird.');
  roundTrip('Cost^2 rose\tsharply.', 'Cost^2 rose\tvery sharply.');
  assert.equal(escapeSearch('a^b\rc\vd\te'), 'a^^b^pc^ld^te');
});

test('a long deletion is located by its first and last words', () => {
  const long = Array.from({ length: 40 }, (_, i) => `Sentence ${i} repeats the same idea again.`).join(' ');
  const raw = `Keep this. ${long} Keep that ${cite(1)}.`;
  const p = roundTrip(raw, 'Keep this. Keep that (1).');
  assert.equal(p.steps[0].mode, 'Span');
  assert.ok(p.steps[0].head.length <= 240 && p.steps[0].tail.length <= 240);
});

test('unchanged text needs no steps; trailing paragraph marks are ignored', () => {
  assert.deepEqual(plan(`Same ${cite(1)}.\r`, 'Same (1).').steps, []);
});

test('random edits away from citations always round-trip in Word search semantics', () => {
  let seed = 11;
  const rand = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const words = ['solar', 'grid', 'the', 'adoption', 'grew', 'quickly', 'in', 'regions', '光伏', '增长', 'and', 'data'];
  let checked = 0;
  for (let k = 0; k < 300; k++) {
    const parts = [];
    for (let i = 0; i < 6 + rand(20); i++) {
      if (rand(6) === 0) parts.push(cite(i));
      else parts.push(words[rand(words.length)] + (rand(5) === 0 ? '.' : '') + (rand(9) === 0 ? '\r' : ' '));
    }
    const raw = parts.join('');
    const { text, fields } = stripFields(raw);
    // edit a few words outside the citations
    let next = text.replace(/\r/g, '\n');
    const tokens = next.split(/(\s+)/);
    let pos = 0;
    const out = tokens.map((tk) => {
      const at = pos; pos += tk.length;
      const inField = fields.some(([a, b]) => at < b && at + tk.length > a);
      if (inField || /^\s+$/.test(tk) || !tk) return tk;
      const r = rand(8);
      return r === 0 ? '' : r === 1 ? tk + ' new' : r === 2 ? 'changed' : tk;
    });
    next = out.join('');
    const p = plan(raw, next);
    if (!p.ok) { assert.equal(p.reason, 'locate', JSON.stringify(p)); continue; }
    const res = applyToString(raw, p.steps);
    assert.equal(visible(res).replace(/\n+$/, ''), next.replace(/\n+$/, ''), raw);
    assert.deepEqual(codes(res), codes(raw));
    checked++;
  }
  assert.ok(checked > 250, `${checked} plans`);
});
