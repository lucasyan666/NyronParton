/**
 * Camera Z as mutable shared state, deliberately outside React.
 *
 * Previously the walk loop called setState every 0.6 world units, which
 * re-rendered every Frame, Lighting and Architecture several times a second.
 * Architecture cloned eight GPU textures per room on each of those renders —
 * a continuous stream of texture uploads while scrolling.
 *
 * Components that care about camera position now subscribe and mutate their
 * own objects in useFrame instead. React renders only when the set of visible
 * things actually changes, not when the camera moves.
 */

type Listener = (z: number) => void;

let cameraZ = 0;
const listeners = new Set<Listener>();

export function setCameraZ(z: number) {
  cameraZ = z;
}

export function getCameraZ() {
  return cameraZ;
}

/** Coarse bucket used to decide when visibility genuinely changed. */
export function zBucket(z: number, size = 12) {
  return Math.round(z / size);
}

export function subscribeBucket(fn: Listener) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

let lastBucket = Number.NaN;

/** Called once per frame from the walk loop. Fires only on bucket changes. */
export function publishCameraZ(z: number) {
  cameraZ = z;
  const b = zBucket(z);
  if (b !== lastBucket) {
    lastBucket = b;
    listeners.forEach((fn) => fn(z));
  }
}

/* ------------------------------------------------------------------ region */

/**
 * Whether the camera is in the foyer or inside the chosen wing. Published by
 * the camera rig on change only, so the few things that care (which rooms
 * and works are drawn, the HUD, the fog) re-render exactly once per crossing
 * rather than on every bucket.
 */
type RegionListener = (inFoyer: boolean) => void;

let inFoyer = true;
const regionListeners = new Set<RegionListener>();

export function getInFoyer() {
  return inFoyer;
}

export function publishRegion(v: boolean) {
  if (v === inFoyer) return;
  inFoyer = v;
  regionListeners.forEach((fn) => fn(v));
}

export function subscribeRegion(fn: RegionListener) {
  regionListeners.add(fn);
  return () => {
    regionListeners.delete(fn);
  };
}
