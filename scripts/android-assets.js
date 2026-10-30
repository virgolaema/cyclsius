// Regenerates Android launcher icons and splash screens from scripts/icon.svg.
// Overwrites every ic_launcher*.png / splash.png in android/app/src/main/res at its existing size.
import { chromium } from 'playwright';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('.', import.meta.url));
const res = dir + '../android/app/src/main/res/';
const BG = '#b03a5b';
const svg = await readFile(dir + 'icon.svg', 'utf8');
const glyph = svg.replace(/<rect[^>]*\/>/, ''); // icon without background
const sized = (s, px) => s.replace('<svg ', `<svg width="${px}" height="${px}" `);

const pngSize = (buf) => [buf.readUInt32BE(16), buf.readUInt32BE(20)];

const browser = await chromium.launch();
const page = await browser.newPage();
async function render(path, w, h, html, transparent = false) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<body style="margin:0;width:${w}px;height:${h}px;display:flex;align-items:center;justify-content:center;background:${transparent ? 'transparent' : BG}">${html}</body>`);
  await page.screenshot({ path, omitBackground: transparent });
}

for (const d of await readdir(res)) {
  if (!d.startsWith('mipmap-') && !d.startsWith('drawable')) continue;
  for (const f of await readdir(res + d).catch(() => [])) {
    const path = `${res}${d}/${f}`;
    if (!f.endsWith('.png')) continue;
    const [w, h] = pngSize(await readFile(path));
    if (f === 'ic_launcher_foreground.png') await render(path, w, h, sized(glyph, Math.round(w * 0.62)), true);
    else if (f === 'ic_launcher_round.png') await render(path, w, h, `<div style="width:${w}px;height:${h}px;border-radius:50%;overflow:hidden">${sized(svg, w)}</div>`, true);
    else if (f === 'ic_launcher.png') await render(path, w, h, `<div style="width:${w}px;height:${h}px;border-radius:${w * 0.18}px;overflow:hidden">${sized(svg, w)}</div>`, true);
    else if (f === 'splash.png') await render(path, w, h, sized(glyph, Math.round(Math.min(w, h) * 0.35)));
    else continue;
    console.log('wrote', d + '/' + f, w + 'x' + h);
  }
}
await browser.close();
await writeFile(res + 'values/ic_launcher_background.xml',
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BG.toUpperCase()}</color>\n</resources>\n`);
