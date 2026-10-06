// 桥程序测试：不用开 Chrome，直接模拟 Chrome 的原生消息协议
// （4字节小端长度前缀 + JSON）来验证 ping / 抓论文 / 对话 三条链路。
// 用法：node tools/test-native-host.js [--wrapper]   （--wrapper 走 ~/.llm_in_pdf/host.sh 测真实安装）
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const useWrapper = process.argv.includes('--wrapper');
const proj = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const cmd = useWrapper
  ? { bin: path.join(os.homedir(), '.llm_in_pdf', 'host.sh'), args: [] }
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
const errors = [];
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

let chatText = '';
function onMsg(msg) {
  if (msg.type === 'error') errors.push(msg.error);
  if (msg.type === 'delta') { chatText += msg.text; process.stdout.write('.'); }
  else if (msg.type === 'thinking') process.stdout.write('~');
  else if (msg.type !== 'paper_result') console.log(`\n← ${msg.type}${msg.error ? ' ' + msg.error : ''}`);
  for (let i = 0; i < waiters.length; i++) {
    if (waiters[i].match(msg)) { const w = waiters.splice(i, 1)[0]; w.resolve(msg); return; }
  }
}
function waitFor(match, ms = 120000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('等待超时')), ms);
    waiters.push({ match, resolve: (m) => { clearTimeout(t); resolve(m); } });
  });
}

const fail = (msg) => { console.error(`\n❌ ${msg}`); child.kill(); process.exit(1); };

try {
  // 1) ping
  child.stdin.write(frame({ type: 'ping' }));
  const pong = await waitFor((m) => m.type === 'pong', 5000);
  console.log(`✓ ping → pong v${pong.version}`);

  // 2) 抓论文
  child.stdin.write(frame({ type: 'paper', reqId: 'p1', id: '1706.03762' }));
  const pr = await waitFor((m) => m.type === 'paper_result' && m.reqId === 'p1');
  if (!pr.ok) fail(`抓论文失败: ${pr.error}`);
  console.log(`✓ 论文: ${pr.paper.title} | ${pr.paper.source} | ${pr.paper.chars} chars`);

  // 3) 对话（claude sonnet low，小论文文本，快）
  child.stdin.write(frame({
    type: 'chat_start', reqId: 'c1',
    payload: {
      backend: process.argv.includes('--codex') ? 'codex' : 'claude', model: process.argv.includes('--codex') ? '(default)' : 'sonnet', effort: 'low',
      paper: { title: 'Attention Is All You Need', text: 'The Transformer achieves 28.4 BLEU on WMT 2014 English-to-German translation.', source: 'test' },
      messages: [{ role: 'user', content: '一句话：BLEU 是多少？' }],
    },
  }));
  await waitFor((m) => m.type === 'done' && m.reqId === 'c1');
  if (errors.length) fail(errors.join('\n'));
  if (!chatText.trim()) fail('对话没有输出');
  if (!/28\.4/.test(chatText) || /<invoke|<function_results/.test(chatText)) fail('模型没有正确回答测试问题：' + chatText.trim());
  console.log(`\n✓ 对话回答: ${chatText.trim()}`);

  // 4) 关闭 stdin，桥应自动退出（不留僵尸）
  child.stdin.end();
  const code = await new Promise((r) => { child.on('close', r); setTimeout(() => r('timeout'), 3000); });
  if (code === 'timeout') fail('桥未随 stdin 关闭而退出（会留僵尸进程）');
  console.log(`✓ stdin 关闭后桥自动退出 (code=${code})`);
  console.log('\n🎉 全部通过');
} catch (e) {
  fail(e.message);
}
