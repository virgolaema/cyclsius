// Renders scripts/icon.svg to PNG icons with the preinstalled Playwright Chromium.
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('.', import.meta.url));
const svg = await readFile(dir + 'icon.svg', 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, pad] of [['icon-192', 192, 0], ['icon-512', 512, 0], ['icon-maskable-512', 512, 0.1], ['../../resources/icon', 1024, 0]]) {
  await page.setViewportSize({ width: size, height: size });
  const inner = size * (1 - 2 * pad);
  await page.setContent(`<body style="margin:0;background:#b03a5b"><div style="padding:${size * pad}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body>`);
  await page.screenshot({ path: `${dir}../www/icons/${name}.png`, omitBackground: false });
}
await browser.close();
