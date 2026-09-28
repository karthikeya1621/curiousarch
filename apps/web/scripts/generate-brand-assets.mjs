/**
 * Renders the brand PNGs from the logo geometry (one source of truth: components/Logo.tsx and
 * app/icon.svg). Run after changing the mark or the wordmark:
 *
 *   node scripts/generate-brand-assets.mjs
 *
 * Needs network once (Space Grotesk from Google Fonts, for the social card) and Playwright's Chromium
 * (`npx playwright install chromium`). Writes:
 *   app/apple-icon.png          180x180  iOS home-screen icon (opaque, as iOS requires)
 *   app/opengraph-image.png     1200x630 link preview (Open Graph)
 *   app/twitter-image.png       1200x630 link preview (Twitter/X)
 *   public/icon-192.png, public/icon-512.png   PWA / Android icons (manifest)
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dirname, "..");
const INK = "#0f172a";

const mark = (id, color) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 280" width="100%" height="100%">
  <defs>
    <path id="s${id}" d="M140 0 H420 A60 60 0 0 1 480 60 V220 A60 60 0 0 1 420 280 H140 A140 140 0 0 1 140 0 Z"/>
    <mask id="m${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="480" height="280">
      <use href="#s${id}" fill="#fff"/>
      <g stroke="#000" stroke-width="24"><line x1="100" y1="140" x2="240" y2="140"/><line x1="240" y1="36" x2="240" y2="244"/><line x1="366" y1="140" x2="366" y2="290"/></g>
      <g fill="#000"><circle cx="240" cy="36" r="30"/><circle cx="240" cy="244" r="30"/><circle cx="100" cy="140" r="30"/><circle cx="366" cy="140" r="30"/></g>
      <g fill="#fff"><circle cx="240" cy="36" r="14"/><circle cx="240" cy="244" r="14"/><circle cx="100" cy="140" r="14"/><circle cx="366" cy="140" r="14"/></g>
    </mask>
  </defs>
  <use href="#s${id}" fill="${color}" mask="url(#m${id})"/>
</svg>`;

const FONT = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;700&display=block">`;

/** A square icon: the mark centred on a white tile, `pad` = fraction of the side left empty around it. */
const iconHtml = (size, pad) => `<html><body style="margin:0;background:#fff;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center">
  <div style="width:${size * (1 - 2 * pad)}px;height:${(size * (1 - 2 * pad) * 280) / 480}px">${mark("i", INK)}</div></body></html>`;

const cardHtml = `<html><head>${FONT}</head><body style="margin:0;width:1200px;height:630px;background:#f8fafc;display:flex;flex-direction:column;justify-content:center;padding:0 96px;box-sizing:border-box;font-family:'Space Grotesk',sans-serif;color:${INK}">
  <div style="display:flex;align-items:center;gap:36px">
    <div style="width:210px;height:122px">${mark("c", INK)}</div>
    <div style="font-size:112px;letter-spacing:-0.03em;line-height:1"><span style="font-weight:300">Curious</span><span style="font-weight:700">Arch</span></div>
  </div>
  <div style="margin-top:56px;font-size:46px;line-height:1.25;max-width:940px;color:#334155">Describe a system in plain English. See where it breaks as it grows. Try the fix.</div>
</body></html>`;

const browser = await chromium.launch();
async function shot(html, width, height, out) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  writeFileSync(path.join(root, out), await page.screenshot({ type: "png" }));
  await page.close();
  console.log("wrote", out);
}

await shot(iconHtml(180, 0.14), 180, 180, "app/apple-icon.png");
await shot(iconHtml(192, 0.1), 192, 192, "public/icon-192.png");
await shot(iconHtml(512, 0.1), 512, 512, "public/icon-512.png");
await shot(cardHtml, 1200, 630, "app/opengraph-image.png");
await shot(cardHtml, 1200, 630, "app/twitter-image.png");
await browser.close();
