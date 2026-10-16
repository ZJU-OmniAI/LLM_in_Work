// 只改变化的地方（Word）：把新旧文本的差异变成「在文档里搜到这几个字 → 只替换它们」，没变的文字一个不动。
// 这样段落里的 Zotero/EndNote 引用域、批注、脚注引用、公式和格式都原样保留；开着修订时也只标出真正改动的词。
// 浏览器里挂 window.WordEdits，node 里 module.exports（tools/test-word-edits.js 单测用）。依赖 DiffUtils（diff-utils.js）。
//
// Word 实测（Mac 16.10x）：
//   - getReviewedText 会把域代码读出来：\x13 代码 \x14 结果 \x15（没有结果的域没有 \x14），range.text 和 getHtml 则没有；
//   - search 也会搜到域代码里的字，而且搜不过域的边界（"regions (1) and" 搜不到）；
//   - ^p 段落标记、^l 软回车、^t 制表符、^^ 是字面的 ^；搜索词最长 255 个字符。
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WordEdits = api;
})(typeof self !== 'undefined' ? self : globalThis, function (root) {
  'use strict';

  const MAX_SEARCH = 240;  // 搜索词转义后的长度上限（Word 限 255）
  const MAX_EDITS = 400;   // 改动处太多就不逐处定位，交给整段替换
  const LONG_DELETE = 200; // 删掉的文字比这长，就分别定位开头和结尾

  // 去掉域代码，留下域结果。返回 { text, fields }，fields 是各个（最外层）域结果在 text 里的 [起, 止)。
  function stripFields(s) {
    s = String(s == null ? '' : s);
    if (!s.includes('\x13')) return { text: s, fields: [] };
    let out = '';
    const stack = []; // 每层域：true = 还在代码部分
    const fields = [];
    let open = -1;
    for (const ch of s) {
      if (ch === '\x13') { if (!stack.length) open = out.length; stack.push(true); continue; }
      if (ch === '\x14') { if (stack.length) stack[stack.length - 1] = false; continue; }
      if (ch === '\x15') {
        if (!stack.length) continue;
        stack.pop();
        if (!stack.length) fields.push([open, out.length]);
        continue;
      }
      if (stack.some((code) => code)) continue;
      out += ch;
    }
    if (stack.length) fields.push([open, out.length]); // 没闭合的域也当域看待
    return { text: out, fields };
  }

  // 文本 → Word 搜索词
  const escapeSearch = (s) => s.replace(/\^/g, '^^').replace(/\r/g, '^p').replace(/\v/g, '^l').replace(/\t/g, '^t');
  // x 在 s 里不重叠地从左往右出现的位置（Word 搜索的找法）
  function occurrences(s, x) {
    const at = [];
    if (!x) return at;
    for (let i = s.indexOf(x); i >= 0; i = s.indexOf(x, i + x.length)) at.push(i);
    return at;
  }

  // 新旧文本 → [{ pos, del, ins }]（旧文本里第 pos 个字起删 del 个字、插入 ins）
  function editsOf(oldText, newText) {
    const edits = [];
    let pos = 0;
    for (const [t, s] of root.DiffUtils.ops(oldText, newText)) {
      if (t === '=') { pos += s.length; continue; }
      const last = edits[edits.length - 1];
      const joined = last && last.pos + last.del === pos;
      if (t === '-') {
        if (joined) last.del += s.length; else edits.push({ pos, del: s.length, ins: '' });
        pos += s.length;
      } else if (joined) last.ins += s;
      else edits.push({ pos, del: 0, ins: s });
    }
    return edits;
  }

  // 改到了引用域的改动处数（删改了域结果，或在域结果中间插字）：这些不能用改文字的方式写，否则引用就变成普通文字
  const canon = (s) => String(s == null ? '' : s).replace(/\r\n?/g, '\n').replace(/\v/g, '\n').replace(/\n+$/, '');
  function touchedFields(oldText, newText, fields) {
    if (!fields || !fields.length) return 0;
    const touches = (e) => fields.some(([s, t]) => (e.del ? e.pos < t && e.pos + e.del > s : e.pos > s && e.pos < t));
    return editsOf(canon(oldText), canon(newText)).filter(touches).length;
  }

  // raw：Word 读出来的目标原文（getReviewedText，\r\n 已合成 \r，含域代码）；newText：替换文本（\n 分段）。
  // 返回 { ok: true, steps, oldText, newText } 或 { ok: false, reason: 'fields'|'locate'|'many', touched }。
  // 每个 step：{ window, index? , part?, mode, ins, head?, tail? }，见 applyPlan。
  function plan(raw, newText) {
    raw = String(raw == null ? '' : raw).replace(/\r\n/g, '\r');
    const { text: curRaw, fields } = stripFields(raw);
    const nl = (s) => s.replace(/[\r\v]/g, '\n');
    const cur = canon(nl(curRaw));
    const next = canon(newText);
    const edits = editsOf(cur, next);
    const touched = touchedFields(cur, next, fields);
    if (touched) return { ok: false, reason: 'fields', touched, fields: fields.length };
    if (edits.length > MAX_EDITS) return { ok: false, reason: 'many', fields: fields.length };
    const inField = new Uint8Array(curRaw.length + 1);
    for (const [s, t] of fields) for (let i = s; i < t; i++) inField[i] = 1;
    // 能放进搜索词的字：不在域结果里，不是 \r \v \t 以外的控制字符
    const usable = (i) => i >= 0 && i < curRaw.length && !inField[i] && !/[\x00-\x08\x0a-\x0c\x0e-\x1f\x7f]/.test(curRaw[i]);
    // 整段里只出现一次（重叠的也算：Word 从左往右找，"aaaa aaaa" 在 "aaaa aaaa aaaa" 里会先找到开头那处）
    const unique = (s) => { const i = raw.indexOf(s); return i >= 0 && raw.indexOf(s, i + 1) < 0; };
    const fits = (s) => escapeSearch(s).length <= MAX_SEARCH;
    // 不切开代理对
    const lowSurrogate = (i) => i > 0 && i < curRaw.length && /[\uDC00-\uDFFF]/.test(curRaw[i]);

    // [a, b) 里能不能放进搜索词（全部可用、两端不切代理对）
    const clean = (a, b) => { for (let i = a; i < b; i++) if (!usable(i)) return false; return !lowSurrogate(a) && !lowSurrogate(b); };
    // 从 [a, b) 向两边扩，直到整段在目标里只出现一次，且 part 在窗口里能按位置认出来
    function locate(a, b, partAt, partLen) {
      for (let guard = 0; guard < 200; guard++) {
        const win = curRaw.slice(a, b);
        if (win && fits(win) && unique(win)) {
          if (!partLen) return { window: win };
          const part = curRaw.substr(partAt, partLen);
          const index = occurrences(win, part).indexOf(partAt - a);
          if (index >= 0) return { window: win, part, index };
        }
        let grew = false;
        for (const [na, nb] of [[a, Math.min(curRaw.length, b + 6)], [Math.max(0, a - 6), b]]) {
          let x = na, y = nb;
          while (x < a && !clean(x, a)) x++;
          while (y > b && !clean(b, y)) y--;
          if ((x < a || y > b) && fits(curRaw.slice(x, y))) { a = x; b = y; grew = true; break; }
        }
        if (!grew) return null;
      }
      return null;
    }

    const steps = [];
    for (const e of edits) {
      if (e.del > LONG_DELETE) {
        // 长删除：开头一段、结尾一段各自定位，再连成整段
        let head = null, tail = null;
        for (let L = 40; L <= Math.min(e.del, MAX_SEARCH) && !(head && tail); L += 40) {
          if (!head && clean(e.pos, e.pos + L) && fits(curRaw.substr(e.pos, L)) && unique(curRaw.substr(e.pos, L))) head = curRaw.substr(e.pos, L);
          if (!tail && clean(e.pos + e.del - L, e.pos + e.del) && fits(curRaw.substr(e.pos + e.del - L, L)) && unique(curRaw.substr(e.pos + e.del - L, L))) tail = curRaw.substr(e.pos + e.del - L, L);
        }
        if (!head || !tail || !clean(e.pos, e.pos + e.del)) return { ok: false, reason: 'locate', fields: fields.length };
        steps.push({ mode: 'Span', head, tail, ins: e.ins });
        continue;
      }
      if (e.del) {
        if (!clean(e.pos, e.pos + e.del)) return { ok: false, reason: 'locate', fields: fields.length };
        const loc = locate(e.pos, e.pos + e.del, e.pos, e.del);
        if (!loc) return { ok: false, reason: 'locate', fields: fields.length };
        steps.push({ mode: 'Replace', ...loc, ins: e.ins });
        continue;
      }
      // 纯插入：贴着左边的字插在它后面；左边是域或开头，就插在右边的字前面；都没有字可贴（紧挨着引用），
      // 在整段开头或结尾的就直接插在开头/结尾
      let loc = null;
      if (usable(e.pos - 1)) {
        let a = e.pos - 1;
        while (a > 0 && usable(a - 1) && e.pos - a < 4) a--;
        loc = locate(a, e.pos, a, e.pos - a);
        if (loc) { steps.push({ mode: 'After', ...loc, ins: e.ins }); continue; }
      }
      if (usable(e.pos)) {
        let b = e.pos + 1;
        while (b < curRaw.length && usable(b) && b - e.pos < 4) b++;
        loc = locate(e.pos, b, e.pos, b - e.pos);
        if (loc) { steps.push({ mode: 'Before', ...loc, ins: e.ins }); continue; }
      }
      if (e.pos === 0) { steps.push({ mode: 'Start', ins: e.ins }); continue; }
      if (e.pos === curRaw.length) { steps.push({ mode: 'End', ins: e.ins }); continue; }
      return { ok: false, reason: 'locate', fields: fields.length };
    }
    return { ok: true, steps, oldText: cur, newText: next, fields: fields.length };
  }

  // 在纯字符串上按 Word 的找法执行一遍（单测用，也说明 steps 的含义）：
  // window 在整段里搜，必须正好一处；再在这处里找第 index 个 part；Replace 替换 part，After/Before 插在 part 后/前，
  // Span 从 head 开头到 tail 结尾整段替换。从后往前做，前面的位置不受影响。
  function applyToString(raw, steps) {
    let s = String(raw).replace(/\r\n/g, '\r');
    const spans = steps.map((st) => {
      if (st.mode === 'Start') return [0, 0, st];
      if (st.mode === 'End') return [s.length, s.length, st];
      if (st.mode === 'Span') {
        const h = occurrences(s, st.head), t = occurrences(s, st.tail);
        if (h.length !== 1 || t.length !== 1) throw new Error('not unique');
        return [h[0], t[0] + st.tail.length, st];
      }
      const w = occurrences(s, st.window);
      if (w.length !== 1) throw new Error('not unique: ' + st.window);
      if (!st.part) throw new Error('no part');
      const p = w[0] + occurrences(st.window, st.part)[st.index];
      if (st.mode === 'After') return [p + st.part.length, p + st.part.length, st];
      if (st.mode === 'Before') return [p, p, st];
      return [p, p + st.part.length, st];
    });
    for (const [a, b, st] of spans.sort((x, y) => y[0] - x[0])) s = s.slice(0, a) + st.ins.replace(/\n/g, '\r') + s.slice(b);
    return s;
  }

  return { stripFields, escapeSearch, occurrences, editsOf, touchedFields, plan, applyToString };
});
