'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { Placement } from '@/lib/layout';
import { getCameraZ } from '@/lib/cameraStore';
import { createBeamMaterial } from '@/lib/beamMaterial';
import { CEILING } from './Architecture';

/** Path distance at which a lamp strikes on, and the further one at which it goes dark. */
const ON_AT = 6.5;
const OFF_AT = 8.8;

/**
 * One stage light per print: a can on the ceiling in front of the work, a
 * real SpotLight aimed at it, a visible beam, and a lens that glows.
 *
 * It switches on as you approach — fast attack with a brief strike flicker,
 * like a lamp coming up — and fades when you have moved on. The mounted set
 * is wider than the on/off band, so a lamp is always ready before it is
 * needed and never pops into existence lit.
 */
export function StageLight({ placement, selected, focusAmount }: {
  placement: Placement;
  selected: boolean;
  focusAmount: number;
}) {
  const { photo, position, rotationY, height } = placement;
  const { scene } = useThree();

  // Geometry: the lamp sits on the ceiling, out from the wall in front of
  // the print, aimed down at its centre.
  const nx = Math.sin(rotationY), nz = Math.cos(rotationY);
  const lamp = useMemo(() => new THREE.Vector3(position[0] + nx * 1.25, CEILING - 0.14, position[2] + nz * 1.25), [position, nx, nz]);
  const target = useMemo(() => new THREE.Vector3(position[0], position[1], position[2]), [position]);
  const dir = useMemo(() => new THREE.Vector3().subVectors(lamp, target), [lamp, target]);
  const length = dir.length();
  const quat = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize()), [dir]);
  const mid = useMemo(() => new THREE.Vector3().addVectors(lamp, target).multiplyScalar(0.5), [lamp, target]);
  const radius = Math.max(0.5, height * 0.62 * photo.aspect ** 0.25);

  const light = useRef<THREE.SpotLight>(null);
  const targetObj = useMemo(() => new THREE.Object3D(), []);
  const beam = useMemo(() => createBeamMaterial('#ffd9a3'), []);
  const lens = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.35, 0.95), toneMapped: false }), []);

  useEffect(() => {
    targetObj.position.copy(target);
    targetObj.updateMatrixWorld();
    scene.add(targetObj);
    if (light.current) light.current.target = targetObj;
    return () => { scene.remove(targetObj); beam.dispose(); lens.dispose(); };
  }, [scene, targetObj, target, beam, lens]);

  const amount = useRef(0);
  const on = useRef(false);
  const sinceOn = useRef(10);

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    const d = Math.abs(getCameraZ() - placement.focusS);

    // Hysteresis so a lamp does not chatter at the threshold.
    if (!on.current && (d < ON_AT || selected)) { on.current = true; sinceOn.current = 0; }
    else if (on.current && d > OFF_AT && !selected) on.current = false;
    sinceOn.current += delta;

    // Strike: a couple of stutters in the first third of a second.
    let strike = 1;
    if (on.current && sinceOn.current < 0.34) {
      const t = sinceOn.current;
      strike = 0.35 + 0.65 * (Math.sin(t * 61) * Math.sin(t * 37) > -0.15 ? 1 : 0.15);
    }

    const base = selected ? 1.35 + focusAmount * 0.35 : 1;
    const dim = selected ? 1 : 1 - focusAmount * 0.55;
    const goal = on.current ? base * dim * strike : 0;
    amount.current = THREE.MathUtils.damp(amount.current, goal, goal > amount.current ? 11 : 4, delta);

    const a = amount.current;
    if (light.current) light.current.intensity = 30 * a;
    beam.uniforms.uOpacity.value = 0.14 * a;
    lens.color.setRGB(0.12 + 1.5 * a, 0.1 + 1.25 * a, 0.08 + 0.88 * a);
  });

  return (
    <group>
      <spotLight ref={light} position={lamp} angle={0.46} penumbra={0.7} distance={9} decay={1.5} intensity={0} color="#ffe6c4" />

      {/* the can, aimed along the beam */}
      <group position={lamp} quaternion={quat}>
        <mesh position={[0, 0.06, 0]}>
          <cylinderGeometry args={[0.075, 0.075, 0.22, 16]} />
          <meshStandardMaterial color="#141311" roughness={0.6} metalness={0.3} />
        </mesh>
        <mesh position={[0, -0.056, 0]} rotation={[Math.PI / 2, 0, 0]} material={lens}>
          <circleGeometry args={[0.062, 16]} />
        </mesh>
      </group>

      {/* the beam */}
      <mesh position={mid} quaternion={quat} material={beam} renderOrder={2}>
        <coneGeometry args={[radius, length, 28, 1, true]} />
      </mesh>
    </group>
  );
}
