import { EXHIBITION, type Photo, type Room, type Vec3 } from '@/data/exhibition';

/**
 * The walk as a path, not a line.
 *
 * Each room is a straight segment in its own local frame (forward = −z).
 * Rooms alternate left and right turns, so the walk snakes through the
 * building and you never scroll into a wall: the camera looks ahead along
 * the path and turns the corner on its own. A salon hangs its works on the
 * wall you approach before turning — a feature wall, faced and then left.
 * The last room ends at an open door.
 */

export type Turn = 'left' | 'right';

export type Placement = {
  photo: Photo;
  room: Room;
  /** World position. */
  position: Vec3;
  /** World Y rotation: the direction the print faces. */
  rotationY: number;
  height: number;
  /** Path distance at which this work is best viewed. */
  focusS: number;
};

export type Segment = {
  room: Room;
  index: number;
  /** World x,z of the centreline start. */
  origin: [number, number];
  heading: number;
  length: number;
  halfWidth: number;
  /** Path distance at the segment start. */
  s0: number;
  turnIn: Turn | null;
  turnOut: Turn | null;
  prevHalf: number;
  nextHalf: number;
};

export const EYE_HEIGHT = 1.62;
const EYE = EYE_HEIGHT;
const DEFAULT_SCALE = 1.7;
/** The first room extends this far behind the entrance, so you start inside. */
export const VESTIBULE = 9;
/** How generously the camera path rounds each corner. */
export const CORNER_RADIUS = 1.8;

/* ---------------------------------------------------------------- frames */

/** three.js rotation.y convention: local (x, z) → world. */
export function toWorld(seg: Segment, x: number, z: number): [number, number] {
  const c = Math.cos(seg.heading);
  const s = Math.sin(seg.heading);
  return [seg.origin[0] + x * c + z * s, seg.origin[1] - x * s + z * c];
}

function localToWorld(seg: Segment, x: number, y: number, z: number): Vec3 {
  const [wx, wz] = toWorld(seg, x, z);
  return [wx, y, wz];
}

/* ------------------------------------------------------------- per-room */

type Local = { photo: Photo; x: number; y: number; z: number; rotY: number; height: number; along: number };

function layoutRoom(room: Room, width: number, nextHalf: number): { items: Local[]; length: number } {
  const items: Local[] = [];

  if (room.layout === 'custom') {
    let deepest = 0;
    for (const photo of room.photos) {
      if (!photo.at) continue;
      const [x, y, z] = photo.at.position;
      const facing = Math.abs(photo.at.rotationY) < 0.01;
      items.push({
        photo, x, y, z,
        rotY: photo.at.rotationY,
        height: photo.scale ?? DEFAULT_SCALE,
        // Face-on works are viewed from a few metres back; side works from beside.
        along: facing ? Math.max(1, -z - 3.2) : -z,
      });
      deepest = Math.min(deepest, z);
    }
    return { items, length: Math.abs(deepest) + 3 };
  }

  if (room.layout === 'salon') {
    /*
     * Feature wall: the wall you face as you approach the corner, which is
     * the next room's outer wall. Works are packed by their real widths,
     * one or two rows, centred; the whole hang is scaled down if it would
     * not fit the wall.
     */
    const length = 9;
    const wallZ = -(length + nextHalf);
    const usable = width * 2 - 0.7;
    const gap = 0.34;
    const n = room.photos.length;
    const rows = n > 3 ? 2 : 1;
    const perRow = Math.ceil(n / rows);
    const rowsOf: Photo[][] = [];
    for (let r = 0; r < rows; r++) rowsOf.push(room.photos.slice(r * perRow, (r + 1) * perRow));

    // Uniform heights per row: a mixed hang on one wall overlaps otherwise.
    const rowHeight = (r: number) => (rows === 2 ? (r === 0 ? 1.32 : 1.08) : 1.55);
    const heightOf = (_p: Photo, r = 0) => rowHeight(r);
    let scale = 1;
    rowsOf.forEach((row, r) => {
      const w = row.reduce((a, p) => a + heightOf(p, r) * p.aspect, 0) + gap * (row.length - 1);
      if (w > usable) scale = Math.min(scale, usable / w);
    });
    const centres = rows === 2 ? [EYE + 1.0, EYE - 0.56] : [EYE + 0.12];

    rowsOf.forEach((row, r) => {
      const widths = row.map((p) => heightOf(p, r) * p.aspect * scale);
      const total = widths.reduce((a, b) => a + b, 0) + gap * (row.length - 1);
      let x = -total / 2;
      row.forEach((photo, i) => {
        items.push({
          photo, x: x + widths[i] / 2, y: centres[r], z: wallZ, rotY: 0,
          height: heightOf(photo, r) * scale,
          along: length - 2.4,
        });
        x += widths[i] + gap;
      });
    });
    return { items, length };
  }

  // corridor: prints alternate walls, close enough that one is always near
  const spacing = room.spacing ?? 4.4;
  room.photos.forEach((photo, i) => {
    const side = i % 2 === 0 ? -1 : 1;
    const z = -(3 + Math.floor(i / 2) * spacing + (side === 1 ? spacing / 2 : 0));
    items.push({
      photo, x: side * width, y: EYE + 0.05, z,
      rotY: side === -1 ? Math.PI / 2 : -Math.PI / 2,
      height: photo.scale ?? DEFAULT_SCALE,
      along: -z,
    });
  });
  const length = 3 + Math.ceil(room.photos.length / 2) * spacing + 2;
  return { items, length };
}

/* ------------------------------------------------------------------ build */

