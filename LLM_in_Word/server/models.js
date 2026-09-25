// 从本机 CLI 读取模型目录；不发起生成请求，5 分钟缓存。
import { spawnCli, killTree } from './launch.js';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CLAUDE_BIN, CODEX_BIN, DATA_DIR } from './config.js';

// Claude 使用稳定别名，刷新列表不再启动四次模型生成请求。
const CLAUDE_MODELS = [['sonnet', 'Sonnet · 自动版本'], ['opus', 'Opus · 自动版本'], ['haiku', 'Haiku · 自动版本']];
const PROBE_TIMEOUT = 12000;

// SDK initialize 只查询能力目录，不发送 user 消息或文档。
function listClaudeModels() {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnCli(CLAUDE_BIN, ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json',
        '--verbose', '--permission-mode', 'dontAsk', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
        '--disable-slash-commands', '--tools', '', '--no-session-persistence'],
      { cwd: DATA_DIR, stdio: ['pipe', 'pipe', 'ignore'] });
    } catch { resolve(null); return; }
    let buf = '', done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      killTree(child, 'SIGKILL');
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), PROBE_TIMEOUT);
    child.stdin.on('error', () => {});
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      if (buf.length > 1024 * 1024) { finish(null); return; }
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.type !== 'control_response' || m.response?.request_id !== 'models') continue;
        const models = m.response?.response?.models;
        finish(Array.isArray(models) ? models : null);
        return;
      }
    });
    child.on('error', () => finish(null));
    child.on('close', () => finish(null));
    child.stdin.write(JSON.stringify({ type: 'control_request', request_id: 'models', request: { subtype: 'initialize' } }) + '\n');
  });
}

export function claudeCatalog(data) {
  const details = {};
  const claude = CLAUDE_MODELS.map(([alias, fallback]) => {
    const item = data?.find((m) => m?.value === alias);
    const id = typeof item?.resolvedModel === 'string' ? item.resolvedModel : '';
    // Older CLI versions may return only a display name. Never invent a version.
    if (!id || id === alias) return [alias, fallback];
    details[alias] = { resolvedModel: id, description: item.description || '', source: 'cli' };
    const match = id.match(/^claude-([a-z]+)-(\d+(?:-\d{1,2})*)(?:-\d{8})?$/i);
    const label = match ? `${match[1][0].toUpperCase()}${match[1].slice(1)} ${match[2].replaceAll('-', '.')}` : id;
    return [alias, label];
  });
  return { claude, details };
}

// 走 codex app-server 的 JSON-RPC：initialize → model/list，拿到列表即杀进程
function listCodexModels() {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnCli(CODEX_BIN, ['app-server'], { stdio: ['pipe', 'pipe', 'ignore'] });
    } catch { resolve(null); return; }
    const send = (o) => { try { child.stdin.write(JSON.stringify(o) + '\n'); } catch {} };
    let buf = '';
    let done = false;
    const all = [];
    const cursors = new Set();
    const finish = (val) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      killTree(child, 'SIGKILL');
      resolve(val);
    };
    const timer = setTimeout(() => finish(null), PROBE_TIMEOUT);
    child.stdin.on('error', () => {});
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
        if (m && m.id === 1) {
          if (m.error) { finish(null); return; }
          send({ jsonrpc: '2.0', method: 'initialized' });
          send({ jsonrpc: '2.0', id: 2, method: 'model/list', params: { includeHidden: false } });
        } else if (m && m.id === 2) {
          const data = m.result && Array.isArray(m.result.data) ? m.result.data : null;
          if (!data) { finish(null); return; }
          all.push(...data.filter((x) => !x.hidden));
          const cursor = m.result.nextCursor;
          if (cursor && !cursors.has(cursor) && cursors.size < 20) {
            cursors.add(cursor);
            send({ jsonrpc: '2.0', id: 2, method: 'model/list', params: { includeHidden: false, cursor } });
          } else finish(all);
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

async function fetchModels() {
  const [codexData, claudeData] = await Promise.all([listCodexModels(), listClaudeModels()]);
  const { claude, details } = claudeCatalog(claudeData);
  const efforts = { codex: {} };

  let codex = null;
  if (codexData) {
    const cfgModel = codexConfigModel();
    const serverDefault = (codexData.find((x) => x.isDefault) || {}).id || null;
    codex = [['(default)', `默认 · ${cfgModel || serverDefault || '按 codex 配置'}`]];
    if (cfgModel && !codexData.some((x) => (x.model || x.id) === cfgModel)) {
      codex.push([cfgModel, `${cfgModel}（配置默认）`]);
    }
    for (const x of codexData) {
      const id = x.model || x.id;
      if (!id) continue;
      codex.push([id, x.displayName || id]);
      const levels = (x.supportedReasoningEfforts || []).map((e) => typeof e === 'string' ? e : e.reasoningEffort).filter(Boolean);
      if (levels.length) efforts.codex[id] = levels;
      if (x.isDefault && levels.length) efforts.codex['(default)'] = levels;
    }
    if (cfgModel) {
      if (efforts.codex[cfgModel]) efforts.codex['(default)'] = efforts.codex[cfgModel];
      else delete efforts.codex['(default)'];
    }
  }

  return {
    claude,
    efforts,
    details: { claude: details },
    sources: { claude: Object.keys(details).length ? 'cli' : 'aliases', codex: codex ? 'cli' : 'unavailable' },
    warnings: [
      ...(!Object.keys(details).length ? ['Claude CLI 暂未提供具体版本；别名由 CLI 解析，回复会显示实际模型。'] : []),
      ...(!codex ? ['Codex 模型列表暂时不可用，保留上次列表；可在连接设置中检查 CLI。'] : []),
    ],
    codex,
    fetchedAt: new Date().toISOString(),
  };
}

// 5 分钟缓存 + 进行中的探测只跑一份
let cache = null;
let inflight = null;
export function getModels(force = false) {
  if (!force && cache && Date.now() - cache.at < 5 * 60 * 1000) return Promise.resolve(cache.data);
  if (inflight) return inflight;
  inflight = fetchModels()
    .then((data) => {
      if (data.claude || data.codex) cache = { at: Date.now(), data };
      return data;
    })
    .finally(() => { inflight = null; });
  return inflight;
}
