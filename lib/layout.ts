import { WINGS, type Photo, type Room, type Vec3, type Wing } from '@/data/exhibition';
import type { Mood } from './moods';

/**
 * The building: a foyer, and one wing per style of photograph opening off it.
 *
 * The foyer is a tall hall with a door per wing along its far wall. Each wing
 * is a WALK — a path made of straight segments in their own local frames
 * (forward = −z) — that starts at the foyer entrance, crosses the foyer to its
 * own door, and then runs through the wing's rooms, turning left and right so
 * you never scroll into a wall. Only one wing is walked at a time; choosing a
 * door is what decides which.
 *
 * Every wing's walk shares the foyer spine up to the point where off-centre
 * doors peel away, so switching wings in the foyer is continuous, and the
 * works of every wing can be measured by path distance from there.
 */

export type Turn = 'left' | 'right';

export type Placement = {
  photo: Photo;
  room: Room;
  /** Index of the wing this work hangs in. */
  wing: number;
  /** Index of its room within the wing. */
  roomIndex: number;
  /** World position. */
  position: Vec3;
  /** World Y rotation: the direction the print faces. */
  rotationY: number;
  height: number;
  /** Distance along its wing's walk at which this work is best viewed. */
  focusS: number;
};

export type Segment = {
  /** 'foyer' segments are path only: the foyer draws its own hall. */
  kind: 'foyer' | 'room';
  room: Room | null;
  wing: number;
  /** Index within its walk's segment list. */
  index: number;
  /** Index of the room within its wing; −1 for foyer segments. */
  roomIndex: number;
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
  /** Corner rounding at this segment's far end; short segments round tighter. */
  radiusOut: number;
  /**
   * Wall carrying the room's title and statement: −1 left, 1 right, 0 none.
   * First rooms have none — their door in the foyer is their introduction.
   */
  textSide: -1 | 0 | 1;
};

/** A path the camera can walk, and how far along it the scroll may go. */
export type Walk = {
  segments: Segment[];
  length: number;
};

export type WingLayout = Walk & {
  wing: Wing;
  index: number;
  mood: Mood;
  placements: Placement[];
  /** Placements in walking order. */
  order: Placement[];
  /** Room segments only. */
  rooms: Segment[];
  /** Path distance at the foyer door. */
  doorS: number;
  /** The door's x on the foyer's far wall. */
  doorX: number;
  /**
   * True when this wing's later rooms would intersect another wing's first
   * room. Both are never drawn at once in that case: see Architecture.
   */
  crosses: boolean;
};

/* -------------------------------------------------------------- constants */

export const EYE_HEIGHT = 1.62;
const EYE = EYE_HEIGHT;
/** Room ceiling. */
export const CEILING = 3.9;
/** The foyer is taller than the rooms it opens into. */
export const FOYER_HEIGHT = 5.4;
/** Wall faces sit this far outside a room's half-width. */
export const OFF = 0.3;
export const DOOR_W = 2.4;
export const DOOR_H = 3.0;
/** Solid wall left between neighbouring wings' outer faces. */
const DOOR_GAP = 0.8;
const DEFAULT_SCALE = 1.7;
/** Frame moulding and mount add this much to each side of a print. */
const MOUNT_MARGIN = 0.1;
/** How generously the camera path rounds a corner. */
export const CORNER_RADIUS = 1.8;
/** Where the foyer walk stops when no room has been chosen yet. */
export const DECISION_S = 3;
/** Depth at which off-centre doors' paths peel away from the spine. */
const TURN_S = 5.5;
/** The foyer's back wall, behind the visitor at the top of the page. */
export const FOYER_BACK = 7;
/** How far past a door the walk-in stops, and where a teleport arrives. */
export const ENTRY_INSIDE = 2.4;
export const ARRIVE_BEFORE = 3.4;
/** The end panel rises over this last stretch of a wing. */
export const END_S = 3.5;
/**
 * The walk stops this far short of a wing's exit door: close enough to read
 * it and see the light beyond, not so close that the light fills the screen.
 */
