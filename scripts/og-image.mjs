/**
 * Regenerates public/og-image.png (1200x630) from src/assets/bakeit-logo.svg.
 *
 * Run by hand — `node scripts/og-image.mjs` — and commit the result. It is deliberately NOT
 * wired into `npm run build`: the PNG changes only when the logo does, and keeping it out of
 * the build keeps `astro build` free of image-generation work.
 */
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const W = 1200;
const H = 630;
const LOGO_W = 680;
const GAP = 52;      // logo baseline -> tagline block
const TAGLINE_H = 44;

const background = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1a1726"/>
      <stop offset="1" stop-color="#100f18"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.42" r="0.62">
      <stop offset="0" stop-color="#8b7cf6" stop-opacity="0.28"/>
      <stop offset="1" stop-color="#8b7cf6" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <rect x="0" y="${H - 8}" width="${W}" height="8" fill="#a78bfa"/>
</svg>`;

// density: 600 so the vector is rasterised well above the target size before downscaling.
const logo = await sharp(readFileSync(new URL('src/assets/bakeit-logo.svg', root)), { density: 600 })
  .resize({ width: LOGO_W })
  .png()
  .toBuffer();
const { height: logoH } = await sharp(logo).metadata();

const tagline = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="90">
  <text x="${W / 2}" y="60" text-anchor="middle"
    font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="34" font-weight="500"
    fill="#c4b5fd" letter-spacing="1.5">Modern Software Development Principles</text>
</svg>`;

const top = Math.round((H - (logoH + GAP + TAGLINE_H)) / 2) - 24;
const out = fileURLToPath(new URL('public/og-image.png', root));

await sharp(Buffer.from(background))
  .composite([
    { input: logo, left: Math.round((W - LOGO_W) / 2), top },
    { input: Buffer.from(tagline), left: 0, top: top + logoH + GAP },
  ])
  .png()
  .toFile(out);

console.log(`wrote ${out}`);
