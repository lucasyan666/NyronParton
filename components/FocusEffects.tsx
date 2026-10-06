'use client';

import { memo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { EffectComposer, DepthOfField, Bloom, Vignette } from '@react-three/postprocessing';
import type { DepthOfFieldEffect } from 'postprocessing';
import * as THREE from 'three';

/**
 * Post: a soft bloom that only the cove lights and lamp lenses reach, a
 * gentle vignette, and depth of field while a work is held.
 *
 * Depth of field is ALWAYS mounted, at zero strength while walking.
 * @react-three/postprocessing merges every effect into one shader, so
 * mounting it on click and removing it on Escape rebuilt and recompiled that
 * whole shader each time — measured as a 517 ms freeze on opening a photo.
 * Kept mounted, it compiles once, behind the loading screen.
 *
 * Live values go through `cocMaterial.worldFocusDistance` / `.focusRange`;
 * `worldFocusRange` is a constructor option only, with no runtime setter.
 */
/*
 * Memoised, and that matters: EffectComposer rebuilds its merged pass whenever
 * its children change identity, which is every time this re-renders. Its
 * props are refs, so with memo it renders once.
 */
export const FocusEffects = memo(function FocusEffects({ amountRef, targetRef, extentRef }: {
  amountRef: React.MutableRefObject<number>;
  targetRef: React.MutableRefObject<THREE.Vector3 | null>;
  extentRef: React.MutableRefObject<number>;
}) {
  const dof = useRef<DepthOfFieldEffect>(null);
  const { camera } = useThree();

  useFrame(() => {
    const e = dof.current;
    if (!e) return;
    const a = amountRef.current;
    const target = targetRef.current;
    const coc = e.cocMaterial;
    coc.worldFocusDistance = target ? camera.position.distanceTo(target) : 3;
    coc.focusRange = Math.max(1.2, extentRef.current * 1.35);
    e.bokehScale = a < 0.002 ? 0 : a * 4.5;
  });

  return (
    <EffectComposer multisampling={0}>
      <DepthOfField ref={dof} worldFocusDistance={3} worldFocusRange={2} bokehScale={0} resolutionScale={0.5} />
      {/* Threshold sits at 1.0: only the over-white cove strips and lenses
          cross it, so mounts and highlights never glow. */}
      <Bloom mipmapBlur luminanceThreshold={1.0} luminanceSmoothing={0.02} intensity={0.55} radius={0.8} />
      <Vignette offset={0.3} darkness={0.42} />
    </EffectComposer>
  );
});
