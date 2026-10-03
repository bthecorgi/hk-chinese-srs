// Renders the PWA icons with headless Chromium (Playwright).
// Usage: npm run build:icons   (needs a CJK font installed for the 字 glyph)

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'icons');

// glyphScale: share of the canvas the glyph occupies. Maskable icons keep it
// inside the central 80% safe zone.
const ICONS = [
  { file: 'apple-touch-icon.png', size: 180, glyphScale: 0.62 },
  { file: 'icon-192.png', size: 192, glyphScale: 0.62, rounded: true },
  { file: 'icon-512.png', size: 512, glyphScale: 0.62, rounded: true },
  { file: 'icon-maskable-512.png', size: 512, glyphScale: 0.5 },
];

const html = ({ size, glyphScale, rounded }) => `<!doctype html><html><body style="margin:0;background:transparent">
<div style="width:${size}px;height:${size}px;border-radius:${rounded ? size * 0.22 : 0}px;
  background:linear-gradient(160deg,#c8352b,#9c1f18);display:grid;place-items:center;position:relative;overflow:hidden">
  <div style="position:absolute;inset:${size * 0.09}px;border:${Math.max(2, size * 0.012)}px solid rgba(255,255,255,.28);border-radius:${size * 0.08}px"></div>
  <div style="position:absolute;left:50%;top:9%;bottom:9%;border-left:${Math.max(1, size * 0.006)}px dashed rgba(255,255,255,.22)"></div>
  <div style="position:absolute;top:50%;left:9%;right:9%;border-top:${Math.max(1, size * 0.006)}px dashed rgba(255,255,255,.22)"></div>
  <span style="position:relative;color:#fff;font:${size * glyphScale}px/1 'WenQuanYi Zen Hei','Noto Sans CJK TC','PingFang HK',sans-serif">字</span>
</div></body></html>`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
for (const icon of ICONS) {
  await page.setViewportSize({ width: icon.size, height: icon.size });
  await page.setContent(html(icon));
  await page.screenshot({ path: path.join(OUT, icon.file), omitBackground: !!icon.rounded });
  console.log(`wrote icons/${icon.file}`);
}
await browser.close();
