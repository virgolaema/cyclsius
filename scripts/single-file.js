// Builds dist/cyclsius.html: the whole web app in one file (no service worker).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (f) => readFile(root + 'www/' + f, 'utf8');
const strip = (js) => js.replace(/^import[\s\S]*?from '.\/cycle.js';\n/m, '').replace(/^export /gm, '');
let html = await read('index.html');
const css = await read('styles.css');
const js = strip(await read('cycle.js')) + '\n' + strip(await read('app.js'));
const icon = (await readFile(root + 'www/icons/icon-192.png')).toString('base64');
html = html
  .replace('<link rel="stylesheet" href="styles.css">', () => `<style>\n${css}</style>`)
  .replace('<link rel="manifest" href="manifest.webmanifest">\n', '')
  .replace(/href="icons\/icon-192.png"/g, `href="data:image/png;base64,${icon}"`)
  .replace('<script type="module" src="app.js"></script>', () => `<script type="module">\n${js}</script>`);
await mkdir(root + 'dist', { recursive: true });
await writeFile(root + 'dist/cyclsius.html', html);
console.log('dist/cyclsius.html', html.length, 'bytes');
