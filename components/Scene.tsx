'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  ALL_PLACEMENTS,
  EYE_HEIGHT,
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

const _eye = new THREE.Vector3();
const _look = new THREE.Vector3();

/**
 * Where the camera should stand to face a given photo square-on: back off
 * along the frame's own normal, and rise to the frame's centre height.
 * Reuses module-level vectors — this runs every frame while focusing.
 */
function viewpointFor(p: Placement) {
  const [x, y, z] = p.position;
  const nx = Math.sin(p.rotationY);
  const nz = Math.cos(p.rotationY);
  const dist = VIEW_DISTANCE + p.height * 0.6;
  _eye.set(x + nx * dist, y, z + nz * dist);
  _look.set(x, y, z);
  return { eye: _eye, look: _look };
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

function Rig({ targetS, teleport, active, selectedId, onSelect, onCameraZ, onEnterWing, onNextWing, onFoyer, onWarm, onStats }: Props) {
  const { camera, pointer, gl, scene } = useThree();
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

  useFrame((_, rawDelta) => {
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
    const lat = pointer.x * 0.3 + sway;
    tmpEye.current.set(here.x + here.rx * lat, EYE_HEIGHT + pointer.y * 0.18 + bob, here.z + here.rz * lat);
    const [ax, az] = pathPoint(walk, smoothed.current + 6.5);
    const look = pointer.x * 2.6 + sway;
    tmpLook.current.set(ax + here.rx * look, EYE_HEIGHT + pointer.y * 1.0 + bob * 0.5, az + here.rz * look);

    // Blend toward the artwork viewpoint; parallax fades as focus rises.
    if (selected) {
      const { eye, look: target } = viewpointFor(selected);
      focusPos.current.copy(target);
      focusTarget.current = focusPos.current;
      focusExtent.current = 0.5 * Math.hypot(selected.height * selected.photo.aspect, selected.height);
      const k = focus.current;
      const drift = 1 - k;
      tmpEye.current.lerp(eye, k);
      tmpEye.current.x += pointer.x * 0.22 * drift;
      tmpEye.current.y += pointer.y * 0.12 * drift;
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

      {selected && <Caption placement={selected} amountRef={focus} />}

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
      dpr={[1, 1.5]}
      camera={{ fov: 64, near: 0.08, far: 160, position: [0, EYE_HEIGHT, 6] }}
      style={{ position: 'fixed', inset: 0 }}
      onPointerMissed={() => props.onSelect(null)}
    >
      <color attach="background" args={[MOODS[FOYER_MOOD].fog]} />
      <Rig {...props} />
    </Canvas>
  );
}
