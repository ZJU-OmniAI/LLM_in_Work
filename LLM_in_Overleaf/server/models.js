// 模型列表探测：把面板下拉框里的模型列表换成"现在真实可用的最新版"，不再靠代码里写死。
// 两个后端的探测办法不一样：
// - claude：CLI 没有"列模型"命令，但别名（fable/opus/sonnet/haiku）会被解析成当下最新版。
//   起一个 -p 流式进程，第一行 init 事件里就带解析后的完整模型名，读到立刻杀进程——
//   不等模型回答，几乎不花钱、不留会话。
// - codex：codex app-server 有正规 JSON-RPC 接口 model/list，返回 OpenAI 服务器端的实时列表；
//   另读 ~/.codex/config.toml 里配置的默认模型（面板选"默认"、exec 不带 -m 时用的就是它）。
// 结果带 5 分钟内存缓存，防止连点刷新按钮反复起进程。

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CLAUDE_BIN, CODEX_BIN, spawnEnv } from './config.js';

const CLAUDE_ALIASES = ['opus', 'sonnet', 'haiku'];
const PROBE_TIMEOUT = 25000;

// claude-fable-5 → Fable 5；claude-haiku-4-5-20251001 → Haiku 4.5
function prettyClaude(id) {
  const core = String(id).replace(/^claude-/, '').replace(/-\d{8}$/, '');
  const parts = core.split('-');
  const name = parts.shift() || core;
  const ver = parts.join('.');
  return name.charAt(0).toUpperCase() + name.slice(1) + (ver ? ' ' + ver : '');
}

// 问 CLI：这个别名现在指向哪个模型？（读 init 事件即杀，别名无效→进程报错退出→null）
function resolveClaudeAlias(alias) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(CLAUDE_BIN, ['-p', '--model', alias, '--verbose', '--output-format', 'stream-json', 'ok'], {
        env: spawnEnv(),
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch { resolve(null); return; }
    let buf = '';
    let done = false;
    const finish = (val) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { child.kill('SIGKILL'); } catch {}
      resolve(val);
    };
    const timer = setTimeout(() => finish(null), PROBE_TIMEOUT);
    child.stdout.on('data', (d) => {
      buf += d.toString();
      const i = buf.indexOf('\n');
      if (i < 0) return;
      let evt = null;
      try { evt = JSON.parse(buf.slice(0, i)); } catch {}
      finish(evt && evt.model ? { alias, id: String(evt.model) } : null);
    });
    child.on('error', () => finish(null));
    child.on('close', () => finish(null)); // close 在 stdout 排干后才触发，不会抢在 data 前面
  });
}

// 走 codex app-server 的 JSON-RPC：initialize → model/list，拿到列表即杀进程
function listCodexModels() {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(CODEX_BIN, ['app-server'], { env: spawnEnv(), stdio: ['pipe', 'pipe', 'ignore'] });
    } catch { resolve(null); return; }
    const send = (o) => { try { child.stdin.write(JSON.stringify(o) + '\n'); } catch {} };
    let buf = '';
    let done = false;
    const finish = (val) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { child.kill('SIGKILL'); } catch {}
      resolve(val);
    };
    const timer = setTimeout(() => finish(null), PROBE_TIMEOUT);
    child.stdin.on('error', () => {});
    const models = [];
    const cursors = new Set();
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        let m = null;
        try { m = JSON.parse(line); } catch { continue; }
        if (m?.error) { finish(null); return; }
        if (m && m.id === 1) {
          send({ jsonrpc: '2.0', method: 'initialized' });
          send({ jsonrpc: '2.0', id: 2, method: 'model/list', params: { includeHidden: false } });
        } else if (m && m.id === 2) {
          const data = m.result && Array.isArray(m.result.data) ? m.result.data : null;
          if (!data) { finish(null); return; }
          models.push(...data.filter((x) => !x.hidden));
          const cursor = m.result.nextCursor;
          if (cursor && !cursors.has(cursor)) {
            cursors.add(cursor);
            send({ jsonrpc: '2.0', id: 2, method: 'model/list', params: { includeHidden: false, cursor } });
          } else finish(models);
        }
      }
    });
    child.on('error', () => finish(null));
    child.on('close', () => finish(null));
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'model-probe', version: '1.0' } } });
  });
}

// ~/.codex/config.toml 里 model = "..."（用户自己配的默认模型，可能不在服务器列表里）
function codexConfigModel() {
  try {
    const t = readFileSync(path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'config.toml'), 'utf8');
    const m = t.match(/^\s*model\s*=\s*"([^"]+)"/m);
    return m ? m[1] : null;
  } catch { return null; }
}

async function fetchModels(backend) {
  const [claudeRes, codexData] = await Promise.all([
    backend === 'codex' ? [] : Promise.all(CLAUDE_ALIASES.map(resolveClaudeAlias)),
    backend === 'claude' ? null : listCodexModels(),
  ]);

  const resolved = claudeRes.filter(Boolean);
  const claude = resolved.map(({ alias, id }) => [alias, `${alias} · ${prettyClaude(id)}`]);

  let codex = null;
  if (codexData) {
    const cfgModel = codexConfigModel();
    const serverDefault = (codexData.find((x) => x.isDefault) || {}).model || null;
    codex = [['(default)', `默认 · ${cfgModel || serverDefault || '按 codex 配置'}`]];
    if (cfgModel && !codexData.some((x) => (x.model || x.id) === cfgModel)) {
      codex.push([cfgModel, `${cfgModel}（配置默认）`]);
    }
    for (const x of codexData) {
      const id = x.model || x.id;
      if (!id) continue;
      codex.push([id, (x.displayName || id) + (x.isDefault ? '（默认）' : '')]);
    }
  }

  return {
    claude: claude.length ? claude : null,
    codex,
    error: backend === 'codex' && !codexData ? 'Codex 模型列表读取失败。请检查 codex login status、网络或代理配置；仍可使用 CLI 配置默认模型。' : undefined,
    fetchedAt: new Date().toISOString(),
  };
}

// 5 分钟缓存 + 进行中的探测只跑一份
const cache = new Map();
const inflight = new Map();
export function getModels(backend = 'all') {
  const prev = cache.get(backend);
  if (prev && Date.now() - prev.at < 5 * 60 * 1000) return Promise.resolve(prev.data);
  if (inflight.has(backend)) return inflight.get(backend);
  const request = fetchModels(backend).then((data) => {
    if (data.claude || data.codex) cache.set(backend, { at: Date.now(), data });
    return data;
  }).finally(() => inflight.delete(backend));
  inflight.set(backend, request);
  return request;
}
