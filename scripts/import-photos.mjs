/**
 * Import a folder of photographs into the exhibition.
 *
 *   node scripts/import-photos.mjs <folder> [--room street] [--title "III. Street"]
 *
 * Reads every image in <folder>, compresses it into public/photos/, measures
 * the real aspect ratio, pulls EXIF date where present, and prints a ready-made
 * room block to paste into data/exhibition.ts.
 *
 * You do not need to rename anything first — files are slugged automatically
 * and the original name is kept as the working title.
 */
import { readdir, mkdir, stat } from 'node:fs/promises';
import { join, parse } from 'node:path';
import { encodePhoto } from './encode.mjs';

const args = process.argv.slice(2);
const folder = args.find((a) => !a.startsWith('--'));

function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
}

if (!folder) {
  console.error('Usage: node scripts/import-photos.mjs <folder> [--room id] [--title "Room title"]');
  process.exit(1);
}

const roomId = flag('room', parse(folder).name.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
const roomTitle = flag('title', roomId.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()));

const OUT = 'public/photos';
await mkdir(OUT, { recursive: true });

let files;
try {
  files = (await readdir(folder))
    .filter((f) => /\.(jpe?g|png|tiff?|webp|heic|heif)$/i.test(f))
    .sort();
} catch {
  console.error(`Cannot read folder: ${folder}`);
  process.exit(1);
}

if (!files.length) {
  console.error(`No images found in ${folder}`);
  process.exit(1);
}

const slug = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

const entries = [];
let before = 0;
let after = 0;

for (const [i, file] of files.entries()) {
  const inPath = join(folder, file);
  const { name } = parse(file);
  const id = `${roomId}-${String(i + 1).padStart(2, '0')}`;

  before += (await stat(inPath)).size;
  const r = await encodePhoto(inPath, OUT, id);
  const { width: w, height: h, aspect, year } = r;
  const size = r.bytes;
  after += size;

  entries.push({ id, aspect, year, original: name, kb: Math.round(size / 1024) });
  console.log(`  ${id}  ${String(w).padStart(5)}x${String(h).padEnd(5)} ${String(aspect).padEnd(6)} ${String(entries.at(-1).kb).padStart(4)} KB  ${name}`);
}

const mb = (n) => (n / 1024 / 1024).toFixed(1);
const avg = Math.round(after / entries.length / 1024);

console.error(`\n${entries.length} photos  ${mb(before)} MB -> ${mb(after)} MB  (avg ${avg} KB)`);
if (avg > 150) {
  console.error(`Average is above the 150 KB target. Lower QUALITY or MAX_EDGE in this script.`);
}

// ---- emit a paste-ready room block -----------------------------------------

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

const lines = entries.map((e) => {
  const extras = [];
  if (e.year) extras.push(`year: '${e.year}'`);
  const extra = extras.length ? `, { ${extras.join(', ')} }` : '';
  return `      p('${e.id}', '${esc(e.original)}', 'TODO caption.', ${e.aspect}${extra}),`;
});

console.log(`
/* ---- paste into EXHIBITION in data/exhibition.ts ---- */
  {
    id: '${roomId}',
    title: '${esc(roomTitle)}',
    statement: 'TODO one line of wall text.',
    layout: 'corridor',
    width: 6.5,
    spacing: 10,
    photos: [
${lines.join('\n')}
    ],
  },
`);
