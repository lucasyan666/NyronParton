/**
 * Drop folder → exhibition.
 *
 *   drop/
 *     hero.jpg                 the landing photograph (optional)
 *     nights/                  a folder is a ROOM in the foyer — one per style
 *       room.json              optional: { "title", "subtitle", "mood", "statement" }
 *       01.jpg 02.jpg …        hung in filename order
 *     black-and-white/
 *     travel/
 *     loose.jpg …              files with no folder are dealt into rooms for you
 *
 *   npm run photos:scan
 *   npm run photos:scan -- path/to/other/folder     (scan somewhere else)
 *
 * Every image is compressed into public/photos/ (a 2048px WebP plus a small
 * thumb), measured for its true aspect ratio, and written to
 * data/generated.json, which the site uses in place of the built-in demo.
 *
 * mood is one of: concrete (warm, board-marked), noir (near-black, cool lamps
 * — made for black and white), gallery (pale plaster and daylight). Folders
 * that do not name one take them in turn.
 */
import { readdir, mkdir, stat, writeFile, readFile, rm } from 'node:fs/promises';
import { join, parse } from 'node:path';
import { encodePhoto } from './encode.mjs';

const SRC = process.argv[2] ?? 'drop';
const OUT = 'public/photos';
const GEN = 'data/generated.json';
const IMAGE = /\.(jpe?g|png|tiff?|webp|avif|heic|heif)$/i;
/** Works per room inside a wing; rooms are balanced, never a lone print. */
const PER_ROOM = 6;
const MOODS = ['concrete', 'noir', 'gallery'];

/**
 * Example copy. A phone's filename is not a title, so works get a working
 * title and a one-line caption in the house voice — clearly placeholders,
 * shaped like the real thing — until the photographer writes his own.
 */
const ROOM_TITLES = [
  'Nights', 'The People I Was With', 'Elsewhere', 'In Between',
  'Late', 'Daylight', 'Interiors', 'Return',
];
const ROOM_STATEMENTS = [
  'What the flash found, and what it missed.',
  'Not portraits. Just who was there.',
  'Berlin, Georgia, and the long way round.',
  'The frames that were not the reason I brought the camera.',
  'After the last train.',
  'Colour, for once.',
  'Rooms that belonged to someone.',
  'Home, eventually.',
];
const TITLES = [
  'Front Left', 'Smoke', 'Outside', 'Last Track', 'Walk Home', 'Across the Table',
  'The Group', 'On the Step', 'Last Frame', 'Graduation', 'Kazbek', 'Doorway',
  'Canal, Night', 'Ridge', 'Lotto', 'Mirror', 'Empty Street', 'Docu', 'Last Light',
  'Kitchen', 'Balcony', 'Night Bus', 'Two Pints', 'Stairwell',
];
const CAPTIONS = [
  'Where the sound is loudest and no one is watching the booth.',
  'A room turned orange for the length of one track.',
  'The part of the night that happens on the pavement.',
  'No one wants to be the first to leave.',
  'The long way round, because it was still warm.',
  'Mid-sentence, mid-drink.',
  'Everyone in the frame, which never happens.',
  'Waiting for someone who was always going to be late.',
  'The end of the roll, and the best one on it.',
  'Four years, one hat, borrowed gown.',
  'Five thousand metres of mountain doing nothing, beautifully.',
  'A front door older than my country.',
  'No signal, no idea where I was.',
  'After the photograph is where the walking starts.',
  'The most saturated thing on the street.',
  'Every film photographer has this frame. This is mine.',
  'Middle of the afternoon, no one about.',
  'Printed and stacked and finally real.',
  'Wound on. Nothing left. Time to go home.',
  'The party ended in here, the way it always does.',
  "Someone else's view, borrowed for a cigarette.",
  'Top deck, front seat, nobody else.',
  'Held up for the camera like evidence.',
  'Went up it for no reason, got a photograph out of it.',
];

/** "02-black-and-white" → "Black and White" */
function prettify(name) {
  const words = name.replace(/^\d+[\s._-]*/, '').replace(/[_-]+/g, ' ').trim().split(/\s+/);
  const small = new Set(['and', 'of', 'the', 'in', 'at', 'on', 'a', 'to', 'for']);
  return words
    .map((w, i) => (i > 0 && small.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'room';

async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; }
}

/* --------------------------------------------------------------- collect */

let entries;
try {
  entries = await readdir(SRC, { withFileTypes: true });
} catch {
  console.error(`No ${SRC}/ folder. Create it and drop images in.`);
  process.exit(1);
}

const heroFile = entries.find((e) => e.isFile() && /^hero\./i.test(e.name) && IMAGE.test(e.name))?.name ?? null;
const loose = entries
  .filter((e) => e.isFile() && IMAGE.test(e.name) && e.name !== heroFile)
  .map((e) => e.name)
  .sort();

/** Groups to become wings: { folder, files, meta } */
const groups = [];
for (const dir of entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).sort((a, b) => a.name.localeCompare(b.name))) {
  const files = (await readdir(join(SRC, dir.name))).filter((f) => IMAGE.test(f)).sort();
  if (!files.length) continue;
  groups.push({ folder: dir.name, files: files.map((f) => join(dir.name, f)), meta: (await readJson(join(SRC, dir.name, 'room.json'))) ?? {} });
}

