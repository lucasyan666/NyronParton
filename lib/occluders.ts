import * as THREE from 'three';

/**
 * Walls, registered so a click can be checked for line of sight.
 *
 * Three's raycaster tests every object it is given, visible or not, and the
 * event system only raycasts things with handlers — walls have none. So
 * without this a click could reach a photograph through a wall: the next
 * room's print, behind the one you are standing in, would open and fly the
 * camera straight through the concrete.
 */
const occluders = new Set<THREE.Object3D>();
const raycaster = new THREE.Raycaster();
const hits: THREE.Intersection[] = [];

export function registerOccluder(o: THREE.Object3D) {
  occluders.add(o);
  return () => {
    occluders.delete(o);
  };
}

function shown(o: THREE.Object3D | null): boolean {
  for (let p = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

/** True if a drawn wall stands between the ray's origin and `distance` along it. */
export function isOccluded(ray: THREE.Ray, distance: number) {
  raycaster.ray.copy(ray);
  raycaster.near = 0;
  raycaster.far = Math.max(0, distance - 0.08);
  for (const o of occluders) {
    if (!shown(o)) continue;
    hits.length = 0;
    o.raycast(raycaster, hits);
    if (hits.length) return true;
  }
  return false;
}

/**
 * For pointer handlers on things that may be hidden or behind a wall. The
 * hit object itself may be an invisible hit area, so only its ancestors must
 * be drawn; and no drawn wall may stand in front of it.
 */
export function reachable(e: { object: THREE.Object3D; ray: THREE.Ray; distance: number }) {
  if (e.object.parent && !shown(e.object.parent)) return false;
  return !isOccluded(e.ray, e.distance);
}
