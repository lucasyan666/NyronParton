/**
 * The exhibition. This is the file you edit to curate the show.
 *
 * Rooms are laid out sequentially along -Z. A room is either:
 *   layout: 'corridor'  — photos alternate left/right wall, evenly spaced
 *   layout: 'salon'     — photos clustered on one end wall, stacked grid
 *   layout: 'custom'    — you place every photo by hand via `at`
 *
 * Add a room by adding an entry. Depth is derived, never hand-maintained.
 */

import generatedJson from './generated.json';

export type Vec3 = [number, number, number];

export type Photo = {
  id: string;
  /**
   * Full-size image under /public, always .webp. A small companion at
   * `<name>.thumb.webp` is loaded first so a frame is never blank while the
   * full print decodes — see thumbOf().
   */
  src: string;
  title: string;
  /** Shown in the overlay on click. Plain text, no markup. Keep it short. */
  caption: string;
  year?: string;
  place?: string;
  /** Title · Year · Medium is the hover line. e.g. '35mm film'. */
  medium?: string;
  /** Aspect ratio w/h. 1.5 = 3:2 landscape, 0.667 = 2:3 portrait. */
  aspect: number;
  /** Height in world units. Bigger = a more important print. */
  scale?: number;
  /** custom layout only: explicit position + Y-rotation in radians. */
  at?: { position: Vec3; rotationY: number };
};

export type Room = {
  id: string;
  title: string;
  /** Wall text at the room entrance. Keep it short and declarative. */
  statement?: string;
  layout: 'corridor' | 'salon' | 'custom';
  /** Half-width in metres. 2.4 is a corridor; 4–5 is a chamber. */
  width?: number;
  /** Spacing between photos along Z in corridor layout. */
  spacing?: number;
  photos: Photo[];
};

const p = (
  id: string,
  title: string,
  caption: string,
  aspect: number,
  extra: Partial<Photo> = {},
): Photo => ({
  id,
  src: `/photos/${id}.webp`,
  title,
  caption,
  aspect,
  medium: '35mm film',
  ...extra,
});

/** The mid-size step, used for the landing image. */
export function midOf(src: string): string {
  return src.replace(/\.(webp|jpe?g|png)$/i, '.mid.webp');
}

/** The low-res companion the loader shows while the full print decodes. */
export function thumbOf(src: string): string {
  return src.replace(/\.(webp|jpe?g|png)$/i, '.thumb.webp');
}

