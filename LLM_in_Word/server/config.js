// LLM_in_Word 后端配置
// 说明（大白话）：集中放"可调参数"。改这里就能改行为，不用翻代码。
// （从 overleaf_edit 移植，改了环境变量前缀。）

import os from 'node:os';
import path from 'node:path';
import { accessSync, constants, readdirSync, existsSync } from 'node:fs';

// The legacy data directory and environment names remain readable during upgrades.
const setting = (name) => process.env[`LLM_IN_WORD_${name}`] || process.env[`WORD_EDIT_${name}`];
const defaultData = existsSync(path.join(os.homedir(), '.word_edit'))
  ? path.join(os.homedir(), '.word_edit') : path.join(os.homedir(), '.llm_in_word');
export const DATA_DIR = setting('DATA_DIR') || defaultData;

// 本机服务监听端口（manifest.xml 里的地址与之绑定，改了要一起改并重跑 install.sh）
export const PORT = Number(setting('PORT') || 8377);

// HTTPS 证书位置（install.sh 生成并加入钥匙串信任；缺证书时退回 HTTP 方便调试）
export const CERT_DIR = setting('CERT_DIR') || path.join(DATA_DIR, 'cert');

// CLI 可执行文件名。默认用名字（靠 PATH 找），也可用环境变量指定绝对路径。
export const REQUEST_TIMEOUT_MS = Math.max(1000, Number(setting('TIMEOUT_MS')) || 300000);

export function resolveBin(name) {
  const override = setting(`${name.toUpperCase()}_BIN`);
  if (override) return override;
  for (const dir of spawnEnv().PATH.split(path.delimiter)) {
    const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
    for (const ext of extensions) {
      const candidate = path.join(dir, name + ext);
      try { accessSync(candidate, constants.X_OK); return candidate; } catch {}
    }
  }
  return name;
}
export const CLAUDE_BIN = resolveBin('claude');
export const CODEX_BIN = resolveBin('codex');

// 发给模型的"文档全文"最大字符数。约 3 万 token，够长且不爆上下文。
export const MAX_FULLTEXT_CHARS = Number(setting('MAX_CHARS') || 120000);

// claude 的 --effort 直接支持 low|medium|high|xhigh|max，原样透传即可。
export const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

// 支持的档位由 model/list 提供，保留实际值；旧版回退选项由面板限制。
export function codexEffort(effort) {
  return ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(effort) ? effort : 'medium';
}

// 给子进程用的 PATH。claude 装在 nvm 的 node 目录里、codex 常在 ~/.local/bin，
// 这些目录在非交互 shell 里不一定进 PATH，所以手动补齐，保证 spawn 能找到命令。
export function spawnEnv() {
  const extra = [
    path.dirname(process.execPath), // node 所在目录，claude 通常和它同级
    path.join(os.homedir(), '.local', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/Applications/Codex.app/Contents/Resources',
    '/Applications/ChatGPT.app/Contents/Resources',
  ];
  // nvm 升级后，launchd 使用的 Node 与新装 CLI 可能不再处于同一目录。
  try {
    const root = path.join(os.homedir(), '.nvm', 'versions', 'node');
    extra.push(...readdirSync(root).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })).map((v) => path.join(root, v, 'bin')));
  } catch {}
  if (process.platform === 'win32') {
    extra.push(path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'npm'));
  }
  const pathKey = Object.keys(process.env).find(k => k.toUpperCase() === 'PATH') || 'PATH';
  const cur = process.env[pathKey] || '';
  const merged = [...new Set([...cur.split(path.delimiter), ...extra])].filter(Boolean).join(path.delimiter);
  const env = { ...process.env, PATH: merged, NO_COLOR: '1' };
  if (pathKey !== 'PATH') delete env[pathKey];
  // 从另一个代理进程启动服务时，不把其嵌套会话标记传入独立的 Word 会话。
  delete env.CLAUDECODE;
  for (const key of ['NO_PROXY', 'no_proxy']) {
    env[key] = [...new Set([...(env[key] || '').split(','), 'localhost', '127.0.0.1', '::1'])].filter(Boolean).join(',');
  }
  return env;
}
