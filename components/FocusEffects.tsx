'use client';

import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { EffectComposer, DepthOfField, Bloom, Vignette } from '@react-three/postprocessing';
import type { DepthOfFieldEffect } from 'postprocessing';
import * as THREE from 'three';

/**
 * Post: a soft bloom that only the cove lights reach, a gentle vignette, and
 * depth of field while a work is held.
 *
 * No film grain. It was a temporal noise pass, and on still photographs it
 * read as pixels flashing — the exact complaint it took screenshots to see.
 *
 * DOF is expensive, so it is unmounted while walking. Live values go through
 * `cocMaterial.worldFocusDistance` / `.focusRange`; `worldFocusRange` is a
 * constructor option only, with no runtime setter.
 */
export function FocusEffects({ amountRef, quantised, targetRef, extentRef }: {
  amountRef: React.MutableRefObject<number>;
  quantised: number;
  targetRef: React.MutableRefObject<THREE.Vector3 | null>;
  extentRef: React.MutableRefObject<number>;
}) {
  const dof = useRef<DepthOfFieldEffect>(null);
  const { camera } = useThree();

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (quantised > 0 && !mounted) setMounted(true);
    else if (quantised === 0 && mounted) setMounted(false);
  }, [quantised, mounted]);

  useFrame(() => {
    const e = dof.current;
    if (!e) return;
    const a = amountRef.current;
    const target = targetRef.current;
    const coc = e.cocMaterial;
    coc.worldFocusDistance = target ? camera.position.distanceTo(target) : 3;
    coc.focusRange = Math.max(1.2, extentRef.current * 1.35);
    e.bokehScale = a * 4.5;
  });

  return (
    <EffectComposer multisampling={0}>
      {mounted ? (
        <DepthOfField ref={dof} worldFocusDistance={3} worldFocusRange={2} bokehScale={0} resolutionScale={0.5} />
      ) : (
        <></>
      )}
      {/* Threshold sits at 1.0: only the over-white cove strips cross it. Lit
          surfaces top out below it, so mounts and highlights never glow. */}
      <Bloom mipmapBlur luminanceThreshold={1.0} luminanceSmoothing={0.02} intensity={0.55} radius={0.8} />
      <Vignette offset={0.3} darkness={0.42} />
    </EffectComposer>
  );
}
