// 保格式替换（buildFormattedReplacement）的单元测试：在 jsdom 里加载任务窗格脚本，
// 用仿 Word 的 HTML 片段验证"格式迁移 + 段落重排 + 自校验回退"各条路径。
// 用法：node tools/test-format.js

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const pageHtml = readFileSync(path.join(ROOT, 'taskpane', 'taskpane.html'), 'utf8');
const paneJs = readFileSync(path.join(ROOT, 'taskpane', 'taskpane.js'), 'utf8');

const dom = new JSDOM(pageHtml, { runScripts: 'outside-only', url: 'https://localhost:8377/taskpane.html' });
dom.window.eval(readFileSync(path.join(ROOT, 'taskpane', 'i18n.js'), 'utf8'));
dom.window.eval(paneJs);
const T = dom.window.__we_test;
if (!T) { console.error('❌ 测试钩子 __we_test 没暴露出来'); process.exit(1); }

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓', name); }
  else { failed++; console.error('  ✗', name, extra != null ? `\n    实际: ${extra}` : ''); }
}
function section(t) { console.log('\n■', t); }

const wrap = (body) => `<html><head><style>.MsoNormal{margin:0}</style></head><body>${body}</body></html>`;

// ---------- 1) 未改动文字保留加粗；插入的字继承插入处（非加粗）格式 ----------
section('插入文字：加粗保留、新增继承普通格式');
{
  const html = wrap('<p class="MsoNormal" style="text-align:justify">这是<b>重点</b>内容。</p>');
  const out = T.buildFormattedReplacement(html, '这是重点内容。', '这是很棒的重点内容。');
  check('构造成功', out != null, out);
  if (out) {
    check('加粗保留', /<b>重点<\/b>/.test(out), out);
    check('新增文字不在加粗里', !/<b>[^<]*很棒的/.test(out) && /很棒的/.test(out), out);
    check('段落样式保留', /class="MsoNormal"/.test(out) && /text-align:\s*justify/.test(out), out);
  }
}

// ---------- 2) 替换加粗词 → 新词继承加粗 ----------
section('替换文字：继承被替换处的格式');
{
  const html = wrap('<p>这是<b>重点</b>内容。</p>');
  const out = T.buildFormattedReplacement(html, '这是重点内容。', '这是核心内容。');
  check('构造成功', out != null, out);
  if (out) check('替换词继承加粗', /<b>核心<\/b>/.test(out), out);
}

// ---------- 3) 嵌套行内格式链（span 字体 + i）----------
section('嵌套格式链保留');
{
  const html = wrap('<p><span style="font-family:宋体"><i>倾斜的一句</i></span>话尾。</p>');
  const out = T.buildFormattedReplacement(html, '倾斜的一句话尾。', '倾斜的这一句话尾。');
  check('构造成功', out != null, out);
  if (out) check('span+i 链保留', /<span style="font-family:\s*宋体"><i>[^<]*这一句<\/i><\/span>/.test(out) || /<span[^>]*><i>倾斜的这一句<\/i><\/span>/.test(out), out);
}

// ---------- 4) 段落拆分：新增换行 → 克隆来源段落样式 ----------
section('段落拆分与样式克隆');
{
  const html = wrap('<p class="A" style="text-indent:2em">第一段甲乙丙。</p><p class="B">第二段。</p>');
  const out = T.buildFormattedReplacement(html, '第一段甲乙丙。\n第二段。', '第一段甲。\n乙丙成段。\n第二段。');
  check('构造成功', out != null, out);
  if (out) {
    const aCount = (out.match(/class="A"/g) || []).length;
    check('拆出的新段克隆 A 段样式（A 出现两次）', aCount === 2, out);
    check('B 段仍在', /class="B"/.test(out), out);
  }
}

// ---------- 5) 段落合并 ----------
section('段落合并');
{
  const html = wrap('<p class="A">前半。</p><p class="B">后半。</p>');
  const out = T.buildFormattedReplacement(html, '前半。\n后半。', '前半，后半。');
  check('构造成功', out != null, out);
  if (out) check('合并后只剩一个段落', (out.match(/<p /g) || []).length === 1, out);
}

// ---------- 6) 软回车 <br> 保留 ----------
section('软回车保留');
{
  const html = wrap('<p>甲<br>乙</p>');
  const out = T.buildFormattedReplacement(html, '甲\n乙', '甲\n乙丙');
  check('构造成功', out != null, out);
  if (out) check('<br> 保留', /甲<br\s*\/?>乙丙/.test(out.replace(/\s+/g, '')), out);
}

// ---------- 7) 表格/图片 → 放弃（null，退纯文本）----------
section('复杂结构回退');
{
  const html = wrap('<p>文字</p><table><tr><td>格</td></tr></table>');
  check('表格返回 null', T.buildFormattedReplacement(html, '文字\n格', '文字改\n格') == null);
  const html2 = wrap('<p>图<img src="x.png">后</p>');
  check('图片返回 null', T.buildFormattedReplacement(html2, '图后', '图改后') == null);
}

