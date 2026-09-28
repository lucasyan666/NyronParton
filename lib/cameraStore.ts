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
