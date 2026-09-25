// TableUtils 单元测试（纯 node，无依赖）：node tools/test-table.js
await import('../taskpane/table-utils.js'); // UMD 副作用挂到 globalThis
const T = globalThis.TableUtils;

let n = 0;
function eq(actual, expected, name) {
  n++;
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { console.error(`❌ ${name}\n  期望 ${e}\n  实得 ${a}`); process.exit(1); }
  console.log(`✓ ${name}`);
}

// 1) 值矩阵 → Markdown → 值矩阵 round-trip
const vals = [['模型', '准确率', '备注'], ['A', '91.2', '基线'], ['B', '93.4', '本文']];
const md = T.toMarkdown(vals);
eq(md.split('\n')[1], '| --- | --- | --- |', 'toMarkdown 第二行是分隔线');
eq(T.parseMarkdown(md).values, vals, 'round-trip 还原');

// 2) 竖线转义 + 单元格内换行拍平
const vals2 = [['a|b', 'x\ny'], ['c', 'd']];
const md2 = T.toMarkdown(vals2);
eq(T.parseMarkdown(md2).values, [['a|b', 'x y'], ['c', 'd']], '竖线转义与换行拍平');

// 3) 宽容解析：列数不齐右侧补空、忽略分隔线、忽略围栏外杂质行
const messy = '说明文字\n| h1 | h2 | h3 |\n|---|---|---|\n| a | b |\n| c | d | e |';
eq(T.parseMarkdown(messy).values, [['h1', 'h2', 'h3'], ['a', 'b', ''], ['c', 'd', 'e']], '宽容解析补空列');

// 4) 非表格内容报错
eq(T.parseMarkdown('这不是表格').ok, false, '非表格内容拒收');

// 5) diffCells：改动/增行/删行/列变
const d1 = T.diffCells(vals, [['模型', '准确率', '备注'], ['A', '91.2', '基线'], ['B', '95.0', '本文'], ['C', '90.1', '对比']]);
eq([d1.changed, d1.rowsAdded, d1.rowsRemoved, d1.colsChanged], [[[2, 1]], 1, 0, false], 'diffCells 单元格改动+增行');
const d2 = T.diffCells(vals, [['模型', '准确率'], ['A', '91.2']]);
eq([d2.rowsRemoved, d2.colsChanged], [1, true], 'diffCells 删行+列变');

// 6) toHTML 转义
const html = T.toHTML([['<b>', 'a&b']]);
if (html.includes('<b>') || !html.includes('&lt;b&gt;') || !html.includes('a&amp;b')) {
  console.error('❌ toHTML 未正确转义：' + html); process.exit(1);
}
console.log('✓ toHTML 转义');

console.log(`\n🎉 全部 ${n + 1} 项通过`);
