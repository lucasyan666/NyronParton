'use client';

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { pathPoint, type Walk } from '@/lib/layout';
import { type MoodSpec } from '@/lib/moods';
import { getCameraZ } from '@/lib/cameraStore';
import { LampPool } from './LampPool';

/**
 * Gallery lighting, set by the look of the room you are in. The room itself
 * is lit only enough to read as a room — an ambient, a sky/floor hemisphere,
 * and a soft fill that travels with you. The prints are lit by the lamp
 * pool, whose lamps strike on as you approach each work.
 *
 * The number of lights never changes (see LampPool), and the travelling fill
 * is moved in the frame loop rather than by re-rendering.
 */
export function Lighting({ focusAmount, selectedId, walk, mood }: {
  focusAmount: number;
  selectedId: string | null;
  /** The walk being followed, for the travelling fill. */
  walk: Walk;
  /** Look of the space the camera is in now (foyer or wing). */
  mood: MoodSpec;
}) {
  const fill = useRef<THREE.PointLight>(null);
  const walkRef = useRef(walk);
  walkRef.current = walk;

  useFrame(() => {
    const l = fill.current;
    if (!l) return;
    const [x, z] = pathPoint(walkRef.current, getCameraZ() + 1.5);
    l.position.set(x, 3.5, z);
  });

  return (
    <>
      <ambientLight intensity={mood.ambient.intensity * (1 - focusAmount * 0.36)} color={mood.ambient.color} />
      <hemisphereLight args={[mood.hemi.sky, mood.hemi.ground, mood.hemi.intensity * (1 - focusAmount * 0.36)]} />
      <pointLight
        ref={fill}
        intensity={mood.fill.intensity * (1 - focusAmount * 0.45)}
        distance={16}
        decay={1.5}
        color={mood.fill.color}
      />
      <LampPool selectedId={selectedId} focusAmount={focusAmount} />
    </>
  );
}
