'use client';

import { useEffect, useState } from 'react';
import { pathPoint, type Placement, type Walk } from '@/lib/layout';
import { type MoodSpec } from '@/lib/moods';
import { getCameraZ, subscribeBucket } from '@/lib/cameraStore';
import { StageLight } from './StageLight';

/**
 * Gallery lighting, set by the look of the room you are in. The room itself
 * is lit only enough to read as a room — an ambient, a sky/floor hemisphere,
 * and a soft fill that travels with you. The prints are lit by their own
 * stage lights, which strike on as you approach.
 *
 * Only works in the chosen wing get lamps: the rooms seen through the foyer
 * doors stay dark until you walk in. Spotlights multiply fragment cost, so
 * the mounted set is the nearest few.
 */
const MAX_LAMPS = 5;
const MOUNT_WITHIN = 14;

export function Lighting({ focusAmount, selectedId, walk, placements, mood, lampMood }: {
  focusAmount: number;
  selectedId: string | null;
  /** The walk being followed, for the travelling fill. */
  walk: Walk;
  /** Works that may be lit: the chosen wing's. */
  placements: Placement[];
  /** Look of the space the camera is in now (foyer or wing). */
  mood: MoodSpec;
  /** Look of the chosen wing, for its lamps. */
  lampMood: MoodSpec;
}) {
  const [cameraS, setCameraS] = useState(() => getCameraZ());
  useEffect(() => subscribeBucket(setCameraS), []);

  const fill = pathPoint(walk, cameraS + 1.5);
  const lamps = placements
    .map((p) => ({ p, d: Math.abs(cameraS - p.focusS) }))
    .filter(({ p, d }) => p.photo.id === selectedId || d < MOUNT_WITHIN)
    .sort((a, b) => (a.p.photo.id === selectedId ? -1 : b.p.photo.id === selectedId ? 1 : a.d - b.d))
    .slice(0, MAX_LAMPS)
    .map(({ p }) => p);

  return (
    <>
      <ambientLight intensity={mood.ambient.intensity * (1 - focusAmount * 0.36)} color={mood.ambient.color} />
      <hemisphereLight args={[mood.hemi.sky, mood.hemi.ground, mood.hemi.intensity * (1 - focusAmount * 0.36)]} />
      <pointLight
        position={[fill[0], 3.5, fill[1]]}
        intensity={mood.fill.intensity * (1 - focusAmount * 0.45)}
        distance={16}
        decay={1.5}
        color={mood.fill.color}
      />

      {lamps.map((p) => (
        <StageLight
          key={p.photo.id}
          placement={p}
          selected={p.photo.id === selectedId}
          focusAmount={focusAmount}
          mood={lampMood}
        />
      ))}
    </>
  );
}
