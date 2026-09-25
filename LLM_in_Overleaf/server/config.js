// LLM_in_Overleaf 后端配置
// 说明（大白话）：集中放"可调参数"。改这里就能改行为，不用翻代码。

import os from 'node:os';
import path from 'node:path';
import { accessSync, constants } from 'node:fs';

// CLI 可执行文件名。默认用名字（靠 PATH 找），也可用环境变量指定绝对路径。
export function resolveBinary(name, override = process.env[`LLM_IN_OVERLEAF_${name.toUpperCase()}_BIN`]) {
  if (override) return override;
  const dirs = spawnEnv().PATH.split(path.delimiter);
  const candidates = dirs.map((dir) => path.join(dir, name));
  if (name === 'codex' && process.platform === 'darwin') {
    for (const root of ['/Applications', path.join(os.homedir(), 'Applications')]) {
      for (const app of ['Codex.app', 'ChatGPT.app']) candidates.push(path.join(root, app, 'Contents/Resources/codex'));
    }
  }
  for (const candidate of candidates) {
    try { accessSync(candidate, constants.X_OK); return candidate; } catch {}
  }
  return name;
}
export const CLAUDE_BIN = resolveBinary('claude');
export const CODEX_BIN = resolveBinary('codex');

// 发给模型的"文档全文"最大字符数（问答模式没选中时用得到）。约 3 万 token，够长且不爆上下文。
export const MAX_FULLTEXT_CHARS = Number(process.env.LLM_IN_OVERLEAF_MAX_CHARS || 120000);

// claude 的 --effort 直接支持 low|medium|high|xhigh|max，原样透传即可。
export const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

// codex 的推理强度用 config 的 model_reasoning_effort：minimal|low|medium|high|xhigh；max 并到 xhigh。
export function codexEffort(effort) {
  switch (effort) {
    case 'low': return 'low';
    case 'medium': return 'medium';
    case 'high': return 'high';
    case 'xhigh':
    case 'max':
      return 'xhigh';
    default:
      return 'medium';
  }
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
  ];
  const cur = process.env.PATH || '';
  const merged = [...new Set([...cur.split(path.delimiter), ...extra])].filter(Boolean).join(path.delimiter);
  return { ...process.env, PATH: merged };
}
