import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';
import os from 'node:os';
import { launchSpec, spawnCli, killTree } from '../server/launch.js';

test('official Windows npm shims launch Node directly, with arguments intact', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'llm cli 空格 & '));
  try {
    const entry = path.join(dir, 'node_modules/@openai/codex/bin/codex.js');
    await mkdir(path.dirname(entry), { recursive: true });
    await writeFile(entry, 'console.log(JSON.stringify(process.argv.slice(2)))');
    const args = ['exec', '--config', '{"path":"C:\\a b & c"}', 'x & echo nope', '%PATH%', '中文'];
    const spec = launchSpec(path.join(dir, 'codex.cmd'), args, 'win32');
    assert.equal(spec.bin, process.execPath); assert.deepEqual(spec.args, [entry, ...args]);
    const child = spawnCli(spec.bin, spec.args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', c => { output += c; });
    const [code] = await once(child, 'close'); assert.equal(code, 0);
    assert.deepEqual(JSON.parse(output), args);
    assert.throws(() => launchSpec(path.join(dir, 'unknown.cmd'), [], 'win32'), /CLI executable not found/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('stop terminates the CLI and its child process', async () => {
  const code = `const {spawn}=require('node:child_process');const p=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log(p.pid);setInterval(()=>{},1000);`;
  const child = spawnCli(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = once(child, 'close');
  const [line] = await once(child.stdout, 'data'); const grandchild = Number(String(line).trim());
  try {
    killTree(child, 'SIGKILL'); await closed;
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      try { process.kill(grandchild, 0); } catch { return; }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.fail('CLI descendant survived cancellation');
  } finally { try { process.kill(grandchild, 'SIGKILL'); } catch {} }
});
