'use client';

import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { MeshReflectorMaterial, Text } from '@react-three/drei';
import { BOUNDS, SEGMENTS, VESTIBULE, type Segment } from '@/lib/layout';
import { createConcrete } from '@/lib/concrete';
import { getCameraZ, subscribeBucket } from '@/lib/cameraStore';
import { WallText } from './WallText';

/**
 * The building, one room at a time, each in its own local frame.
 *
 * At a corner the inner wall stops short to open into the next room and the
 * outer wall runs on to close the corner; the next room's outer wall begins
 * behind its own origin to form the wall you faced while approaching. No
 * doorway panels, no end walls to walk into — the turn is the transition.
 * The first room has a vestibule behind the entrance; the last ends at an
 * open door with light beyond it.
 */

export const CEILING = 3.9;
const WALL = '#a29a8c';
const REVEAL = '#3a3733';
const PLASTER_NORMAL = 0.75;
/** Wall faces sit this far outside the room's half-width. */
const OFF = 0.3;

type Maps = { map: THREE.Texture; normalMap: THREE.Texture; roughnessMap: THREE.Texture; aoMap: THREE.Texture };

function clone(t: Maps, rx: number, ry: number): Maps {
  const out = {} as Maps;
  (Object.keys(t) as (keyof Maps)[]).forEach((k) => {
    const c = t[k].clone();
    c.needsUpdate = true;
    c.wrapS = c.wrapT = THREE.RepeatWrapping;
    c.repeat.set(rx, ry);
    out[k] = c;
  });
  return out;
}

function Wall({ maps, args, position, rotation, side, color = WALL }: {
  maps: Maps;
  args: [number, number];
  position: [number, number, number];
  rotation?: [number, number, number];
  side?: THREE.Side;
  color?: string;
}) {
  const ns = useMemo(() => new THREE.Vector2(PLASTER_NORMAL, PLASTER_NORMAL), []);
  return (
    <mesh receiveShadow position={position} rotation={rotation}>
      <planeGeometry args={args} />
      <meshStandardMaterial map={maps.map} normalMap={maps.normalMap} roughnessMap={maps.roughnessMap} normalScale={ns} color={color} roughness={0.92} metalness={0} side={side ?? THREE.DoubleSide} />
    </mesh>
  );
}

