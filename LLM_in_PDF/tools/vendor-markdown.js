import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const source = new URL('../node_modules/markdown-it/', import.meta.url);
const destination = new URL('../extension/vendor/markdown-it/', import.meta.url);
await mkdir(destination, { recursive: true });
await cp(new URL('dist/browser/markdown-it.umd.min.js', source), new URL('markdown-it.min.js', destination));
await cp(new URL('LICENSE', source), new URL('LICENSE', destination));
const { version } = JSON.parse(await readFile(new URL('package.json', source), 'utf8'));
await writeFile(new URL('VERSION', destination), `${version}\n`);
console.log(`Bundled markdown-it ${version} in ${fileURLToPath(destination)}`);

// KaTeX is distributed locally too, including its MIT license and fonts.
const katex = new URL('../node_modules/katex/', import.meta.url);
const katexOut = new URL('../extension/vendor/katex/', import.meta.url);
await rm(katexOut, { recursive: true, force: true });
await mkdir(katexOut, { recursive: true });
for (const entry of ['katex.min.js', 'katex.min.css', 'fonts']) {
  await cp(new URL(`dist/${entry}`, katex), new URL(entry, katexOut), { recursive: true });
}
await cp(new URL('LICENSE', katex), new URL('LICENSE', katexOut));
const katexVersion = JSON.parse(await readFile(new URL('package.json', katex), 'utf8')).version;
await writeFile(new URL('VERSION', katexOut), `${katexVersion}\n`);

// Mermaid (MIT) is loaded only when an answer contains a ```mermaid block. The ESM build loads just
// the chunks a diagram needs; source maps are left out to keep the extension smaller.
const mermaid = new URL('../node_modules/mermaid/', import.meta.url);
const mermaidOut = new URL('../extension/vendor/mermaid/', import.meta.url);
await rm(mermaidOut, { recursive: true, force: true });
await mkdir(new URL('chunks/mermaid.esm.min/', mermaidOut), { recursive: true });
const stripMap = (code) => code.replace(/\n?\/\/# sourceMappingURL=\S+\s*$/, '\n');
await writeFile(new URL('mermaid.esm.min.mjs', mermaidOut), stripMap(await readFile(new URL('dist/mermaid.esm.min.mjs', mermaid), 'utf8')));
const { readdir } = await import('node:fs/promises');
for (const name of await readdir(new URL('dist/chunks/mermaid.esm.min/', mermaid))) {
  if (!name.endsWith('.mjs')) continue;
  const code = await readFile(new URL(`dist/chunks/mermaid.esm.min/${name}`, mermaid), 'utf8');
  await writeFile(new URL(`chunks/mermaid.esm.min/${name}`, mermaidOut), stripMap(code));
}
await cp(new URL('LICENSE', mermaid), new URL('LICENSE', mermaidOut));
const mermaidVersion = JSON.parse(await readFile(new URL('package.json', mermaid), 'utf8')).version;
await writeFile(new URL('VERSION', mermaidOut), `${mermaidVersion}\n`);
console.log(`Bundled mermaid ${mermaidVersion}`);
