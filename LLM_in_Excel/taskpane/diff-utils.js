// 文字对比（LLM_in_Word / LLM_in_PowerPoint / LLM_in_Excel 三份相同，算法同 LLM_in_Overleaf 的 shared/diff.js）。
// 浏览器里挂 window.DiffUtils，node 里 module.exports（tools/test-diff.js 单测用）。
// 两级比较让长文也快：先按句子/行比，再把改过的句子按词比（中文逐字）。Myers 算法的代价是 O((N+M)·D)，
// 长文里改几处仍然很快；整块几乎全改的就显示成一段删除加一段新增。
//   ops(a, b)  精确的操作序列，写回文档时用（Word 保格式替换、PowerPoint 只改变化的片段）；
//   diff(a, b) 预览用：夹在两处改动之间的很短的相同片段并进改动，读起来是整词/整句的替换；
//   fold(s, isFirst, isLast) 很长的未改动文字只留两头，返回 [头, 折起来的部分, 尾] 或 null。
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DiffUtils = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const UNIT_EDITS = 4000;  // 一次最多比较的句子/行改动数
  const TOKEN_EDITS = 2500; // 一块改动里最多比较的词改动数
  const FOLD_MIN = 700;     // 超过这么长的未改动文字折起来，只留两头
  const FOLD_KEEP = 160;

  // 句子/行：在换行、中文句末标点、或后面跟空白的英文句末标点处断开，句后的空格并入本句。
  function units(s) {
    const out = [];
    const re = /\n|[。！？；]|[.!?;](?=\s)/g;
    let start = 0, m;
    while ((m = re.exec(s))) {
      let end = m.index + m[0].length;
      while (end < s.length && (s[end] === ' ' || s[end] === '\t')) end++;
      out.push(s.slice(start, end));
      start = end;
      re.lastIndex = end;
    }
    if (start < s.length) out.push(s.slice(start));
    return out;
  }

  // 词元：空白、拉丁/希腊/西里尔字母数字串；其余（汉字、假名、标点、符号）逐字。
  const TOKEN = /\s+|[A-Za-z0-9_À-ɏͰ-ϿЀ-ӿ]+|[\s\S]/gu;
  const tokens = (s) => s.match(TOKEN) || [];

  // Myers 差分。编辑数超过 maxD 返回 null，由调用方换更粗的比较方式。
  function myers(a, b, maxD) {
    const n = a.length, m = b.length;
    const max = Math.min(n + m, maxD);
    const off = max + 1;
    const v = new Int32Array(2 * max + 3);
    const trace = [];
    for (let d = 0; d <= max; d++) {
      trace.push(v.slice(off - d - 1, off + d + 2)); // 第 d 步之前 k ∈ [-d-1, d+1] 的 V[k]
      for (let k = -d; k <= d; k += 2) {
        let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
        let y = x - k;
        while (x < n && y < m && a[x] === b[y]) { x++; y++; }
        v[off + k] = x;
        if (x >= n && y >= m) return backtrack(trace, a, b, d);
      }
    }
    return null;
  }
  function backtrack(trace, a, b, D) {
    const ops = [];
    let x = a.length, y = b.length;
    for (let d = D; d > 0; d--) {
      const snap = trace[d], base = d + 1;
      const k = x - y;
      const down = k === -d || (k !== d && snap[k - 1 + base] < snap[k + 1 + base]);
      const pk = down ? k + 1 : k - 1;
      const px = snap[pk + base], py = px - pk;
      const sx = down ? px : px + 1;
      while (x > sx) { ops.push(['=', a[x - 1]]); x--; y--; }
      if (down) ops.push(['+', b[py]]);
      else ops.push(['-', a[px]]);
      x = px; y = py;
    }
    while (x > 0) { ops.push(['=', a[x - 1]]); x--; }
    return ops.reverse();
  }

  // 去掉相同的首尾再比对；返回 [['='|'-'|'+', 文本], …]，同类相邻已合并。
  function seqDiff(a, b, maxD) {
    let p = 0;
    while (p < a.length && p < b.length && a[p] === b[p]) p++;
    let s = 0;
    while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
    const mid = myers(a.slice(p, a.length - s), b.slice(p, b.length - s), maxD);
    if (!mid) return null;
    const out = [];
    const push = (t, x) => {
      if (!x) return;
      const last = out[out.length - 1];
      if (last && last[0] === t) last[1] += x; else out.push([t, x]);
    };
    push('=', a.slice(0, p).join(''));
    for (const [t, x] of mid) push(t, x);
    push('=', a.slice(a.length - s).join(''));
    return out;
  }

  // 每段连续的改动整理成「先删后增」。absorb 为真时，夹在两处改动之间的很短的相同片段
  // （空白、一两个字，不含换行）也并进改动——只用于预览，写回文档要用精确的序列。
  function group(ops, absorb) {
    const out = [];
    let del = '', ins = '', open = false;
    const flush = () => {
      if (del) out.push(['-', del]);
      if (ins) out.push(['+', ins]);
      del = ins = ''; open = false;
    };
    for (let i = 0; i < ops.length; i++) {
      const [t, x] = ops[i];
      if (t === '-') { del += x; open = true; }
      else if (t === '+') { ins += x; open = true; }
      else if (absorb && open && i + 1 < ops.length && (/^\s+$/.test(x) || x.trim().length <= 2) && !/\n/.test(x)) { del += x; ins += x; }
      else { flush(); out.push(['=', x]); }
    }
    flush();
    return out;
  }

  function raw(oldText, newText) {
    if (oldText === newText) return oldText ? [['=', oldText]] : [];
    const coarse = seqDiff(units(oldText), units(newText), UNIT_EDITS) || [['-', oldText], ['+', newText]];
    const out = [];
    const push = (t, x) => {
      if (!x) return;
      const last = out[out.length - 1];
      if (last && last[0] === t) last[1] += x; else out.push([t, x]);
    };
    for (let i = 0; i < coarse.length; i++) {
      if (coarse[i][0] === '=') { push('=', coarse[i][1]); continue; }
      let del = '', ins = '';
      for (; i < coarse.length && coarse[i][0] !== '='; i++) {
        if (coarse[i][0] === '-') del += coarse[i][1]; else ins += coarse[i][1];
      }
      i--;
      for (const [t, x] of changedBlock(del, ins)) push(t, x);
    }
    return out;
  }

  // 一块改动：先整块按词比；改得太多时，若前后句数相同（逐句润色常见），就逐句按词比；否则整块删/增。
  function changedBlock(del, ins) {
    if (!del || !ins) return [['-', del], ['+', ins]];
    const whole = seqDiff(tokens(del), tokens(ins), TOKEN_EDITS);
    if (whole) return whole;
    const du = units(del), iu = units(ins);
    if (du.length < 2 || du.length !== iu.length) return [['-', del], ['+', ins]];
    return du.flatMap((u, j) => seqDiff(tokens(u), tokens(iu[j]), TOKEN_EDITS) || [['-', u], ['+', iu[j]]]);
  }

  // 整段插入写成「上一段末尾 + 换行 + 新段」而不是「新段 + 换行 + 下一段开头」：
  // PowerPoint/Word 里新段落沿用插入处所在段落的格式，这样新段跟随它前面那一段（项目符号层级等）。
  function slideBreaks(list) {
    for (let i = 1; i < list.length; i++) {
      const [t, x] = list[i], prev = list[i - 1], next = list[i + 1];
      if (t !== '+' || prev[0] !== '=' || (next && next[0] !== '=')) continue;
      if (!x.endsWith('\n') || !prev[1].endsWith('\n')) continue;
      prev[1] = prev[1].slice(0, -1);
      list[i] = ['+', '\n' + x.slice(0, -1)];
      if (next) next[1] = '\n' + next[1]; else list.push(['=', '\n']);
    }
    return list.filter(([, x]) => x);
  }

  const ops = (a, b) => slideBreaks(group(raw(String(a), String(b)), false));
  const diff = (a, b) => slideBreaks(group(raw(String(a), String(b)), true));

  // 改动处数：连续的删/增算一处。
  const changeCount = (list) => list.filter(([t], i) => t !== '=' && (i === 0 || list[i - 1][0] === '=')).length;

  // 折叠点挪到附近的空白处，且不切开代理对。
  function foldCut(s, at, dir) {
    for (let i = 0; i < 40; i++) {
      const p = at + dir * i;
      if (p <= 0 || p >= s.length) break;
      if (/\s/.test(s[p - 1])) return p;
    }
    const c = s.charCodeAt(at);
    return c >= 0xDC00 && c <= 0xDFFF ? at + 1 : at;
  }
  function fold(s, isFirst, isLast) {
    if (s.length < FOLD_MIN) return null;
    const head = isFirst ? 0 : foldCut(s, FOLD_KEEP, 1);
    const tail = isLast ? s.length : foldCut(s, s.length - FOLD_KEEP, -1);
    if (tail - head < FOLD_KEEP) return null;
    return [s.slice(0, head), s.slice(head, tail), s.slice(tail)];
  }

  return { ops, diff, changeCount, fold, units, tokens };
});
