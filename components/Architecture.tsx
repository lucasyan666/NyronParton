'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { MeshReflectorMaterial, Text } from '@react-three/drei';
import { BOUNDS, CEILING, OFF, WING_LAYOUTS, type Segment, type WingLayout } from '@/lib/layout';
import { MOODS } from '@/lib/moods';
import { createConcrete } from '@/lib/concrete';
import { getActiveWing, getCameraZ, getInFoyer } from '@/lib/cameraStore';
import { reachable, registerOccluder } from '@/lib/occluders';
import { reportStage } from '@/lib/warmup';
import { WallText } from './WallText';
import { Foyer, type Maps } from './Foyer';
import { PulseArrow } from './PulseArrow';

export { CEILING };

/**
 * The building: the foyer, and the rooms of every wing, each room in its own
 * local frame.
 *
 * At a corner the inner wall stops short to open into the next room and the
 * outer wall runs on to close the corner, so the turn is the transition — no
 * wall to walk into. A wing's first room opens straight off the foyer; its
 * last ends at a door with the next room's light beyond it.
 *
 * What is drawn depends on where you are. In the foyer: every wing's first
 * room (you can see into them through their doors). Inside a wing: only that
 * wing. Wings fan apart, but a later room of one can pass where another
 * wing's first room stands; such pairs are never drawn together.
 *
 * Every room is mounted once, at start-up, and shown or hidden in the frame
 * loop. Nothing in the building mounts, unmounts or re-renders as you walk or
 * change room — that churn (new geometry, new materials, shader compiles)
 * was what made doors and corners stutter.
 */

const REVEAL = '#3a3733';
/** Board texture tile size in metres. */
const TILE_W = 3.2;
const TILE_H = 3.25;

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

function Wall({ maps, args, position, rotation, color, normal }: {
  maps: Maps;
  args: [number, number];
  position: [number, number, number];
  rotation?: [number, number, number];
  color: string;
  normal: number;
}) {
  const ns = useMemo(() => new THREE.Vector2(normal, normal), [normal]);
  const ref = useRef<THREE.Mesh>(null);
  useEffect(() => (ref.current ? registerOccluder(ref.current) : undefined), []);
  return (
    <mesh ref={ref} position={position} rotation={rotation}>
      <planeGeometry args={args} />
      <meshStandardMaterial map={maps.map} normalMap={maps.normalMap} roughnessMap={maps.roughnessMap} normalScale={ns} color={color} roughness={0.92} metalness={0} side={THREE.DoubleSide} />
    </mesh>
  );
}

