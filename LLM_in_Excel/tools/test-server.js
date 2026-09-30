// 冒烟测试：起一个测试实例（HTTP、端口 8398，不碰正式服务），
// 打 /api/ping 和 /api/chat（真实调一次 claude/codex），校验流式事件和 ```text 围栏。
// 用法：node tools/test-server.js [--codex] [--wrapper]
//   --wrapper 走 ~/.llm_in_excel 的正式安装（https + 烤入的代理）测真实链路

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const useCodex = process.argv.includes('--codex');
const useWrapper = process.argv.includes('--wrapper');

const PORT = useWrapper ? 8397 : 8398;
const BASE = useWrapper ? `https://127.0.0.1:${PORT}` : `http://127.0.0.1:${PORT}`;

function log(...a) { console.log('[test]', ...a); }
function fail(msg) { console.error('❌', msg); process.exit(1); }

let child = null;
async function startServer() {
  if (useWrapper) return; // 正式服务由 launchd 管
  child = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
    env: { ...process.env, LLM_IN_EXCEL_PORT: String(PORT), LLM_IN_EXCEL_CERT_DIR: path.join(os.tmpdir(), 'llm-in-excel-no-cert') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => process.stdout.write('[server] ' + d));
  child.stderr.on('data', (d) => process.stderr.write('[server] ' + d));
  // 等监听起来
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`${BASE}/api/ping`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  fail('服务 6 秒内没起来');
}

function stopServer() {
  if (child) { try { child.kill('SIGTERM'); } catch {} }
}

