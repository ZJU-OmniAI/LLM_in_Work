// Text diff for the replacement preview. Loaded as a classic script before content.js (and by Node tests).
// Two levels keep long selections fast: sentences and lines are compared first, then each changed block is compared
// word by word (CJK characters one by one). Myers' algorithm costs O((N+M)·D), so a few edits in a long passage stay
// cheap; a block that changed almost completely is shown as one deletion plus one insertion.
(() => {
  'use strict';
  if (globalThis.LLMOverleafDiff) return;

  const UNIT_EDITS = 4000;  // most sentence/line edits compared at once
  const TOKEN_EDITS = 2500; // most word edits inside one changed block

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

  // 词元：空白、LaTeX 命令、拉丁/希腊/西里尔字母数字串；其余（汉字、假名、标点、符号）逐字。
  const TOKEN = /\s+|\\[A-Za-z@]+\*?|[A-Za-z0-9À-ɏͰ-ϿЀ-ӿ]+|[\s\S]/gu;
  const tokens = (s) => s.match(TOKEN) || [];

  // Myers 差分。编辑数超过 maxD 返回 null，由调用方换更粗的显示方式。
  function myers(a, b, maxD) {
    const n = a.length, m = b.length;
    const max = Math.min(n + m, maxD);
    const off = max + 1;
    const v = new Int32Array(2 * max + 3);
    const trace = [];
    for (let d = 0; d <= max; d++) {
      trace.push(v.slice(off - d - 1, off + d + 2)); // V[k] for k in [-d-1, d+1] before step d
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

  // 夹在两处改动之间的很短的相同片段（空白、一两个字）并进改动，读起来是整句/整词的替换，而不是碎片。
  function tidy(ops) {
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
      else if (open && i + 1 < ops.length && (/^\s+$/.test(x) || x.trim().length <= 2) && !/\n/.test(x)) { del += x; ins += x; }
      else { flush(); out.push(['=', x]); }
    }
    flush();
    return out;
  }

  function diff(oldText, newText) {
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
    return tidy(out);
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

  // 改动处数：连续的删/增算一处。
  const changeCount = (ops) => ops.filter(([t], i) => t !== '=' && (i === 0 || ops[i - 1][0] === '=')).length;

  globalThis.LLMOverleafDiff = { diff, changeCount, units, tokens };
})();
