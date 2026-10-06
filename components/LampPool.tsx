'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { ALL_PLACEMENTS, CEILING, WING_LAYOUTS, type Placement } from '@/lib/layout';
import { MOODS, FOYER_MOOD, type MoodSpec } from '@/lib/moods';
import { createBeamMaterial } from '@/lib/beamMaterial';
import { getActiveWing, getCameraZ } from '@/lib/cameraStore';
import { isPredrawing } from '@/lib/warmup';

/**
 * Stage lights, as a fixed pool.
 *
 * Every lit material's shader is compiled for an exact number of lights, so
 * adding or removing a single SpotLight makes three.js recompile every wall,
 * floor and frame in the building. With one lamp mounted per nearby work,
 * that happened each time a lamp came into or left range, and every time you
 * entered a room — the lag you felt walking. Here the scene always holds the
 * same number of lamps. They are never mounted or unmounted, only moved to
 * the nearest works, faded, and struck on.
 */

export const POOL = 5;
/** Path distance at which a lamp strikes on, and the further one at which it goes dark. */
const ON_AT = 6.5;
const OFF_AT = 8.8;
/** Works this near may claim a lamp. */
const CLAIM_WITHIN = 14;

type Rig = {
  lamp: THREE.Vector3;
  target: THREE.Vector3;
  mid: THREE.Vector3;
  quat: THREE.Quaternion;
  length: number;
  radius: number;
};

const UP = new THREE.Vector3(0, 1, 0);

/** Where a work's lamp hangs and what it points at, computed once per work. */
const rigs = new Map<string, Rig>();
function rigFor(p: Placement): Rig {
  let r = rigs.get(p.photo.id);
  if (r) return r;
  const [x, y, z] = p.position;
  const nx = Math.sin(p.rotationY), nz = Math.cos(p.rotationY);
  const lamp = new THREE.Vector3(x + nx * 1.25, CEILING - 0.14, z + nz * 1.25);
  const target = new THREE.Vector3(x, y, z);
  const dir = new THREE.Vector3().subVectors(lamp, target);
  r = {
    lamp,
    target,
    mid: new THREE.Vector3().addVectors(lamp, target).multiplyScalar(0.5),
    quat: new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize()),
    length: dir.length(),
    radius: Math.max(0.5, p.height * 0.62 * p.photo.aspect ** 0.25),
  };
  rigs.set(p.photo.id, r);
  return r;
}

type Slot = {
  id: string | null;
  amount: number;
  on: boolean;
  sinceOn: number;
};

