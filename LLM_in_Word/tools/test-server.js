// 冒烟测试：起一个测试实例（HTTP、端口 8378，不碰正式服务），
// 打 /api/ping 和 /api/chat（真实调一次 claude/codex），校验流式事件和 ```text 围栏。
// 用法：node tools/test-server.js [--codex] [--wrapper]
//   --wrapper 走 ~/.word_edit 的正式安装（https + 烤入的代理）测真实链路

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const useCodex = process.argv.includes('--codex');
const useWrapper = process.argv.includes('--wrapper');

const PORT = useWrapper ? 8377 : 8378;
const BASE = useWrapper ? `https://127.0.0.1:${PORT}` : `http://127.0.0.1:${PORT}`;

function log(...a) { console.log('[test]', ...a); }
function fail(msg) { console.error('❌', msg); process.exit(1); }

let child = null;
async function startServer() {
  if (useWrapper) return; // 正式服务由 launchd 管
  child = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
    env: { ...process.env, WORD_EDIT_PORT: String(PORT), WORD_EDIT_CERT_DIR: path.join(os.tmpdir(), 'word_edit-no-cert') },
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
  if (!html.includes('LLM_in_Word')) fail('taskpane.html 内容不对');
  log('静态文件 ok');

  // 2.5) 模型列表探测（claude 别名解析 + codex model/list；服务端有 5 分钟缓存）
  const models = await (await fetch(`${BASE}/api/models`)).json();
  if (!models.ok) fail('模型列表探测失败：' + JSON.stringify(models));
  if (!Array.isArray(models.claude) || models.claude.length < 3) fail('claude 模型列表异常：' + JSON.stringify(models.claude));
  if (!Array.isArray(models.codex) || models.codex.length < 2) fail('codex 模型列表异常：' + JSON.stringify(models.codex));
  log('模型列表 ok：claude', models.claude.map(([v]) => v).join('/'), '| codex', models.codex.length, '个，默认', models.codex[0][1]);

  // 3) chat：小文档 + 改写指令，要求围栏输出
  const backend = useCodex ? 'codex' : 'claude';
  const payload = {
    backend,
    model: useCodex ? '(default)' : 'haiku',
    effort: 'low',
    mode: 'edit',
    doc: {
      docTitle: '测试.docx',
      docChars: 60,
      selection: '本方法在多个数据集上都取得了很好的效果。',
      fullText: '实验结果分析。\n【选中段开始】\n本方法在多个数据集上都取得了很好的效果。\n【选中段结束】\n具体数据见表3。',
      truncated: false,
    },
    messages: [{ role: 'user', content: '把这句改得更具体、更学术一点，不要扩得太长' }],
  };
  log(`chat 开始（${backend}）…`);
  const resp = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) fail(`chat HTTP ${resp.status}`);
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = '', text = '', sawMeta = false, sawDone = false, errors = [], cliSid = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      const evt = JSON.parse(line);
      if (evt.type === 'meta') sawMeta = true;
      else if (evt.type === 'delta') text += evt.text;
      else if (evt.type === 'cli_session') cliSid = evt.id;
      else if (evt.type === 'error') errors.push(evt.error);
      else if (evt.type === 'done') sawDone = true;
    }
  }
  if (!sawMeta) fail('没收到 meta 事件');
  if (!sawDone) fail('没收到 done 事件');
  if (errors.length) fail('出错：' + errors.join(' | '));
  if (!text.trim()) fail('没有正文输出');
  const fence = text.match(/```([a-zA-Z]*)[^\S\n]*\n([\s\S]*?)```/);
  if (!fence) fail('回复里没有围栏代码块：\n' + text);
  log('围栏语言:', JSON.stringify(fence[1]), '| 替换文本:', fence[2].trim().slice(0, 80));

  // 3.5) 缓存续写：用上一轮回报的 CLI 会话 id 续一轮，只发增量
  if (!cliSid) fail('首轮没回报 cli_session（缓存会话建立失败）');
  log('cli_session:', cliSid, '→ 续写轮…');
  const payloadR = {
    ...payload,
    cliSession: { [backend]: cliSid },
    messages: [
      ...payload.messages,
      { role: 'assistant', content: '（上一轮回复）' },
      { role: 'user', content: '很好。在上一版的基础上，在句末追加"（详见附录A）"，其他不动' },
    ],
  };
  const respR = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payloadR),
  });
  if (!respR.ok) fail(`续写 chat HTTP ${respR.status}`);
  let textR = '', metaResume = null, sawNote = false;
  for (const line of (await respR.text()).split('\n')) {
    if (!line.trim()) continue;
    const evt = JSON.parse(line);
    if (evt.type === 'meta') metaResume = evt.resume;
    else if (evt.type === 'delta') textR += evt.text;
    else if (evt.type === 'note') sawNote = true;
    else if (evt.type === 'error') fail('续写出错：' + evt.error);
  }
  if (metaResume !== true) fail('续写轮 meta.resume 不是 true');
  const fenceR = textR.match(/```[a-zA-Z]*[^\S\n]*\n([\s\S]*?)```/);
  if (!fenceR) fail('续写轮没有围栏：\n' + textR);
  if (!/附录A/.test(fenceR[1])) fail('续写轮没执行本轮指令（缺"附录A"）：\n' + fenceR[1]);
  if (sawNote) log('  ⚠️ 出现了回退提示（缓存未续上，走了重建），功能可用但请人工留意');
  else log('续写 ok（走缓存）：', fenceR[1].trim().slice(0, 60));

  // 4) 多目标 chat：两段分散目标，要求按【目标k】+围栏分别输出
  const payload2 = {
    ...payload,
    doc: {
      docTitle: '测试.docx',
      docChars: 120,
      targets: [
        { k: 1, text: '这个方法效果很好。' },
        { k: 2, text: '实验结果也很好。' },
      ],
      fullText: '摘要。\n【目标1开始】\n这个方法效果很好。\n【目标1结束】\n中间还有别的段落。\n【目标2开始】\n实验结果也很好。\n【目标2结束】\n结论。',
      truncated: false,
    },
    messages: [{ role: 'user', content: '把这两处的"很好"改成更学术的说法，两处措辞要一致' }],
  };
  log(`多目标 chat 开始（${backend}）…`);
  const resp2 = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload2),
  });
  if (!resp2.ok) fail(`多目标 chat HTTP ${resp2.status}`);
  let text2 = '';
  for (const line of (await resp2.text()).split('\n')) {
    if (!line.trim()) continue;
    const evt = JSON.parse(line);
    if (evt.type === 'delta') text2 += evt.text;
    else if (evt.type === 'error') fail('多目标出错：' + evt.error);
  }
  const fences2 = [...text2.matchAll(/```[a-zA-Z]*[^\S\n]*\n([\s\S]*?)```/g)];
  const labels = [...text2.matchAll(/【\s*目标\s*(\d)\s*】/g)].map((m) => Number(m[1]));
  if (fences2.length < 2) fail(`多目标只回了 ${fences2.length} 个围栏：\n` + text2);
  if (!labels.includes(1) || !labels.includes(2)) fail('多目标缺少【目标1】/【目标2】标签：\n' + text2);
  log('多目标 ok：', fences2.map((f, i) => `[${i + 1}] ${f[1].trim().slice(0, 40)}`).join(' | '));

  // 5) 表格目标：要求 ```table 围栏输出改后的 Markdown 表格（改单元格 + 增一行）
  const tableMd = '| 模型 | 准确率 | 备注 |\n| --- | --- | --- |\n| A | 91.2 | 基线 |\n| B | 93.4 | 本文 |';
  const payload3 = {
    ...payload,
    doc: {
      docTitle: '测试.docx',
      docChars: 200,
      targets: [{ k: 1, kind: 'table', rows: 3, cols: 3, text: tableMd }],
      fullText: '实验对比如下。\n【选中段开始】\n' + tableMd + '\n【选中段结束】\n以上为主要结果。',
      truncated: false,
    },
    messages: [{ role: 'user', content: '把 B 的准确率改成 95.0，并在表尾加一行：模型 C、准确率 90.1、备注 对比' }],
  };
  log(`表格 chat 开始（${backend}）…`);
  const resp3 = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload3),
  });
  if (!resp3.ok) fail(`表格 chat HTTP ${resp3.status}`);
  let text3 = '';
  for (const line of (await resp3.text()).split('\n')) {
    if (!line.trim()) continue;
    const evt = JSON.parse(line);
    if (evt.type === 'delta') text3 += evt.text;
    else if (evt.type === 'error') fail('表格轮出错：' + evt.error);
  }
  const fence3 = text3.match(/```(table|markdown)[^\S\n]*\n([\s\S]*?)```/);
  if (!fence3) fail('表格轮没有 ```table 围栏：\n' + text3);
  const rows3 = fence3[2].split('\n').filter((l) => l.trim().startsWith('|') && !/^\|[\s:|-]+\|$/.test(l.trim()));
  if (!/95\.0/.test(fence3[2])) fail('表格轮没执行"改成95.0"：\n' + fence3[2]);
  if (!/C/.test(fence3[2]) || !/90\.1/.test(fence3[2])) fail('表格轮没执行"加一行C"：\n' + fence3[2]);
  if (rows3.length !== 4) log(`  ⚠️ 内容行数 ${rows3.length}（期望 4=表头+3数据行），人工看一眼`);
  log('表格 ok：', fence3[2].trim().split('\n').slice(-1)[0]);

  log('✅ 全部通过');
  stopServer();
  process.exit(0);
}

main().catch((e) => { stopServer(); fail(e.stack || e.message); });
