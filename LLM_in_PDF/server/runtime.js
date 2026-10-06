// Prefer the newest installed CLI; an explicit LLM_IN_PDF_*_BIN always wins.
import { access, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { spawnEnv, setting } from './config.js';
import { runProcess } from './process.js';

const cache = new Map();
export function compareVersions(a, b) {
  const av = (a || '').split('.').map(Number), bv = (b || '').split('.').map(Number);
  for (let i = 0; i < Math.max(av.length, bv.length); i++) {
    const diff = (av[i] || 0) - (bv[i] || 0);
    if (diff) return diff;
  }
  return 0;
}

export function getCliRuntime(name) {
  if (!['claude', 'codex'].includes(name)) throw new Error('未知 CLI');
  if (!cache.has(name)) cache.set(name, discover(name));
  return cache.get(name);
}

async function discover(name) {
  const override = setting(`${name.toUpperCase()}_BIN`);
  const candidates = override ? [override] : spawnEnv().PATH.split(path.delimiter).flatMap((dir) =>
    (process.platform === 'win32' ? ['.exe', '.cmd', ''] : ['']).map((ext) => path.join(dir, name + ext)));
  const seen = new Set(), bins = [];
  for (const bin of candidates) {
    try {
      await access(bin, constants.X_OK);
      const resolved = await realpath(bin);
      if (!seen.has(resolved)) { seen.add(resolved); bins.push(bin); }
    } catch { if (override) bins.push(bin); }
  }
  const results = await Promise.all(bins.map(async (bin) => {
    const result = await runProcess(bin, ['--version'], { timeoutMs: 3000 });
    const version = result.code === 0 ? result.stdout.match(/\b(\d+\.\d+\.\d+)\b/)?.[1] : null;
    return { bin, version: version || null, available: !!version, overridden: !!override };
  }));
  results.sort((a, b) => compareVersions(b.version, a.version));
  return results[0] || { bin: override || name, version: null, available: false, overridden: !!override };
}
