// 模型列表：从本机 CLI 读取模型目录，不发起任何生成请求，也不发送文档内容。
// - claude：用 SDK 的 initialize 控制请求读能力目录，拿到 sonnet/opus/haiku 别名当前解析到的版本；
// - codex：codex app-server 的 JSON-RPC model/list（服务器实时列表，含每个模型支持的思考档位），
//   另读 ~/.codex/config.toml 里配置的默认模型（面板选"默认"、exec 不带 -m 时用的就是它）。
// 只探测当前后端；结果带 5 分钟缓存，防止连点刷新按钮反复起进程。
// 与 LLM_in_Word 的 server/models.js 同源。

import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnCli, killTree } from './launch.js';
import { CLAUDE_BIN, CODEX_BIN } from './config.js';

// Claude 使用稳定别名；CLI 会把别名解析成当下最新版本。
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
      { cwd: os.tmpdir(), stdio: ['pipe', 'pipe', 'ignore'] });
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

// claude-sonnet-5-5 → Sonnet 5.5；claude-haiku-4-5-20251001 → Haiku 4.5
export function claudeCatalog(data) {
  const details = {};
  const claude = CLAUDE_MODELS.map(([alias, fallback]) => {
    const item = Array.isArray(data) ? data.find((m) => m?.value === alias) : null;
    const id = typeof item?.resolvedModel === 'string' ? item.resolvedModel : '';
    // 旧版 CLI 可能只返回显示名：不编造版本号。
    if (!id || id === alias) return [alias, fallback];
    details[alias] = { resolvedModel: id, description: item.description || '', source: 'cli' };
    const match = id.match(/^claude-([a-z]+)-(\d+(?:-\d{1,2})*)(?:-\d{8})?$/i);
    const label = match ? `${match[1][0].toUpperCase()}${match[1].slice(1)} ${match[2].replaceAll('-', '.')}` : id;
    return [alias, label];
  });
  return { claude, details };
}

// 走 codex app-server 的 JSON-RPC：initialize → model/list（支持翻页），拿到列表即杀进程
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
          if (m.error) { finish(null); return; }
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
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'llm-in-overleaf-model-probe', version: '1.0' } } });
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

function codexCatalog(data) {
  const efforts = {};
  const cfgModel = codexConfigModel();
  const serverDefault = (data.find((x) => x.isDefault) || {}).model || (data.find((x) => x.isDefault) || {}).id || null;
  const codex = [['(default)', `默认 · ${cfgModel || serverDefault || '按 codex 配置'}`]];
  if (cfgModel && !data.some((x) => (x.model || x.id) === cfgModel)) codex.push([cfgModel, `${cfgModel}（配置默认）`]);
  for (const x of data) {
    const id = x.model || x.id;
    if (!id) continue;
    codex.push([id, x.displayName || id]);
    const levels = (x.supportedReasoningEfforts || []).map((e) => (typeof e === 'string' ? e : e.reasoningEffort)).filter(Boolean);
    if (levels.length) efforts[id] = levels;
    if (x.isDefault && levels.length) efforts['(default)'] = levels;
  }
  if (cfgModel) {
    if (efforts[cfgModel]) efforts['(default)'] = efforts[cfgModel];
    else delete efforts['(default)'];
  }
  return { codex, efforts };
}

async function fetchModels(backend) {
  const wantClaude = backend !== 'codex';
  const wantCodex = backend !== 'claude';
  const [claudeData, codexData] = await Promise.all([
    wantClaude ? listClaudeModels() : null,
    wantCodex ? listCodexModels() : null,
  ]);
  const result = { claude: null, codex: null, efforts: { codex: {} }, details: { claude: {} }, warnings: [], fetchedAt: new Date().toISOString() };
  if (wantClaude) {
    const { claude, details } = claudeCatalog(claudeData);
    result.claude = claude;
    result.details.claude = details;
    if (!Object.keys(details).length) result.warnings.push('Claude CLI 暂未提供具体版本；别名由 CLI 解析，回复会显示实际模型。');
  }
  if (wantCodex) {
    if (codexData) Object.assign(result, (({ codex, efforts }) => ({ codex, efforts: { codex: efforts } }))(codexCatalog(codexData)));
    else result.warnings.push('Codex 模型列表暂时不可用，保留上次列表；请检查 Codex CLI 是否安装并已登录。');
  }
  if (!result.claude && !result.codex) result.error = '两个后端都没探测到模型（CLI 没装好或网络不通？）';
  return result;
}

// 5 分钟缓存 + 进行中的探测只跑一份（按后端分开）
const cache = new Map();
const inflight = new Map();
export function getModels(backend, force = false) {
  const key = backend === 'codex' || backend === 'claude' ? backend : 'all';
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < 5 * 60 * 1000) return Promise.resolve(hit.data);
  if (inflight.has(key)) return inflight.get(key);
  const pending = fetchModels(key === 'all' ? undefined : key)
    .then((data) => {
      if (data.claude || data.codex) cache.set(key, { at: Date.now(), data });
      return data;
    })
    .finally(() => { inflight.delete(key); });
  inflight.set(key, pending);
  return pending;
}
