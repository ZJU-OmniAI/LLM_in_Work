// A small in-memory stand-in for the parts of the PowerPoint JavaScript API that the pane uses.
// Behaviour follows what PowerPoint 16.109 (Mac) did in manual probes:
//   - paragraphs are separated by \r, line breaks inside a paragraph by \v;
//   - textRange.getSubstring(start, 0).text = s inserts s with the formatting of the character on its left;
//   - replacing a range keeps the formatting of the first replaced character;
//   - an inserted \r starts a new paragraph at the same indent level;
//   - the selected text range of a selected shape is its whole text; getItemOrNullObject finds grouped shapes by ID.
// Writes apply immediately (the real API queues them until sync, in the same order), so reads are always current.

const nullObject = () => ({ isNullObject: true, load() { return this; } });

function makeChars(spec) {
  const chars = [];
  const paras = spec.paras || [{ text: spec.text || '' }];
  paras.forEach((p, i) => {
    const runs = p.runs || [[p.text || '', {}]];
    for (const [text, fmt] of runs) for (const ch of text) chars.push({ ch, bold: !!fmt.bold, color: fmt.color || null, level: p.level || 0 });
    if (i < paras.length - 1) chars.push({ ch: '\r', bold: false, color: null, level: p.level || 0 });
  });
  return chars;
}

