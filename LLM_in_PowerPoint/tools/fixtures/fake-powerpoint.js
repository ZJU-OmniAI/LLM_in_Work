// A small in-memory stand-in for the parts of the PowerPoint JavaScript API that the pane uses.
// Behaviour follows what PowerPoint 16.109 (Mac) did in manual probes:
//   - paragraphs are separated by \r, line breaks inside a paragraph by \v;
//   - textRange.getSubstring(start, 0).text = s inserts s with the formatting of the character on its left;
//   - replacing a range keeps the formatting of the first replaced character;
//   - an inserted \r starts a new paragraph at the same indent level;
//   - the selected text range of a selected shape is its whole text; getItemOrNullObject finds grouped shapes by ID.
// Writes apply immediately (the real API queues them until sync, in the same order), so reads are always current.
// Formatting (format mode): shapes carry width/height/rotation, fill, lineFormat and a z-order (their index among
// siblings); characters carry font name/size/color/bold/italic/underline and their paragraph's alignment, and a
// range's font property reads null when the range mixes values (as PowerPoint does). Table cells carry fill, font,
// four borders and alignment. pageSetup, slide backgrounds and theme colours need PowerPointApi 1.10.
// Readings as observed in PowerPoint 16.109: horizontal alignment reads as the enum's index (0 = Left; writes take the
// name or the index); a shape without fill reads foregroundColor "" and transparency -1, a hidden line color "" and
// weight/transparency -1. A table with a table style (spec.tableStyle) draws its fills, borders and text colours from
// the style: such cells read NoFill (color null, transparency 1), borders with every property null, and the default
// black, non-bold font. A border that was set reads transparency 1 and dashStyle null unless a dash was written.
// fill.clear() on a cell returns it to the style; re-applying styleSettings.style drops every cell's direct fill and
// borders but keeps fonts; a font property cannot be unset (null throws InvalidArgument).
// Whole-slide redesign: shapes.addGeometricShape / addLine / addTextBox create shapes the way 16.109 does (a new text
// box's Chinese text defaults to 宋体; a geometric shape's text is white and centred; a line created with height 0
// comes out 72 pt high until its height is set again), shape.delete(), RoundRectangle adjustments, text-frame
// autosize / margins / word wrap. slide.exportAsBase64() and presentation.insertSlidesFromBase64() copy a slide
// exactly (shape IDs kept, new slide ID), and getImageAsBase64() is a hash of everything visible, so "looks the
// same" checks work.
import { createHash } from 'node:crypto';

const nullObject = () => ({ isNullObject: true, load() { return this; } });

