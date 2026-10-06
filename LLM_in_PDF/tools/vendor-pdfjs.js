import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'node_modules/pdfjs-dist');
const dest = path.join(root, 'extension/vendor/pdfjs');
for (const entry of ['build/pdf.mjs', 'build/pdf.worker.mjs', 'web/pdf_viewer.mjs', 'web/pdf_viewer.css', 'web/images', 'cmaps', 'standard_fonts', 'wasm', 'iccs', 'LICENSE']) {
  await mkdir(path.dirname(path.join(dest, entry)), { recursive: true });
  // Legacy JS supplies standard-library polyfills for supported Chrome versions.
  const source = entry.endsWith('.mjs') ? path.join(src, 'legacy', entry) : path.join(src, entry);
  await cp(source, path.join(dest, entry), { recursive: true });
}
const { version } = JSON.parse(await readFile(path.join(src, 'package.json'), 'utf8'));
await writeFile(path.join(dest, 'VERSION'), `${version}\n`);
console.log(`Bundled PDF.js ${version}`);
