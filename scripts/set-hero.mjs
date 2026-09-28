/**
 * Set the landing photograph: npm run photos:hero -- path/to/image.jpg
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { encodePhoto } from './encode.mjs';

const file = process.argv[2];
if (!file) { console.error('usage: npm run photos:hero -- <image>'); process.exit(1); }
await mkdir('public/photos', { recursive: true });
const r = await encodePhoto(file, 'public/photos', 'hero');

/*
 * The hero is the largest single asset on the page and the one the visitor
 * waits on. A 2048px full-size is far more than a viewport-covering
 * background needs, so write a 1280px mid step; the markup offers thumb /
 * mid / full and lets the browser pick one.
 */
const sharp = (await import('sharp')).default;
await sharp(file).rotate()
  .resize(1280, 1280, { fit: 'inside', withoutEnlargement: true })
  .webp({ quality: 78, effort: 4 })
  .toFile('public/photos/hero.mid.webp');
let gen = { rooms: [] };
try { gen = JSON.parse(await readFile('data/generated.json', 'utf8')); } catch { /* fresh */ }
gen.hero = '/photos/hero.webp';
await writeFile('data/generated.json', JSON.stringify(gen, null, 2) + '\n');
const { statSync } = await import('node:fs');
const mid = statSync('public/photos/hero.mid.webp').size;
console.log(`hero set: ${r.width}x${r.height}`);
console.log(`  full ${(r.bytes / 1024).toFixed(0)} KB · mid ${(mid / 1024).toFixed(0)} KB · thumb ${(r.thumbBytes / 1024).toFixed(0)} KB`);
console.log('Restart the dev server.');
