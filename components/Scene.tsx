'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { AdaptiveEvents } from '@react-three/drei';
import * as THREE from 'three';
import { PLACEMENTS, EYE_HEIGHT, pathFrame, pathPoint, sAtProgress, type Placement } from '@/lib/layout';
import { getCameraZ, publishCameraZ } from '@/lib/cameraStore';
import { preloadFirst, setMaxAnisotropy } from '@/lib/useProximityTexture';
import { ALL_PHOTOS } from '@/data/exhibition';
import { Frame } from './Frame';
import { Architecture } from './Architecture';
import { Lighting } from './Lighting';
import { FocusEffects } from './FocusEffects';
import { Caption } from './Caption';
import { Stats } from './Stats';

type Props = {
  progress: React.MutableRefObject<number>;
  selectedId: string | null;
  onSelect: React.Dispatch<React.SetStateAction<string | null>>;
  onCameraZ: (z: number) => void;
  /** Fired once the first real frame has been drawn. */
  onReady?: () => void;
  /** Perf line, twice a second, when ?stats is in the URL. */
  onStats?: (line: string) => void;
};

/** How far back from a photo the camera settles when focused. */
const VIEW_DISTANCE = 2.2;

/**
 * Where the camera should stand to face a given photo square-on: back off
 * along the frame's own normal, and rise to the frame's centre height.
 */
const _eye = new THREE.Vector3();
const _look = new THREE.Vector3();

/** Reuses module-level vectors — this runs every frame while focusing. */
function viewpointFor(p: Placement) {
  const [x, y, z] = p.position;
  const nx = Math.sin(p.rotationY);
  const nz = Math.cos(p.rotationY);
  // Frames are large; back off proportionally so the whole print fits.
  const dist = VIEW_DISTANCE + p.height * 0.6;
  _eye.set(x + nx * dist, y, z + nz * dist);
  _look.set(x, y, z);
  return { eye: _eye, look: _look };
}

