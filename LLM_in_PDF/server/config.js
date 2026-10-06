// LLM_in_PDF 本机桥配置
// 说明（大白话）：集中放"可调参数"。改这里就能改行为，不用翻代码。
// 与 LLM_in_Word 的 server/config.js 保持同一套约定，只是环境变量前缀不同。

import os from 'node:os';
import path from 'node:path';
import { readdirSync } from 'node:fs';

export const setting = (name) => process.env[`LLM_IN_PDF_${name}`] ?? process.env[`PAPER_READ_${name}`];

// 单次 CLI 请求的总时限；超时后结束整个进程树并提示降低思考强度。
export const REQUEST_TIMEOUT_MS = Math.max(1000, Number(setting('TIMEOUT_MS')) || 600000);

// claude 的 --effort 直接支持 low|medium|high|xhigh|max，原样透传即可。
export const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

// Codex 的档位来自 model/list，保留 CLI 支持的 max / ultra。
export function codexEffort(effort) {
  return ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(effort) ? effort : 'medium';
}

// 给子进程用的 PATH。Chrome 拉起的桥进程不继承交互式 shell 的 PATH：
// claude 常装在 nvm 的 node 目录里、codex 常在 ~/.local/bin 或应用包里，这里手动补齐。
export function spawnEnv() {
  const extra = [
    path.dirname(process.execPath), // node 所在目录，claude 通常和它同级
    path.join(os.homedir(), '.local', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
  ];
  if (process.platform === 'darwin') {
    for (const root of ['/Applications', path.join(os.homedir(), 'Applications')]) {
      for (const app of ['Codex.app', 'ChatGPT.app']) {
        extra.push(path.join(root, app, 'Contents/Resources'));
        extra.push(path.join(root, app, 'Contents/Resources/codex-cli/bin')); // 新版应用包里的 CLI 位置
      }
    }
  }
  // nvm 升级后，安装时记录的 Node 与新装 CLI 可能不再处于同一目录。
  try {
    const root = path.join(os.homedir(), '.nvm', 'versions', 'node');
    extra.push(...readdirSync(root).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })).map((v) => path.join(root, v, 'bin')));
  } catch {}
  if (process.platform === 'win32') {
    extra.push(path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'npm'));
    extra.push(path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'claude'));
  }
  const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  const cur = process.env[pathKey] || '';
  const merged = [...new Set([...cur.split(path.delimiter), ...extra])].filter(Boolean).join(path.delimiter);
  const env = { ...process.env, PATH: merged, NO_COLOR: '1' };
  if (pathKey !== 'PATH') delete env[pathKey];
  // 从另一个 Claude Code 会话里安装/调试时，不把嵌套会话标记带进独立请求。
  delete env.CLAUDECODE;
  for (const key of ['NO_PROXY', 'no_proxy']) {
    env[key] = [...new Set([...(env[key] || '').split(','), 'localhost', '127.0.0.1', '::1'])].filter(Boolean).join(',');
  }
  return env;
}

export const PORT = Number(setting('PORT') || 8765);
export const MAX_PAPER_CHARS = Number(setting('MAX_CHARS') || 600000);
export const PAPER_CACHE_MS = Number(setting('CACHE_MS') || 3600000);