/** Slightly over-white emissive strip; Bloom picks it up. */
function Cove({ length, position, rotation, width = 0.07 }: {
  length: number;
  position: [number, number, number];
  rotation?: [number, number, number];
  width?: number;
}) {
  const c = useMemo(() => new THREE.Color(1.32, 1.18, 0.94), []);
  return (
    <mesh position={position} rotation={rotation}>
      <planeGeometry args={[width, length]} />
      <meshBasicMaterial color={c} toneMapped={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

/** One side wall with its cove and skirting gap, from zStart down to zEnd. */
function SideWall({ side, x, zStart, zEnd, maps }: { side: -1 | 1; x: number; zStart: number; zEnd: number; maps: Maps }) {
  const len = zStart - zEnd;
  const zc = (zStart + zEnd) / 2;
  const rot: [number, number, number] = [0, (side * -Math.PI) / 2, 0];
  return (
    <>
      <Wall maps={maps} args={[len, CEILING]} position={[side * (x + OFF), CEILING / 2, zc]} rotation={rot} />
      <Cove length={len} position={[side * (x + 0.24), CEILING - 0.02, zc]} rotation={[Math.PI / 2, 0, 0]} />
      <mesh position={[side * (x + 0.27), 0.035, zc]} rotation={rot}>
        <planeGeometry args={[len, 0.07]} />
        <meshBasicMaterial color="#0d0c0b" side={THREE.DoubleSide} />
      </mesh>
    </>
  );
}

/** The way out: a wall with an open door and light beyond. */
function ExitDoor({ z, halfWidth, maps }: { z: number; halfWidth: number; maps: Maps }) {
  const w = 1.1, h = 2.2;
  const panelW = halfWidth + 0.3 - w / 2;
  const glow = useMemo(() => new THREE.Color(1.32, 1.26, 1.14), []);
  return (
    <group position={[0, 0, z]}>
      {[-1, 1].map((s) => (
        <Wall key={s} maps={maps} args={[panelW, CEILING]} position={[s * (w / 2 + panelW / 2), CEILING / 2, 0]} />
      ))}
      <Wall maps={maps} args={[w + 0.02, CEILING - h]} position={[0, h + (CEILING - h) / 2, 0]} />
      {/* reveals */}
      {[-1, 1].map((s) => (
        <mesh key={`r${s}`} position={[s * (w / 2), h / 2, -0.16]} rotation={[0, (s * -Math.PI) / 2, 0]}>
          <planeGeometry args={[0.32, h]} />
          <meshStandardMaterial color={REVEAL} roughness={1} side={THREE.DoubleSide} />
        </mesh>
      ))}
      <mesh position={[0, h, -0.16]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[w, 0.32]} />
        <meshStandardMaterial color={REVEAL} roughness={1} side={THREE.DoubleSide} />
      </mesh>
      {/* door leaf, swung open into the light */}
      <group position={[-w / 2, 0, -0.3]} rotation={[0, -1.15, 0]}>
        <mesh position={[w / 2, h / 2, 0]} castShadow>
          <boxGeometry args={[w, h, 0.045]} />
          <meshStandardMaterial color="#151311" roughness={0.6} metalness={0.1} />
        </mesh>
      </group>
      {/* what lies beyond: light */}
      <mesh position={[0, CEILING / 2, -1.6]}>
        <planeGeometry args={[halfWidth * 2 + 2, CEILING]} />
        <meshBasicMaterial color={glow} toneMapped={false} />
      </mesh>
      <Text font="/fonts/InstrumentSerif-Italic.ttf" fontSize={0.13} letterSpacing={0.16} color="#b9b2a5" anchorX="center" anchorY="bottom" position={[0, h + 0.22, 0.02]}>
        EXIT
      </Text>
    </group>
  );
}

function RoomGroup({ seg, maps, endMaps, cameraS }: { seg: Segment; maps: Maps; endMaps: Maps; cameraS: number }) {
  const { halfWidth: hw, length, turnIn, turnOut, prevHalf, nextHalf } = seg;
  const mid = seg.s0 + length / 2;
  if (Math.abs(cameraS - mid) > length / 2 + 26) return null;

  const walls = ([-1, 1] as const).map((side) => {
    const innerIn = turnIn === (side === -1 ? 'left' : 'right');
    const innerOut = turnOut === (side === -1 ? 'left' : 'right');
    // Corner joins: the inner wall stops at the previous/next room's wall
    // face, the outer wall runs to meet the other outer wall face.
    const zStart = turnIn ? (innerIn ? -(prevHalf + OFF) : prevHalf + OFF) : VESTIBULE;
    const zEnd = turnOut ? (innerOut ? -(length - nextHalf - OFF) : -(length + nextHalf + OFF)) : -length;
    return { side, zStart, zEnd };
  });

  // Wall text goes on the wall that starts earliest: the left wall in the
  // first room, otherwise the outer wall of the turn you came round.
  const textSide: -1 | 1 = turnIn ? (turnIn === 'left' ? 1 : -1) : -1;
  const textZ = (turnIn ? -0.2 : 0) - 1.3;

  return (
    <group position={[seg.origin[0], 0, seg.origin[1]]} rotation={[0, seg.heading, 0]}>
      {walls.map((w) => (
        <SideWall key={w.side} side={w.side} x={hw} zStart={w.zStart} zEnd={w.zEnd} maps={maps} />
      ))}

      {!turnIn && (
        <>
          <Wall maps={endMaps} args={[hw * 2 + 0.6, CEILING]} position={[0, CEILING / 2, VESTIBULE + 0.3]} />
          <Cove length={hw * 2 + 0.5} position={[0, CEILING - 0.02, VESTIBULE + 0.24]} rotation={[Math.PI / 2, 0, Math.PI / 2]} />
        </>
      )}

      <WallText
        room={seg.room}
        index={seg.index}
        position={[textSide * (hw + 0.28), 0, textZ]}
        rotationY={(textSide * -Math.PI) / 2}
        top={CEILING * 0.6}
      />

      {!turnOut && <ExitDoor z={-length} halfWidth={hw} maps={endMaps} />}
    </group>
  );
}

export function Architecture() {
  const [cameraS, setCameraS] = useState(() => getCameraZ());
  useEffect(() => subscribeBucket(setCameraS), []);

  /*
   * The reflective floor renders the whole scene a second time, every frame.
   * During warm-up that doubles the GPU cost of something nobody can see yet,
   * which showed up as the largest remaining item in the startup profile. So
   * it begins at a quarter resolution and steps up to full once the first
   * frames are behind us — by which point the visitor is still reading.
   */
  const [reflectRes, setReflectRes] = useState(128);
  useEffect(() => {
    const t = window.setTimeout(() => setReflectRes(512), 1200);
    return () => clearTimeout(t);
  }, []);

  // Plaster relief, generated at idle. Nothing is drawn until it exists; the
  // hero covers the viewport for that first stretch of scroll.
  const [plaster, setPlaster] = useState<Maps | null>(null);
  useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      // Board-marked concrete, dark. Shuttering seams and tie holes come back;
      // under the stage lights they are what makes the wall a wall.
      setPlaster(createConcrete({ seed: 3, base: '#5a564f', boards: 6, tieCols: 3, tieRows: 4, streak: 0.45, amplitude: 0.75, size: 512 }));
    };
    const w = window as typeof window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };
    // A short timeout, not a long one: the walls are the first thing seen,
    // and at 512px the generator is quick enough to sit inside the warm-up.
    const h = w.requestIdleCallback ? w.requestIdleCallback(run, { timeout: 400 }) : window.setTimeout(run, 120);
    return () => { cancelled = true; w.cancelIdleCallback ? w.cancelIdleCallback(h) : clearTimeout(h); };
  }, []);

  const rooms = useMemo(() => {
    if (!plaster) return [];
    return SEGMENTS.map((seg) => ({
      seg,
      maps: clone(plaster, (seg.length + VESTIBULE) / 3.2, 1.2),
      endMaps: clone(plaster, (seg.halfWidth * 2 + 0.6) / 3.2, 1.2),
    }));
  }, [plaster]);

  const floor = useMemo(() => {
    const m = 6;
    const w = BOUNDS.maxX - BOUNDS.minX + m * 2;
    const d = BOUNDS.maxZ - BOUNDS.minZ + m * 2;
    return { w, d, x: (BOUNDS.minX + BOUNDS.maxX) / 2, z: (BOUNDS.minZ + BOUNDS.maxZ) / 2 };
  }, []);

  if (!plaster) return null;

  return (
    <group>
      {/* Floor: polished, dark enough to hold a reflection of the prints. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[floor.x, 0, floor.z]} receiveShadow>
        <planeGeometry args={[floor.w, floor.d]} />
        <MeshReflectorMaterial
          resolution={reflectRes}
          blur={[400, 120]}
          mixBlur={1}
          mixStrength={0.9}
          mixContrast={1}
          mirror={0.55}
          roughness={0.8}
          depthScale={0.8}
          minDepthThreshold={0.5}
          maxDepthThreshold={1.2}
          color="#1f1d1a"
          metalness={0.08}
        />
      </mesh>

      <mesh rotation={[Math.PI / 2, 0, 0]} position={[floor.x, CEILING, floor.z]}>
        <planeGeometry args={[floor.w, floor.d]} />
        <meshStandardMaterial color="#1c1a18" roughness={1} />
      </mesh>

      {rooms.map(({ seg, maps, endMaps }) => (
        <RoomGroup key={seg.room.id} seg={seg} maps={maps} endMaps={endMaps} cameraS={cameraS} />
      ))}
    </group>
  );
}