function Walk({ progress, selectedId, onSelect, onCameraZ, onReady, onStats }: Props) {
  const { camera, pointer, gl, scene } = useThree();

  // Photographs hang on side walls and are viewed at glancing angles down
  // the corridor — the exact case anisotropic filtering exists for. Without
  // the GPU's real maximum they mip down to a blur.
  useEffect(() => {
    setMaxAnisotropy(gl.capabilities.getMaxAnisotropy());
    preloadFirst(ALL_PHOTOS.map((p) => p.src), 10);
  }, [gl]);

  /*
   * Compile shaders once, as soon as the renderer exists.
   *
   * This used to sit in useFrame, which meant it ran on the first frame —
   * after the very cost it exists to avoid. Profiling the warm-up showed
   * shader compilation as the single largest item, so it now runs in an
   * effect at mount, before anything is drawn.
   *
   * `gl.compile` only covers what is currently in the scene graph, and the
   * scene culls all but the nearest room. So this also asks the renderer to
   * initialise the handful of shared materials directly, which is what the
   * remaining rooms will reuse as you reach them.
   */
  useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      gl.compile(scene, camera);
    };
    // One frame of headroom so the scene graph is populated first.
    const raf = requestAnimationFrame(run);
    return () => { cancelled = true; cancelAnimationFrame(raf); };
  }, [gl, scene, camera]);

  // Live look-at target, damped alongside position so turns feel like a head
  // turning rather than a cut.
  const lookAt = useRef(new THREE.Vector3(0, EYE_HEIGHT, -8));
  /** Damped path distance; the walk position the camera actually uses. */
  const smoothed = useRef(0);
  /** Previous frame's distance, for the walking-speed estimate. */
  const prevZ = useRef(0);
  /** Accumulated stride phase, driving the head bob and sway. */
  const stride = useRef(0);
  /** Last distance reported to React, to throttle room-change renders. */
  const reported = useRef(0);
  /** 0..1 focus weight; 1 when a work is fully held. */
  const focus = useRef(0);
  /** Quantised focus for React consumers; see the frame loop. */
  const [focusAmount, setFocusAmount] = useState(0);

  const selected = useMemo(
    () => PLACEMENTS.find((p) => p.photo.id === selectedId) ?? null,
    [selectedId],
  );

  // Dev hook for the screenshot harness: select a work by index and read the
  // camera back. Tree-shaken out of production builds.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    (window as unknown as { __nyron: unknown }).__nyron = {
      select: (i: number) => onSelect(PLACEMENTS[i]?.photo.id ?? null),
      camera: () => ({ p: camera.position.toArray(), look: lookAt.current.toArray(), z: getCameraZ(), selected: selectedId }),
      placements: PLACEMENTS.map((p) => ({ id: p.photo.id, pos: p.position, rot: p.rotationY, focusS: p.focusS })),
    };
  }, [camera, onSelect, selectedId]);

  // Stable across renders so memoised Frames are not invalidated by a new
  // closure on every parent render.
  const select = useCallback(
    (id: string) => onSelect((current) => (current === id ? null : id)),
    [onSelect],
  );

  // World position of the focused artwork, for the depth-of-field plane.
  // Owns its own vector: viewpointFor reuses module-level scratch vectors,
  // so storing its result directly would alias and be overwritten.
  const focusPos = useRef(new THREE.Vector3());
  const focusTarget = useRef<THREE.Vector3 | null>(null);
  // Half-diagonal of the focused print; the DOF range is derived from it so
  // a large print's corners stay as sharp as its centre.
  const focusExtent = useRef(0);

  const tmpEye = useRef(new THREE.Vector3());
  const tmpLook = useRef(new THREE.Vector3());
  // Textures generate and shaders compile before the first frame lands;
  // hold the boot screen until then so the wait is legible, not a freeze.
  const announced = useRef(false);

  useFrame((_, rawDelta) => {
    // Clamp the timestep. A tab switch or GC pause produces a delta of
    // hundreds of milliseconds, which exponential damping turns into a
    // visible jump; capping it at ~3 frames keeps motion continuous.
    const delta = Math.min(rawDelta, 0.05);

    if (!announced.current) {
      announced.current = true;
      onReady?.();
    }

    /*
     * While a work is held the walk position is pinned. Lenis is stopped, but
     * anything else that moves the scroll (a programmatic scrollTo, a browser
     * restore) would otherwise drag the underlying position out from under
     * the focus pose — and you would return to a different spot than you left.
     */
    if (!selected) {
      const walkS = sAtProgress(progress.current);
      smoothed.current = THREE.MathUtils.damp(smoothed.current, walkS, 4, delta);
    }

    const focusLevel = selected ? 1 : 0;
    focus.current = THREE.MathUtils.damp(focus.current, focusLevel, 3.2, delta);

    /*
     * Free-walk pose, on the path. The body barely drifts sideways in a
     * corridor; the head does the looking. A gentle bob keyed to speed plus a
     * faint sway is what turns "the camera moves" into "I am walking". The
     * look target is a point further along the path, so the camera turns
     * each corner by itself, ahead of arriving at it.
     */
    const speed = Math.min(1, Math.abs(smoothed.current - prevZ.current) / (delta || 0.016) / 6);
    stride.current += delta * (5.2 + speed * 3.5);
    const bob = Math.sin(stride.current) * 0.022 * speed;
    const sway = Math.sin(stride.current * 0.5) * 0.02 * speed;
    const here = pathFrame(smoothed.current);
    const lat = pointer.x * 0.3 + sway;
    tmpEye.current.set(here.x + here.rx * lat, EYE_HEIGHT + pointer.y * 0.18 + bob, here.z + here.rz * lat);
    const [ax, az] = pathPoint(smoothed.current + 6.5);
    const look = pointer.x * 2.6 + sway;
    tmpLook.current.set(ax + here.rx * look, EYE_HEIGHT + pointer.y * 1.0 + bob * 0.5, az + here.rz * look);

    // Blend toward the artwork viewpoint. Pointer parallax is scaled down as
    // focus rises so the held view is steady, not floaty.
    if (selected) {
      const { eye, look } = viewpointFor(selected);
      focusPos.current.copy(look);
      focusTarget.current = focusPos.current;
      focusExtent.current = 0.5 * Math.hypot(
        selected.height * selected.photo.aspect,
        selected.height,
      );
      const k = focus.current;
      const drift = 1 - k;
      tmpEye.current.lerp(eye, k);
      tmpEye.current.x += pointer.x * 0.22 * drift;
      tmpEye.current.y += pointer.y * 0.12 * drift;
      tmpLook.current.lerp(look, k);
    } else {
      focusTarget.current = null;
    }

    // Damp toward the blended pose. Slower while focusing = a considered glide.
    const posSpeed = selected ? 2.6 : 3.4;
    camera.position.x = THREE.MathUtils.damp(camera.position.x, tmpEye.current.x, posSpeed, delta);
    camera.position.y = THREE.MathUtils.damp(camera.position.y, tmpEye.current.y, posSpeed, delta);
    camera.position.z = THREE.MathUtils.damp(camera.position.z, tmpEye.current.z, posSpeed, delta);

    lookAt.current.x = THREE.MathUtils.damp(lookAt.current.x, tmpLook.current.x, posSpeed, delta);
    lookAt.current.y = THREE.MathUtils.damp(lookAt.current.y, tmpLook.current.y, posSpeed, delta);
    lookAt.current.z = THREE.MathUtils.damp(lookAt.current.z, tmpLook.current.z, posSpeed, delta);
    camera.lookAt(lookAt.current);

    prevZ.current = smoothed.current;

    // Camera position goes to a plain store, not React state. Subscribers
    // re-render only when the coarse bucket changes; everything else reads it
    // directly inside its own useFrame.
    publishCameraZ(smoothed.current);

    // The HUD room name still needs React, but far less often.
    if (Math.abs(smoothed.current - reported.current) > 4) {
      reported.current = smoothed.current;
      onCameraZ(smoothed.current);
    }
    // Quantised to 8 steps: the focus ramp drove ~80 renders of the whole
    // scene per transition at the old 0.012 threshold. Lighting only needs
    // coarse steps, and the caption and DOF read `focusRef` every frame.
    const step = Math.round(focus.current * 8) / 8;
    if (step !== focusAmount) setFocusAmount(step);
  });

  return (
    <>
      <Lighting focusAmount={focusAmount} selectedId={selectedId} />
      <Architecture />

      {PLACEMENTS.map((p) => (
        <Frame
          key={p.photo.id}
          placement={p}
          revealed={selectedId === p.photo.id}
          dimmed={selectedId !== null && selectedId !== p.photo.id}
          onSelect={select}
        />
      ))}

      {selected && <Caption placement={selected} amountRef={focus} />}

      {/* Skips raycasting during motion — pointer events are not needed
          mid-scroll and raycasting 33 frames per move is wasted work. */}
      <AdaptiveEvents />

      {onStats && <Stats onSample={onStats} />}

      <FocusEffects
        amountRef={focus}
        quantised={focusAmount}
        targetRef={focusTarget}
        extentRef={focusExtent}
      />
      {/* Daylight haze, matched to the background so distance dissolves into
          light rather than into darkness. */}
      <fog attach="fog" args={['#0c0b0a', 18, 70]} />
    </>
  );
}

export function Scene(props: Props) {
  return (
    <Canvas
      // MSAA is wasted here: EffectComposer renders into its own buffer, so
      // the canvas AA never applies to what you actually see. The composer's
      // SMAA-free output is slightly softer but costs far less.
      gl={{ antialias: false, powerPreference: 'high-performance', stencil: false, depth: true }}
      // 1.5 is the practical ceiling before fill rate dominates on a retina
      // display; the scene is dim and fogged, so the extra pixels buy little.
      // AdaptiveDpr moves within this range: full quality when still,
      // dropping toward the floor while the camera is in motion.
      dpr={[1, 1.5]}
      // How far quality may fall, and how long it waits before recovering.
      performance={{ min: 0.9, max: 1, debounce: 200 }}
      camera={{ fov: 64, near: 0.08, far: 160, position: [0, EYE_HEIGHT, 6] }}
      shadows
      style={{ position: 'fixed', inset: 0 }}
      onPointerMissed={() => props.onSelect(null)}
    >
      <color attach="background" args={['#0c0b0a']} />
      <Walk {...props} />
    </Canvas>
  );
}
