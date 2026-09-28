/**
 * Grey stand-in plates for every photo in the built-in demo, so the gallery
 * renders before real photographs exist. Ids and aspect ratios are read from
 * data/exhibition.ts, so this can never drift from the show.
 */
import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { encodePhoto } from './encode.mjs';

const OUT = 'public/photos';
const src = await readFile('data/exhibition.ts', 'utf8');

// p('id', 'title', 'caption', aspect  — tolerating \' inside the strings.
const re = /p\(\s*'([\w-]+)'\s*,\s*'(?:[^'\\]|\\.)*'\s*,\s*'(?:[^'\\]|\\.)*'\s*,\s*([\d.]+)/g;
const entries = [...src.matchAll(re)].map((m) => ({ id: m[1], aspect: +m[2] }));
if (!entries.length) {
  console.error('No photos found in data/exhibition.ts');
  process.exit(1);
}

await mkdir(OUT, { recursive: true });
// Clear old placeholders (any format) so renamed rooms do not leave orphans.
for (const f of await readdir(OUT)) {
  if (!f.startsWith('drop-')) await rm(join(OUT, f));
}

const tmp = join(OUT, '_placeholder.png');
let i = 0;
for (const { id, aspect } of entries) {
  const w = 1400;
  const h = Math.round(w / aspect);
  const tone = 150 + ((i * 37) % 60);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <rect width="${w}" height="${h}" fill="rgb(${tone},${tone - 3},${tone - 8})"/>
  <rect x="30" y="30" width="${w - 60}" height="${h - 60}" fill="none" stroke="rgb(${tone - 40},${tone - 42},${tone - 46})" stroke-width="2"/>
  <text x="${w / 2}" y="${h / 2}" font-family="serif" font-size="44" fill="rgb(${tone - 70},${tone - 72},${tone - 76})" text-anchor="middle" letter-spacing="4">${id}</text>
</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(tmp);
  await encodePhoto(tmp, OUT, id);
  i++;
}
await rm(tmp);
console.log(`${entries.length} placeholders written to ${OUT}/ (webp + thumb)`);
