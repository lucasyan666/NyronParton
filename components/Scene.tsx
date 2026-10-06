'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  ALL_PLACEMENTS,
  DECISION_S,
  EYE_HEIGHT,
  FOYER,
  WING_LAYOUTS,
  inFoyerAt,
  pathFrame,
  pathPoint,
  walkFor,
  type Placement,
} from '@/lib/layout';
import { FOYER_MOOD, MOODS, type MoodSpec } from '@/lib/moods';
import {
  getCameraZ,
  getInFoyer,
  getSheetShare,
  publishCameraZ,
  publishRegion,
  setActiveWing,
  subscribeRegion,
} from '@/lib/cameraStore';
import { pumpUploads, setMaxAnisotropy, warmSet } from '@/lib/useProximityTexture';
import { isWarm, markWarm, reportStage, setPredrawing } from '@/lib/warmup';
import { Frame } from './Frame';
import { Architecture } from './Architecture';
import { Lighting } from './Lighting';
import { FocusEffects } from './FocusEffects';
import { Caption } from './Caption';
import { Stats } from './Stats';
import { LITE, TOUCH } from '@/lib/device';
import { getMotion, recenterMotion } from '@/lib/motion';

type Props = {
  /** Where the scroll says the camera should be, as path distance. */
  targetS: React.MutableRefObject<number>;
  /** Bumped to make the camera jump to targetS instead of gliding there. */
  teleport: React.MutableRefObject<number>;
  /** The chosen wing, or null while still choosing in the foyer. */
  active: number | null;
  selectedId: string | null;
  onSelect: React.Dispatch<React.SetStateAction<string | null>>;
  onCameraZ: (s: number) => void;
  onEnterWing: (wing: number) => void;
  onNextWing: () => void;
  onFoyer: () => void;
  /** Fired once everything is built, compiled and uploaded. */
  onWarm?: () => void;
  /** The room that scrolling on from the foyer leads into (touch screens look toward its door). */
  suggested?: number | null;
  /** Perf line, twice a second, when ?stats is in the URL. */
  onStats?: (line: string) => void;
};

/** How far back from a photo the camera settles when focused. */
const VIEW_DISTANCE = 2.2;
/** Upload budget per frame: generous behind the loading screen, small after. */
const UPLOAD_MS_WARMING = 40;
const UPLOAD_MS_WALKING = 4;
/**
 * Limits on the loading screen, in seconds of drawn frames — so a tab opened
 * in the background, where nothing draws, does not use them up. Past the
 * first, stop waiting for photographs (the rest stream in); past the second,
 * lift the screen whatever is still outstanding.
 */
const PHOTO_TIMEOUT_S = 7;
const WARM_CAP_S = 12;

const UP = new THREE.Vector3(0, 1, 0);
/** Damp an angle along the short way round. */
const dampAngle = (from: number, to: number, rate: number, dt: number) =>
  from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * (1 - Math.exp(-rate * dt));

const smooth01 = (t: number) => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
};

const _eye = new THREE.Vector3();
const _look = new THREE.Vector3();

/** Vertical field of view: wider on a portrait screen, which is otherwise a slit. */
const fovFor = (aspect: number) => (aspect >= 1 ? 64 : Math.min(84, 64 + (1 - aspect) * 40));

/**
 * Where the camera should stand to face a given photo square-on: back off
 * along the frame's own normal, and rise to the frame's centre height.
 * Reuses module-level vectors — this runs every frame while focusing.
 *
 * On a portrait screen the caption is a sheet across the bottom, so the print
 * must fit the space above it, in both directions (a landscape print on a
 * phone is usually limited by width). The distance is capped by the room:
 * stepping back through the opposite wall would show the building's outside.
 */
