/**
 * Drop-folder mode, for seeing the gallery with real images fast.
 *
 * Put any images in `drop/` and run this. It compresses them into
 * public/photos/, measures real aspect ratios, and writes
 * `data/generated.json`, which the exhibition uses automatically when present.
 *
 * No renaming, no captions, no editing data/exhibition.ts. Photos are dealt
 * into rooms of ~12 so the walk still has structure.
 */
import { readdir, mkdir, stat, writeFile, readFile, rm } from 'node:fs/promises';
import { join, parse } from 'node:path';
import { encodePhoto } from './encode.mjs';

const SRC = 'drop';
const OUT = 'public/photos';
const GEN = 'data/generated.json';
/** Works per room. The brief asks for 3–6; five reads as a considered hang. */
const PER_ROOM = 5;

/**
 * Example copy. A phone's filename is not a title, so drops get a working
 * title and a one-line caption in the house voice — clearly placeholders,
 * shaped like the real thing, so the hang reads as designed until the
 * photographer writes his own.
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
  'Someone else\'s view, borrowed for a cigarette.',
  'Top deck, front seat, nobody else.',
  'Held up for the camera like evidence.',
  'Went up it for no reason, got a photograph out of it.',
];
const LAYOUTS = ['corridor', 'salon', 'corridor', 'corridor'];

let files;
let heroFile = null;
try {
  files = (await readdir(SRC))
    .filter((f) => /\.(jpe?g|png|tiff?|webp|avif|heic|heif)$/i.test(f))
    .sort();
  // A file named hero.* is the landing photograph, not a work in the show.
  heroFile = files.find((f) => /^hero\./i.test(f)) ?? null;
  files = files.filter((f) => f !== heroFile);
} catch {
  console.error(`No ${SRC}/ folder. Create it and drop images in.`);
  process.exit(1);
}

if (!files.length) {
  console.error(`${SRC}/ is empty — drop some images in and run again.`);
  process.exit(1);
}

await mkdir(OUT, { recursive: true });

// Clear previously generated drops so removed files actually disappear.
for (const f of await readdir(OUT)) {
  if (f.startsWith('drop-')) await rm(join(OUT, f));
}

const photos = [];
let before = 0;
let after = 0;

for (const [i, file] of files.entries()) {
  const id = `drop-${String(i + 1).padStart(3, '0')}`;
  const inPath = join(SRC, file);

  try {
    before += (await stat(inPath)).size;
    const r = await encodePhoto(inPath, OUT, id);
    after += r.bytes;

    photos.push({
      id,
      src: `/photos/${id}.webp`,
      title: TITLES[i % TITLES.length],
      caption: CAPTIONS[i % CAPTIONS.length],
      year: r.year ?? '2025',
      medium: '35mm film',
      aspect: r.aspect,
      // keep the source name so the photographer can find the file
      source: parse(file).name,
    });
  } catch (err) {
    console.error(`  skipped ${file}: ${err.message}`);
  }
}

if (!photos.length) {
  console.error('Nothing usable found.');
  process.exit(1);
}

// Deal into rooms, giving a few photos a larger print so scale varies.
const rooms = [];
for (let i = 0; i < photos.length; i += PER_ROOM) {
  const slice = photos.slice(i, i + PER_ROOM);
  const n = rooms.length;
  // First work in each room is the hero print.
  slice.forEach((p, j) => {
    if (j === 0) p.scale = 2.2;
  });
  rooms.push({
    id: `drop-room-${n + 1}`,
    title: ROOM_TITLES[n % ROOM_TITLES.length],
    statement: ROOM_STATEMENTS[n % ROOM_STATEMENTS.length],
    layout: (i + PER_ROOM >= photos.length) ? 'corridor' : LAYOUTS[n % LAYOUTS.length],
    width: (i + PER_ROOM < photos.length && LAYOUTS[n % LAYOUTS.length] === 'salon') ? 3.4 : 2.2,
    spacing: 4.4,
    photos: slice,
  });
}

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
await writeFile(GEN, JSON.stringify(hero ? { hero, rooms } : { rooms }, null, 2) + '\n');

const mb = (n) => (n / 1024 / 1024).toFixed(1);
console.log(`${photos.length} photos -> ${rooms.length} rooms`);
console.log(`${mb(before)} MB -> ${mb(after)} MB (avg ${Math.round(after / photos.length / 1024)} KB)`);
console.log(`\nWrote ${GEN}. Restart the dev server if it is running.`);
console.log(`To go back to the built-in demo: rm ${GEN}`);
