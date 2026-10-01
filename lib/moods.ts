/**
 * Room looks. Each wing of the exhibition picks one, so different styles of
 * photograph hang in rooms that suit them: warm concrete for colour flash
 * work, near-black with cool lamps for black-and-white, pale plaster and
 * daylight for travel and landscape.
 *
 * Everything that depends on the look reads from here — walls, lamps, fog,
 * wall text, and whether the DOM chrome needs dark ink. Add a mood by adding
 * an entry; nothing else needs to change.
 */

export type Mood = 'concrete' | 'noir' | 'gallery';

export type MoodSpec = {
  label: string;
  /** Wall surface: board-marked concrete, or smooth plaster. */
  walls: 'boards' | 'smooth';
  /** Multiplies the wall texture. */
  wallTint: string;
  ceiling: string;
  /**
   * A floor of its own, laid over the building's dark reflective one. Pale
   * rooms want a pale floor; dark rooms keep the reflection.
   */
  floor?: string;
  /** Fog and background: what distance dissolves into. */
  fog: string;
  fogNear: number;
  fogFar: number;
  ambient: { color: string; intensity: number };
  hemi: { sky: string; ground: string; intensity: number };
  /** The soft light that travels with you. */
  fill: { color: string; intensity: number };
  /** Stage light colour, its visible beam, and the lit lens (HDR). */
  lamp: string;
  beam: string;
  lens: [number, number, number];
  /** Cove strips and the glow around this room's doorway in the foyer (HDR). */
  cove: [number, number, number];
  portal: [number, number, number];
  /** Wall text and print labels. */
  ink: string;
  inkDim: string;
  /** Pale room: the DOM chrome switches to dark ink. */
  light: boolean;
};

export const MOODS: Record<Mood, MoodSpec> = {
  concrete: {
    label: 'Concrete',
    walls: 'boards',
    wallTint: '#a29a8c',
    ceiling: '#1c1a18',
    fog: '#0c0b0a',
    fogNear: 18,
    fogFar: 70,
    ambient: { color: '#a4acbb', intensity: 0.5 },
    hemi: { sky: '#59606e', ground: '#1a1714', intensity: 0.55 },
    fill: { color: '#ffe9d2', intensity: 5.5 },
    lamp: '#ffe6c4',
    beam: '#ffd9a3',
    lens: [1.6, 1.35, 0.95],
    cove: [1.32, 1.18, 0.94],
    portal: [1.55, 1.24, 0.86],
    ink: '#ebe5d8',
    inkDim: '#a8a196',
    light: false,
  },
  noir: {
    label: 'Noir',
    walls: 'smooth',
    wallTint: '#3d3e43',
    ceiling: '#0c0c0e',
    fog: '#060708',
    fogNear: 14,
    fogFar: 58,
    ambient: { color: '#9aa6bf', intensity: 0.34 },
    hemi: { sky: '#4a5366', ground: '#0e0f12', intensity: 0.42 },
    fill: { color: '#dfe7ff', intensity: 3.6 },
    lamp: '#eef3ff',
    beam: '#dce6ff',
    lens: [1.28, 1.4, 1.66],
    cove: [1.1, 1.18, 1.36],
    portal: [1.2, 1.34, 1.66],
    ink: '#e9ecf2',
    inkDim: '#98a0ad',
    light: false,
  },
  gallery: {
    label: 'Gallery',
    walls: 'smooth',
    wallTint: '#f2eee5',
    ceiling: '#ebe7df',
    floor: '#aaa398',
    fog: '#d9d4ca',
    fogNear: 20,
    fogFar: 82,
    ambient: { color: '#f4f1ea', intensity: 1.3 },
    hemi: { sky: '#fbf7ee', ground: '#8d8375', intensity: 1.15 },
    fill: { color: '#fff6e8', intensity: 13 },
    lamp: '#fff4e4',
    beam: '#fff1dc',
    lens: [1.7, 1.62, 1.45],
    cove: [1.28, 1.24, 1.14],
    portal: [1.78, 1.72, 1.6],
    ink: '#221f1b',
    inkDim: '#6b665e',
    light: true,
  },
};

/** The foyer is always concrete: a dark hall the rooms open off. */
export const FOYER_MOOD: Mood = 'concrete';

/** Default looks for wings that do not name one, in order. */
export const MOOD_CYCLE: Mood[] = ['concrete', 'noir', 'gallery'];

export function isMood(v: unknown): v is Mood {
  return typeof v === 'string' && v in MOODS;
}