/** Slightly over-white emissive strip; Bloom picks it up. */
function Cove({ length, position, rotation, color, width = 0.07 }: {
  length: number;
  position: [number, number, number];
  rotation?: [number, number, number];
  color: [number, number, number];
  width?: number;
}) {
  const c = useMemo(() => new THREE.Color(...color), [color]);
  return (
    <mesh position={position} rotation={rotation}>
      <planeGeometry args={[width, length]} />
      <meshBasicMaterial color={c} toneMapped={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

/** The end of a wing: a door standing open, light beyond, an arrow leading through. */
function EndDoor({ z, halfWidth, maps, wl, onNext, onFoyer }: {
  z: number;
  halfWidth: number;
  maps: Maps;
  wl: WingLayout;
  onNext: () => void;
  onFoyer: () => void;
}) {
  const w = 1.1, h = 2.2;
  const mood = MOODS[wl.mood];
  const panelW = halfWidth + OFF - w / 2;
  const next = WING_LAYOUTS[wl.index + 1] ?? null;
  // The light beyond the door is the colour of the room it leads to.
  const beyond = next ? MOODS[next.mood].portal : ([1.32, 1.26, 1.14] as [number, number, number]);
  const glow = useMemo(() => new THREE.Color(beyond[0] * 0.85, beyond[1] * 0.85, beyond[2] * 0.85), [beyond]);
  // Clicks reach invisible things too, so act only for the wing you are in.
  const go = () => {
    if (getActiveWing() !== wl.index || getInFoyer()) return;
    (next ? onNext : onFoyer)();
  };
  const arrow = useRef<THREE.Group>(null);
  useFrame(() => {
    if (arrow.current) arrow.current.visible = getActiveWing() === wl.index && !getInFoyer();
  });

  return (
    <group position={[0, 0, z]}>
      {[-1, 1].map((s) => (
        <Wall key={s} maps={maps} args={[panelW, CEILING]} position={[s * (w / 2 + panelW / 2), CEILING / 2, 0]} color={mood.wallTint} normal={mood.walls === 'boards' ? 0.75 : 0.25} />
      ))}
      <Wall maps={maps} args={[w + 0.02, CEILING - h]} position={[0, h + (CEILING - h) / 2, 0]} color={mood.wallTint} normal={mood.walls === 'boards' ? 0.75 : 0.25} />
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
      <mesh position={[0, CEILING / 2, -1.6]}>
        <planeGeometry args={[halfWidth * 2 + 2, CEILING]} />
        <meshBasicMaterial color={glow} toneMapped={false} />
      </mesh>

      <Text font="/fonts/InstrumentSerif-Italic.ttf" fontSize={0.12} letterSpacing={0.18} color={mood.inkDim} anchorX="center" anchorY="bottom" position={[0, h + 0.5, 0.02]}>
        {next ? 'NEXT ROOM' : 'EXIT'}
      </Text>
      <Text font="/fonts/InstrumentSerif-Regular.ttf" fontSize={0.2} color={mood.ink} anchorX="center" anchorY="bottom" position={[0, h + 0.2, 0.02]} maxWidth={3.4} textAlign="center">
        {next ? next.wing.title : 'Back to the foyer'}
      </Text>

      <group ref={arrow} visible={false}>
        <PulseArrow position={[0, 0, 2.6]} onActivate={go} />
      </group>
      {/* Hit area: never drawn, still clickable (raycasts ignore visibility). */}
      <mesh
        position={[0, h / 2, 0.02]}
        visible={false}
        onClick={(e) => { if (!reachable(e)) return; e.stopPropagation(); go(); }}
        onPointerOver={(e) => {
          if (getActiveWing() !== wl.index || !reachable(e)) return;
          e.stopPropagation();
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => { document.body.style.cursor = ''; }}
      >
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial />
      </mesh>
    </group>
  );
}

function RoomGroup({ seg, wl, maps, onNext, onFoyer }: {
  seg: Segment;
  wl: WingLayout;
  maps: Maps;
  onNext: () => void;
  onFoyer: () => void;
}) {
  const group = useRef<THREE.Group>(null);
  const mid = seg.s0 + seg.length / 2;
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const active = getActiveWing();
    const inFoyer = getInFoyer();
    const show = wl.index === active
      ? seg.roomIndex === 0 || !inFoyer || !wl.crosses
      : seg.roomIndex === 0 && inFoyer;
    // Distance window along the walk (in the foyer every walk shares the spine).
    g.visible = show && Math.abs(getCameraZ() - mid) <= seg.length / 2 + 26;
  });
  const { halfWidth: hw, length, turnIn, turnOut, prevHalf, nextHalf, roomIndex, textSide } = seg;
  const mood = MOODS[wl.mood];
  const normal = mood.walls === 'boards' ? 0.75 : 0.25;

  const walls = ([-1, 1] as const).map((side) => {
    const innerIn = turnIn === (side === -1 ? 'left' : 'right');
    const innerOut = turnOut === (side === -1 ? 'left' : 'right');
    // A first room starts at the foyer wall. After a turn both walls start
    // past the corner square: the inner one where the previous room's wall
    // ends, the outer one where the previous room's corner wall ends — that
    // corner wall is drawn by the previous room, so it closes the view down
    // that room even when this one is not drawn (from the foyer, say).
    void innerIn;
    const zStart = roomIndex === 0 ? 0 : -(prevHalf + OFF);
    const zEnd = turnOut ? (innerOut ? -(length - nextHalf - OFF) : -(length + nextHalf + OFF)) : -length;
    return { side, zStart, zEnd };
  });

  const span = (walls[0].zStart - walls[0].zEnd + walls[1].zStart - walls[1].zEnd) / 2;
  const local = useMemo(() => clone(maps, Math.max(0.5, span / TILE_W), CEILING / TILE_H), [maps, span]);
  const endMaps = useMemo(() => clone(maps, (hw * 2 + 0.6) / TILE_W, CEILING / TILE_H), [maps, hw]);

  // Ceiling: across the room and the corner square it turns out through.
  // The square it turned in through belongs to the previous room.
  const zBack = roomIndex === 0 ? 0 : -(prevHalf + OFF);
  const zFront = turnOut ? -(length + nextHalf + OFF) : -(length + 1.8);
  const ceilW = (hw + OFF) * 2;
  const ceilD = zBack - zFront;

  return (
    <group ref={group} visible={false} position={[seg.origin[0], 0, seg.origin[1]]} rotation={[0, seg.heading, 0]}>
      {walls.map(({ side, zStart, zEnd }) => {
        const len = zStart - zEnd;
        const zc = (zStart + zEnd) / 2;
        const rot: [number, number, number] = [0, (side * -Math.PI) / 2, 0];
        return (
          <group key={side}>
            <Wall maps={local} args={[len, CEILING]} position={[side * (hw + OFF), CEILING / 2, zc]} rotation={rot} color={mood.wallTint} normal={normal} />
            <Cove length={len} position={[side * (hw + 0.24), CEILING - 0.02, zc]} rotation={[Math.PI / 2, 0, 0]} color={mood.cove} />
            <mesh position={[side * (hw + 0.27), 0.035, zc]} rotation={rot}>
              <planeGeometry args={[len, 0.07]} />
              <meshBasicMaterial color={mood.light ? '#b9b3a8' : '#0d0c0b'} side={THREE.DoubleSide} />
            </mesh>
          </group>
        );
      })}

      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, CEILING, (zBack + zFront) / 2]}>
        <planeGeometry args={[ceilW, ceilD]} />
        <meshStandardMaterial color={mood.ceiling} roughness={1} side={THREE.DoubleSide} />
      </mesh>

      {mood.floor && (
        // Lifted clear of the reflective floor so the two never z-fight at a distance.
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, (zBack + zFront) / 2]} receiveShadow>
          <planeGeometry args={[ceilW, ceilD]} />
          <meshStandardMaterial color={mood.floor} roughness={0.55} metalness={0} polygonOffset polygonOffsetFactor={-1} />
        </mesh>
      )}

      {/* The corner wall: the far side of the square this room turns out
          through — the wall you walk toward before the turn. */}
      {turnOut && (
        <group position={[0, 0, -(length + nextHalf + OFF)]}>
          <Wall maps={endMaps} args={[(hw + OFF) * 2, CEILING]} position={[0, CEILING / 2, 0]} color={mood.wallTint} normal={normal} />
          <Cove length={(hw + OFF) * 2} position={[0, CEILING - 0.02, 0.06]} rotation={[Math.PI / 2, 0, Math.PI / 2]} color={mood.cove} />
          <mesh position={[0, 0.035, 0.03]}>
            <planeGeometry args={[(hw + OFF) * 2, 0.07]} />
            <meshBasicMaterial color={mood.light ? '#b9b3a8' : '#0d0c0b'} side={THREE.DoubleSide} />
          </mesh>
        </group>
      )}

      {textSide !== 0 && seg.room && (
        <WallText
          room={seg.room}
          index={roomIndex}
          position={[textSide * (hw + 0.28), 0, -1.0]}
          rotationY={(textSide * -Math.PI) / 2}
          top={CEILING * 0.6}
          ink={mood.ink}
          inkDim={mood.inkDim}
        />
      )}

      {!turnOut && (
        <EndDoor z={-length} halfWidth={hw} maps={endMaps} wl={wl} onNext={onNext} onFoyer={onFoyer} />
      )}
    </group>
  );
}