if (loose.length) {
  if (groups.length) {
    // Folders are the plan; loose files go in a room of their own.
    groups.push({ folder: null, files: loose, meta: { title: 'More' } });
  } else {
    // No folders yet: deal the loose files into a few rooms of four to six,
    // so the foyer still has doors to choose between.
    const count = Math.max(1, Math.min(5, Math.round(loose.length / 4.5)));
    const size = Math.ceil(loose.length / count);
    for (let i = 0; i < count; i++) {
      const files = loose.slice(i * size, (i + 1) * size);
      if (files.length) groups.push({ folder: null, files, meta: {} });
    }
  }
}

if (!groups.length) {
  console.error(`${SRC}/ has no images — drop some in (or folders of them) and run again.`);
  process.exit(1);
}

await mkdir(OUT, { recursive: true });
// Clear previously generated drops so removed files actually disappear.
for (const f of await readdir(OUT)) {
  if (f.startsWith('drop-')) await rm(join(OUT, f));
}

/* ---------------------------------------------------------------- encode */

let counter = 0;
let before = 0;
let after = 0;
const wings = [];

for (const [w, group] of groups.entries()) {
  const photos = [];
  for (const rel of group.files) {
    const id = `drop-${String(++counter).padStart(3, '0')}`;
    const inPath = join(SRC, rel);
    try {
      before += (await stat(inPath)).size;
      const r = await encodePhoto(inPath, OUT, id);
      after += r.bytes;
      const n = counter - 1;
      photos.push({
        id,
        src: `/photos/${id}.webp`,
        title: TITLES[n % TITLES.length],
        caption: CAPTIONS[n % CAPTIONS.length],
        year: r.year ?? '2025',
        medium: '35mm film',
        aspect: r.aspect,
        // keep the source name so the photographer can find the file
        source: rel,
      });
    } catch (err) {
      console.error(`  skipped ${rel}: ${err.message}`);
    }
  }
  if (!photos.length) continue;

  const meta = group.meta;
  const title = meta.title ?? (group.folder ? prettify(group.folder) : ROOM_TITLES[w % ROOM_TITLES.length]);
  const statement = meta.statement ?? meta.subtitle ?? ROOM_STATEMENTS[w % ROOM_STATEMENTS.length];
  const mood = MOODS.includes(meta.mood) ? meta.mood : MOODS[w % MOODS.length];

  // Balanced rooms: 7 works make rooms of 4 and 3, never 6 and 1.
  const roomCount = Math.ceil(photos.length / PER_ROOM);
  const size = Math.ceil(photos.length / roomCount);
  const rooms = [];
  for (let r = 0; r < roomCount; r++) {
    const slice = photos.slice(r * size, (r + 1) * size);
    if (!slice.length) continue;
    const isLast = r === roomCount - 1;
    // A salon hangs on the wall you face before a turn, so never in a last
    // room; inside a wing they alternate with corridors.
    const layout = !isLast && r % 2 === 1 ? 'salon' : 'corridor';
    slice[0].scale = 2.2; // the first work in each room is its large print
    rooms.push({
      id: `${slug(title)}-${r + 1}`,
      title: r === 0 ? title : `${title} · ${['II', 'III', 'IV', 'V', 'VI'][r - 1] ?? r + 1}`,
      statement: r === 0 ? statement : undefined,
      layout,
      width: layout === 'salon' ? 3.4 : 2.2,
      spacing: 4.4,
      photos: slice,
    });
  }

  wings.push({
    id: slug(title),
    title,
    subtitle: meta.subtitle ?? statement,
    mood,
    rooms,
  });
}

/* ------------------------------------------------------------------ hero */

let hero;
if (heroFile) {
  await encodePhoto(join(SRC, heroFile), OUT, 'hero');
  hero = '/photos/hero.webp';
  console.log(`hero: ${heroFile} -> public/photos/hero.webp`);
} else {
  // keep a previously set hero if the file is still there
  try {
    const prev = JSON.parse(await readFile(GEN, 'utf8'));
    if (prev.hero) { await stat(join('public', prev.hero)); hero = prev.hero; }
  } catch { /* none */ }
}

await writeFile(GEN, JSON.stringify(hero ? { hero, wings } : { wings }, null, 2) + '\n');

const mb = (n) => (n / 1024 / 1024).toFixed(1);
const total = wings.reduce((a, w) => a + w.rooms.reduce((b, r) => b + r.photos.length, 0), 0);
console.log(`${total} photos -> ${wings.length} rooms in the foyer`);
for (const w of wings) {
  const works = w.rooms.reduce((a, r) => a + r.photos.length, 0);
  console.log(`  ${w.title.padEnd(26)} ${String(works).padStart(3)} works  ${w.rooms.length} part${w.rooms.length > 1 ? 's' : ''}  ${w.mood}`);
}
console.log(`${mb(before)} MB -> ${mb(after)} MB (avg ${Math.round(after / Math.max(1, total) / 1024)} KB)`);
console.log(`\nWrote ${GEN}. Restart the dev server if it is running.`);
console.log(`To go back to the built-in demo: rm ${GEN}`);