export function createFakePowerPoint(deckSpec, { apiVersion = '1.10' } = {}) {
  const log = [];
  const deck = {
    slides: deckSpec.slides.map((s) => ({ id: s.id, shapes: s.shapes.map(function mk(sh) {
      return {
        id: sh.id, name: sh.name || `Shape ${sh.id}`, type: sh.type || 'TextBox', left: sh.left ?? 0, top: sh.top ?? 0,
        ph: sh.ph || null,
        chars: ['Table', 'Group', 'Image'].includes(sh.type) ? null : makeChars(sh),
        values: sh.values ? sh.values.map((r) => [...r]) : null,
        merged: !!sh.merged,
        children: sh.shapes ? sh.shapes.map(mk) : null,
      };
    }) })),
    selection: { slides: [deckSpec.slides[0].id], shapes: [], text: null },
  };
  const textOf = (shape) => shape.chars.map((c) => c.ch).join('');
  const findShape = (slide, id) => {
    const walk = (list) => { for (const s of list) { if (s.id === id) return s; if (s.children) { const f = walk(s.children); if (f) return f; } } return null; };
    return walk(slide.shapes);
  };
  const slideOf = (shape) => deck.slides.find((sl) => findShape(sl, shape.id) === shape);

  function textRange(shape, start, length) {
    const full = () => textOf(shape);
    return {
      isNullObject: false,
      get start() { return start; },
      get length() { return length == null ? -1 : length; },
      get text() { return length == null ? full() : full().substr(start, length); },
      set text(value) {
        const s = String(value);
        const len = length == null ? shape.chars.length - start : length;
        const src = len > 0 ? shape.chars[start] : (shape.chars[start - 1] && shape.chars[start - 1].ch !== '\r' ? shape.chars[start - 1] : shape.chars[start] || shape.chars[start - 1]);
        const base = src || { bold: false, color: null, level: 0 };
        const fresh = [...s].map((ch) => ({ ch, bold: base.bold, color: base.color, level: base.level }));
        shape.chars.splice(start, len, ...fresh);
        log.push({ op: 'text', shape: shape.id, start, del: len, ins: s });
        if (length != null) length = s.length;
      },
      font: { get bold() { const cs = shape.chars.slice(start, start + (length ?? shape.chars.length)); return cs.every((c) => c.bold) ? true : cs.some((c) => c.bold) ? null : false; }, load() { return this; } },
      load() { return this; },
      getSubstring(s, l) {
        const base = start;
        if (s < 0 || s + (l ?? 0) > full().length - base) throw Object.assign(new Error('InvalidArgument'), { code: 'InvalidArgument' });
        return textRange(shape, base + s, l == null ? full().length - base - s : l);
      },
      setSelected() { const sl = slideOf(shape); deck.selection = { slides: [sl.id], shapes: [shape.id], text: { shape, start, length: length ?? full().length } }; },
      getParentTextFrame() { return textFrame(shape); },
    };
  }
  function textFrame(shape) {
    return {
      isNullObject: false,
      get hasText() { return textOf(shape).length > 0; },
      get textRange() { return textRange(shape, 0, null); },
      load() { return this; },
      getParentShape() { return shapeApi(shape); },
    };
  }
  function table(shape) {
    return {
      get values() { return shape.values.map((r) => [...r]); },
      get rowCount() { return shape.values.length; },
      get columnCount() { return shape.values[0] ? shape.values[0].length : 0; },
      load() { return this; },
      getCellOrNullObject(r, c) {
        if (!shape.values[r] || c >= shape.values[r].length) return nullObject();
        return { isNullObject: false, get text() { return shape.values[r][c]; }, set text(v) { shape.values[r][c] = String(v); log.push({ op: 'cell', r, c, v }); }, load() { return this; } };
      },
      getMergedAreas() { return { items: shape.merged ? [{}] : [], load() { return this; } }; },
      rows: {
        // Row objects are bound when loaded; deleting several in one batch removes exactly those rows.
        get items() {
          return shape.values.map((row) => ({ delete() { const k = shape.values.indexOf(row); if (k >= 0) { shape.values.splice(k, 1); log.push({ op: 'deleteRow', k }); } } }));
        },
        load() { return this; },
        add(index, count = 1) {
          if (Number(String(apiVersion).split('.')[1]) < 9) throw new Error('rows.add requires PowerPointApi 1.9');
          const cols = shape.values[0] ? shape.values[0].length : 0;
          const at = index == null ? shape.values.length : index;
          if (at > shape.values.length) throw Object.assign(new Error('InvalidArgument'), { code: 'InvalidArgument' });
          for (let k = 0; k < count; k++) shape.values.splice(at, 0, Array(cols).fill(''));
          log.push({ op: 'addRow', at, count });
        },
      },
    };
  }
  function shapeApi(shape) {
    return {
      isNullObject: false,
      get id() { return shape.id; }, get name() { return shape.name; }, get type() { return shape.type; },
      get left() { return shape.left; }, get top() { return shape.top; },
      load() { return this; },
      get textFrame() { if (!shape.chars) throw Object.assign(new Error('The shape has no text frame'), { code: 'InvalidArgument' }); return textFrame(shape); },
      getTextFrameOrNullObject() { return shape.chars ? textFrame(shape) : nullObject(); },
      getTable() { if (!shape.values) throw new Error('not a table'); return table(shape); },
      get placeholderFormat() { return { get type() { return shape.ph; }, load() { return this; } }; },
      get group() { return { shapes: collection(shape.children || []) }; },
      getParentSlideOrNullObject() { const sl = slideOf(shape); return sl ? slideApi(sl) : nullObject(); },
    };
  }
  function collection(list, slide) {
    return {
      get items() { return list.map(shapeApi); },
      load() { return this; },
      getItem(id) { const s = slide ? findShape(slide, id) : list.find((x) => x.id === id); if (!s) throw Object.assign(new Error('ItemNotFound'), { code: 'ItemNotFound' }); return shapeApi(s); },
      getItemOrNullObject(id) { const s = slide ? findShape(slide, id) : list.find((x) => x.id === id); return s ? shapeApi(s) : nullObject(); },
    };
  }
  function slideApi(slide) {
    return {
      isNullObject: false,
      get id() { return slide.id; },
      load() { return this; },
      get shapes() { return collection(slide.shapes, slide); },
      setSelectedShapes(ids) { deck.selection = { slides: [slide.id], shapes: [...ids], text: null }; },
      getImageAsBase64() { return { value: Buffer.from(`PNG:${slide.id}`).toString('base64') }; },
    };
  }
  const slides = {
    get items() { return deck.slides.map(slideApi); },
    load() { return this; },
    getItem(id) { const s = deck.slides.find((x) => x.id === id); if (!s) throw Object.assign(new Error('ItemNotFound'), { code: 'ItemNotFound' }); return slideApi(s); },
    getItemOrNullObject(id) { const s = deck.slides.find((x) => x.id === id); return s ? slideApi(s) : nullObject(); },
  };
  const presentation = {
    slides,
    getSelectedSlides() { return { items: deck.selection.slides.map((id) => slideApi(deck.slides.find((s) => s.id === id))), load() { return this; } }; },
    getSelectedShapes() {
      const slide = deck.slides.find((s) => s.id === deck.selection.slides[0]);
      return { items: deck.selection.shapes.map((id) => shapeApi(findShape(slide, id))), load() { return this; } };
    },
    getSelectedTextRangeOrNullObject() {
      const sel = deck.selection;
      if (sel.text) return textRange(sel.text.shape, sel.text.start, sel.text.length);
      if (sel.shapes.length === 1) {
        const slide = deck.slides.find((s) => s.id === sel.slides[0]);
        const shape = findShape(slide, sel.shapes[0]);
        if (shape && shape.chars) return textRange(shape, 0, shape.chars.length);
        // PowerPoint 16.109: with a group selected, loading the selected range's start fails.
        if (shape && shape.type === 'Group') return { isNullObject: false, load() { throw Object.assign(new Error('InvalidArgument'), { code: 'InvalidArgument' }); } };
      }
      return nullObject();
    },
    setSelectedSlides(ids) { deck.selection = { slides: [...ids], shapes: [], text: null }; },
  };
  const api = {
    run: async (fn) => fn({ presentation, sync: async () => {} }),
    // --- test helpers ---
    deck, log,
    shape(slideId, shapeId) { return findShape(deck.slides.find((s) => s.id === slideId), shapeId); },
    text(slideId, shapeId) { return textOf(api.shape(slideId, shapeId)); },
    select({ slide, shapes = [], text = null }) {
      const sl = deck.slides.find((s) => s.id === slide);
      deck.selection = { slides: [slide], shapes, text: text ? { shape: findShape(sl, text.shape), start: text.start, length: text.length } : null };
    },
    selectSlides(ids) { deck.selection = { slides: ids, shapes: [], text: null }; },
  };
  return api;
}