function viewpointFor(p: Placement, portrait: boolean, fov: number, aspect: number) {
  const [x, y, z] = p.position;
  const nx = Math.sin(p.rotationY);
  const nz = Math.cos(p.rotationY);
  let dist = VIEW_DISTANCE + p.height * 0.6;
  if (portrait) {
    const t = Math.tan(THREE.MathUtils.degToRad(fov) / 2);
    const above = 1 - getSheetShare();
    const w = p.height * p.photo.aspect + 0.3;
    const h = p.height + 0.3;
    const fit = Math.max(h / 2 / (above * t * 0.92), w / 2 / (t * aspect * 0.92), 1.2);
    const seg = WING_LAYOUTS[p.wing]?.rooms[p.roomIndex];
    dist = Math.min(fit, seg ? seg.halfWidth * 2 - 0.35 : fit);
  }
  _eye.set(x + nx * dist, y, z + nz * dist);
  _look.set(x, y, z);
  return { eye: _eye, look: _look };
}

/**
 * Lens shift, for a portrait screen while a work is held: the print rides up
 * into the space above the caption sheet. A shifted lens, not a tilted
 * camera, so the print's edges stay square and the eye stays at a person's
 * height. `shift` is in pixels; the field of view is widened to match, so
 * the visible area stays the same size and only moves.
 */
function setLensShift(cam: THREE.PerspectiveCamera, w: number, h: number, fov: number, shift: number) {
  if (shift < 0.5) {
    if (cam.view?.enabled) cam.clearViewOffset();
    if (cam.fov !== fov || Math.abs(cam.aspect - w / h) > 1e-6) {
      cam.fov = fov;
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    }
    return;
  }
  const full = h + 2 * shift;
  const t = Math.tan(THREE.MathUtils.degToRad(fov) / 2);
  cam.fov = THREE.MathUtils.radToDeg(2 * Math.atan((t * full) / h));
  cam.aspect = w / full;
  cam.setViewOffset(w, full, 0, 2 * shift, w, h);
}

/**
 * Compile every shader the building will ever need, without blocking.
 *
 * three.js compiles only what is visible, and most of the building is hidden
 * at any moment (other wings, later rooms, the lamps' beams). So for the
 * length of one synchronous call everything is made visible, the compile is
 * started — with KHR_parallel_shader_compile the driver then works in the
 * background — and visibility is put back exactly as it was before anything
 * is drawn.
 */
function compileEverything(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
  const hidden: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if (!o.visible) {
      hidden.push(o);
      o.visible = true;
    }
  });
  let done: Promise<unknown>;
  try {
    done = gl.compileAsync(scene, camera);
  } finally {
    hidden.forEach((o) => { o.visible = false; });
  }
  return done;
}