export const END_STOP = 5;

/* ---------------------------------------------------------------- frames */

/** three.js rotation.y convention: local (x, z) → world. */
export function toWorld(seg: Pick<Segment, 'origin' | 'heading'>, x: number, z: number): [number, number] {
  const c = Math.cos(seg.heading);
  const s = Math.sin(seg.heading);
  return [seg.origin[0] + x * c + z * s, seg.origin[1] - x * s + z * c];
}

function opposite(t: Turn): Turn {
  return t === 'left' ? 'right' : 'left';
}

/* ------------------------------------------------------------- per-room */

type Local = { photo: Photo; x: number; y: number; z: number; rotY: number; height: number; along: number };

type RoomContext = {
  /** Half-width of this room. */
  width: number;
  turnIn: Turn | null;
  prevHalf: number;
  turnOut: Turn | null;
  nextHalf: number;
  isLast: boolean;
  textSide: -1 | 0 | 1;
};

/** Is `side` the inner wall of a turn? Inner walls stop short at corners. */
const innerOf = (turn: Turn | null, side: -1 | 1) => turn === (side === -1 ? 'left' : 'right');

function layoutRoom(room: Room, ctx: RoomContext): { items: Local[]; length: number } {
  const { width, nextHalf, isLast, textSide } = ctx;
  const items: Local[] = [];
  // A salon hangs on the wall you face before a turn. The last room of a wing
  // has no turn — it ends at a door — so it is hung as a corridor instead.
  const layout = room.layout === 'salon' && isLast ? 'corridor' : room.layout;

  if (layout === 'custom') {
    let deepest = 0;
    for (const photo of room.photos) {
      if (!photo.at) continue;
      const [ax, y, z] = photo.at.position;
      const facing = Math.abs(photo.at.rotationY) < 0.01;
      // A work placed at the room's half-width is on a side wall: hang it on
      // the wall's face, which sits OFF further out.
      const x = !facing && Math.abs(ax) >= width - 0.05 ? Math.sign(ax) * (width + OFF) : ax;
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

  if (layout === 'salon') {
    /*
     * Feature wall: the wall you face as you approach the corner, which is
     * the next room's outer wall. Works are packed by their real widths,
     * one or two rows, centred; the whole hang is scaled down if it would
     * not fit the wall.
     */
    const length = 9;
    const wallZ = -(length + nextHalf + OFF);
    const usable = width * 2 - 0.7;
    const gap = 0.34;
    const n = room.photos.length;
    const rows = n > 3 ? 2 : 1;
    const perRow = Math.ceil(n / rows);
    const rowsOf: Photo[][] = [];
    for (let r = 0; r < rows; r++) rowsOf.push(room.photos.slice(r * perRow, (r + 1) * perRow));

    // Uniform heights per row: a mixed hang on one wall overlaps otherwise.
    const rowHeight = (r: number) => (rows === 2 ? (r === 0 ? 1.32 : 1.08) : 1.55);
    let scale = 1;
    rowsOf.forEach((row, r) => {
      const w = row.reduce((a, p) => a + rowHeight(r) * p.aspect, 0) + gap * (row.length - 1);
      if (w > usable) scale = Math.min(scale, usable / w);
    });
    const centres = rows === 2 ? [EYE + 1.0, EYE - 0.56] : [EYE + 0.12];

    rowsOf.forEach((row, r) => {
      const widths = row.map((p) => rowHeight(r) * p.aspect * scale);
      const total = widths.reduce((a, b) => a + b, 0) + gap * (row.length - 1);
      let x = -total / 2;
      row.forEach((photo, i) => {
        items.push({
          photo, x: x + widths[i] / 2, y: centres[r], z: wallZ, rotY: 0,
          height: rowHeight(r) * scale,
          along: length - 2.4,
        });
        x += widths[i] + gap;
      });
    });
    return { items, length };
  }

  /*
   * Corridor: prints alternate walls, close enough that one is always near.
   *
   * Positions follow a steady rhythm, but every print is checked against the
   * wall it hangs on, using its real width: it must start past the point
   * where its wall begins (after a turn, the inner wall begins beyond the
   * corner), stay clear of the room's title, keep a gap from its neighbour,
   * and end before its wall does. A print that would overhang is pushed
   * along, and everything after it moves with it. Without this a wide
   * landscape print could hang half off the end of its wall, into the
   * corner, and be seen from behind from the room before.
   */
  const spacing = room.spacing ?? 4.4;
  const firstSide: -1 | 1 = textSide === 0 ? -1 : (-textSide as -1 | 1);
  const start = textSide === 0 ? 3 : 3.6;
  const MARGIN = 0.45;
  const GAP = 0.6;

  /** Distance into the room at which a print on `side` may begin. */
  const minNear = (side: -1 | 1) => {
    if (!ctx.turnIn) return 0.8; // first room: the foyer wall is at 0
    if (innerOf(ctx.turnIn, side)) return ctx.prevHalf + OFF + MARGIN;
    return side === textSide ? 1.0 + MARGIN : 0.8; // clear the title
  };
  /** Clearance needed between a print's far edge and the room's end. */
  const endClear = (side: -1 | 1) =>
    ctx.turnOut && innerOf(ctx.turnOut, side) ? nextHalf + OFF + MARGIN : 1.6;

  const lastFar: Record<number, number> = { [-1]: -Infinity, [1]: -Infinity };
  let push = 0;
  let needLength = 0;
  let lastRhythm = start;
  room.photos.forEach((photo, i) => {
    const side: -1 | 1 = i % 2 === 0 ? firstSide : (-firstSide as -1 | 1);
    const height = photo.scale ?? DEFAULT_SCALE;
    const half = (height * photo.aspect) / 2 + MOUNT_MARGIN;
    const rhythm = start + push + Math.floor(i / 2) * spacing + (i % 2) * (spacing / 2);
    const along = Math.max(rhythm, minNear(side) + half, lastFar[side] + GAP + half);
    push += along - rhythm;
    lastRhythm = along;
    lastFar[side] = along + half;
    needLength = Math.max(needLength, along + half + endClear(side));
    items.push({
      photo, x: side * (width + OFF), y: EYE + 0.05, z: -along,
      rotY: side === -1 ? Math.PI / 2 : -Math.PI / 2,
      height,
      along,
    });
  });
  const rhythmLength = start + push + Math.ceil(room.photos.length / 2) * spacing + 2;
  const length = Math.max(rhythmLength, needLength, lastRhythm + 3);
  return { items, length };
}

/* ------------------------------------------------------------------ foyer */

/**
 * Room half-widths. A salon that ends its wing is hung as a corridor (see
 * layoutRoom), so it also takes a corridor's width — a 9 m-wide corridor
 * would also push every foyer door apart.
 */
const halvesOf = (w: Wing) =>
  w.rooms.map((r, i) => {
    const h = r.width ?? 2.2;
    return r.layout === 'salon' && i === w.rooms.length - 1 ? Math.min(h, 2.4) : h;
  });

/**
 * Door positions along the far wall, packed by each wing's first-room width
 * so neighbouring rooms never overlap, then centred on the spine.
 */
function doorPositions(firstHalves: number[]): number[] {
  const outer = firstHalves.map((h) => h + OFF);
  const xs: number[] = [];
  let x = 0;
  outer.forEach((o, i) => {
    if (i > 0) x += outer[i - 1] + DOOR_GAP + o;
    xs.push(x);
  });
  const mid = (xs[0] - outer[0] + xs[xs.length - 1] + outer[outer.length - 1]) / 2;
  return xs.map((v) => {
    const c = v - mid;
    return Math.abs(c) < 0.05 ? 0 : c;
  });
}

const FIRST_HALVES = WINGS.map((w) => halvesOf(w)[0] ?? 2.2);
const DOOR_X = WINGS.length ? doorPositions(FIRST_HALVES) : [];
const MAX_ABS_X = DOOR_X.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
const MAX_OUTER = FIRST_HALVES.reduce((m, h) => Math.max(m, h + OFF), 2.5);

export const FOYER = {
  /** Far wall at z = −depth. Deep enough that every door is in view from the decision point. */
  depth: DECISION_S + Math.max(9, 1.25 * MAX_ABS_X + 1),
  halfWidth: Math.max(6.5, MAX_ABS_X + MAX_OUTER + 1.6),
  back: FOYER_BACK,
  height: FOYER_HEIGHT,
  doors: DOOR_X.map((x, wing) => ({ wing, x })),
};

/* ------------------------------------------------------------------ build */

type Box = { minX: number; maxX: number; minZ: number; maxZ: number };

function boxOf(seg: Segment, beyondEnd: number): Box {
  const hw = seg.halfWidth + OFF;
  const zBack = seg.turnIn ? seg.prevHalf + OFF : 0;
  const zFront = -(seg.length + (seg.turnOut ? seg.nextHalf + OFF : beyondEnd));
  const pts = [[-hw, zBack], [hw, zBack], [-hw, zFront], [hw, zFront]].map(([x, z]) => toWorld(seg, x, z));
  return {
    minX: Math.min(...pts.map((p) => p[0])), maxX: Math.max(...pts.map((p) => p[0])),
    minZ: Math.min(...pts.map((p) => p[1])), maxZ: Math.max(...pts.map((p) => p[1])),
  };
}

function overlaps(a: Box, b: Box, eps = 0.05) {
  return a.minX < b.maxX - eps && a.maxX > b.minX + eps && a.minZ < b.maxZ - eps && a.maxZ > b.minZ + eps;
}

function foyerSeg(wing: number, index: number, origin: [number, number], heading: number, length: number, s0: number, turnIn: Turn | null, turnOut: Turn | null): Segment {
  return { kind: 'foyer', room: null, wing, index, roomIndex: -1, origin, heading, length, halfWidth: 0, s0, turnIn, turnOut, prevHalf: 0, nextHalf: 0, radiusOut: 0, textSide: 0 };
}

function buildWing(wing: Wing, w: number, doorX: number, startTurn: Turn): WingLayout {
  const segments: Segment[] = [];
  const placements: Placement[] = [];
  const D = FOYER.depth;
  let s0 = 0;

  const addFoyer = (origin: [number, number], heading: number, length: number, turnOut: Turn | null) => {
    const turnIn = segments.length ? segments[segments.length - 1].turnOut : null;
    segments.push(foyerSeg(w, segments.length, origin, heading, length, s0, turnIn, turnOut));
    s0 += length;
  };

  // Across the foyer: straight to a centre door, or an S-bend to one either side.
  if (doorX === 0) {
    addFoyer([0, 0], 0, D, null);
  } else {
    const toward: Turn = doorX < 0 ? 'left' : 'right';
    addFoyer([0, 0], 0, TURN_S, toward);
    addFoyer([0, -TURN_S], doorX < 0 ? Math.PI / 2 : -Math.PI / 2, Math.abs(doorX), opposite(toward));
    addFoyer([doorX, -TURN_S], 0, D - TURN_S, null);
  }
  const doorS = s0;

  // Through the door and into the rooms.
  const halves = halvesOf(wing);
  const n = wing.rooms.length;
  let origin: [number, number] = [doorX, -D];
  let heading = 0;

  wing.rooms.forEach((room, r) => {
    const isLast = r === n - 1;
    const turnOut: Turn | null = isLast ? null : r % 2 === 0 ? startTurn : opposite(startTurn);
    const turnIn: Turn | null = r === 0 ? null : segments[segments.length - 1].turnOut;
    const nextHalf = isLast ? 0 : halves[r + 1];
    const prevHalf = r === 0 ? 0 : halves[r - 1];
    // Title on the outer wall of the turn you came round: the wall you see first.
    const textSide: -1 | 0 | 1 = r === 0 ? 0 : turnIn === 'left' ? 1 : -1;
    const { items, length } = layoutRoom(room, {
      width: halves[r], turnIn, prevHalf, turnOut, nextHalf, isLast, textSide,
    });

    const seg: Segment = {
      kind: 'room', room, wing: w, index: segments.length, roomIndex: r,
      origin, heading, length, halfWidth: halves[r], s0, turnIn, turnOut, prevHalf, nextHalf, radiusOut: 0, textSide,
    };
    segments.push(seg);

    for (const it of items) {
      const [wx, wz] = toWorld(seg, it.x, it.z);
      placements.push({
        photo: it.photo, room, wing: w, roomIndex: r,
        position: [wx, it.y, wz],
        rotationY: heading + it.rotY,
        height: it.height,
        focusS: s0 + it.along,
      });
    }

    origin = toWorld(seg, 0, -length);
    if (turnOut) heading += turnOut === 'left' ? Math.PI / 2 : -Math.PI / 2;
    s0 += length;
  });

  // Corners round as generously as both neighbouring segments allow.
  segments.forEach((seg, i) => {
    if (!seg.turnOut) return;
    const next = segments[i + 1];
    seg.radiusOut = Math.min(CORNER_RADIUS, 0.45 * seg.length, 0.45 * next.length);
  });

  const order = [...placements].sort((a, b) => a.focusS - b.focusS);
  return {
    wing, index: w, mood: wing.mood ?? 'concrete',
    segments, length: Math.max(doorS + 3, s0 - END_STOP), placements, order,
    rooms: segments.filter((s) => s.kind === 'room'),
    doorS, doorX, crosses: false,
  };
}

/** Light plane beyond a wing's last door. */
const BEYOND_END = 1.8;

function build() {
  const layouts: WingLayout[] = [];
  const firstBoxes: Box[] = [];

  // First rooms do not depend on turn direction (the corner square is the
  // same width either way), so they can be measured before choosing turns.
  WINGS.forEach((wing, w) => {
    const probe = buildWing(wing, w, DOOR_X[w], 'left');
    firstBoxes.push(boxOf(probe.rooms[0], BEYOND_END));
  });

  WINGS.forEach((wing, w) => {
    const x = DOOR_X[w];
    // Turn away from the middle first, so wings fan apart; the centre wing
    // tries left, then right.
    const prefs: Turn[] = x > 0 ? ['right', 'left'] : ['left', 'right'];
    let chosen: WingLayout | null = null;
    for (const t of prefs) {
      const candidate = buildWing(wing, w, x, t);
      const clash = candidate.rooms.slice(1).some((seg) => {
        const b = boxOf(seg, BEYOND_END);
        return firstBoxes.some((fb, j) => j !== w && overlaps(b, fb));
      });
      if (!clash) { chosen = candidate; break; }
      if (!chosen) { chosen = candidate; chosen.crosses = true; }
    }
    layouts.push(chosen!);
  });

  // Bounding box of the whole building, for the floor.
  let minX = -FOYER.halfWidth, maxX = FOYER.halfWidth, minZ = -FOYER.depth, maxZ = FOYER.back;
  for (const wl of layouts) {
    for (const seg of wl.rooms) {
      const b = boxOf(seg, BEYOND_END);
      minX = Math.min(minX, b.minX); maxX = Math.max(maxX, b.maxX);
      minZ = Math.min(minZ, b.minZ); maxZ = Math.max(maxZ, b.maxZ);
    }
  }

  return { layouts, bounds: { minX, maxX, minZ, maxZ } };
}

export const { layouts: WING_LAYOUTS, bounds: BOUNDS } = build();

/** Every placement in the building, across all wings. */
export const ALL_PLACEMENTS: Placement[] = WING_LAYOUTS.flatMap((w) => w.placements);

/** The walk before any room is chosen: the foyer spine, up to the decision point. */
export const FOYER_WALK: Walk = {
  segments: [foyerSeg(-1, 0, [0, 0], 0, FOYER.depth, 0, null, null)],
  length: DECISION_S,
};

/** The walk for a wing, or the foyer's when none is chosen. */
export function walkFor(wing: number | null): Walk {
  return wing == null ? FOYER_WALK : WING_LAYOUTS[wing];
}

/** True while the camera is still in the foyer, short of the chosen door. */
export function inFoyerAt(wing: number | null, s: number): boolean {
  return wing == null || s < WING_LAYOUTS[wing].doorS + 0.5;
}

/* ------------------------------------------------------------------- path */

function segmentAt(walk: Walk, s: number): Segment {
  for (const seg of walk.segments) if (s < seg.s0 + seg.length) return seg;
  return walk.segments[walk.segments.length - 1];
}

/** Point on the straight centreline of `seg` at path distance s (extrapolates). */
function straight(seg: Segment, s: number): [number, number] {
  return toWorld(seg, 0, -(s - seg.s0));
}

function bezier(a: [number, number], b: [number, number], c: [number, number], t: number): [number, number] {
  const u = 1 - t;
  return [u * u * a[0] + 2 * u * t * b[0] + t * t * c[0], u * u * a[1] + 2 * u * t * b[1] + t * t * c[1]];
}

/** World x,z on a walk at path distance s, corners rounded. */
export function pathPoint(walk: Walk, s: number): [number, number] {
  const segs = walk.segments;
  const seg = segmentAt(walk, s);
  const end = seg.s0 + seg.length;

  // Corner ahead, within its rounding window
  if (seg.turnOut && seg.radiusOut > 0 && s > end - seg.radiusOut) {
    const R = seg.radiusOut;
    const next = segs[seg.index + 1];
    const t = Math.min(1, (s - (end - R)) / (2 * R));
    return bezier(straight(seg, end - R), straight(seg, end), straight(next, end + R), t);
  }
  // Corner behind
  if (seg.turnIn && seg.index > 0) {
    const prev = segs[seg.index - 1];
    const R = prev.radiusOut;
    if (R > 0 && s < seg.s0 + R) {
      const t = Math.max(0, (s - (seg.s0 - R)) / (2 * R));
      return bezier(straight(prev, seg.s0 - R), straight(prev, seg.s0), straight(seg, seg.s0 + R), t);
    }
  }
  return straight(seg, s);
}

/** Position plus forward and right vectors at s. */
export function pathFrame(walk: Walk, s: number) {
  const [x, z] = pathPoint(walk, s);
  const [ax, az] = pathPoint(walk, s + 0.6);
  const [bx, bz] = pathPoint(walk, s - 0.6);
  let fx = ax - bx, fz = az - bz;
  const l = Math.hypot(fx, fz) || 1;
  fx /= l; fz /= l;
  // right = forward rotated 90° clockwise seen from above
  return { x, z, fx, fz, rx: -fz, rz: fx };
}

/** The room the camera is standing in, or null in the foyer. */
export function roomAt(walk: Walk, s: number): { room: Room; roomIndex: number } | null {
  const seg = segmentAt(walk, Math.max(0, s));
  return seg.kind === 'room' && seg.room ? { room: seg.room, roomIndex: seg.roomIndex } : null;
}

/* ----------------------------------------------------------- scroll map */

/**
 * Scroll is mapped in pixels, not as a fraction of the page: the page grows
 * and shrinks as wings are chosen, and a pixel mapping keeps the camera where
 * it is when that happens.
 */
export const INTRO_PX = 1800;
export const PX_PER_M = 130;
/** How far behind the foyer entrance the camera stands at the top of the page. */
export const INTRO_SETBACK = 6;

export function introProgressForScroll(y: number): number {
  return Math.min(1, Math.max(0, y / INTRO_PX));
}

export function sForScroll(y: number): number {
  if (y <= INTRO_PX) {
    const i = introProgressForScroll(y);
    const eased = i * i * (3 - 2 * i);
    return -INTRO_SETBACK * (1 - eased);
  }
  return (y - INTRO_PX) / PX_PER_M;
}

export function scrollForS(s: number): number {
  return INTRO_PX + s * PX_PER_M;
}

/** Total scrollable length for a walk, in pixels. */
export function scrollLengthFor(walk: Walk): number {
  return Math.round(INTRO_PX + walk.length * PX_PER_M);
}
