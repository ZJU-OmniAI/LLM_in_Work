// Which Claude Code / Codex executable to run. Shared by every assistant: the copies in
// LLM_in_*/server/runtime.js must stay identical (checked by LLM_in_Word/tools/test-backend.js).
//
// Several copies often coexist (npm, Homebrew, the native installer, the Codex CLI bundled
// with the ChatGPT desktop app). The first one on PATH is frequently stale, and a stale CLI
// does not list newly released models. So every working copy reports its version and the
// newest one runs; ties keep search order. An explicit *_BIN setting always wins. The path
// an installer found in the user's terminal (*_DETECTED) is just one more candidate.
import { accessSync, constants, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { spawnEnv, setting } from './config.js';
import { runProcess } from './process.js';

const VERSION_TTL_MS = 10 * 60 * 1000;
const versions = new Map(); // real path -> { stamp, at, version }
const pending = new Map();  // CLI name -> discovery in progress

// "codex-cli 0.169.0-alpha.11.1" -> "0.169.0-alpha.11.1"; "2.1.323 (Claude Code)" -> "2.1.323"
export function versionOf(output) {
  return /\b(\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?)/.exec(String(output || ''))?.[1] || null;
}

// Semantic-version order: a release outranks its own pre-releases (0.169.0 > 0.169.0-alpha.11).
export function compareVersions(a, b) {
  const parse = (v) => {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.]+))?/.exec(v || '');
    return m && { parts: m.slice(1, 4).map(Number), pre: m[4] ? m[4].split('.') : [] };
  };
  const x = parse(a), y = parse(b);
  if (!x || !y) return x ? 1 : y ? -1 : 0;
  for (let i = 0; i < 3; i++) if (x.parts[i] !== y.parts[i]) return x.parts[i] - y.parts[i];
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === q) continue;
    if (p === undefined || q === undefined) return p === undefined ? -1 : 1;
    const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q);
    if (pn && qn) return Number(p) - Number(q);
    if (pn !== qn) return pn ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

function realFile(bin) {
  try {
    accessSync(bin, constants.X_OK);
    const real = realpathSync(bin);
    return statSync(real).isFile() ? real : null;
  } catch { return null; }
}

// Every distinct installed copy: the detected path first, then the first match per PATH directory.
function candidates(name) {
  const seen = new Set(), list = [];
  const add = (bin) => {
    const real = realFile(bin);
    if (real && !seen.has(real)) { seen.add(real); list.push({ bin, real }); }
    return !!real;
  };
  const detected = setting(`${name.toUpperCase()}_DETECTED`);
  if (detected) add(detected);
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of spawnEnv().PATH.split(path.delimiter)) {
    for (const ext of extensions) if (add(path.join(dir, name + ext))) break;
  }
  return list;
}

// Cached per file; probed again when the file changes or after ten minutes, so an
// in-place npm or app update is picked up without restarting the service.
async function probe({ bin, real }) {
  let stamp;
  try { const info = statSync(real); stamp = `${info.mtimeMs}:${info.size}`; } catch { return null; }
  const hit = versions.get(real);
  if (hit && hit.stamp === stamp && Date.now() - hit.at < VERSION_TTL_MS) return hit.version;
  const result = await runProcess(bin, ['--version'], { timeoutMs: 5000 });
  const version = result.code === 0 ? versionOf(result.stdout) : null;
  versions.set(real, { stamp, at: Date.now(), version });
  return version;
}

async function discover(name) {
  const override = setting(`${name.toUpperCase()}_BIN`);
  const list = override ? [{ bin: override, real: realFile(override) }] : candidates(name);
  const found = await Promise.all(list.map(async (item) => ({ bin: item.bin, version: item.real ? await probe(item) : null })));
  let best = null;
  for (const item of found) if (item.version && (!best || compareVersions(item.version, best.version) > 0)) best = item;
  best ||= found[0] || { bin: override || name, version: null };
  return { bin: best.bin, version: best.version, available: !!best.version, overridden: !!override };
}

export function getCliRuntime(name) {
  if (!['claude', 'codex'].includes(name)) throw new Error('未知 CLI');
  if (!pending.has(name)) pending.set(name, discover(name).finally(() => pending.delete(name)));
  return pending.get(name);
}