function Rig({ targetS, teleport, active, selectedId, onSelect, onCameraZ, onEnterWing, onNextWing, onFoyer, onWarm, onStats, suggested }: Props) {
  const { camera, pointer, gl, scene } = useThree();
  // Portrait: the caption becomes a sheet (Exhibition) and the camera adapts.
  const portrait = useThree((s) => s.size.height > s.size.width);
  const walk = walkFor(active);
  const wing = active == null ? null : WING_LAYOUTS[active];
  // Plain value for everything that decides visibility in its own frame loop.
  setActiveWing(active);

  useEffect(() => {
    setMaxAnisotropy(gl.capabilities.getMaxAnisotropy());
    reportStage('scene', 1);
  }, [gl]);

  /* ------------------------------------------------------------ warm-up */

  const photosDone = useRef<() => number>(() => 0);
  const shadersDone = useRef(false);
  /** Pre-draw frames still to go; -1 before it starts, 0 once it is done. */
  const predraw = useRef(-1);
  const forced = useRef<{ hidden: Set<THREE.Object3D>; culled: THREE.Object3D[] } | null>(null);
  const warmFrames = useRef(-1);
  /** Seconds of frames drawn while warming. */
  const warmClock = useRef(0);

  // Thumbnails for every work in the show, and the full prints you meet
  // first in each room, all on the GPU before the loading screen lifts.
  useEffect(() => {
    const firsts = new Set(WING_LAYOUTS.flatMap((w) => w.order.slice(0, 2).map((p) => p.photo.src)));
    const all = [...firsts, ...ALL_PLACEMENTS.map((p) => p.photo.src).filter((s) => !firsts.has(s))];
    photosDone.current = warmSet(all, firsts.size);
  }, []);

  const onBuilt = useCallback(() => {
    const done = () => {
      shadersDone.current = true;
      reportStage('shaders', 0.85);
    };
    void compileEverything(gl, scene, camera).then(done, done);
    reportStage('shaders', 0.5);
  }, [gl, scene, camera]);

  /*
   * The pre-draw: the last step behind the loading screen.
   *
   * A compiled shader is not the whole first-use cost. The GPU driver builds
   * a pipeline the first time each shader is drawn with a given blending and
   * render target, and geometry goes up on its first draw. Left alone, that
   * lands the first time you meet each thing — a lamp's beam, a hover glow,
   * a room around a corner — as a stall. So for two frames, every object in
   * the building is shown with culling off and drawn through the real
   * pipeline (floor reflection, scene, post), then put back as it was.
   *
   * Three hooks around the render: before every frame loop (show all), just
   * before post renders (show again whatever a loop hid since), and after
   * (restore).
   */
  useFrame(() => {
    if (predraw.current <= 0) return;
    const f = { hidden: new Set<THREE.Object3D>(), culled: [] as THREE.Object3D[] };
    scene.traverse((o) => {
      if (!o.visible) { f.hidden.add(o); o.visible = true; }
      if (o.frustumCulled) { f.culled.push(o); o.frustumCulled = false; }
    });
    forced.current = f;
    setPredrawing(true);
  }, -100);
  useFrame(() => {
    const f = forced.current;
    if (!f) return;
    scene.traverse((o) => { if (!o.visible) { f.hidden.add(o); o.visible = true; } });
  }, 0.5);
  useFrame(() => {
    const f = forced.current;
    if (!f) return;
    f.hidden.forEach((o) => { o.visible = false; });
    f.culled.forEach((o) => { o.frustumCulled = true; });
    forced.current = null;
    setPredrawing(false);
    if (--predraw.current === 0) reportStage('shaders', 1);
  }, 1.5);

  /* ------------------------------------------------------------- camera */

  /*
   * Looking around on a phone: the head's own turn on top of the walk —
   * from the phone's motion sensor, plus a finger drag (which eases back to
   * centre when you let go). Applied after the walk's look, so it answers at
   * once instead of through the walk's slow damping.
   */
  const head = useRef({ yaw: 0, pitch: 0 });
  /** How strongly the head is turned toward the nearest work (eased, see the frame loop). */
  const guideW = useRef(0);
  const drag = useRef({ yaw: 0, pitch: 0, held: false });
  useEffect(() => {
    if (!TOUCH) return;
    const el = gl.domElement;
    let id = -1;
    let x0 = 0;
    let y0 = 0;
    let yaw0 = 0;
    let pitch0 = 0;
    const down = (e: PointerEvent) => {
      if (id !== -1) return;
      id = e.pointerId;
      x0 = e.clientX;
      y0 = e.clientY;
      yaw0 = drag.current.yaw;
      pitch0 = drag.current.pitch;
      drag.current.held = true;
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      // Drag the room: pull it right and you turn left.
      drag.current.yaw = yaw0 + (e.clientX - x0) * 0.0065;
      drag.current.pitch = Math.max(-0.6, Math.min(0.6, pitch0 + (e.clientY - y0) * 0.0045));
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = -1;
      drag.current.held = false;
    };
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [gl]);

  // Live look-at target, damped alongside position so turns feel like a head
  // turning rather than a cut.
  const lookAt = useRef(new THREE.Vector3(0, EYE_HEIGHT, -8));
  /** Damped path distance; the walk position the camera actually uses. */
  const smoothed = useRef(targetS.current);
  /** Previous frame's distance, for the walking-speed estimate. */
  const prevZ = useRef(targetS.current);
  /** Accumulated stride phase, driving the head bob and sway. */
  const stride = useRef(0);
  /** Last distance reported to React, to throttle room-change renders. */
  const reported = useRef(Number.NaN);
  /** 0..1 focus weight; 1 when a work is fully held. */
  const focus = useRef(0);
  /** Quantised focus for React consumers; see the frame loop. */
  const [focusAmount, setFocusAmount] = useState(0);
  const lastTeleport = useRef(teleport.current);

  // Which space the camera is in: the foyer, or inside the chosen wing.
  const [inFoyer, setInFoyer] = useState(() => getInFoyer());
  useEffect(() => subscribeRegion(setInFoyer), []);
  const roomMood: MoodSpec = inFoyer || !wing ? MOODS[FOYER_MOOD] : MOODS[wing.mood];
  const moodRef = useRef(roomMood);
  moodRef.current = roomMood;
  const fogTarget = useMemo(() => new THREE.Color(), []);

  const selected = useMemo(
    () => ALL_PLACEMENTS.find((p) => p.photo.id === selectedId) ?? null,
    [selectedId],
  );

  /*
   * Selecting a work. A work glimpsed through another wing's door is not
   * opened where it hangs — that would fly the camera through a wall — it
   * takes you into its room instead.
   */
  const activeRef = useRef(active);
  activeRef.current = active;
  const select = useCallback(
    (id: string) => {
      const p = ALL_PLACEMENTS.find((q) => q.photo.id === id);
      if (p && p.wing !== activeRef.current) {
        onEnterWing(p.wing);
        return;
      }
      onSelect((current) => (current === id ? null : id));
    },
    [onSelect, onEnterWing],
  );

  // Every work in the building, mounted once. Each decides in its own frame
  // loop whether to draw; nothing is added or removed as you walk.
  const frames = useMemo(
    () =>
      WING_LAYOUTS.flatMap((wl) => {
        const m = MOODS[wl.mood];
        return wl.placements.map((p) => ({ p, crosses: wl.crosses, ink: m.ink, inkDim: m.inkDim }));
      }),
    [],
  );

  // Dev hook for the screenshot harness. Tree-shaken out of production builds.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const places = wing?.placements ?? [];
    (window as unknown as { __nyronScene: unknown }).__nyronScene = scene;
    (window as unknown as { __nyron: unknown }).__nyron = {
      select: (i: number) => onSelect(places[i]?.photo.id ?? null),
      camera: () => ({
        p: camera.position.toArray(),
        look: lookAt.current.toArray(),
        // Where the camera actually faces, head turn included.
        dir: camera.getWorldDirection(new THREE.Vector3()).toArray(),
        z: getCameraZ(),
        selected: selectedId,
        active,
        inFoyer: getInFoyer(),
      }),
      placements: places.map((p) => ({ id: p.photo.id, pos: p.position, rot: p.rotationY, focusS: p.focusS })),
    };
  }, [camera, onSelect, selectedId, active, wing, scene]);

  // World position of the focused artwork, for the depth-of-field plane.
  const focusPos = useRef(new THREE.Vector3());
  const focusTarget = useRef<THREE.Vector3 | null>(null);
  // Half-diagonal of the focused print; the DOF range is derived from it.
  const focusExtent = useRef(0);

  const tmpEye = useRef(new THREE.Vector3());
  const tmpLook = useRef(new THREE.Vector3());

  useFrame((state, rawDelta) => {
    // Clamp the timestep: a tab switch or GC pause would otherwise turn into
    // a visible jump through exponential damping.
    const delta = Math.min(rawDelta, 0.05);

    // Photographs onto the GPU, a few milliseconds' worth per frame.
    const warming = !isWarm();
    pumpUploads(gl, warming ? UPLOAD_MS_WARMING : UPLOAD_MS_WALKING);

    if (warming) {
      warmClock.current += Math.min(rawDelta, 0.1);
      const photos = photosDone.current();
      reportStage('photos', photos);
      const photosReady = photos >= 1 || warmClock.current > PHOTO_TIMEOUT_S;
      const capped = warmClock.current > WARM_CAP_S;
      // Everything compiled and on the GPU: pre-draw it all once (above)...
      if (shadersDone.current && photosReady && predraw.current < 0 && !capped) predraw.current = 2;
      // ...then two ordinary frames, so the first frame the visitor sees is
      // not the first frame the GPU has drawn.
      if (predraw.current === 0 || capped) {
        if (warmFrames.current < 0) warmFrames.current = 0;
        else if (++warmFrames.current >= 2) {
          markWarm();
          onWarm?.();
        }
      }
    }

    // A teleport (changing wing through a door, or back to the foyer) jumps
    // the camera instead of gliding across the whole building.
    let snap = false;
    if (teleport.current !== lastTeleport.current) {
      lastTeleport.current = teleport.current;
      smoothed.current = targetS.current;
      prevZ.current = smoothed.current;
      snap = true;
      // A new room: whichever way the phone faces becomes straight ahead.
      recenterMotion();
      head.current.yaw = 0;
      head.current.pitch = 0;
    } else if (!selected) {
      // While a work is held the walk position is pinned, so Escape returns
      // you exactly where you were.
      smoothed.current = THREE.MathUtils.damp(smoothed.current, targetS.current, 4, delta);
    }

    focus.current = THREE.MathUtils.damp(focus.current, selected ? 1 : 0, 3.2, delta);

    /*
     * Free-walk pose, on the path. The body barely drifts sideways; the head
     * does the looking. A gentle bob keyed to speed plus a faint sway is what
     * turns "the camera moves" into "I am walking". The look target is a
     * point further along the path, so the camera turns each corner — and
     * toward the chosen door — before it gets there.
     */
    const speed = snap ? 0 : Math.min(1, Math.abs(smoothed.current - prevZ.current) / (delta || 0.016) / 6);
    stride.current += delta * (5.2 + speed * 3.5);
    const bob = Math.sin(stride.current) * 0.022 * speed;
    const sway = Math.sin(stride.current * 0.5) * 0.02 * speed;
    const here = pathFrame(walk, smoothed.current);
    // A mouse looks around; a finger only walks (a swipe must not swing the view).
    const px = TOUCH ? 0 : pointer.x;
    const py = TOUCH ? 0 : pointer.y;
    let lat = px * 0.3 + sway;
    const [ax, az] = pathPoint(walk, smoothed.current + 6.5);
    const look = px * 2.6 + sway;
    tmpLook.current.set(ax + here.rx * look, EYE_HEIGHT + py * 1.0 + bob * 0.5, az + here.rz * look);

    /*
     * On a touch screen nothing steers the head, and a portrait screen sees
     * only a narrow slice of the corridor. So the head turns on its own: in a
     * room, toward the next work while it is still a few steps ahead — the
     * body easing away from that wall for a squarer view — letting go as you
     * draw level, by which time the next work, on the other wall, takes over.
     * In the foyer, toward the door that scrolling on leads to. The turn
     * blends directions, not points: a work close beside you is a big turn.
     */
    // With the motion sensor on, the visitor turns their own head while
    // walking; once they stop, the head still turns to the work in front of
    // them, and the phone's own turn adds to that.
    const motion = getMotion();
    const sensing = TOUCH && motion.on && motion.fresh;
    const guideTo = !TOUCH || selected ? 0 : sensing ? (speed < 0.06 ? 0.7 : 0) : portrait ? 0.85 : 0.45;
    guideW.current = THREE.MathUtils.damp(guideW.current, guideTo, 2.5, delta);
    const guide = guideW.current;
    let turn = 0;
    let tx = 0;
    let ty = 0;
    let tz = 0;
    if (guide > 0 && wing) {
      let bestW = 0;
      for (const p of wing.order) {
        const ds = p.focusS - smoothed.current;
        if (ds < -0.2 || ds > 5) continue;
        const w = smooth01((5 - ds) / 2.8) * smooth01((ds + 0.2) / 0.8);
        if (w > bestW) {
          bestW = w;
          [tx, ty, tz] = p.position;
        }
      }
      turn = guide * bestW;
      if (turn > 0) lat -= Math.sign((tx - here.x) * here.rx + (tz - here.z) * here.rz) * 0.5 * turn;
    } else if (guide > 0 && suggested != null && WING_LAYOUTS[suggested]) {
      tx = WING_LAYOUTS[suggested].doorX;
      ty = EYE_HEIGHT;
      tz = -FOYER.depth;
      turn = guide * smooth01((smoothed.current - (DECISION_S - 3.5)) / 3.5);
    }
    tmpEye.current.set(here.x + here.rx * lat, EYE_HEIGHT + py * 0.18 + bob, here.z + here.rz * lat);
    if (turn > 0.001) {
      const ex = tmpEye.current.x;
      const ez = tmpEye.current.z;
      let bx = tmpLook.current.x - ex;
      let bz = tmpLook.current.z - ez;
      let wx = tx - ex;
      let wz = tz - ez;
      const bl = Math.hypot(bx, bz) || 1;
      const wl = Math.hypot(wx, wz) || 1;
      bx /= bl; bz /= bl; wx /= wl; wz /= wl;
      let dx = bx + (wx - bx) * turn;
      let dz = bz + (wz - bz) * turn;
      const dl = Math.hypot(dx, dz) || 1;
      dx /= dl; dz /= dl;
      tmpLook.current.x = ex + dx * 4;
      tmpLook.current.z = ez + dz * 4;
      tmpLook.current.y += (ty - tmpLook.current.y) * turn * 0.6;
    }

    // The lens for this screen: portrait field of view, shifted while held.
    const W = state.size.width;
    const H = state.size.height;
    const cam = camera as THREE.PerspectiveCamera;
    const fov = fovFor(W / Math.max(1, H));
    setLensShift(cam, W, H, fov, portrait ? (focus.current * H * getSheetShare()) / 2 : 0);

    // Blend toward the artwork viewpoint; parallax fades as focus rises.
    if (selected) {
      const { eye, look: target } = viewpointFor(selected, portrait, fov, W / Math.max(1, H));
      focusPos.current.copy(target);
      focusTarget.current = focusPos.current;
      focusExtent.current = 0.5 * Math.hypot(selected.height * selected.photo.aspect, selected.height);
      const k = focus.current;
      const drift = 1 - k;
      tmpEye.current.lerp(eye, k);
      tmpEye.current.x += px * 0.22 * drift;
      tmpEye.current.y += py * 0.12 * drift;
      tmpLook.current.lerp(target, k);
    } else {
      focusTarget.current = null;
    }

    if (snap) {
      camera.position.copy(tmpEye.current);
      lookAt.current.copy(tmpLook.current);
    } else {
      // Slower while focusing = a considered glide.
      const posSpeed = selected ? 2.6 : 3.4;
      camera.position.x = THREE.MathUtils.damp(camera.position.x, tmpEye.current.x, posSpeed, delta);
      camera.position.y = THREE.MathUtils.damp(camera.position.y, tmpEye.current.y, posSpeed, delta);
      camera.position.z = THREE.MathUtils.damp(camera.position.z, tmpEye.current.z, posSpeed, delta);
      lookAt.current.x = THREE.MathUtils.damp(lookAt.current.x, tmpLook.current.x, posSpeed, delta);
      lookAt.current.y = THREE.MathUtils.damp(lookAt.current.y, tmpLook.current.y, posSpeed, delta);
      lookAt.current.z = THREE.MathUtils.damp(lookAt.current.z, tmpLook.current.z, posSpeed, delta);
    }
    camera.lookAt(lookAt.current);

    if (TOUCH) {
      if (!drag.current.held) {
        drag.current.yaw = THREE.MathUtils.damp(drag.current.yaw, 0, 1.4, delta);
        drag.current.pitch = THREE.MathUtils.damp(drag.current.pitch, 0, 1.4, delta);
      }
      const wantYaw = (sensing ? motion.yaw : 0) + drag.current.yaw;
      const wantPitch = Math.max(-0.75, Math.min(0.75, (sensing ? motion.pitch : 0) + drag.current.pitch));
      head.current.yaw = dampAngle(head.current.yaw, wantYaw, 16, delta);
      head.current.pitch = THREE.MathUtils.damp(head.current.pitch, wantPitch, 16, delta);
      // Steady while a work is held: the framing is the point then.
      const free = 1 - focus.current;
      if (free > 0.001) {
        camera.rotateOnWorldAxis(UP, head.current.yaw * free);
        camera.rotateX(head.current.pitch * free);
      }
    }

    prevZ.current = smoothed.current;

    // Camera position goes to a plain store, not React state; subscribers
    // re-render only when something they draw could change.
    publishCameraZ(smoothed.current);
    publishRegion(inFoyerAt(activeRef.current, smoothed.current));

    // The air takes on the look of the room you are in: fog and background
    // ease between rooms rather than switching at the door.
    const m = moodRef.current;
    const fog = scene.fog as THREE.Fog | null;
    const k = snap ? 1 : 1 - Math.exp(-2.4 * delta);
    fogTarget.set(m.fog);
    if (fog) {
      fog.color.lerp(fogTarget, k);
      fog.near += (m.fogNear - fog.near) * k;
      fog.far += (m.fogFar - fog.far) * k;
    }
    if (scene.background instanceof THREE.Color) scene.background.lerp(fogTarget, k);

    // The HUD room name still needs React, but far less often.
    if (!(Math.abs(smoothed.current - reported.current) <= 2)) {
      reported.current = smoothed.current;
      onCameraZ(smoothed.current);
    }
    // Quantised: Lighting only needs coarse steps; caption and DOF read the ref.
    const step = Math.round(focus.current * 8) / 8;
    if (step !== focusAmount) setFocusAmount(step);
  });

  const foyerMood = MOODS[FOYER_MOOD];

  return (
    <>
      <Lighting focusAmount={focusAmount} selectedId={selectedId} walk={walk} mood={roomMood} />
      <Architecture onEnter={onEnterWing} onNext={onNextWing} onFoyer={onFoyer} onBuilt={onBuilt} />

      {frames.map(({ p, crosses, ink, inkDim }) => (
        <Frame
          key={p.photo.id}
          placement={p}
          crosses={crosses}
          ink={ink}
          inkDim={inkDim}
          revealed={selectedId === p.photo.id}
          dimmed={selectedId !== null && selectedId !== p.photo.id}
          onSelect={select}
        />
      ))}

      {/* On a portrait screen the caption is a sheet in the page (Exhibition). */}
      {selected && !portrait && <Caption placement={selected} amountRef={focus} />}

      {onStats && <Stats onSample={onStats} />}

      <FocusEffects amountRef={focus} targetRef={focusTarget} extentRef={focusExtent} />
      <fog attach="fog" args={[foyerMood.fog, foyerMood.fogNear, foyerMood.fogFar]} />
    </>
  );
}

/*
 * Fixed pixel ratio, deliberately not adaptive: dropping resolution when the
 * frame rate dips softens the prints, which on a photography site is worse
 * than a lower frame rate. It would also misfire whenever the browser itself
 * caps the frame rate (battery saver holds every page to 30 fps), blurring
 * the photographs for no gain at all.
 */
export function Scene(props: Props) {
  return (
    <Canvas
      // MSAA is wasted here: EffectComposer renders into its own buffer.
      gl={{ antialias: false, powerPreference: 'high-performance', stencil: false, depth: true }}
      // Phones have 3x screens and the scene is lighter there: a little more resolution.
      dpr={[1, LITE ? 1.75 : 1.5]}
      camera={{ fov: 64, near: 0.08, far: 160, position: [0, EYE_HEIGHT, 6] }}
      // Sized to the large viewport (see .stage), so a phone's toolbars
      // sliding in and out never resize the canvas mid-walk.
      className="stage"
      resize={{ scroll: false, debounce: { scroll: 0, resize: 120 } }}
      onPointerMissed={() => props.onSelect(null)}
    >
      <color attach="background" args={[MOODS[FOYER_MOOD].fog]} />
      <Rig {...props} />
    </Canvas>
  );
}