export const sampleDeck = () => ({
  slides: [
    { id: '256#0', shapes: [
      { id: '2', name: 'Title 1', type: 'Placeholder', ph: 'CenterTitle', top: 160, left: 50, text: 'Q3 Product Review' },
      { id: '3', name: 'Subtitle 2', type: 'Placeholder', ph: 'Subtitle', top: 300, left: 100, text: 'Growth team · September 2026' },
      { id: '9', name: 'Footer 3', type: 'Placeholder', ph: 'Footer', top: 500, left: 50, text: 'Confidential' },
    ] },
    { id: '257#0', shapes: [
      { id: '3', name: 'Content Placeholder 2', type: 'Placeholder', ph: 'Content', top: 126, left: 36, paras: [
        { text: 'Revenue grew 23% year over year' },
        { runs: [['Active users passed ', {}], ['1 million', { bold: true }], [' for the first time', {}]] },
        { text: 'Churn fell to 2.1%', level: 1 },
        { runs: [['Next quarter we will focus on retention\vand on two new markets', { color: '#C0392B' }]] },
      ] },
      { id: '2', name: 'Title 1', type: 'Placeholder', ph: 'Title', top: 22, left: 36, text: 'Key results this quarter' },
    ] },
    { id: '258#0', shapes: [
      { id: '2', name: 'Title 1', type: 'Placeholder', ph: 'Title', top: 22, left: 36, text: 'Regional revenue' },
      { id: '3', name: 'Table 2', type: 'Table', top: 144, left: 72, values: [['Region', 'Q2', 'Q3'], ['North', '1.2M', '1.5M'], ['South', '0.8M', '0.9M']] },
      { id: '4', name: 'Table 3', type: 'Table', top: 300, left: 72, merged: true, values: [['A', ''], ['B', 'C']] },
    ] },
    { id: '259#0', shapes: [
      { id: '2', name: 'TextBox 1', type: 'TextBox', top: 43, left: 72, text: '我们的目标是在明年实现盈利，并把客户满意度提升到九十分以上。' },
      { id: '3', name: 'Group 2', type: 'Group', top: 216, left: 72, shapes: [
        { id: '4', name: 'TextBox 3', type: 'TextBox', top: 216, left: 72, text: 'Left note inside a group' },
        { id: '5', name: 'TextBox 4', type: 'TextBox', top: 216, left: 400, text: 'Right note inside a group' },
      ] },
      { id: '6', name: 'Picture 5', type: 'Image', top: 400, left: 72 },
    ] },
  ],
});
