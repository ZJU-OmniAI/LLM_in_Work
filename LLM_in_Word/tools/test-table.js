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

// 5b) 行按内容对齐：中间插入一行只算新增，后面的行不算改动
const base = [['指标', '第3周', '第6周'], ['文档数', '19', '48'], ['接受率', '71%', '83%']];
const inserted = [base[0], ['参与人数', '8', '12'], base[1], base[2]];
eq(T.planRows(base, inserted).map((o) => o.type), ['keep', 'insert', 'keep', 'keep'], 'planRows 中间插入一行');
const d3 = T.diffCells(base, inserted);
eq([d3.changed, d3.rowsAdded, d3.rowsRemoved], [[], 1, 0], 'diffCells 中间插入不误报改动');
eq(T.planRows(base, [base[0], base[2]]).map((o) => [o.type, o.old ?? null, o.new ?? null]), [['keep', 0, 0], ['delete', 1, null], ['keep', 2, 1]], 'planRows 中间删除一行');
const edited = [base[0], ['文档数', '19', '50'], ['新行', '1', '2'], base[2]];
eq(T.planRows(base, edited).map((o) => o.type), ['keep', 'change', 'insert', 'keep'], 'planRows 修改与插入并存');
eq(T.diffCells(base, edited).changed, [[1, 2]], 'diffCells 只标修改行的变化单元格');
eq(T.planRows([['a']], [['b'], ['a']]).map((o) => o.type), ['insert', 'keep'], 'planRows 在首行之前插入');

// 6) toHTML 转义
const html = T.toHTML([['<b>', 'a&b']]);
if (html.includes('<b>') || !html.includes('&lt;b&gt;') || !html.includes('a&amp;b')) {
  console.error('❌ toHTML 未正确转义：' + html); process.exit(1);
}
console.log('✓ toHTML 转义');

console.log(`\n🎉 全部 ${n + 1} 项通过`);
