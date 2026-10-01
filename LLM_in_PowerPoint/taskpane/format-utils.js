// 版式模式的纯函数（浏览器里挂 window.FormatUtils，node 里 module.exports，tools/test-format.js 单测用）：
//   把幻灯片快照写成给模型看的形状清单（JSON 一行一个形状，单位磅、颜色 #RRGGBB）；
//   解析模型回复里的 ```format 方案；逐条校验（只能改范围内的形状、数值在合理范围、属性受支持）；
//   生成预览用的「旧值 → 新值」行。真正读写 PowerPoint 的部分在 taskpane.js。
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FormatUtils = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  // ---------- 取值规范化 ----------
  const NAMED = { black: '#000000', white: '#FFFFFF', gray: '#808080', grey: '#808080', red: '#FF0000', green: '#008000', blue: '#0000FF' };
  function normColor(c) {
    if (c == null) return null;
    let s = String(c).trim();
    if (NAMED[s.toLowerCase()]) return NAMED[s.toLowerCase()];
    if (/^#?[0-9a-f]{3}$/i.test(s)) s = s.replace('#', '').split('').map((x) => x + x).join('');
    const m = s.match(/^#?([0-9a-f]{6})$/i);
    return m ? '#' + m[1].toUpperCase() : null;
  }
  const round2 = (v) => Math.round(v * 100) / 100;
  function num(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*(pt)?\s*$/i.test(v)) return parseFloat(v);
    return null;
  }
  // 透明度：0–1；模型写成百分数（如 30）时折算
  function transparency(v) {
    let t = num(typeof v === 'string' ? v.replace('%', '') : v);
    if (t == null) return null;
    if (t > 1) t /= 100;
    return t >= 0 && t <= 1 ? round2(t) : null;
  }
  function pick(map, v) {
    if (v == null) return null;
    const k = String(v).trim().toLowerCase().replace(/[\s_-]/g, '');
    return map[k] || null;
  }
  const ALIGN = { left: 'Left', center: 'Center', centre: 'Center', middle: 'Center', right: 'Right', justify: 'Justify', justified: 'Justify', distributed: 'Distributed' };
  const VALIGN = { top: 'Top', middle: 'Middle', center: 'Middle', centre: 'Middle', bottom: 'Bottom' };
  const ZORDER = { front: 'BringToFront', bringtofront: 'BringToFront', tofront: 'BringToFront', back: 'SendToBack', sendtoback: 'SendToBack', toback: 'SendToBack',
    forward: 'BringForward', bringforward: 'BringForward', backward: 'SendBackward', sendbackward: 'SendBackward' };
  const DASH = { solid: 'Solid', dash: 'Dash', dashed: 'Dash', dot: 'RoundDot', dotted: 'RoundDot', rounddot: 'RoundDot', squaredot: 'SquareDot',
    dashdot: 'DashDot', dashdotdot: 'DashDotDot', longdash: 'LongDash', longdashdot: 'LongDashDot', longdashdotdot: 'LongDashDotDot' };
  const SIDES = ['all', 'outer', 'inner', 'top', 'bottom', 'left', 'right', 'horizontal', 'vertical'];
  const FONT_KEYS = ['name', 'size', 'color', 'bold', 'italic', 'underline'];
  // 桌面版 PowerPoint（Mac 16.109 实测）读对齐时返回的是枚举序号（0 = Left），写入时字符串和序号都接受
  const ALIGN_ENUM = ['Left', 'Center', 'Right', 'Justify', 'JustifyLow', 'Distributed', 'ThaiDistributed'];
  const VALIGN_ENUM = ['Top', 'Middle', 'Bottom', 'TopCentered', 'MiddleCentered', 'BottomCentered'];
  const enumName = (list) => (v) => (typeof v === 'number' ? list[v] || null : typeof v === 'string' && v ? v : null);
  const alignName = enumName(ALIGN_ENUM);
  const valignName = enumName(VALIGN_ENUM);
  // 表格样式（MediumStyle2Accent1 等）画出来的底色、边框和文字颜色读不到：读到的是「无填充」、空边框、黑色不加粗
  const hasTableStyle = (style) => !!style && !/^NoStyle/i.test(style);
  // 新增形状（整页美化用）：模型写的类型 → PowerPoint 的几何形状名；line / textbox 单独处理
  const ADD_TYPES = { rect: 'Rectangle', rectangle: 'Rectangle', box: 'Rectangle', roundrect: 'RoundRectangle', roundedrect: 'RoundRectangle',
    roundrectangle: 'RoundRectangle', roundedrectangle: 'RoundRectangle', card: 'RoundRectangle', ellipse: 'Ellipse', circle: 'Ellipse', oval: 'Ellipse',
    line: 'Line', textbox: 'TextBox', text: 'TextBox' };
  const AUTOSIZE = { none: 'AutoSizeNone', off: 'AutoSizeNone', shrink: 'AutoSizeTextToFitShape', shrinktext: 'AutoSizeTextToFitShape', fit: 'AutoSizeTextToFitShape',
    grow: 'AutoSizeShapeToFitText', resize: 'AutoSizeShapeToFitText', resizeshape: 'AutoSizeShapeToFitText' };
  const AUTOSIZE_SHORT = { AutoSizeNone: 'none', AutoSizeTextToFitShape: 'shrink', AutoSizeShapeToFitText: 'grow' };
  const TABLE_STYLE_FAMILIES = ['NoStyleNoGrid', 'NoStyleTableGrid', 'ThemedStyle1', 'ThemedStyle2', 'LightStyle1', 'LightStyle2', 'LightStyle3',
    'MediumStyle1', 'MediumStyle2', 'MediumStyle3', 'MediumStyle4', 'DarkStyle1', 'DarkStyle2'];
  const TABLE_STYLES = TABLE_STYLE_FAMILIES.flatMap((f) => (/^NoStyle/.test(f) ? [f]
    : [...(/^Themed/.test(f) ? [] : [f]), ...[1, 2, 3, 4, 5, 6].map((n) => `${f}Accent${n}`)]))
    .filter((n) => !/^DarkStyle2Accent[456]$/.test(n));
  const MAX_ADD_TEXT = 40;
  // 中文字体：PowerPoint 给文字设字体名时连中文一起改，设成 Calibri 这类西文字体，中文会落到宋体（16.109 实测）。
  // 所以西文字体只设给西文字符；新建的文字里，中文字符要明确设一个中文字体。
  const CJK_CHAR = /[\u2e80-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/;
  const isCJK = (ch) => CJK_CHAR.test(ch);
  const cjkCapable = (name) => !!name && (CJK_CHAR.test(name) ||
    /yahei|jhenghei|dengxian|pingfang|hiragino|heiti|songti|simsun|simhei|kaiti|fangsong|stxihei|stsong|stkaiti|source han|noto (sans|serif) cjk|noto sans (sc|tc)|meiryo|yu gothic|ms gothic|ms mincho|malgun|nsimsun|lantinghei|baoli|yuanti|hannotate|kaiti sc|weibei/i.test(name));
  const DEFAULT_CJK_FONT = '微软雅黑'; // Office 在 Windows 和 Mac 上都自带
  // 一段文字按「中文 / 西文」分段：[[start, length, isCJK], …]
  const scriptRuns = (text) => compressRuns([...String(text)].map(isCJK)); // 新增形状里直接写的文字只能是短标签（编号、小标题），正文必须从原有形状搬过来
  // 段落范围："2"、"2-4"、"all"、2、[2, 4]（从 1 数）→ { p1, p2 }（从 0 数）
  function parseParas(spec, count) {
    if (!count) return null;
    if (spec == null || String(spec).trim().toLowerCase() === 'all') return { p1: 0, p2: count - 1 };
    let a, b;
    if (Array.isArray(spec)) { a = Number(spec[0]); b = Number(spec[spec.length - 1]); }
    else { const m = String(spec).trim().match(/^(\d+)\s*(?:[-–~,]\s*(\d+))?$/); if (!m) return null; a = Number(m[1]); b = m[2] ? Number(m[2]) : a; }
    if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
    const p1 = Math.min(a, b) - 1, p2 = Math.max(a, b) - 1;
    return p1 >= 0 && p2 < count ? { p1, p2 } : null;
  }

  // 形状在清单里的类别（给模型看的英文短词）
  function kindOf(s) {
    if (s.role === 'table' || s.type === 'Table') return 'table';
    if (s.role === 'title' || s.role === 'subtitle' || s.role === 'footer') return s.role;
    if (s.type === 'Placeholder') return 'body';
    if (s.type === 'TextBox') return 'textbox';
    if (s.type === 'Image') return 'picture';
    if (s.type === 'Line') return 'line';
    if (s.type === 'Group') return 'group';
    if (s.type === 'GeometricShape') return 'shape';
    return String(s.type || 'shape').toLowerCase();
  }

  // ---------- 给模型看的形状清单 ----------
  const fillText = (f) => (!f ? undefined : f.type === 'NoFill' ? 'none' : f.type === 'Solid' ? (f.transparency ? { color: f.color, transparency: f.transparency } : f.color) : String(f.type || '').toLowerCase());
  const lineText = (l) => {
    if (!l) return undefined;
    if (!l.visible) return 'none';
    const o = { color: l.color, weight: l.weight };
    if (l.dash && l.dash !== 'Solid') o.dash = l.dash;
    if (l.transparency) o.transparency = l.transparency;
    return o;
  };
  const fontText = (f, cell) => {
    if (!f) return undefined;
    const o = {};
    for (const k of FONT_KEYS) {
      if (f[k] == null) { if (!cell && (k === 'size' || k === 'name' || k === 'color')) o[k] = 'mixed'; continue; }
      if (k === 'underline') { if (f.underline && f.underline !== 'None') o.underline = true; continue; }
      if (k === 'bold' || k === 'italic') { if (f[k]) o[k] = true; continue; }
      o[k] = f[k];
    }
    return o;
  };
  function shapeLine(s) {
    const o = { id: s.id, kind: kindOf(s) };
    if (s.name) o.name = s.name;
    if (s.group) o.inGroup = s.group;
    o.x = round2(s.x); o.y = round2(s.y); o.w = round2(s.w); o.h = round2(s.h);
    if (s.rotation) o.rotation = round2(s.rotation);
    const fill = fillText(s.fill);
    if (fill !== undefined) o.fill = fill;
    const line = lineText(s.line);
    if (line !== undefined) o.line = line;
    if (s.text) {
      o.text = s.text.preview;
      const font = fontText(s.text.font);
      if (font) o.font = font;
      const align = alignName(s.text.align), valign = valignName(s.text.valign);
      if (align) o.align = align.toLowerCase();
      if (valign) o.valign = valign.toLowerCase();
      if (s.text.length != null) o.chars = s.text.length;
      if (s.text.autoSize && AUTOSIZE_SHORT[s.text.autoSize]) o.autoSize = AUTOSIZE_SHORT[s.text.autoSize];
      // 多段文字逐段列出（字数、字号、是否加粗、开头几个字），整页重排时可以按段搬进卡片或单独设格式
      const paras = s.text.paras || [];
      if (paras.length > 1) {
        o.paras = paras.map((p, i) => {
          const q = { n: i + 1, chars: p.length };
          if (p.size != null) q.size = p.size; else q.size = 'mixed';
          if (p.bold === true) q.bold = true; else if (p.bold == null) q.bold = 'mixed';
          if (p.level) q.level = p.level;
          q.text = p.preview;
          return q;
        });
        delete o.text;
      }
    }
    if (s.ratio) o.ratio = round2(s.ratio);
    if (s.table) {
      const t = s.table;
      o.rows = t.rows; o.cols = t.cols;
      const styled = hasTableStyle(t.style);
      if (t.style) o.tableStyle = t.style;
      // 有表格样式时，「无填充 / 无边框」其实是样式在画，标成 table-style，实际颜色看截图
      const cellFill = (f) => (styled && f && f.type === 'NoFill' ? 'table-style' : fillText(f));
      const cellLine = (l) => (styled && (!l || !l.visible) ? 'table-style' : lineText(l));
      if (t.header) o.header = { fill: cellFill(t.header.fill), font: fontText(t.header.font, true) };
      if (t.body) o.body = { fill: cellFill(t.body.fill), font: fontText(t.body.font, true) };
      if (t.borders) o.borders = { outer: cellLine(t.borders.outer), inner: cellLine(t.borders.inner) };
    }
    return JSON.stringify(o);
  }
  function describeSnapshot(snap) {
    const parts = [];
    const size = snap.size ? `幻灯片大小 ${round2(snap.size.w)}×${round2(snap.size.h)} pt` : '幻灯片大小未知（常见宽屏是 960×540 pt）';
    parts.push(`【第 ${snap.slideNo} 页${snap.slideCount ? `（共 ${snap.slideCount} 页）` : ''}】${size}；原点在左上角，x 向右、y 向下，单位都是磅（pt）。`);
    if (snap.theme && Object.keys(snap.theme).length) {
      parts.push('主题色：' + Object.entries(snap.theme).map(([k, v]) => `${k} ${v}`).join(' · '));
    }
    if (snap.mainFont) parts.push(`正文主要字体：${snap.mainFont}（新建的文字默认沿用它）`);
    if (snap.background) {
      const b = snap.background;
      parts.push('背景：' + (b.type === 'Solid' ? `纯色 ${b.color}` : b.type === 'Gradient' ? '渐变' : b.type === 'PictureOrTexture' ? '图片或纹理' : b.type === 'Pattern' ? '图案' : '跟随母版') +
        (snap.canBackground ? '（可以用 "id": "background" 改成纯色）' : ''));
    }
    const inScope = snap.shapes.filter((s) => s.inScope);
    const others = snap.shapes.filter((s) => !s.inScope);
    parts.push(`\n可以修改的形状（${snap.scopeKind === 'selection' ? `用户选中的 ${inScope.length} 个` : `本页全部 ${inScope.length} 个`}，每行一个，JSON）：`);
    parts.push(inScope.map(shapeLine).join('\n') || '（无）');
    if (others.length) {
      parts.push('\n本页其他形状（只作参考，不能修改）：');
      parts.push(others.map(shapeLine).join('\n'));
    }
    if (snap.shapes.some((s) => s.table && hasTableStyle(s.table.style))) {
      parts.push('\n说明：tableStyle 是表格套用的样式。"table-style" 表示这一项由表格样式决定，具体颜色读不到，以截图为准；' +
        '由样式决定的文字颜色和加粗也读不到，清单里写的是默认值（黑色、不加粗）。');
    }
    return parts.join('\n');
  }

  // ---------- 解析模型回复 ----------
  // 取 ```format（或 ```json）围栏里的 JSON：{"changes": [...]}，也接受直接给数组。容忍尾逗号和 // 注释。
  function parseFormatReply(raw) {
    const text = String(raw || '');
    const fences = [...text.matchAll(/```[ \t]*(format|json)?[ \t]*\n([\s\S]*?)```/gi)];
    const fence = fences.find((m) => (m[1] || '').toLowerCase() === 'format') || fences.find((m) => /"changes"|^\s*\[/.test(m[2]));
    if (!fence) return { ok: false, error: '回复里没有 ```format 方案' };
    let body = fence[2].replace(/^\s*\/\/.*$/gm, '').replace(/,\s*([}\]])/g, '$1');
    let data;
    try { data = JSON.parse(body); } catch (e) { return { ok: false, error: '方案不是合法的 JSON：' + e.message }; }
    const changes = Array.isArray(data) ? data : Array.isArray(data?.changes) ? data.changes : null;
    if (!changes) return { ok: false, error: '方案里没有 changes 列表' };
    return { ok: true, changes, start: fence.index, end: fence.index + fence[0].length };
  }
  // 去掉方案围栏，剩下的说明文字
  function stripFormatFence(raw, parsed) {
    if (!parsed || !parsed.ok) return String(raw || '').trim();
    return (raw.slice(0, parsed.start) + raw.slice(parsed.end)).trim();
  }

  // ---------- 校验与规范化 ----------
  // 返回 { changes: [规范化后的修改], problems: [{ id, text }] }。规范化后的修改：
  //   形状：{ id, kind: 'shape', set: { x, y, w, h, rotation, fill: {none}|{color, transparency}, line: {visible:false}|{color, weight, dash, transparency},
  //          font: {...}, align, valign, zOrder } }
  //   表格单元格：{ id, kind: 'cells', range: {r1,c1,r2,c2}, region, set: { fill, font, align, valign, border: { sides, color, weight, dash, transparency } } }
  //   背景：{ id: 'background', kind: 'background', set: { fill: { color, transparency } } }
  function parseCells(spec, rows, cols) {
    const s = String(spec == null ? 'all' : spec).trim().toLowerCase();
    if (s === 'all') return { r1: 0, c1: 0, r2: rows - 1, c2: cols - 1, region: 'all' };
    if (s === 'header' || s === 'first-row' || s === 'firstrow') return { r1: 0, c1: 0, r2: 0, c2: cols - 1, region: 'header' };
    if (s === 'body') return rows > 1 ? { r1: 1, c1: 0, r2: rows - 1, c2: cols - 1, region: 'body' } : null;
    if (s === 'first-col' || s === 'firstcol' || s === 'first-column') return { r1: 0, c1: 0, r2: rows - 1, c2: 0, region: 'first-col' };
    if (s === 'last-row' || s === 'lastrow') return { r1: rows - 1, c1: 0, r2: rows - 1, c2: cols - 1, region: 'last-row' };
    const m = s.match(/^r(\d+)c(\d+)(?::r(\d+)c(\d+))?$/);
    if (!m) return null;
    const r1 = Number(m[1]) - 1, c1 = Number(m[2]) - 1, r2 = m[3] ? Number(m[3]) - 1 : r1, c2 = m[4] ? Number(m[4]) - 1 : c1;
    const box = { r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2), region: s };
    if (box.r1 < 0 || box.c1 < 0 || box.r2 >= rows || box.c2 >= cols) return null;
    return box;
  }
  function normFont(f, problems, id) {
    if (!f || typeof f !== 'object') { problems.push({ id, text: 'font 应该是一个对象' }); return null; }
    const out = {};
    for (const [k, v] of Object.entries(f)) {
      if (k === 'name') { if (typeof v === 'string' && v.trim() && v.length <= 60) out.name = v.trim(); else problems.push({ id, text: '字体名称无效' }); }
      else if (k === 'size') { const n = num(v); if (n != null && n >= 1 && n <= 400) out.size = round2(n); else problems.push({ id, text: `字号 ${v} 超出范围` }); }
      else if (k === 'color') { const c = normColor(v); if (c) out.color = c; else problems.push({ id, text: `文字颜色 ${v} 无效` }); }
      else if (k === 'bold' || k === 'italic') out[k] = !!v;
      else if (k === 'underline') out.underline = v && v !== 'None' ? 'Single' : 'None';
      else problems.push({ id, text: `不支持的文字属性 ${k}，已忽略` });
    }
    return Object.keys(out).length ? out : null;
  }
  function normFill(v, problems, id, label = '填充') {
    if (v === 'none' || v === null || (v && typeof v === 'object' && v.none)) return { none: true };
    if (typeof v === 'string') { const c = normColor(v); if (c) return { color: c }; problems.push({ id, text: `${label}颜色 ${v} 无效` }); return null; }
    if (v && typeof v === 'object') {
      const out = {};
      if (v.color != null) { const c = normColor(v.color); if (c) out.color = c; else problems.push({ id, text: `${label}颜色 ${v.color} 无效` }); }
      if (v.transparency != null) { const t = transparency(v.transparency); if (t != null) out.transparency = t; else problems.push({ id, text: `${label}透明度 ${v.transparency} 无效` }); }
      return Object.keys(out).length ? out : null;
    }
    problems.push({ id, text: `${label}的写法无效` });
    return null;
  }
  function normLine(v, problems, id, label = '边框') {
    if (v === 'none' || v === null || (v && typeof v === 'object' && (v.none || v.visible === false))) return { visible: false };
    if (typeof v === 'string') { const c = normColor(v); if (c) return { color: c }; problems.push({ id, text: `${label}颜色 ${v} 无效` }); return null; }
    if (!v || typeof v !== 'object') { problems.push({ id, text: `${label}的写法无效` }); return null; }
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (k === 'color') { const c = normColor(x); if (c) out.color = c; else problems.push({ id, text: `${label}颜色 ${x} 无效` }); }
      else if (k === 'weight' || k === 'width') { const n = num(x); if (n != null && n >= 0 && n <= 20) out.weight = round2(n); else problems.push({ id, text: `${label}粗细 ${x} 超出范围（0–20 pt）` }); }
      else if (k === 'dash' || k === 'dashStyle' || k === 'style') { const d = pick(DASH, x); if (d) out.dash = d; else problems.push({ id, text: `不认识的线型 ${x}，已忽略` }); }
      else if (k === 'transparency') { const t = transparency(x); if (t != null) out.transparency = t; else problems.push({ id, text: `${label}透明度 ${x} 无效` }); }
      else if (k === 'visible') { if (x) out.visible = true; }
      else if (k === 'sides') { /* 表格边框用，外面处理 */ }
      else problems.push({ id, text: `不支持的${label}属性 ${k}，已忽略` });
    }
    return Object.keys(out).length ? out : null;
  }

  const SHAPE_KEYS = { left: 'x', top: 'y', width: 'w', height: 'h', x: 'x', y: 'y', w: 'w', h: 'h' };
  const SKIP_KEYS = new Set(['id', 'cells', 'note', 'reason', 'why', 'comment', 'add', 'type', 'from', 'text', 'para', 'paras', 'delete', 'name']);
  function normMargin(v, problems, id) {
    const one = (x) => { const n = num(x); return n != null && n >= 0 && n <= 72 ? round2(n) : null; };
    if (typeof v === 'number' || typeof v === 'string') {
      const n = one(v);
      if (n == null) { problems.push({ id, text: `边距 ${v} 超出范围（0–72 pt）` }); return null; }
      return { left: n, right: n, top: n, bottom: n };
    }
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of ['left', 'right', 'top', 'bottom']) {
        if (v[k] == null) continue;
        const n = one(v[k]);
        if (n == null) problems.push({ id, text: `边距 ${v[k]} 超出范围（0–72 pt）` }); else out[k] = n;
      }
      return Object.keys(out).length ? out : null;
    }
    problems.push({ id, text: '边距的写法无效' });
    return null;
  }

  // 一条修改里的形状属性（现有形状和新增形状共用）。info: { id, kind, hasText, isTable }
  function shapeProps(raw, info, snap, problems) {
    const id = info.id;
    const set = {}, cellSet = {};
    const limit = snap.size ? Math.max(snap.size.w, snap.size.h) * 3 : 5000;
    for (const [k0, v] of Object.entries(raw)) {
      if (SKIP_KEYS.has(k0)) continue;
      const k = SHAPE_KEYS[k0] || k0;
      if (['x', 'y', 'w', 'h'].includes(k)) {
        const n = num(v);
        const zeroOk = info.kind === 'line' && (k === 'w' || k === 'h'); // 横线高 0、竖线宽 0
        if (n == null || Math.abs(n) > limit || ((k === 'w' || k === 'h') && (zeroOk ? n < 0 : n <= 0.5))) problems.push({ id, text: `${k0} = ${v} 不合理，已忽略` });
        else set[k] = round2(n);
      } else if (k === 'rotation') {
        if (!snap.canRotate) { problems.push({ id, text: '这个版本的 PowerPoint 不能通过插件旋转形状，已忽略' }); continue; }
        const n = num(v);
        if (n == null || Math.abs(n) > 360) problems.push({ id, text: `旋转角度 ${v} 不合理，已忽略` }); else set.rotation = round2(n);
      } else if (k === 'zOrder' || k === 'zorder' || k === 'layer') {
        const z = pick(ZORDER, v);
        if (!z) problems.push({ id, text: `不认识的层次 ${v}，已忽略` });
        else if (!snap.canZOrder) problems.push({ id, text: '这个版本的 PowerPoint 不能通过插件调整层次，已忽略' });
        else set.zOrder = z;
      } else if (k === 'fill') {
        if (info.kind === 'group' || info.kind === 'line') { problems.push({ id, text: '分组和线条没有填充，已忽略 fill' }); continue; }
        const f = normFill(v, problems, id, info.isTable ? '单元格填充' : '填充');
        if (f) (info.isTable ? cellSet : set).fill = f;
      } else if (k === 'line' || k === 'border' || k === 'outline') {
        if (info.isTable) {
          const b = normLine(v, problems, id, '表格边框');
          if (!b) continue;
          const sides = v && typeof v === 'object' && v.sides != null ? String(v.sides).toLowerCase() : 'all';
          if (!SIDES.includes(sides)) { problems.push({ id, text: `不认识的边框范围 ${v.sides}，已忽略` }); continue; }
          cellSet.border = { ...b, sides };
        } else {
          if (info.kind === 'group') { problems.push({ id, text: '分组本身没有边框，请改组里的形状，已忽略' }); continue; }
          const l = normLine(v, problems, id);
          if (l) set.line = l;
        }
      } else if (k === 'font') {
        if (!info.isTable && !info.hasText) { problems.push({ id, text: '这个形状里没有文字，已忽略 font' }); continue; }
        const f = normFont(v, problems, id);
        if (f) (info.isTable ? cellSet : set).font = f;
      } else if (k === 'align' || k === 'valign') {
        const a = pick(k === 'align' ? ALIGN : VALIGN, v);
        if (!a) { problems.push({ id, text: k === 'align' ? `不认识的对齐方式 ${v}，已忽略` : `不认识的垂直对齐 ${v}，已忽略` }); continue; }
        if (!info.isTable && !info.hasText) { problems.push({ id, text: k === 'align' ? '这个形状里没有文字，已忽略对齐' : '这个形状里没有文字，已忽略垂直对齐' }); continue; }
        (info.isTable ? cellSet : set)[k] = a;
      } else if (k === 'autoSize' || k === 'autosize' || k === 'autofit') {
        const a = pick(AUTOSIZE, v);
        if (!a) { problems.push({ id, text: `不认识的自动调整方式 ${v}，已忽略` }); continue; }
        if (!info.hasText) { problems.push({ id, text: '这个形状里没有文字，已忽略自动调整' }); continue; }
        set.autoSize = a;
      } else if (k === 'margin' || k === 'margins' || k === 'padding') {
        if (!info.hasText) { problems.push({ id, text: '这个形状里没有文字，已忽略边距' }); continue; }
        const m = normMargin(v, problems, id);
        if (m) set.margin = m;
      } else if (k === 'wrap' || k === 'wordWrap') {
        if (!info.hasText) continue;
        set.wrap = !!v;
      } else if (k === 'corner' || k === 'radius') {
        if (info.addType !== 'RoundRectangle') { problems.push({ id, text: '只有新增的圆角矩形可以设圆角，已忽略' }); continue; }
        const n = num(v);
        if (n == null || n < 0 || n > 0.5) problems.push({ id, text: `圆角 ${v} 超出范围（0–0.5）` }); else set.corner = round2(n);
      } else if (k === 'tableStyle' || k === 'style') {
        if (!info.isTable) { problems.push({ id, text: '只有表格可以换表格样式，已忽略' }); continue; }
        const name = TABLE_STYLES.find((x) => x.toLowerCase() === String(v).replace(/[\s_-]/g, '').toLowerCase());
        if (!name) { problems.push({ id, text: `不认识的表格样式 ${v}，已忽略` }); continue; }
        if (!snap.canTableFormat || !snap.canStructure) { problems.push({ id, text: '这个版本的 PowerPoint 不能通过插件换表格样式，已忽略' }); continue; }
        set.tableStyle = name;
      } else if (k === 'bullet' || k === 'bullets') {
        problems.push({ id, text: '项目符号要按段落设置（写 "para"），已忽略' });
      } else {
        problems.push({ id, text: `不支持的属性 ${k0}，已忽略` });
      }
    }
    return { set, cellSet };
  }

  // 图片保持原来的长宽比；形状不要超出页面（线条除外）。直接改 set，问题记进 problems
  function fitGeometry(set, base, info, snap, problems) {
    const g = { x: set.x ?? base.x, y: set.y ?? base.y, w: set.w ?? base.w, h: set.h ?? base.h };
    if (info.ratio && (set.w != null || set.h != null)) {
      if (set.w != null && set.h == null) set.h = g.h = round2(g.w / info.ratio);
      else if (set.h != null && set.w == null) set.w = g.w = round2(g.h * info.ratio);
      else if (Math.abs(g.w / g.h - info.ratio) / info.ratio > 0.02) {
        set.h = g.h = round2(g.w / info.ratio);
        problems.push({ id: info.id, text: `图片保持原来的长宽比，高度改为 ${g.h} pt` });
      }
    }
    if (!snap.size || info.kind === 'line' || [g.x, g.y, g.w, g.h].some((v) => v == null)) return;
    const W = snap.size.w, H = snap.size.h, tol = 2;
    if (g.x >= -tol && g.y >= -tol && g.x + g.w <= W + tol && g.y + g.h <= H + tol) return;
    const nx = Math.min(Math.max(0, g.x), Math.max(0, W - g.w)), ny = Math.min(Math.max(0, g.y), Math.max(0, H - g.h));
    if (g.w > W) set.w = W;
    if (g.h > H) set.h = H;
    if (nx !== g.x) set.x = round2(nx);
    if (ny !== g.y) set.y = round2(ny);
    problems.push({ id: info.id, text: '超出了页面，已移回页面内' });
  }

  function normalizeChanges(rawChanges, snap) {
    const changes = [], problems = [];
    const byId = new Map(snap.shapes.map((s) => [String(s.id), s]));
    const parasOf = (s) => (s && s.text ? Math.max(1, (s.text.paras || []).length) : 0);
    const moved = new Map(); // 被搬进新形状的段落：源形状 id → Set(段落序号)
    const deletes = [];
    const addIds = new Set();
    for (const raw of rawChanges) {
      if (!raw || typeof raw !== 'object') { problems.push({ id: '?', text: '有一条修改不是对象，已忽略' }); continue; }
      const id = raw.id == null ? '' : String(raw.id);

      // 新增形状：卡片、色块、线条、文本框；正文只能用 from 从原有形状原样搬过来
      if (raw.add != null) {
        const type = pick(ADD_TYPES, raw.add);
        const nid = id || `new${addIds.size + 1}`;
        if (!type) { problems.push({ id: nid, text: `不认识的形状类型 ${raw.add}，已忽略` }); continue; }
        if (!snap.canStructure) { problems.push({ id: nid, text: '这个版本的 PowerPoint 不支持整页撤销，不能新增形状，已忽略' }); continue; }
        if (byId.has(nid) || addIds.has(nid)) { problems.push({ id: nid, text: '新形状的 id 和已有形状重复，已忽略' }); continue; }
        let from = null, text = null;
        if (raw.from != null) {
          const src = byId.get(String(raw.from.id ?? raw.from));
          const range = src && parseParas(raw.from.para ?? raw.from.paras ?? raw.para, parasOf(src));
          if (!src || !src.inScope || !src.text) { problems.push({ id: nid, text: '文字来源必须是范围内有文字的形状，已忽略' }); continue; }
          if (!range) { problems.push({ id: nid, text: `段落范围 ${JSON.stringify(raw.from.para ?? raw.from.paras ?? '')} 无效，已忽略` }); continue; }
          from = { id: String(src.id), ...range };
          const m = moved.get(from.id) || new Set();
          for (let i = range.p1; i <= range.p2; i++) m.add(i);
          moved.set(from.id, m);
        } else if (raw.text != null) {
          text = String(raw.text);
          if (!text.trim() || text.length > MAX_ADD_TEXT || /\n/.test(text.trim())) { problems.push({ id: nid, text: `新形状里的文字只能是 ${MAX_ADD_TEXT} 字以内的短标签，正文请用 from 从原有形状搬过来，已忽略` }); continue; }
        }
        const kind = type === 'Line' ? 'line' : type === 'TextBox' ? 'textbox' : 'shape';
        if (kind === 'textbox' && !from && text == null) { problems.push({ id: nid, text: '新文本框需要文字（from 或 text），已忽略' }); continue; }
        if (kind === 'line' && (from || text != null)) { problems.push({ id: nid, text: '线条不能放文字，已忽略文字' }); from = null; text = null; }
        const info = { id: nid, kind, hasText: !!(from || text != null), addType: type };
        const { set } = shapeProps(raw, info, snap, problems);
        if (['x', 'y', 'w', 'h'].some((k) => set[k] == null)) { problems.push({ id: nid, text: '新形状要写全 x、y、w、h，已忽略' }); continue; }
        if (kind === 'line' && !set.w && !set.h) { problems.push({ id: nid, text: '线条长度为 0，已忽略' }); continue; }
        fitGeometry(set, {}, info, snap, problems);
        addIds.add(nid);
        changes.push({ id: nid, kind: 'add', type, from, text, set });
        continue;
      }

      if (id === 'background') {
        if (!snap.canBackground) { problems.push({ id, text: '这个版本的 PowerPoint 不能通过插件改背景，已忽略' }); continue; }
        const fill = normFill(raw.fill, problems, id, '背景');
        if (!fill || fill.none || !fill.color) { if (fill && fill.none) problems.push({ id, text: '背景不能设为无填充，已忽略' }); continue; }
        changes.push({ id, kind: 'background', set: { fill } });
        continue;
      }
      const shape = byId.get(id);
      if (!shape) { problems.push({ id, text: `找不到 id 为 ${id || '（空）'} 的形状，已忽略` }); continue; }
      if (!shape.inScope) { problems.push({ id, text: '这个形状不在修改范围内（没有选中它），已忽略' }); continue; }
      const kind = kindOf(shape);
      if (raw.delete === true || raw.delete === 'true') {
        if (!snap.canStructure) { problems.push({ id, text: '这个版本的 PowerPoint 不支持整页撤销，不能删除形状，已忽略' }); continue; }
        if (['picture', 'table', 'group'].includes(kind)) { problems.push({ id, text: '删除图片、表格或分组会丢失内容，已忽略' }); continue; }
        if (kind === 'title' || kind === 'subtitle') { problems.push({ id, text: '标题占位符不能删除（可以移动或改格式），已忽略' }); continue; }
        deletes.push({ id, shape });
        continue;
      }
      const info = { id, kind, hasText: !!shape.text, isTable: kind === 'table', ratio: kind === 'picture' ? shape.ratio : null };
      // 按段落设格式：{"id": "3", "para": "2-4", "font": {...}, "align": "left", "bullet": false}
      if (raw.para != null || raw.paras != null) {
        const range = parseParas(raw.para ?? raw.paras, parasOf(shape));
        if (!shape.text || !range) { problems.push({ id, text: `段落范围 ${JSON.stringify(raw.para ?? raw.paras)} 无效，已忽略` }); continue; }
        const pset = {};
        if (raw.font != null) { const f = normFont(raw.font, problems, id); if (f) pset.font = f; }
        if (raw.align != null) { const a = pick(ALIGN, raw.align); if (a) pset.align = a; else problems.push({ id, text: `不认识的对齐方式 ${raw.align}，已忽略` }); }
        const b = raw.bullet ?? raw.bullets;
        if (b != null) pset.bullet = !!b && b !== 'none';
        for (const k of Object.keys(raw)) if (!['id', 'para', 'paras', 'font', 'align', 'bullet', 'bullets', 'note', 'reason'].includes(k)) problems.push({ id, text: `按段落修改时不支持 ${k}，已忽略` });
        if (Object.keys(pset).length) changes.push({ id, kind: 'paras', range, set: pset });
        continue;
      }
      if (raw.text != null || raw.from != null) problems.push({ id, text: '版式模式不改文字内容（text / from 只能用在新增形状上），已忽略' });
      const { set, cellSet } = shapeProps(raw, info, snap, problems);
      if (['x', 'y', 'w', 'h'].some((k) => set[k] != null)) fitGeometry(set, shape, info, snap, problems);
      if (Object.keys(set).length) changes.push({ id, kind: 'shape', set });
      if (Object.keys(cellSet).length) {
        if (!snap.canTableFormat) { problems.push({ id, text: '这个版本的 PowerPoint 不能通过插件改表格格式（需要 PowerPointApi 1.9），已忽略' }); continue; }
        const t = shape.table || { rows: 0, cols: 0 };
        const range = parseCells(raw.cells, t.rows, t.cols);
        if (!range) { problems.push({ id, text: `单元格范围 ${raw.cells} 无效，已忽略` }); continue; }
        changes.push({ id, kind: 'cells', range, set: cellSet });
      }
    }
    // 删除有文字的形状：每一段都必须已经搬进新形状，否则会丢字
    for (const { id, shape } of deletes) {
      if (shape.text) {
        const m = moved.get(id), n = parasOf(shape);
        const missing = [];
        for (let i = 0; i < n; i++) if (!m || !m.has(i)) missing.push(i + 1);
        if (missing.length) { problems.push({ id, text: `删除会丢失第 ${missing.join('、')} 段文字（没有搬进新形状），已忽略删除` }); continue; }
      }
      for (let i = changes.length - 1; i >= 0; i--) if (changes[i].id === id && changes[i].kind !== 'add') changes.splice(i, 1);
      changes.push({ id, kind: 'delete' });
    }
    return { changes, problems };
  }

  // ---------- 预览：旧值 → 新值 ----------
  // 返回 [{ id, label, rows: [{ key, old, value, oldColor, newColor }] }]；key 是属性名（界面里再翻成中文/英文）。
  const pt = (v) => (v == null ? '—' : `${round2(v)} pt`);
  const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
  function fillDisplay(f) { return !f ? { text: '—' } : f.type === 'NoFill' ? { text: 'none' } : f.type === 'Solid' ? { text: f.color, color: f.color } : { text: String(f.type || '').toLowerCase() }; }
  function lineDisplay(l) { return !l ? { text: '—' } : !l.visible ? { text: 'none' } : { text: l.color, color: l.color }; }
  function planRows(changes, snap) {
    const byId = new Map(snap.shapes.map((s) => [String(s.id), s]));
    const groups = [];
    for (const ch of changes) {
      const rows = [];
      const s = byId.get(ch.id);
      const add = (key, old, value, oldColor, newColor) => rows.push({ key, old, value, oldColor, newColor });
      if (ch.kind === 'background') {
        const b = snap.background || {};
        const oldText = b.type === 'Solid' ? b.color : (b.type || '—').toLowerCase();
        add('background', oldText, ch.set.fill.color, b.type === 'Solid' ? b.color : null, ch.set.fill.color);
        if (ch.set.fill.transparency != null) add('background.transparency', pct(b.transparency), pct(ch.set.fill.transparency));
        groups.push({ id: ch.id, label: 'background', rows });
        continue;
      }
      if (ch.kind === 'add') {
        const set = ch.set;
        add('add.type', '—', ch.type);
        add('add.box', '—', `${round2(set.x)}, ${round2(set.y)} · ${round2(set.w)} × ${round2(set.h)} pt`);
        if (ch.from) rows.push({ key: 'add.from', old: '—', value: '', from: ch.from });
        if (ch.text != null) add('add.text', '—', ch.text);
        if (set.fill) add('fill', '—', set.fill.none ? 'none' : set.fill.color || '—', null, set.fill.none ? null : set.fill.color);
        if (set.line) add('line', '—', set.line.visible === false ? 'none' : `${set.line.color || ''} ${set.line.weight != null ? pt(set.line.weight) : ''}`.trim(), null, set.line.color || null);
        if (set.font) fontRows(add, {}, set.font, 'font');
        if (set.align) add('align', '—', set.align);
        if (set.corner != null) add('corner', '—', String(set.corner));
        if (set.zOrder) add('zOrder', '—', set.zOrder);
        groups.push({ id: ch.id, kind: 'add', label: 'add', addType: ch.type, rows });
        continue;
      }
      if (ch.kind === 'delete') {
        add('delete', s && s.text ? s.text.preview : (s && s.name) || ch.id, 'deleted');
        groups.push({ id: ch.id, kind: 'delete', label: s ? kindOf(s) : ch.id, name: s ? s.name : '', rows });
        continue;
      }
      if (ch.kind === 'paras') {
        const p = (s && s.text && s.text.paras && s.text.paras[ch.range.p1]) || (s && s.text ? { size: s.text.font && s.text.font.size, bold: s.text.font && s.text.font.bold } : {});
        if (ch.set.font) fontRows(add, { size: p.size, bold: p.bold, color: p.color, name: p.name }, ch.set.font, 'font');
        if (ch.set.align) add('align', p.align || (s && s.text && s.text.align) || '—', ch.set.align);
        if (ch.set.bullet != null) add('bullet', p.bullet == null ? '—' : p.bullet ? 'on' : 'off', ch.set.bullet ? 'on' : 'off');
        groups.push({ id: ch.id, kind: 'paras', paras: ch.range, label: s ? kindOf(s) : ch.id, name: s ? s.name : '', rows });
        continue;
      }
      if (ch.kind === 'shape') {
        const set = ch.set;
        for (const k of ['x', 'y', 'w', 'h', 'rotation']) if (set[k] != null) add(k, k === 'rotation' ? `${round2(s.rotation || 0)}°` : pt(s[k]), k === 'rotation' ? `${set[k]}°` : pt(set[k]));
        if (set.autoSize) add('autoSize', (s.text && s.text.autoSize) || '—', set.autoSize);
        if (set.margin) add('margin', s.text && s.text.margin ? marginText(s.text.margin) : '—', marginText(set.margin));
        if (set.wrap != null) add('wrap', s.text && s.text.wrap != null ? (s.text.wrap ? 'on' : 'off') : '—', set.wrap ? 'on' : 'off');
        if (set.tableStyle) add('tableStyle', (s.table && s.table.style) || '—', set.tableStyle);
        if (set.fill) {
          const o = fillDisplay(s.fill);
          if (set.fill.none) add('fill', o.text, 'none', o.color, null);
          else {
            if (set.fill.color) add('fill', o.text, set.fill.color, o.color, set.fill.color);
            if (set.fill.transparency != null) add('fill.transparency', pct(s.fill && s.fill.transparency), pct(set.fill.transparency));
          }
        }
        if (set.line) {
          const l = s.line || {};
          if (set.line.visible === false) add('line', lineDisplay(l).text, 'none', lineDisplay(l).color, null);
          else {
            if (!l.visible) add('line', 'none', set.line.color || l.color || '—', null, set.line.color || l.color);
            else if (set.line.color) add('line.color', l.color || '—', set.line.color, l.color, set.line.color);
            if (set.line.weight != null) add('line.weight', l.visible ? pt(l.weight) : '—', pt(set.line.weight));
            if (set.line.dash) add('line.dash', l.visible ? (l.dash || 'Solid') : '—', set.line.dash);
            if (set.line.transparency != null) add('line.transparency', pct(l.transparency), pct(set.line.transparency));
          }
        }
        if (set.font) fontRows(add, (s.text && s.text.font) || {}, set.font, 'font');
        if (set.align) add('align', (s.text && s.text.align) || '—', set.align);
        if (set.valign) add('valign', (s.text && s.text.valign) || '—', set.valign);
        if (set.zOrder) add('zOrder', s.z != null ? String(s.z) : '—', set.zOrder);
      } else if (ch.kind === 'cells') {
        const t = (s && s.table) || {};
        const region = ch.range.region === 'header' ? t.header : ch.range.region === 'body' ? t.body : null;
        const set = ch.set;
        const styled = hasTableStyle(t.style);
        if (set.fill) {
          const o = styled && (!region || !region.fill || region.fill.type === 'NoFill') ? { text: 'table-style' } : fillDisplay(region && region.fill);
          if (set.fill.none) add('cells.fill', o.text, 'none', o.color, null);
          else if (set.fill.color) add('cells.fill', o.text, set.fill.color, o.color, set.fill.color);
        }
        if (set.font) fontRows(add, (region && region.font) || {}, set.font, 'cells.font', styled);
        if (set.align) add('cells.align', '—', set.align);
        if (set.valign) add('cells.valign', '—', set.valign);
        if (set.border) {
          const b = set.border;
          const ref = t.borders ? (b.sides === 'inner' || b.sides === 'horizontal' || b.sides === 'vertical' ? t.borders.inner : t.borders.outer) : null;
          const byStyle = styled && !(ref && ref.visible);
          if (b.visible === false) add('cells.border', byStyle ? 'table-style' : lineDisplay(ref).text, 'none', byStyle ? null : lineDisplay(ref).color, null);
          else {
            if (b.color) add('cells.border.color', ref && ref.visible ? ref.color : byStyle ? 'table-style' : '—', b.color, ref && ref.visible ? ref.color : null, b.color);
            if (b.weight != null) add('cells.border.weight', ref && ref.visible ? pt(ref.weight) : '—', pt(b.weight));
            if (b.dash) add('cells.border.dash', ref && ref.visible ? (ref.dash || 'Solid') : '—', b.dash);
            if (b.transparency != null) add('cells.border.transparency', pct(ref && ref.transparency), pct(b.transparency));
          }
        }
      }
      if (rows.length) groups.push({ id: ch.id, kind: ch.kind, range: ch.range, sides: ch.set.border ? ch.set.border.sides : null, label: s ? `${kindOf(s)}` : ch.id, name: s ? s.name : '', rows });
    }
    return groups;
  }
  const marginText = (m) => ['left', 'right', 'top', 'bottom'].map((k) => (m[k] == null ? '–' : round2(m[k]))).join(' / ') + ' pt';
  // byStyle：表格套了样式时，读到的默认颜色 / 不加粗多半是样式在画，旧值显示成「表格样式」
  function fontRows(add, oldF, f, prefix, byStyle) {
    const show = (k, v) => (v == null ? (k === 'bold' || k === 'italic' ? 'off' : 'mixed') : k === 'size' ? pt(v) : k === 'bold' || k === 'italic' ? (v ? 'on' : 'off') : k === 'underline' ? (v && v !== 'None' ? 'on' : 'off') : String(v));
    const fromStyle = (k, v) => byStyle && (k === 'color' ? v == null || v === '#000000' : ['bold', 'italic', 'underline'].includes(k) && (!v || v === 'None'));
    for (const k of FONT_KEYS) {
      if (f[k] == null) continue;
      const styled = fromStyle(k, oldF[k]);
      add(`${prefix}.${k}`, styled ? 'table-style' : show(k, oldF[k]), show(k, f[k]), k === 'color' && !styled ? oldF.color : null, k === 'color' ? f.color : null);
    }
  }

  // 表格边框：一个范围里，每个单元格要改哪几条边（按 sides 选外框、内线等）。返回 [[r, c, ['top','left',…]], …]
  function borderPlan(range, sides) {
    const out = [];
    for (let r = range.r1; r <= range.r2; r++) {
      for (let c = range.c1; c <= range.c2; c++) {
        const s = [];
        const top = r === range.r1, bottom = r === range.r2, left = c === range.c1, right = c === range.c2;
        if (sides === 'all') s.push('top', 'bottom', 'left', 'right');
        if (sides === 'outer') { if (top) s.push('top'); if (bottom) s.push('bottom'); if (left) s.push('left'); if (right) s.push('right'); }
        if (sides === 'inner' || sides === 'horizontal') { if (!top) s.push('top'); if (!bottom) s.push('bottom'); }
        if (sides === 'inner' || sides === 'vertical') { if (!left) s.push('left'); if (!right) s.push('right'); }
        if (sides === 'top' && top) s.push('top');
        if (sides === 'bottom' && bottom) s.push('bottom');
        if (sides === 'left' && left) s.push('left');
        if (sides === 'right' && right) s.push('right');
        if (s.length) out.push([r, c, [...new Set(s)]]);
      }
    }
    return out;
  }

  // 把一串按字符取到的值压成连续段：[[start, length, value], …]（撤销时恢复混合字号/颜色用）
  // 应用之后的几何检查（给自查那一轮的模型参考）：文字形状互相重叠、图片压到文字、超出页面、贴边
  function layoutIssues(snap) {
    const out = [];
    if (!snap || !snap.size) return out;
    const W = snap.size.w, H = snap.size.h;
    const list = snap.shapes.filter((s) => !s.group && s.w != null && s.h != null && kindOf(s) !== 'line');
    const area = (a) => Math.max(0, a.w) * Math.max(0, a.h);
    const inter = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    const contains = (a, b) => b.x >= a.x - 1 && b.y >= a.y - 1 && b.x + b.w <= a.x + a.w + 1 && b.y + b.h <= a.y + a.h + 1;
    for (const s of list) {
      if (s.x < -1 || s.y < -1 || s.x + s.w > W + 1 || s.y + s.h > H + 1) out.push(`形状 ${s.id} 超出了页面`);
      else if (s.text && (s.x < 12 || s.y < 6 || s.x + s.w > W - 12 || s.y + s.h > H - 6)) out.push(`形状 ${s.id} 离页面边缘太近（不到 12 pt）`);
    }
    const content = list.filter((s) => s.text || kindOf(s) === 'picture' || kindOf(s) === 'table');
    for (let i = 0; i < content.length; i++) {
      for (let j = i + 1; j < content.length; j++) {
        const a = content[i], b = content[j];
        const o = inter(a, b);
        if (!o) continue;
        // 卡片（有底色的形状）里放文字是有意的：一个完全包住另一个、且外面那个没有文字时不算重叠
        if ((contains(a, b) && !a.text) || (contains(b, a) && !b.text)) continue;
        if (o / Math.min(area(a), area(b)) > 0.04) out.push(`形状 ${a.id} 和形状 ${b.id} 重叠（约 ${Math.round(Math.sqrt(o))} pt 见方）`);
      }
    }
    return out;
  }

  function compressRuns(values) {
    const out = [];
    values.forEach((v, i) => {
      const last = out[out.length - 1];
      if (last && last[2] === v) last[1]++;
      else out.push([i, 1, v]);
    });
    return out;
  }

  // 出现最多的值（表格摘要用）
  function mostCommon(list) {
    const counts = new Map();
    for (const v of list) { const k = JSON.stringify(v); counts.set(k, (counts.get(k) || 0) + 1); }
    let best = null, n = 0;
    for (const [k, c] of counts) if (c > n) { best = k; n = c; }
    return best == null ? null : JSON.parse(best);
  }

  return {
    normColor, transparency, kindOf, describeSnapshot, shapeLine, parseFormatReply, stripFormatFence,
    normalizeChanges, parseCells, parseParas, planRows, borderPlan, compressRuns, mostCommon, alignName, valignName, hasTableStyle, layoutIssues,
    TABLE_STYLES, AUTOSIZE_SHORT, isCJK, cjkCapable, scriptRuns, DEFAULT_CJK_FONT,
    ALIGN, VALIGN, ZORDER, DASH, SIDES,
  };
});