/**
 * The floor reflection's blur. It must be one stable array: drei's reflector
 * lists `blur` among its memo dependencies, so an inline `[300, 90]` — a new
 * array on every render — made it build fresh render targets and a new blur
 * pass on each re-render, without freeing the old ones. That was a GPU
 * allocation every time the page re-rendered as you walked, and a leak.
 */
const FLOOR_BLUR: [number, number] = [300, 90];

/** Memoised: its props are stable, and nothing here needs the parent's renders. */
export const Architecture = memo(function Architecture({ onEnter, onNext, onFoyer, onBuilt }: {
  onEnter: (wing: number) => void;
  onNext: () => void;
  onFoyer: () => void;
  /** Called once every room is mounted, for the warm-up to compile them. */
  onBuilt?: () => void;
}) {
  /*
   * Wall surfaces, generated straight away: the loading screen covers this,
   * so there is no reason to wait for idle time and every reason to have the
   * building complete before the shaders are compiled. Board-marked concrete
   * for the foyer and concrete rooms; smooth plaster (tinted dark or pale)
   * for noir and gallery rooms, only if any wing uses one.
   */
  const needSmooth = useMemo(() => WING_LAYOUTS.some((wl) => MOODS[wl.mood].walls === 'smooth'), []);
  const [boards, setBoards] = useState<Maps | null>(null);
  const [smooth, setSmooth] = useState<Maps | null>(null);
  useEffect(() => {
    let cancelled = false;
    // One per task, so the loading screen's progress can move in between.
    const t1 = window.setTimeout(() => {
      if (cancelled) return;
      setBoards(createConcrete({ seed: 3, base: '#5a564f', boards: 6, tieCols: 3, tieRows: 4, streak: 0.45, amplitude: 0.75, size: 512 }));
      reportStage('walls', needSmooth ? 0.5 : 1);
    }, 0);
    const t2 = needSmooth
      ? window.setTimeout(() => {
          if (cancelled) return;
          setSmooth(createConcrete({ seed: 5, base: '#d6d1c6', boards: 0, tieCols: 0, tieRows: 0, streak: 0.06, amplitude: 0.22, size: 512 }));
          reportStage('walls', 1);
        }, 30)
      : 0;
    return () => { cancelled = true; clearTimeout(t1); clearTimeout(t2); };
  }, [needSmooth]);

  const floor = useMemo(() => {
    const m = 4;
    return {
      w: BOUNDS.maxX - BOUNDS.minX + m * 2,
      d: BOUNDS.maxZ - BOUNDS.minZ + m * 2,
      x: (BOUNDS.minX + BOUNDS.maxX) / 2,
      z: (BOUNDS.minZ + BOUNDS.maxZ) / 2,
    };
  }, []);

  const built = !!boards && (!needSmooth || !!smooth);
  const announced = useRef(false);
  useEffect(() => {
    if (!built || announced.current) return;
    announced.current = true;
    // Next frame: the whole tree is committed by then.
    const raf = requestAnimationFrame(() => onBuilt?.());
    return () => cancelAnimationFrame(raf);
  }, [built, onBuilt]);

  if (!built) return null;

  return (
    <group>
      {/* Floor: polished, dark enough to hold a reflection of the prints. A
          fixed resolution: changing it rebuilds the material mid-walk. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[floor.x, 0, floor.z]}>
        <planeGeometry args={[floor.w, floor.d]} />
        <MeshReflectorMaterial
          resolution={384}
          blur={FLOOR_BLUR}
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

      <Foyer maps={boards!} onEnter={onEnter} />

      {WING_LAYOUTS.map((wl) =>
        wl.rooms.map((seg) => (
          <RoomGroup
            key={`${wl.index}-${seg.roomIndex}`}
            seg={seg}
            wl={wl}
            maps={MOODS[wl.mood].walls === 'boards' ? boards! : smooth!}
            onNext={onNext}
            onFoyer={onFoyer}
          />
        )),
      )}
    </group>
  );
});
