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
    }
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
  function normalizeChanges(rawChanges, snap) {
    const changes = [], problems = [];
    const byId = new Map(snap.shapes.map((s) => [String(s.id), s]));
    const limit = snap.size ? Math.max(snap.size.w, snap.size.h) * 3 : 5000;
    for (const raw of rawChanges) {
      if (!raw || typeof raw !== 'object') { problems.push({ id: '?', text: '有一条修改不是对象，已忽略' }); continue; }
      const id = raw.id == null ? '' : String(raw.id);
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
      const isTable = kindOf(shape) === 'table';
      const set = {};
      const cellSet = {};
      for (const [k0, v] of Object.entries(raw)) {
        if (k0 === 'id' || k0 === 'cells' || k0 === 'note' || k0 === 'reason') continue;
        const k = SHAPE_KEYS[k0] || k0;
        if (['x', 'y', 'w', 'h'].includes(k)) {
          const n = num(v);
          if (n == null || Math.abs(n) > limit || ((k === 'w' || k === 'h') && n <= 0.5)) problems.push({ id, text: `${k0} = ${v} 不合理，已忽略` });
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
          if (kindOf(shape) === 'group' || kindOf(shape) === 'line') { problems.push({ id, text: '分组和线条没有填充，已忽略 fill' }); continue; }
          const f = normFill(v, problems, id, isTable ? '单元格填充' : '填充');
          if (f) (isTable ? cellSet : set).fill = f;
        } else if (k === 'line' || k === 'border' || k === 'outline') {
          if (isTable) {
            const b = normLine(v, problems, id, '表格边框');
            if (!b) continue;
            const sides = v && typeof v === 'object' && v.sides != null ? String(v.sides).toLowerCase() : 'all';
            if (!SIDES.includes(sides)) { problems.push({ id, text: `不认识的边框范围 ${v.sides}，已忽略` }); continue; }
            cellSet.border = { ...b, sides };
          } else {
            if (kindOf(shape) === 'group') { problems.push({ id, text: '分组本身没有边框，请改组里的形状，已忽略' }); continue; }
            const l = normLine(v, problems, id);
            if (l) set.line = l;
          }
        } else if (k === 'font') {
          if (!isTable && !shape.text) { problems.push({ id, text: '这个形状里没有文字，已忽略 font' }); continue; }
          const f = normFont(v, problems, id);
          if (f) (isTable ? cellSet : set).font = f;
        } else if (k === 'align') {
          const a = pick(ALIGN, v);
          if (!a) { problems.push({ id, text: `不认识的对齐方式 ${v}，已忽略` }); continue; }
          if (!isTable && !shape.text) { problems.push({ id, text: '这个形状里没有文字，已忽略对齐' }); continue; }
          (isTable ? cellSet : set).align = a;
        } else if (k === 'valign') {
          const a = pick(VALIGN, v);
          if (!a) { problems.push({ id, text: `不认识的垂直对齐 ${v}，已忽略` }); continue; }
          if (!isTable && !shape.text) { problems.push({ id, text: '这个形状里没有文字，已忽略垂直对齐' }); continue; }
          (isTable ? cellSet : set).valign = a;
        } else {
          problems.push({ id, text: `不支持的属性 ${k0}，已忽略` });
        }
      }
      if (Object.keys(set).length) changes.push({ id, kind: 'shape', set });
      if (Object.keys(cellSet).length) {
        if (!snap.canTableFormat) { problems.push({ id, text: '这个版本的 PowerPoint 不能通过插件改表格格式（需要 PowerPointApi 1.9），已忽略' }); continue; }
        const t = shape.table || { rows: 0, cols: 0 };
        const range = parseCells(raw.cells, t.rows, t.cols);
        if (!range) { problems.push({ id, text: `单元格范围 ${raw.cells} 无效，已忽略` }); continue; }
        changes.push({ id, kind: 'cells', range, set: cellSet });
      }
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
      if (ch.kind === 'shape') {
        const set = ch.set;
        for (const k of ['x', 'y', 'w', 'h', 'rotation']) if (set[k] != null) add(k, k === 'rotation' ? `${round2(s.rotation || 0)}°` : pt(s[k]), k === 'rotation' ? `${set[k]}°` : pt(set[k]));
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
    normalizeChanges, parseCells, planRows, borderPlan, compressRuns, mostCommon, alignName, valignName, hasTableStyle,
    ALIGN, VALIGN, ZORDER, DASH, SIDES,
  };
});
