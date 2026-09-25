// 桥程序测试：不开 Chrome，直接模拟 Chrome 的原生消息协议
// （4字节小端长度前缀 + JSON）验证 ping / 改写 / 问答 / 退出 四条链路。
// 用法：node tools/test-native-host.js [--wrapper] [--codex]
//   --wrapper 走 ~/.overleaf_edit/host.sh 测真实安装；--codex 用 codex 后端测
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const useWrapper = process.argv.includes('--wrapper');
const imageOnly = process.argv.includes('--image-only');
const useCodex = process.argv.includes('--codex');
const proj = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const cmd = useWrapper
  ? { bin: path.join(os.homedir(), '.overleaf_edit', 'host.sh'), args: [] }
  : { bin: process.execPath, args: [path.join(proj, 'server', 'native-host.js')] };

console.log(`启动桥: ${cmd.bin} ${cmd.args.join(' ')}`);
const child = spawn(cmd.bin, cmd.args, { stdio: ['pipe', 'pipe', 'inherit'] });

function frame(obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  return Buffer.concat([head, body]);
}

let buf = Buffer.alloc(0);
const waiters = []; // { match, resolve }
child.stdout.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  while (buf.length >= 4) {
    const len = buf.readUInt32LE(0);
    if (buf.length < 4 + len) break;
    const msg = JSON.parse(buf.subarray(4, 4 + len).toString('utf8'));
    buf = buf.subarray(4 + len);
    onMsg(msg);
  }
});

let chatErrors = [];
let chatText = '';
const cliSessions = {}; // backend -> 会话 id（cli_session 事件回报）
function onMsg(msg) {
  if (msg.type === 'error') chatErrors.push(msg.error);
  if (msg.type === 'delta') { chatText += msg.text; process.stdout.write('.'); }
  else if (msg.type === 'thinking') process.stdout.write('~');
  else if (msg.type === 'cli_session') { cliSessions[msg.backend] = msg.id; console.log(`\n← cli_session ${msg.backend} ${msg.id}`); }
  else console.log(`\n← ${msg.type}${msg.resume != null ? ' resume=' + msg.resume : ''}${msg.model ? ' ' + msg.model : ''}${msg.text ? ' ' + msg.text : ''}${msg.error ? ' ' + msg.error : ''}`);
  for (let i = 0; i < waiters.length; i++) {
    if (waiters[i].match(msg)) { const w = waiters.splice(i, 1)[0]; w.resolve(msg); return; }
  }
}
function waitFor(match, ms = 180000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('等待超时')), ms);
    waiters.push({ match, resolve: (m) => { clearTimeout(t); if (m.type === 'done' && chatErrors.length) { const errors = chatErrors; chatErrors = []; reject(new Error(errors.join('\n'))); } else resolve(m); } });
  });
}

const fail = (msg) => { console.error(`\n❌ ${msg}`); child.kill(); process.exit(1); };

const backend = useCodex ? 'codex' : 'claude';
const model = useCodex ? '(default)' : 'sonnet';

// 全文上下文式载荷（与 bridge.get_context 返回的结构一致）
const SELECTION = 'Deep learning have revolutionized many field, such as computer vision and natural language processing.';
const FULLTEXT = [
  '\\documentclass{article}',
  '\\usepackage{amsmath}',
  '\\begin{document}',
  '\\section{Introduction}',
  SELECTION,
  '\\section{Method}',
  'We formulate the task as $y = f(x)$ and optimize it end to end.',
  '\\end{document}',
].join('\n');
const DOC = {
  projectName: '测试项目',
  fileName: 'main.tex',
  docChars: FULLTEXT.length,
  fullText: FULLTEXT,
  truncated: false,
  selection: SELECTION,
  selLine1: 5,
  selLine2: 5,
};