// ---------- 8) HTML 与文本对不上 → null ----------
section('文本对不齐回退');
{
  const html = wrap('<p>实际内容。</p>');
  check('对不齐返回 null', T.buildFormattedReplacement(html, '完全另一回事', '随便什么') == null);
}

// ---------- 9) Word 排版性换行（元素间断行缩进）能对齐 ----------
section('排版性换行容错');
{
  const html = wrap('<p class="MsoNormal">这是\n<b>重点</b>内容。</p>');
  const out = T.buildFormattedReplacement(html, '这是重点内容。', '这是重点的内容。');
  check('strip 档对齐成功', out != null, out);
}

// ---------- 10) 段中片段（无段落包裹）不硬加段落 ----------
section('段中纯行内片段');
{
  const html = wrap('这是<b>片段</b>文字');
  const out = T.buildFormattedReplacement(html, '这是片段文字', '这是好片段文字');
  check('构造成功', out != null, out);
  if (out) check('不包 <p>', !/<p[ >]/.test(out), out);
}

// ---------- 11) diffOps 基本性质：拼回原串 ----------
section('diffOps 自洽');
{
  const a = '量化研究的第一步是把想法写成可回测的规则。', b = '量化研究的第一步，是把模糊的想法翻译成可回测的规则。';
  const ops = T.diffOps(a, b);
  const oldJoin = ops.filter(([t]) => t !== '+').map(([, s]) => s).join('');
  const newJoin = ops.filter(([t]) => t !== '-').map(([, s]) => s).join('');
  check('删除侧拼回原文', oldJoin === a, oldJoin);
  check('插入侧拼出新文', newJoin === b, newJoin);
  const big1 = '甲'.repeat(3000) + '中间', big2 = '甲'.repeat(3000) + '中枢';
  const ops2 = T.diffOps(big1, big2);
  check('长文掐头去尾后仍细粒度', ops2.some(([t, s]) => t === '=' && s.length > 2900), JSON.stringify(ops2.map(([t, s]) => [t, s.length])));
}

// ---------- 12) parseReplacements：单/多目标围栏解析 ----------
section('围栏解析 parseReplacements');
{
  const single = T.parseReplacements('说明\n```text\n改后文本\n```\n尾注', 1);
  check('单目标解析', single && single.length === 1 && single[0].code === '改后文本', JSON.stringify(single));
  const multiRaw = '改了两处：\n【目标2】\n```text\n乙段新文\n```\n【目标1】\n```text\n甲段新文\n```\n目标3没必要改。';
  const multi = T.parseReplacements(multiRaw, 3);
  check('多目标带标签(乱序输出也能对上号)', multi && multi.length === 2 && multi[0].k === 1 && multi[0].code === '甲段新文' && multi[1].k === 2 && multi[1].code === '乙段新文', JSON.stringify(multi));
  if (multi) {
    const note = T.stripFences(multiRaw, multi);
    check('剔除围栏后说明保留', note.includes('改了两处') && note.includes('目标3没必要改') && !note.includes('甲段新文'), note);
  }
  const seq = T.parseReplacements('```text\n一\n```\n换个话题\n```text\n二\n```', 2);
  check('无标签但数目一致→按顺序对应', seq && seq.length === 2 && seq[0].code === '一' && seq[1].code === '二', JSON.stringify(seq));
  check('无标签且数目不一致→不猜(null)', T.parseReplacements('```text\n一\n```', 3) == null);
}

// ---------- 13) markFullText：多目标标记与截断 ----------
section('多目标全文标记');
{
  const r = T.markFullText(['开头。', '中间。', '结尾。'], ['目标甲', '目标乙']);
  check('两段目标标记齐全', r.fullText.includes('【目标1开始】') && r.fullText.includes('【目标2结束】') && !r.truncated, r.fullText);
  check('间隔文本都在', r.fullText.includes('开头。') && r.fullText.includes('中间。') && r.fullText.includes('结尾。'), r.fullText);
  const single = T.markFullText(['前', '后'], ['唯一目标']);
  check('单目标沿用旧标记', single.fullText.includes('【选中段开始】'), single.fullText);
  const long = T.markFullText(['甲'.repeat(80000), '乙'.repeat(80000), '丙'.repeat(80000)], ['t1', 't2']);
  check('超长截断且有省略标注', long.truncated && long.fullText.includes('过长省略') && long.fullText.length < 130000, String(long.fullText.length));
}

console.log(`\n${failed ? '❌' : '✅'} 通过 ${passed} 项，失败 ${failed} 项`);
process.exit(failed ? 1 : 0);
