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
