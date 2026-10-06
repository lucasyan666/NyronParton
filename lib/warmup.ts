/**
 * Warm-up progress, outside React.
 *
 * The site does all of its expensive first-time work — building the rooms,
 * compiling every shader, uploading the photographs to the GPU — behind the
 * loading screen, so none of it can land as a stall once you are walking.
 * Each stage reports 0..1 here; the loading screen reads the weighted total
 * and lifts when the scene marks itself warm.
 */

export type Stage = 'scene' | 'walls' | 'shaders' | 'photos';

const WEIGHTS: Record<Stage, number> = { scene: 0.15, walls: 0.2, shaders: 0.3, photos: 0.35 };
const stages: Record<Stage, number> = { scene: 0, walls: 0, shaders: 0, photos: 0 };
let warm = false;

type Listener = (progress: number, warm: boolean) => void;
const listeners = new Set<Listener>();

function total() {
  return (Object.keys(WEIGHTS) as Stage[]).reduce((a, k) => a + WEIGHTS[k] * stages[k], 0);
}

function emit() {
  const p = warm ? 1 : total();
  listeners.forEach((fn) => fn(p, warm));
}

export function reportStage(stage: Stage, value: number) {
  const v = Math.max(stages[stage], Math.min(1, value));
  if (v === stages[stage]) return;
  stages[stage] = v;
  emit();
}

export function markWarm() {
  if (warm) return;
  warm = true;
  emit();
}

export function isWarm() {
  return warm;
}

/**
 * True for the frames of the pre-draw (see Scene): everything in the building
 * is being drawn once, and frame loops must leave visibility alone.
 */
let predrawing = false;
export function setPredrawing(v: boolean) {
  predrawing = v;
}
export function isPredrawing() {
  return predrawing;
}

export function subscribeWarmup(fn: Listener) {
  listeners.add(fn);
  fn(warm ? 1 : total(), warm);
  return () => {
    listeners.delete(fn);
  };
}