const FONT_DEFAULT = { name: 'Calibri', size: 18, color: '#000000', bold: false, italic: false, underline: 'None' };
const ALIGN_ENUM = ['Left', 'Center', 'Right', 'Justify', 'JustifyLow', 'Distributed', 'ThaiDistributed'];
const alignIn = (v) => (typeof v === 'number' ? ALIGN_ENUM[v] : v);
const alignOut = (v) => (v == null ? null : ALIGN_ENUM.indexOf(v));
const invalid = () => Object.assign(new Error('InvalidArgument'), { code: 'InvalidArgument' });
function charOf(ch, fmt, p) {
  return { ch, ...FONT_DEFAULT, ...(p.font || {}), ...fmt, bold: !!fmt.bold, color: fmt.color || (p.font && p.font.color) || FONT_DEFAULT.color, level: p.level || 0, align: p.align || 'Left' };
}
function makeChars(spec) {
  const chars = [];
  const paras = spec.paras || [{ text: spec.text || '', font: spec.font, align: spec.align }];
  paras.forEach((p, i) => {
    const pp = { ...p, font: p.font || spec.font, align: p.align || spec.align };
    const runs = p.runs || [[p.text || '', {}]];
    for (const [text, fmt] of runs) for (const ch of text) chars.push(charOf(ch, fmt, pp));
    if (i < paras.length - 1) chars.push(charOf('\r', {}, pp));
  });
  return chars;
}
const FILL = (f) => (f == null || f === 'none' ? { type: 'NoFill', color: '#FFFFFF', transparency: 0 } : typeof f === 'string' ? { type: 'Solid', color: f, transparency: 0 } : { type: 'Solid', transparency: 0, ...f });
const LINE = (l) => (l == null || l === 'none' ? { visible: false, color: '#000000', weight: 0.75, dashStyle: 'Solid', transparency: 0 } : { visible: true, color: '#000000', weight: 1, dashStyle: 'Solid', transparency: 0, ...(typeof l === 'string' ? { color: l } : l) });
const BORDER = (b) => ({ color: '#000000', weight: 1, dashStyle: 'Solid', transparency: 0, ...(b || {}) });
const STYLE_FILL = () => ({ type: 'NoFill', color: null, transparency: 1, style: true });
const STYLE_BORDER = () => ({ color: null, weight: null, dashStyle: null, transparency: null });
function cellFormats(sh) {
  if (!sh.values) return null;
  if (sh.tableStyle) {
    return sh.values.map((row) => row.map(() => ({
      fill: STYLE_FILL(), font: { ...FONT_DEFAULT, name: null },
      borders: { top: STYLE_BORDER(), bottom: STYLE_BORDER(), left: STYLE_BORDER(), right: STYLE_BORDER() },
      align: 'Left', valign: 'Top',
    })));
  }
  return sh.values.map((row, r) => row.map(() => ({
    fill: FILL(r === 0 ? (sh.headerFill ?? '#4472C4') : (sh.bodyFill ?? null)),
    font: { ...FONT_DEFAULT, size: 14, ...(r === 0 ? { bold: true, color: '#FFFFFF' } : {}) },
    borders: { top: BORDER(sh.border), bottom: BORDER(sh.border), left: BORDER(sh.border), right: BORDER(sh.border) },
    align: 'Left', valign: 'Top',
  })));
}