try {
  // 1) ping
  child.stdin.write(frame({ type: 'ping' }));
  const pong = await waitFor((m) => m.type === 'pong', 5000);
  console.log(`✓ ping → pong v${pong.version}`);

  if (!imageOnly) {
  // 2) 改写（edit 模式，必须返回 ```latex 围栏）
  child.stdin.write(frame({
    type: 'chat_start', reqId: 'e1',
    payload: {
      backend, model, effort: 'low', mode: 'edit',
      doc: DOC,
      messages: [{ role: 'user', content: '修正这句话的语法错误，其他不要动' }],
    },
  }));
  await waitFor((m) => m.type === 'done' && m.reqId === 'e1');
  if (!chatText.trim()) fail('改写没有输出');
  const fence = chatText.match(/```[a-zA-Z]*\s*\n([\s\S]*?)```/);
  if (!fence) fail(`回复里没有围栏代码块：\n${chatText}`);
  console.log(`\n✓ 改写返回围栏内容: ${fence[1].trim()}`);
  if (!/fields|has revolutionized/i.test(fence[1])) console.log('  （提示：语法修正结果与预期措辞不同，人工看一眼上面输出）');

  // 2.5) 续写链路：上一步应回报了 CLI 会话 id；用它续一轮，验证走缓存且记得上下文
  const sid = cliSessions[backend];
  if (!sid) fail('首轮没有回报 cli_session（会话续写建立失败）');
  chatText = '';
  child.stdin.write(frame({
    type: 'chat_start', reqId: 'e2',
    payload: {
      backend, model, effort: 'low', mode: 'edit',
      cliSession: { [backend]: sid },
      doc: DOC, // 完整 doc 照带（续写失效回退时用），正常应走短 prompt
      messages: [
        { role: 'user', content: '修正这句话的语法错误，其他不要动' },
        { role: 'assistant', content: '（上一轮回复）' },
        { role: 'user', content: '很好。在上一版的基础上把 fields 换成 domains，其他保持不变' },
      ],
    },
  }));
  await waitFor((m) => m.type === 'done' && m.reqId === 'e2');
  const fence2 = chatText.match(/```[a-zA-Z]*\s*\n([\s\S]*?)```/);
  if (!fence2) fail(`续写轮没有围栏：\n${chatText}`);
  console.log(`\n✓ 续写轮围栏: ${fence2[1].trim()}`);
  if (!/domains/.test(fence2[1])) fail('续写轮没执行本轮指令（缺 domains）');
  if (!/has revolutionized/i.test(fence2[1])) console.log('  ⚠️ 未保留上一轮的语法修正（has），人工确认是否真的续上了上下文');

  // 3) 问答（ask 模式）
  chatText = '';
  child.stdin.write(frame({
    type: 'chat_start', reqId: 'a1',
    payload: {
      backend, model, effort: 'low', mode: 'ask',
      doc: DOC,
      messages: [{ role: 'user', content: '一句话：选中这句英文有什么语法问题？' }],
    },
  }));
  await waitFor((m) => m.type === 'done' && m.reqId === 'a1');
  if (!chatText.trim()) fail('问答没有输出');
  console.log(`\n✓ 问答回答: ${chatText.trim().slice(0, 200)}`);

  }
  // 4) 附件链路：128x128 纯红 PNG → 落盘 → claude 用 Read 看图 / codex 用 -i 附图
  chatText = '';
  const RED_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAIAAABMXPacAAABWklEQVR4nO3OQQ0AMBAEofVv+iqDxzRBALvtg/wgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwg7gEgaMOyrMtNTwAAAABJRU5ErkJggg==';
  child.stdin.write(frame({
    type: 'chat_start', reqId: 't1',
    payload: {
      backend, model, effort: 'low', mode: 'ask',
      doc: DOC,
      attachments: [{ name: 'color_patch.png', mime: 'image/png', b64: RED_PNG_B64 }],
      messages: [{ role: 'user', content: '附件图片 color_patch.png 的主色是什么颜色？只回答颜色词。' }],
    },
  }));
  await waitFor((m) => m.type === 'done' && m.reqId === 't1');
  if (!chatText.trim()) fail('附件测试没有输出');
  console.log(`\n✓ 附件问答: ${chatText.trim().slice(0, 120)}`);
  if (!/红|red/i.test(chatText)) fail('附件颜色识别未通过：测试图片为 RGB(255, 0, 0)。');

  // 5) 关闭 stdin，桥应自动退出（不留僵尸）
  child.stdin.end();
  const code = await new Promise((r) => { child.on('close', r); setTimeout(() => r('timeout'), 3000); });
  if (code === 'timeout') fail('桥未随 stdin 关闭而退出（会留僵尸进程）');
  console.log(`✓ stdin 关闭后桥自动退出 (code=${code})`);
  console.log('\n🎉 全部通过');
} catch (e) {
  fail(e.message);
}