export function LampPool({ selectedId, focusAmount }: { selectedId: string | null; focusAmount: number }) {
  const { scene } = useThree();
  const lights = useRef<(THREE.SpotLight | null)[]>([]);
  const cans = useRef<(THREE.Group | null)[]>([]);
  const beams = useRef<(THREE.Mesh | null)[]>([]);
  const slots = useRef<Slot[]>(Array.from({ length: POOL }, () => ({ id: null, amount: 0, on: false, sinceOn: 10 })));

  const targets = useMemo(() => Array.from({ length: POOL }, () => new THREE.Object3D()), []);
  const beamMats = useMemo(() => Array.from({ length: POOL }, () => createBeamMaterial('#ffd9a3')), []);
  const lensMats = useMemo(
    () => Array.from({ length: POOL }, () => new THREE.MeshBasicMaterial({ color: new THREE.Color(0.1, 0.1, 0.1), toneMapped: false })),
    [],
  );
  const beamGeo = useMemo(() => new THREE.ConeGeometry(1, 1, 28, 1, true), []);

  useEffect(() => {
    targets.forEach((t, i) => {
      scene.add(t);
      const l = lights.current[i];
      if (l) l.target = t;
    });
    return () => {
      targets.forEach((t) => scene.remove(t));
      beamMats.forEach((m) => m.dispose());
      lensMats.forEach((m) => m.dispose());
      beamGeo.dispose();
    };
  }, [scene, targets, beamMats, lensMats, beamGeo]);

  const mood = useRef<MoodSpec>(MOODS[FOYER_MOOD]);
  const lastWing = useRef<number | null | undefined>(undefined);
  const lens = useRef<[number, number, number]>(MOODS[FOYER_MOOD].lens);
  const byId = useMemo(() => new Map(ALL_PLACEMENTS.map((p) => [p.photo.id, p])), []);

  useFrame((_, rawDelta) => {
    // Every beam and can is being drawn once behind the loading screen.
    if (isPredrawing()) return;
    const delta = Math.min(rawDelta, 0.05);
    const wing = getActiveWing();
    const s = getCameraZ();

    // Colours follow the chosen wing's look: warm, cool, or white.
    if (wing !== lastWing.current) {
      lastWing.current = wing;
      mood.current = wing == null ? MOODS[FOYER_MOOD] : MOODS[WING_LAYOUTS[wing].mood];
      lens.current = mood.current.lens;
      beamMats.forEach((m) => m.uniforms.uColor.value.set(mood.current.beam));
      lights.current.forEach((l) => l?.color.set(mood.current.lamp));
    }

    // Which works deserve a lamp: the chosen wing's nearest few, the held one first.
    const wanted: string[] = [];
    if (wing != null) {
      const near = WING_LAYOUTS[wing].placements
        .map((p) => ({ id: p.photo.id, d: Math.abs(s - p.focusS) }))
        .filter((x) => x.id === selectedId || x.d < CLAIM_WITHIN)
        .sort((a, b) => (a.id === selectedId ? -1 : b.id === selectedId ? 1 : a.d - b.d))
        .slice(0, POOL);
      near.forEach((x) => wanted.push(x.id));
    }

    // Keep lamps on the works they already light; let freed lamps fade out
    // fully before they move, then give them to newcomers.
    const pool = slots.current;
    for (const slot of pool) {
      if (slot.id && !wanted.includes(slot.id)) slot.on = false;
    }
    for (const id of wanted) {
      if (pool.some((sl) => sl.id === id)) continue;
      const free = pool.find((sl) => sl.id === null) ?? pool.find((sl) => !sl.on && sl.amount < 0.02);
      if (free) { free.id = id; free.amount = 0; free.on = false; free.sinceOn = 10; }
    }

    const [lr, lg, lb] = lens.current;
    pool.forEach((slot, i) => {
      const light = lights.current[i];
      const can = cans.current[i];
      const beam = beams.current[i];
      const p = slot.id ? byId.get(slot.id) : null;
      if (!p || !light || !can || !beam) {
        if (light) light.intensity = 0;
        if (can) can.visible = false;
        if (beam) beam.visible = false;
        return;
      }

      const r = rigFor(p);
      const d = Math.abs(s - p.focusS);
      const isSel = p.photo.id === selectedId;
      const want = wanted.includes(p.photo.id);
      // Hysteresis so a lamp does not chatter at the threshold.
      if (!slot.on && want && (d < ON_AT || isSel)) { slot.on = true; slot.sinceOn = 0; }
      else if (slot.on && (!want || (d > OFF_AT && !isSel))) slot.on = false;
      slot.sinceOn += delta;

      // Strike: a couple of stutters in the first third of a second.
      let strike = 1;
      if (slot.on && slot.sinceOn < 0.34) {
        const t = slot.sinceOn;
        strike = 0.35 + 0.65 * (Math.sin(t * 61) * Math.sin(t * 37) > -0.15 ? 1 : 0.15);
      }
      const base = isSel ? 1.35 + focusAmount * 0.35 : 1;
      const dim = isSel ? 1 : 1 - focusAmount * 0.55;
      const goal = slot.on ? base * dim * strike : 0;
      slot.amount = THREE.MathUtils.damp(slot.amount, goal, goal > slot.amount ? 11 : 4, delta);
      const a = slot.amount;

      light.position.copy(r.lamp);
      targets[i].position.copy(r.target);
      targets[i].updateMatrixWorld();
      light.intensity = 30 * a;

      can.visible = true;
      can.position.copy(r.lamp);
      can.quaternion.copy(r.quat);
      lensMats[i].color.setRGB(0.1 + (lr - 0.1) * a, 0.1 + (lg - 0.1) * a, 0.1 + (lb - 0.1) * a);

      beam.visible = a > 0.004;
      beam.position.copy(r.mid);
      beam.quaternion.copy(r.quat);
      beam.scale.set(r.radius, r.length, r.radius);
      beamMats[i].uniforms.uOpacity.value = 0.14 * a;

      if (!slot.on && a < 0.01) slot.id = null; // fully dark: free for the next work
    });
  });

  return (
    <>
      {Array.from({ length: POOL }, (_, i) => (
        <group key={i}>
          {/* Always mounted, always visible: an invisible light would drop
              out of the count and trigger the recompile this pool avoids. */}
          <spotLight
            ref={(el) => { lights.current[i] = el; }}
            angle={0.46}
            penumbra={0.7}
            distance={9}
            decay={1.5}
            intensity={0}
            color={MOODS[FOYER_MOOD].lamp}
          />
          <group ref={(el) => { cans.current[i] = el; }} visible={false}>
            <mesh position={[0, 0.06, 0]}>
              <cylinderGeometry args={[0.075, 0.075, 0.22, 16]} />
              <meshStandardMaterial color="#141311" roughness={0.6} metalness={0.3} />
            </mesh>
            <mesh position={[0, -0.056, 0]} rotation={[Math.PI / 2, 0, 0]} material={lensMats[i]}>
              <circleGeometry args={[0.062, 16]} />
            </mesh>
          </group>
          <mesh
            ref={(el) => { beams.current[i] = el; }}
            geometry={beamGeo}
            material={beamMats[i]}
            renderOrder={2}
            visible={false}
          />
        </group>
      ))}
    </>
  );
}
