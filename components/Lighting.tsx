'use client';

import { useEffect, useState } from 'react';
import { PLACEMENTS, pathPoint } from '@/lib/layout';
import { getCameraZ, subscribeBucket } from '@/lib/cameraStore';
import { StageLight } from './StageLight';

/**
 * Black-box gallery lighting. The room itself is barely lit — a cool, low
 * ambient so the concrete reads as material, and a faint fill that travels
 * with you so you are never in pitch dark. The prints are lit by their own
 * stage lights, which strike on as you approach.
 *
 * The mounted set is the nearest few works; each of those decides for
 * itself whether it is on. Spotlights multiply fragment cost, so the cap
 * stays small.
 */
const MAX_LAMPS = 5;
const MOUNT_WITHIN = 14;

export function Lighting({ focusAmount, selectedId }: { focusAmount: number; selectedId: string | null }) {
  const [cameraS, setCameraS] = useState(() => getCameraZ());
  useEffect(() => subscribeBucket(setCameraS), []);

  const fill = pathPoint(cameraS + 1.5);
  const lamps = PLACEMENTS
    .map((p) => ({ p, d: Math.abs(cameraS - p.focusS) }))
    .filter(({ p, d }) => p.photo.id === selectedId || d < MOUNT_WITHIN)
    .sort((a, b) => (a.p.photo.id === selectedId ? -1 : b.p.photo.id === selectedId ? 1 : a.d - b.d))
    .slice(0, MAX_LAMPS)
    .map(({ p }) => p);

  return (
    <>
      <ambientLight intensity={0.5 - focusAmount * 0.18} color="#a4acbb" />
      <hemisphereLight args={['#59606e', '#1a1714', 0.55 - focusAmount * 0.2]} />
      <pointLight position={[fill[0], 3.5, fill[1]]} intensity={5.5 - focusAmount * 2.5} distance={16} decay={1.5} color="#ffe9d2" />

      {lamps.map((p) => (
        <StageLight key={p.photo.id} placement={p} selected={p.photo.id === selectedId} focusAmount={focusAmount} />
      ))}
    </>
  );
}
