'use client';

import * as THREE from 'three';

/**
 * Look around by moving the phone.
 *
 * The orientation sensor reports the phone's attitude in the world. Turned
 * into the attitude of a camera looking out of the back of the phone (the
 * maths of three's old DeviceOrientationControls) and measured against how
 * the phone was held when looking was switched on, it becomes a head turn:
 * turn the phone left and the view turns left; tilt it up and you look up.
 * Rolling the phone is ignored, so the horizon stays level.
 *
 * iOS asks the visitor first, and only in answer to a tap; Android does not
 * ask. Without a sensor, or if it is refused, a finger drag looks around
 * instead (Scene.tsx). Nothing here renders; the scene reads `getMotion()`
 * every frame.
 */

type Listener = (on: boolean) => void;
const listeners = new Set<Listener>();

/** yaw/pitch in radians, relative to the reference pose. `fresh`: a reading has arrived. */
const state = { on: false, fresh: false, yaw: 0, pitch: 0 };
let ref: { yaw: number; pitch: number } | null = null;

const D2R = Math.PI / 180;
const zee = new THREE.Vector3(0, 0, 1);
const euler = new THREE.Euler();
const q = new THREE.Quaternion();
const q0 = new THREE.Quaternion();
/** −90° about X: the camera looks out of the back of the phone, not out of its top. */
const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
const out = new THREE.Euler();

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

function screenAngle() {
  const legacy = (window as unknown as { orientation?: number }).orientation;
  const a = typeof screen !== 'undefined' && screen.orientation ? screen.orientation.angle : legacy ?? 0;
  return (a || 0) * D2R;
}

function onOrient(e: DeviceOrientationEvent) {
  if (e.alpha == null || e.beta == null || e.gamma == null) return;
  euler.set(e.beta * D2R, e.alpha * D2R, -e.gamma * D2R, 'YXZ');
  q.setFromEuler(euler).multiply(q1).multiply(q0.setFromAxisAngle(zee, -screenAngle()));
  // The camera's own yaw and pitch: well defined while it looks roughly level,
  // which is how a phone is held to look into a room.
  out.setFromQuaternion(q, 'YXZ');
  if (!ref) ref = { yaw: out.y, pitch: out.x };
  state.yaw = wrap(out.y - ref.yaw);
  state.pitch = Math.max(-0.65, Math.min(0.65, out.x - ref.pitch));
  state.fresh = true;
}

function set(on: boolean) {
  state.on = on;
  state.fresh = false;
  state.yaw = 0;
  state.pitch = 0;
  listeners.forEach((fn) => fn(on));
}

export function getMotion(): Readonly<typeof state> {
  return state;
}

/** Whatever way the phone faces now becomes straight ahead. */
export function recenterMotion() {
  ref = null;
}

export function subscribeMotion(fn: Listener) {
  listeners.add(fn);
  fn(state.on);
  return () => {
    listeners.delete(fn);
  };
}

export const motionSupported = () => typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;

/** On iOS this must run inside a tap. Resolves whether looking by motion is now on. */
export async function enableMotion(): Promise<boolean> {
  if (state.on) return true;
  if (!motionSupported()) return false;
  const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
  if (typeof DOE.requestPermission === 'function') {
    try {
      if ((await DOE.requestPermission()) !== 'granted') return false;
    } catch {
      return false;
    }
  }
  ref = null;
  window.addEventListener('deviceorientation', onOrient);
  window.addEventListener('orientationchange', recenterMotion);
  set(true);
  return true;
}

export function disableMotion() {
  window.removeEventListener('deviceorientation', onOrient);
  window.removeEventListener('orientationchange', recenterMotion);
  set(false);
}