async function main() {
  if (useWrapper) {
    // Node 18+ 的 fetch 对自签证书需要环境变量放行
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }
  await startServer();

  // 1) ping
  const ping = await (await fetch(`${BASE}/api/ping`)).json();
  if (!ping.ok) fail('ping 不通');
  log('ping ok，版本', ping.version, ping.https ? '(https)' : '(http)');

  // 2) 静态文件
  const html = await (await fetch(`${BASE}/taskpane.html`)).text();
  if (!html.includes('LLM_in_Excel')) fail('taskpane.html 内容不对');
  log('静态文件 ok');

  // 2.5) 模型列表探测（claude 别名解析 + codex model/list；服务端有 5 分钟缓存）
  const models = await (await fetch(`${BASE}/api/models`)).json();
  if (!models.ok) fail('模型列表探测失败：' + JSON.stringify(models));
  if (!Array.isArray(models.claude) || models.claude.length < 3) fail('claude 模型列表异常：' + JSON.stringify(models.claude));
  if (!Array.isArray(models.codex) || models.codex.length < 2) fail('codex 模型列表异常：' + JSON.stringify(models.codex));
  log('模型列表 ok：claude', models.claude.map(([v]) => v).join('/'), '| codex', models.codex.length, '个，默认', models.codex[0][1]);

  // 3) chat：按 G 列反馈给空白的 H 列填分类，要求带坐标的 ```table 围栏
  await import('../taskpane/grid-utils.js');
  const G = globalThis.GridUtils;
  const backend = useCodex ? 'codex' : 'claude';
  const sheet = '【工作表「Orders」 · 已用区域 A1:H4 · 4 行 × 8 列（当前工作表）】\n' + G.toGridMarkdown([
    ['Order ID', 'Customer', 'Region', 'Amount', 'Date', 'Growth', 'Feedback', 'Category'],
    ["'00123", 'Acme', 'North', '1,200.00', '2026-07-03', '12%', 'Delivery was late but the product works great', ''],
    ["'00124", 'Globex', 'South', '860.50', '2026-07-09', '-5%', 'Invoice had the wrong address', ''],
    ["'00125", 'Initech', 'North', '2,400.00', '2026-08-01', '31%', 'Love the new dashboard, very fast', ''],
  ], 1, 1);
  const target = { k: 1, text: G.toGridMarkdown([[''], [''], ['']], 2, 8), where: 'Orders!H2:H4，3 行 × 1 列，目前是空白' };
  const payload = {
    backend,
    model: useCodex ? '(default)' : 'haiku',
    effort: 'low',
    mode: 'edit',
    doc: { docTitle: '测试.xlsx', sheetCount: 1, activeSheet: 'Orders', targets: [target], fullText: sheet, truncated: false },
    messages: [{ role: 'user', content: '根据 G 列的反馈，给 H 列每一行填一个分类：Delivery / Billing / Product / Support 之一' }],
  };
  const readChat = async (body) => {
    const resp = await fetch(`${BASE}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!resp.ok) fail(`chat HTTP ${resp.status}`);
    let text = '', meta = null, done = false, sid = null;
    const errors = [];
    for (const line of (await resp.text()).split('\n')) {
      if (!line.trim()) continue;
      const evt = JSON.parse(line);
      if (evt.type === 'meta') meta = evt;
      else if (evt.type === 'delta') text += evt.text;
      else if (evt.type === 'cli_session') sid = evt.id || sid;
      else if (evt.type === 'error') errors.push(evt.error);
      else if (evt.type === 'done') done = true;
    }
    if (!done) fail('没收到 done 事件');
    if (errors.length) fail('出错：' + errors.join(' | '));
    return { text, meta, sid };
  };
  const cellsOf = (text) => {
    const fence = text.match(/```(?:table|markdown)?[^\S\n]*\n([\s\S]*?)```/);
    if (!fence) fail('回复里没有 ```table 围栏：\n' + text);
    const parsed = G.parseGridMarkdown(fence[1]);
    if (!parsed.ok || parsed.mode !== 'coords') fail('围栏里的表格没有坐标：\n' + fence[1]);
    return parsed.cells;
  };
  log(`chat 开始（${backend}）…`);
  const first = await readChat(payload);
  const cells = cellsOf(first.text);
  const cats = ['H2', 'H3', 'H4'].map((a) => cells.get(a));
  log('分类：', cats.join(' / '));
  if (cats.some((c) => !c)) fail('H2:H4 没有全部给出');
  if (!/billing/i.test(cats[1] || '')) log('  ⚠️ H3（发票地址写错）没分到 Billing，人工看一眼');
  if ([...cells.keys()].some((a) => !/^H[2-4]$/.test(a))) fail('写到了目标以外的单元格：' + [...cells.keys()].join(','));

  // 3.5) 续写：只改一行
  if (!first.sid) fail('首轮没回报 cli_session');
  const second = await readChat({ ...payload, cliSession: { [backend]: first.sid }, messages: [...payload.messages, { role: 'assistant', content: first.text }, { role: 'user', content: '把第 4 行的分类改成 Product Feedback，其他不动' }] });
  if (second.meta?.resume !== true) fail('续写轮 meta.resume 不是 true');
  const cells2 = cellsOf(second.text);
  if (!/Product Feedback/.test(cells2.get('H4') || '')) fail('续写轮没改 H4：\n' + second.text);
  log('续写 ok：H4 =', cells2.get('H4'), '| 给出的单元格', [...cells2.keys()].join(','));

  // 4) 多目标 + 公式
  const payload3 = {
    ...payload,
    doc: {
      ...payload.doc,
      targets: [
        { k: 1, text: G.toGridMarkdown([['Acme'], ['Globex']], 2, 2), where: 'Orders!B2:B3，2 行 × 1 列' },
        { k: 2, text: G.toGridMarkdown([['']], 5, 4), where: 'Orders!D5，1 行 × 1 列，目前是空白' },
      ],
    },
    messages: [{ role: 'user', content: '目标1：公司名后面都加上 " Ltd"；目标2：写一个公式，算 D2 到 D4 的合计' }],
  };
  log(`多目标 chat 开始（${backend}）…`);
  const third = await readChat(payload3);
  const labels = [...third.text.matchAll(/【\s*目标\s*(\d)\s*】/g)].map((m) => Number(m[1]));
  if (!labels.includes(1) || !labels.includes(2)) fail('多目标缺少【目标1】/【目标2】标签：\n' + third.text);
  const blocks = [...third.text.matchAll(/```(?:table|markdown)?[^\S\n]*\n([\s\S]*?)```/g)].map((m) => G.parseGridMarkdown(m[1]));
  const all = new Map(blocks.flatMap((b) => (b.ok ? [...b.cells] : [])));
  if (!/Ltd/.test(all.get('B2') || '')) fail('目标1 没改 B2：\n' + third.text);
  if (!/^=SUM\(D2:D4\)$/i.test((all.get('D5') || '').replace(/\s/g, ''))) fail('目标2 没写合计公式：\n' + third.text);
  log('多目标 ok：B2 =', all.get('B2'), '| D5 =', all.get('D5'));

  log('✅ 全部通过');
  stopServer();
  process.exit(0);
}

main().catch((e) => { stopServer(); fail(e.stack || e.message); });