export function createFakePowerPoint(deckSpec, { apiVersion = '1.10' } = {}) {
  const log = [];
  const deck = {
    slides: deckSpec.slides.map((s) => ({ id: s.id, shapes: s.shapes.map(function mk(sh) {
      return {
        id: sh.id, name: sh.name || `Shape ${sh.id}`, type: sh.type || 'TextBox', left: sh.left ?? 0, top: sh.top ?? 0,
        width: sh.width ?? 300, height: sh.height ?? 60, rotation: sh.rotation ?? 0,
        fill: FILL(sh.fill), line: LINE(sh.line), valign: sh.valign || 'Top',
        tf: { autoSizeSetting: sh.autoSize || (sh.type === 'Placeholder' ? 'AutoSizeTextToFitShape' : sh.type === 'TextBox' || !sh.type ? 'AutoSizeShapeToFitText' : 'AutoSizeNone'),
          wordWrap: true, leftMargin: 7.2, rightMargin: 7.2, topMargin: 3.6, bottomMargin: 3.6 },
        geom: sh.geom || null, adj: sh.geom === 'RoundRectangle' ? [0.16667] : [],
        cellFmt: null,
        ph: sh.ph || null,
        chars: ['Table', 'Group', 'Image'].includes(sh.type) ? null : makeChars(sh),
        values: sh.values ? sh.values.map((r) => [...r]) : null,
        tableStyle: sh.values ? sh.tableStyle || 'NoStyleNoGrid' : null,
        merged: !!sh.merged,
        children: sh.shapes ? sh.shapes.map(mk) : null,
      };
    }), background: s.background ? { follows: false, fill: FILL(s.background) } : { follows: true, fill: FILL('#FFFFFF') } })),
    selection: { slides: [deckSpec.slides[0].id], shapes: [], text: null },
    page: deckSpec.page || { w: 960, h: 540 },
    theme: deckSpec.theme || { Dark1: '#000000', Light1: '#FFFFFF', Dark2: '#44546A', Light2: '#E7E6E6', Accent1: '#4472C4', Accent2: '#ED7D31' },
  };
  const minor = Number(String(apiVersion).split('.')[1]);
  const needs = (v, what) => { if (minor < v) throw Object.assign(new Error(`${what} requires PowerPointApi 1.${v}`), { code: 'ApiNotFound' }); };
  // table cell formats are created lazily so that existing table specs need nothing new
  deckSpec.slides.forEach((s, i) => deck.slides[i].shapes.forEach(function init(sh, k) {
    const spec = s.shapes[k];
    if (sh.values) sh.cellFmt = cellFormats({ ...spec, values: sh.values });
    if (sh.children) sh.children.forEach((c, j) => { if (c.values) c.cellFmt = cellFormats({ ...spec.shapes[j], values: c.values }); });
  }));
  const textOf = (shape) => shape.chars.map((c) => c.ch).join('');
  const findShape = (slide, id) => {
    const walk = (list) => { for (const s of list) { if (s.id === id) return s; if (s.children) { const f = walk(s.children); if (f) return f; } } return null; };
    return walk(slide.shapes);
  };
  const slideOf = (shape) => deck.slides.find((sl) => findShape(sl, shape.id) === shape);
  let slideSeq = 0;

  // A range's font: reads a value only when every character agrees (otherwise null), writes to every character.
  function fontOf(chars, shape) {
    const o = { load() { return this; } };
    for (const k of ['name', 'size', 'color', 'bold', 'italic', 'underline']) {
      Object.defineProperty(o, k, {
        get: () => { const cs = chars().filter((c) => c.ch !== '\r'); return cs.length && cs.every((c) => c[k] === cs[0][k]) ? cs[0][k] : null; },
        set: (v) => { for (const c of chars()) c[k] = v; log.push({ op: 'font', shape: shape.id, k, v }); },
        enumerable: true,
      });
    }
    return o;
  }
  function plainFont(get, set) {
    const o = { load() { return this; } };
    for (const k of ['name', 'size', 'color', 'bold', 'italic', 'underline']) Object.defineProperty(o, k, { get: () => get()[k], set: (v) => { if (v == null) throw invalid(); set(k, v); }, enumerable: true });
    return o;
  }
  function fillApi(get, set, cell) {
    const none = (f) => f.type === 'NoFill';
    return {
      get type() { return get().type; },
      get foregroundColor() { return none(get()) ? (cell ? null : '') : get().color; },
      get transparency() { return none(get()) ? (cell ? 1 : -1) : get().transparency; }, set transparency(v) { set({ ...get(), transparency: v }); },
      setSolidColor(c) { set({ type: 'Solid', color: c, transparency: 0 }); },
      clear() { set(cell ? STYLE_FILL() : { type: 'NoFill', color: get().color, transparency: 0 }); },
      load() { return this; },
    };
  }
  const siblings = (shape) => {
    for (const sl of deck.slides) {
      if (sl.shapes.includes(shape)) return sl.shapes;
      const walk = (list) => { for (const s of list) { if (s.children) { if (s.children.includes(shape)) return s.children; const f = walk(s.children); if (f) return f; } } return null; };
      const f = walk(sl.shapes);
      if (f) return f;
    }
    return [shape];
  };

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
        const base = src || shape.textDefault || { ...FONT_DEFAULT, level: 0, align: 'Left' };
        const fresh = [...s].map((ch) => ({ ...base, ch }));
        shape.chars.splice(start, len, ...fresh);
        log.push({ op: 'text', shape: shape.id, start, del: len, ins: s });
        if (length != null) length = s.length;
      },
      get font() { return fontOf(() => shape.chars.slice(start, start + (length ?? shape.chars.length)), shape); },
      get paragraphFormat() {
        const paras = () => {
          const text = full();
          const end = start + (length ?? text.length);
          let a = text.lastIndexOf('\r', start - 1) + 1, b = text.indexOf('\r', Math.max(start, end - 1));
          if (b < 0) b = text.length;
          return shape.chars.slice(a, b);
        };
        return {
          get horizontalAlignment() { const cs = paras(); return cs.length && cs.every((c) => c.align === cs[0].align) ? alignOut(cs[0].align) : null; },
          set horizontalAlignment(v) { for (const c of paras()) c.align = alignIn(v); log.push({ op: 'align', shape: shape.id, v }); },
          get bulletFormat() {
            return {
              get visible() { const cs = paras(); return cs.length ? cs[0].bullet !== false : null; },
              set visible(v) { for (const c of paras()) c.bullet = !!v; log.push({ op: 'bullet', shape: shape.id, v }); },
              load() { return this; },
            };
          },
          get indentLevel() { const cs = paras(); return cs.length ? cs[0].level || 0 : 0; },
          load() { return this; },
        };
      },
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
    const o = {
      isNullObject: false,
      get hasText() { return textOf(shape).length > 0; },
      get textRange() { return textRange(shape, 0, null); },
      get verticalAlignment() { return shape.valign; },
      set verticalAlignment(v) { shape.valign = v; log.push({ op: 'valign', shape: shape.id, v }); },
      load() { return this; },
      getParentShape() { return shapeApi(shape); },
    };
    for (const k of ['autoSizeSetting', 'wordWrap', 'leftMargin', 'rightMargin', 'topMargin', 'bottomMargin']) {
      Object.defineProperty(o, k, { get: () => shape.tf[k], set: (v) => { shape.tf[k] = v; log.push({ op: 'textFrame', shape: shape.id, k, v }); }, enumerable: true });
    }
    return o;
  }
  function table(shape) {
    const fmtAll = () => { if (!shape.cellFmt) shape.cellFmt = cellFormats(shape); return shape.cellFmt; };
    return {
      get styleSettings() {
        needs(9, 'styleSettings');
        return {
          get style() { return shape.tableStyle; },
          set style(v) {
            // Re-applying a table style drops every cell's direct fill and borders; fonts stay.
            shape.tableStyle = v;
            for (const row of fmtAll()) for (const f of row) { f.fill = STYLE_FILL(); for (const k of Object.keys(f.borders)) f.borders[k] = STYLE_BORDER(); }
            log.push({ op: 'tableStyle', shape: shape.id, v });
          },
          load() { return this; },
        };
      },
      get values() { return shape.values.map((r) => [...r]); },
      get rowCount() { return shape.values.length; },
      get columnCount() { return shape.values[0] ? shape.values[0].length : 0; },
      load() { return this; },
      getCellOrNullObject(r, c) {
        if (!shape.values[r] || c >= shape.values[r].length) return nullObject();
        if (!shape.cellFmt || !shape.cellFmt[r]) shape.cellFmt = cellFormats(shape);
        const fmt = () => shape.cellFmt[r][c];
        return {
          isNullObject: false, rowIndex: r, columnIndex: c,
          get text() { return shape.values[r][c]; }, set text(v) { shape.values[r][c] = String(v); log.push({ op: 'cell', r, c, v }); },
          get fill() { needs(9, 'cell.fill'); return fillApi(() => fmt().fill, (v) => { fmt().fill = v; log.push({ op: 'cellFill', r, c, v }); }, true); },
          get font() { needs(9, 'cell.font'); return plainFont(() => fmt().font, (k, v) => { fmt().font[k] = v; log.push({ op: 'cellFont', r, c, k, v }); }); },
          get borders() {
            needs(9, 'cell.borders');
            const side = (s) => {
              const b = () => fmt().borders[s];
              const o = { load() { return this; } };
              for (const k of ['color', 'weight', 'dashStyle', 'transparency']) {
                Object.defineProperty(o, k, {
                  get: () => (k === 'transparency' ? (b().weight == null ? null : 1) : b()[k]),
                  set: (v) => {
                    if (v == null) throw invalid();
                    if (b().weight == null) fmt().borders[s] = { color: '#000000', weight: 1, dashStyle: null, transparency: 0 };
                    b()[k] = v; log.push({ op: 'border', r, c, s, k, v });
                  },
                  enumerable: true,
                });
              }
              return o;
            };
            return { top: side('top'), bottom: side('bottom'), left: side('left'), right: side('right'), load() { return this; } };
          },
          get horizontalAlignment() { return alignOut(fmt().align); }, set horizontalAlignment(v) { needs(9, 'cell alignment'); fmt().align = alignIn(v); },
          get verticalAlignment() { return fmt().valign; }, set verticalAlignment(v) { needs(9, 'cell alignment'); fmt().valign = v; },
          load() { return this; },
        };
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
      get id() { return shape.id; }, get name() { return shape.name; }, set name(v) { shape.name = v; }, get type() { return shape.type; },
      delete() { const list = siblings(shape); const i = list.indexOf(shape); if (i >= 0) list.splice(i, 1); log.push({ op: 'deleteShape', shape: shape.id }); },
      get adjustments() {
        needs(10, 'adjustments');
        return {
          get count() { return shape.adj.length; },
          get(i) { if (i >= shape.adj.length) throw invalid(); return { value: shape.adj[i] }; },
          set(i, v) { if (i >= shape.adj.length) throw invalid(); shape.adj[i] = v; log.push({ op: 'adjust', shape: shape.id, i, v }); },
          load() { return this; },
        };
      },
      get left() { return shape.left; }, get top() { return shape.top; },
      set left(v) { shape.left = v; log.push({ op: 'left', shape: shape.id, v }); }, set top(v) { shape.top = v; log.push({ op: 'top', shape: shape.id, v }); },
      get width() { return shape.width; }, set width(v) { shape.width = v; log.push({ op: 'width', shape: shape.id, v }); },
      get height() { return shape.height; }, set height(v) { shape.height = v; log.push({ op: 'height', shape: shape.id, v }); },
      get rotation() { needs(10, 'rotation'); return shape.rotation; }, set rotation(v) { needs(10, 'rotation'); shape.rotation = v; },
      get fill() {
        if (['Group', 'Table'].includes(shape.type)) throw Object.assign(new Error('InvalidArgument'), { code: 'InvalidArgument' });
        return fillApi(() => shape.fill, (v) => { shape.fill = v; log.push({ op: 'fill', shape: shape.id, v }); });
      },
      get lineFormat() {
        if (['Group', 'Table'].includes(shape.type)) throw Object.assign(new Error('InvalidArgument'), { code: 'InvalidArgument' });
        const o = { load() { return this; } };
        const hidden = { color: '', weight: -1, transparency: -1 };
        for (const k of ['visible', 'color', 'weight', 'dashStyle', 'transparency']) Object.defineProperty(o, k, { get: () => (!shape.line.visible && k in hidden ? hidden[k] : shape.line[k]), set: (v) => { shape.line[k] = v; log.push({ op: 'line', shape: shape.id, k, v }); }, enumerable: true });
        return o;
      },
      get zOrderPosition() { needs(8, 'zOrderPosition'); return siblings(shape).indexOf(shape); },
      setZOrder(pos) {
        needs(8, 'setZOrder');
        const list = siblings(shape);
        const i = list.indexOf(shape);
        list.splice(i, 1);
        const j = pos === 'BringToFront' ? list.length : pos === 'SendToBack' ? 0 : pos === 'BringForward' ? Math.min(list.length, i + 1) : Math.max(0, i - 1);
        list.splice(j, 0, shape);
        log.push({ op: 'zOrder', shape: shape.id, pos });
      },
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
    const nextId = () => {
      let max = 0;
      const walk = (l) => { for (const x of l) { max = Math.max(max, Number(x.id) || 0); if (x.children) walk(x.children); } };
      walk(slide.shapes);
      return String(max + 1);
    };
    const base = (type, o, extra) => ({
      id: nextId(), name: `${extra.label} ${nextId() - 1}`, type, left: o.left ?? 0, top: o.top ?? 0, width: o.width ?? 100, height: o.height ?? 100, rotation: 0,
      fill: FILL(null), line: LINE(null), valign: 'Top', cellFmt: null, ph: null, chars: [], values: null, tableStyle: null, merged: false, children: null, geom: null, adj: [],
      tf: { autoSizeSetting: 'AutoSizeNone', wordWrap: true, leftMargin: 7.2, rightMargin: 7.2, topMargin: 3.6, bottomMargin: 3.6 },
      ...extra.props,
    });
    const push = (sh) => { slide.shapes.push(sh); log.push({ op: 'addShape', shape: sh.id, type: sh.type, geom: sh.geom }); return shapeApi(sh); };
    return {
      get items() { return list.map(shapeApi); },
      load() { return this; },
      addGeometricShape(geom, o = {}) {
        return push(base('GeometricShape', o, { label: geom, props: {
          geom, adj: geom === 'RoundRectangle' ? [0.16667] : [], fill: FILL('#4472C4'), line: LINE({ color: '#2F528F', weight: 1 }), valign: 'Middle',
          textDefault: { ...FONT_DEFAULT, color: '#FFFFFF', level: 0, align: 'Center' } } }));
      },
      addLine(kind, o = {}) {
        // 16.109: a 0 width or height given at creation comes out as 72 pt until set again
        return push(base('Line', { ...o, width: o.width === 0 ? 72 : o.width, height: o.height === 0 ? 72 : o.height }, { label: 'Straight Connector', props: { chars: null, line: LINE({ color: '#4472C4', weight: 0.75 }) } }));
      },
      addTextBox(text, o = {}) {
        const def = { ...FONT_DEFAULT, name: '宋体', level: 0, align: 'Left' };
        return push(base('TextBox', o, { label: 'TextBox', props: {
          textDefault: def, chars: [...String(text)].map((ch) => ({ ...def, ch })),
          tf: { autoSizeSetting: 'AutoSizeShapeToFitText', wordWrap: true, leftMargin: 7.2, rightMargin: 7.2, topMargin: 3.6, bottomMargin: 3.6 } } }));
      },
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
      // a hash of everything on the slide (not its ID): equal values = the slide looks the same
      getImageAsBase64() { const { id, ...look } = slide; return { value: createHash('sha1').update(JSON.stringify(look)).digest('base64') }; },
      exportAsBase64() { needs(8, 'exportAsBase64'); return { value: Buffer.from(JSON.stringify(slide)).toString('base64') }; },
      delete() { const i = deck.slides.indexOf(slide); if (i >= 0) deck.slides.splice(i, 1); log.push({ op: 'deleteSlide', slide: slide.id }); },
      get background() {
        needs(10, 'background');
        const bg = slide.background;
        return {
          get isMasterBackgroundFollowed() { return bg.follows; },
          fill: {
            get type() { return bg.fill.type; },
            getSolidFillOrNullObject() { return bg.fill.type === 'Solid' ? { isNullObject: false, color: bg.fill.color, transparency: bg.fill.transparency, load() { return this; } } : nullObject(); },
            setSolidFill(o) { bg.follows = false; bg.fill = { type: 'Solid', color: o.color, transparency: o.transparency || 0 }; log.push({ op: 'background', slide: slide.id, o }); },
            load() { return this; },
          },
          reset() { bg.follows = true; bg.fill = FILL('#FFFFFF'); log.push({ op: 'backgroundReset', slide: slide.id }); },
          load() { return this; },
        };
      },
      get themeColorScheme() { needs(10, 'themeColorScheme'); return { getThemeColor: (k) => ({ value: deck.theme[k] || '#000000' }) }; },
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
    get pageSetup() { needs(10, 'pageSetup'); return { slideWidth: deck.page.w, slideHeight: deck.page.h, load() { return this; } }; },
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
    insertSlidesFromBase64(b64, opts = {}) {
      const copy = JSON.parse(Buffer.from(b64, 'base64').toString());
      copy.id = `${300 + (++slideSeq)}#${1000 + slideSeq}`;
      const at = opts.targetSlideId ? deck.slides.findIndex((s) => s.id === opts.targetSlideId) + 1 : deck.slides.length;
      deck.slides.splice(at, 0, copy);
      log.push({ op: 'insertSlide', slide: copy.id, after: opts.targetSlideId });
    },
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
    look(index) { return slideApi(deck.slides[index]).getImageAsBase64().value; },
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
