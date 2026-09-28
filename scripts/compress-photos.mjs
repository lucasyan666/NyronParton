/**
 * Photo pipeline. Drop full-resolution originals into `photos-src/` named
 * to match the ids in data/exhibition.ts (entry-01.jpg, portrait-03.jpg, …),
 * then: npm run photos:compress
 *
 * At 80 photos this is not optional. Untouched exports from a camera will be
 * 300MB+ and the site will never load on anything but your own laptop.
 */
import { readdir, mkdir, stat } from 'node:fs/promises';
import { join, parse } from 'node:path';
import { encodePhoto } from './encode.mjs';

const SRC = 'photos-src';
const OUT = 'public/photos';

await mkdir(OUT, { recursive: true });

let files;
try {
  files = (await readdir(SRC)).filter((f) => /\.(jpe?g|png|tiff?|webp)$/i.test(f));
} catch {
  console.error(`No ${SRC}/ directory. Create it and add your originals.`);
  process.exit(1);
}

if (!files.length) {
  console.error(`${SRC}/ is empty.`);
  process.exit(1);
}

let before = 0;
let after = 0;

for (const file of files) {
  const { name } = parse(file);
  const inPath = join(SRC, file);
  before += (await stat(inPath)).size;
  const r = await encodePhoto(inPath, OUT, name);
  after += r.bytes;
  console.log(`${name.padEnd(16)} ${(r.bytes / 1024).toFixed(0).padStart(5)} KB  (+${(r.thumbBytes / 1024).toFixed(0)} KB thumb)`);
}

const mb = (n) => (n / 1024 / 1024).toFixed(1);
console.log(`\n${files.length} photos: ${mb(before)} MB -> ${mb(after)} MB`);
console.log(`Aim for under 150 KB average. Currently ${(after / files.length / 1024).toFixed(0)} KB.`);