const DEMO: Room[] = [
  {
    id: 'nights',
    title: 'Nights',
    statement: 'What the flash found, and what it missed.',
    layout: 'corridor',
    width: 2.2,
    spacing: 4.4,
    photos: [
      p('nights-01', 'Front Left', 'Where the sound is loudest and no one is watching the booth.', 1.5, { year: '2024', scale: 2.2 }),
      p('nights-02', 'Smoke', 'A room turned orange for the length of one track.', 1.5, { year: '2024' }),
      p('nights-03', 'Outside', 'The part of the night that happens on the pavement.', 0.667, { year: '2023' }),
      p('nights-04', 'Lost Village', 'A field, a tent, and a sound system three fields wide.', 1.5, { year: '2023', medium: '35mm film, flash' }),
      p('nights-05', 'Last Track', 'No one wants to be the first to leave.', 1.5, { year: '2024' }),
      p('nights-06', 'Walk Home', 'The long way round, because it was still warm.', 1.5, { year: '2024', scale: 2.2 }),
    ],
  },
  {
    id: 'people',
    title: 'The People I Was With',
    statement: 'Not portraits. Just who was there.',
    layout: 'salon',
    width: 3.4,
    photos: [
      p('people-01', 'Across the Table', 'Mid-sentence, mid-drink.', 0.8, { year: '2024' }),
      p('people-02', 'The Group', 'Everyone in the frame, which never happens.', 1.2, { year: '2023' }),
      p('people-03', 'On the Step', 'Waiting for someone who was always going to be late.', 0.8, { year: '2024' }),
      p('people-04', 'Last Frame', 'The end of the roll, and the best one on it.', 0.8, { year: '2023', medium: '35mm film, black and white' }),
      p('people-05', 'Graduation', 'Four years, one hat, borrowed gown.', 0.8, { year: '2024' }),
    ],
  },
  {
    id: 'elsewhere',
    title: 'Elsewhere',
    statement: 'Berlin, Georgia, and the long way round.',
    layout: 'custom',
    width: 3.4,
    photos: [
      // One wide print on the left wall, four small ones opposite. Positions
      // are in the room's own frame: x across, z forward (negative), y up.
      p('elsewhere-01', 'Kazbek', 'Five thousand metres of mountain doing nothing, beautifully.', 2.4, {
        year: '2024', medium: '35mm film', scale: 2.3,
        at: { position: [-3.4, 1.72, -7.5], rotationY: Math.PI / 2 },
      }),
      p('elsewhere-02', 'Election Week', 'Berlin. The headlines were louder than the bars.', 1.0, {
        year: '2025', scale: 1.05,
        at: { position: [3.4, 2.4, -5], rotationY: -Math.PI / 2 },
      }),
      p('elsewhere-03', 'Doorway', 'Tbilisi. A front door older than my country.', 1.0, {
        year: '2024', scale: 1.05,
        at: { position: [3.4, 1.1, -5], rotationY: -Math.PI / 2 },
      }),
      p('elsewhere-04', 'Canal, Night', 'No signal, no idea where I was.', 1.0, {
        year: '2025', scale: 1.05,
        at: { position: [3.4, 2.4, -10], rotationY: -Math.PI / 2 },
      }),
      p('elsewhere-05', 'Ridge', 'After the photograph is where the walking starts.', 1.0, {
        year: '2024', scale: 1.05,
        at: { position: [3.4, 1.1, -10], rotationY: -Math.PI / 2 },
      }),
    ],
  },
  {
    id: 'between',
    title: 'In Between',
    statement: 'The frames that were not the reason I brought the camera.',
    layout: 'corridor',
    width: 2.2,
    spacing: 4.4,
    photos: [
      p('between-01', 'Lotto', 'The most saturated thing on the street.', 0.667, { year: '2025' }),
      p('between-02', 'Mirror', 'Every film photographer has this frame. This is mine.', 0.667, { year: '2024' }),
      p('between-03', 'Empty Street', 'Middle of the afternoon, no one about.', 1.5, { year: '2024' }),
      p('between-04', 'Docu', 'The zine, printed and stacked and finally real.', 1.5, { year: '2025', medium: 'Risograph, 24 pages' }),
      p('between-05', 'Last Light', 'Wound on. Nothing left. Time to go home.', 1.5, { year: '2024', scale: 2.1 }),
    ],
  },
];

/** The built-in show, exported so tooling can generate matching placeholders. */
export const DEMO_ROOMS = DEMO;

/**
 * Drop-folder override. `npm run photos:scan` writes data/generated.json from
 * whatever is in drop/; when it holds rooms, it replaces the built-in demo.
 * Delete the file (or empty its rooms) to go back to the demo show.
 */
const generatedData = generatedJson as { rooms?: Room[]; hero?: string };
const generated = generatedData.rooms ?? [];

export const EXHIBITION: Room[] = generated.length > 0 ? generated : DEMO;

/** Flat list of every photo, in exhibition order. */
export const ALL_PHOTOS: Photo[] = EXHIBITION.flatMap((r) => r.photos);

/**
 * The landing photograph. Drop a file named `hero.*` into drop/ (or run
 * `npm run photos:hero -- <file>`) and it lands here; otherwise the first
 * work in the show stands in.
 */
export const HERO_SRC: string = generatedData.hero ?? ALL_PHOTOS[0]?.src ?? '';