function build() {
  const halves = EXHIBITION.map((r) => r.width ?? 2.2);
  const n = EXHIBITION.length;
  const segments: Segment[] = [];
  const placements: Placement[] = [];

  let origin: [number, number] = [0, 0];
  let heading = 0;
  let s0 = 0;

  EXHIBITION.forEach((room, i) => {
    const turnOut: Turn | null = i < n - 1 ? (i % 2 === 0 ? 'left' : 'right') : null;
    const turnIn: Turn | null = i > 0 ? segments[i - 1].turnOut : null;
    const nextHalf = i < n - 1 ? halves[i + 1] : 0;
    const prevHalf = i > 0 ? halves[i - 1] : 0;
    const { items, length } = layoutRoom(room, halves[i], nextHalf);

    const seg: Segment = {
      room, index: i, origin, heading, length, halfWidth: halves[i], s0, turnIn, turnOut, prevHalf, nextHalf,
    };
    segments.push(seg);

    for (const it of items) {
      placements.push({
        photo: it.photo, room,
        position: localToWorld(seg, it.x, it.y, it.z),
        rotationY: heading + it.rotY,
        height: it.height,
        focusS: s0 + it.along,
      });
    }

    // next origin is this room's far corner
    origin = toWorld(seg, 0, -length);
    if (turnOut) heading += turnOut === 'left' ? Math.PI / 2 : -Math.PI / 2;
    s0 += length;
  });

  // bounding box of everything, for the floor and ceiling planes
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const seg of segments) {
    const back = seg.turnIn ? seg.prevHalf + 1 : VESTIBULE + 1;
    const fwd = seg.length + seg.nextHalf + 3;
    for (const [x, z] of [[-seg.halfWidth - 1, back], [seg.halfWidth + 1, back], [-seg.halfWidth - 1, -fwd], [seg.halfWidth + 1, -fwd]]) {
      const [wx, wz] = toWorld(seg, x, z);
      minX = Math.min(minX, wx); maxX = Math.max(maxX, wx);
      minZ = Math.min(minZ, wz); maxZ = Math.max(maxZ, wz);
    }
  }

  return { segments, placements, length: s0, bounds: { minX, maxX, minZ, maxZ } };
}

export const { segments: SEGMENTS, placements: PLACEMENTS, length: WALK_LENGTH, bounds: BOUNDS } = build();

/** Placements in walking order. */
export const WALK_ORDER: Placement[] = [...PLACEMENTS].sort((a, b) => a.focusS - b.focusS);

/* ------------------------------------------------------------------- path */

function segmentAt(s: number): Segment {
  for (const seg of SEGMENTS) if (s < seg.s0 + seg.length) return seg;
  return SEGMENTS[SEGMENTS.length - 1];
}

/** Point on the straight centreline of `seg` at path distance s (extrapolates). */
function straight(seg: Segment, s: number): [number, number] {
  return toWorld(seg, 0, -(s - seg.s0));
}

/** World x,z on the walk at path distance s, corners rounded. */
export function pathPoint(s: number): [number, number] {
  const seg = segmentAt(s);
  const R = CORNER_RADIUS;
  const end = seg.s0 + seg.length;

  // Corner ahead, within the rounding window
  if (seg.turnOut && s > end - R) {
    const next = SEGMENTS[seg.index + 1];
    const t = Math.min(1, (s - (end - R)) / (2 * R));
    return bezier(straight(seg, end - R), straight(seg, end), straight(next, end + R), t);
  }
  // Corner behind
  if (seg.turnIn && s < seg.s0 + R) {
    const prev = SEGMENTS[seg.index - 1];
    const t = Math.max(0, (s - (seg.s0 - R)) / (2 * R));
    return bezier(straight(prev, seg.s0 - R), straight(prev, seg.s0), straight(seg, seg.s0 + R), t);
  }
  return straight(seg, s);
}

function bezier(a: [number, number], b: [number, number], c: [number, number], t: number): [number, number] {
  const u = 1 - t;
  return [u * u * a[0] + 2 * u * t * b[0] + t * t * c[0], u * u * a[1] + 2 * u * t * b[1] + t * t * c[1]];
}

/** Position plus forward and right vectors at s. */
export function pathFrame(s: number) {
  const [x, z] = pathPoint(s);
  const [ax, az] = pathPoint(s + 0.6);
  const [bx, bz] = pathPoint(s - 0.6);
  let fx = ax - bx, fz = az - bz;
  const l = Math.hypot(fx, fz) || 1;
  fx /= l; fz /= l;
  // right = forward rotated 90° clockwise seen from above
  return { x, z, fx, fz, rx: -fz, rz: fx };
}

export function roomAtS(s: number): Room | null {
  if (s < -VESTIBULE) return null;
  return segmentAt(Math.max(0, s)).room;
}

/* ----------------------------------------------------------- scroll map */

/** Fraction of the page given to the intro before the walk begins. */
export const INTRO_FRACTION = 0.16;
/** How far behind the entrance the camera stands at the top of the page. */
export const INTRO_SETBACK = 6;

export function introProgress(t: number): number {
  return Math.min(1, t / INTRO_FRACTION);
}

export function walkProgress(t: number): number {
  if (t <= INTRO_FRACTION) return 0;
  return (t - INTRO_FRACTION) / (1 - INTRO_FRACTION);
}

/** Scroll progress 0..1 → path distance. */
export function sAtProgress(t: number): number {
  if (t <= INTRO_FRACTION) {
    const i = introProgress(t);
    const eased = i * i * (3 - 2 * i);
    return -INTRO_SETBACK * (1 - eased);
  }
  return walkProgress(t) * WALK_LENGTH;
}

/** Inverse of sAtProgress for the walk phase. */
export function progressForS(s: number): number {
  return INTRO_FRACTION + Math.max(0, Math.min(1, s / WALK_LENGTH)) * (1 - INTRO_FRACTION);
}
