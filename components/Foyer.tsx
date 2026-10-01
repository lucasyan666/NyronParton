'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
import { Text } from '@react-three/drei';
import { DOOR_H, DOOR_W, FOYER, WING_LAYOUTS, type WingLayout } from '@/lib/layout';
import { FOYER_MOOD, MOODS } from '@/lib/moods';
import { createGlowMaterial } from '@/lib/glowMaterial';
import { PulseArrow } from './PulseArrow';

/**
 * The foyer: a tall concrete hall with one door per wing in its far wall.
 *
 * Each door carries its room's title above it, a thin frame of light in that
 * room's colour — warm for concrete, cool for noir, white for gallery — a
 * spill of the same light across the floor in front of it, and a pulsing
 * arrow leading in. The rooms beyond are dark until you enter: their lamps
 * strike on as you walk through.
 */

const SERIF = '/fonts/InstrumentSerif-Regular.ttf';
const ITALIC = '/fonts/InstrumentSerif-Italic.ttf';
const REVEAL = '#2c2a27';
const JAMB_DEPTH = 0.42;
/** One tile of the board texture is this tall/wide in metres. */
const TILE_W = 3.2;
const TILE_H = 3.25;

export type Maps = { map: THREE.Texture; normalMap: THREE.Texture; roughnessMap: THREE.Texture; aoMap: THREE.Texture };

/**
 * A flat wall panel. Its texture is pinned to the wall rather than to the
 * panel: repeat follows the panel's size and offset follows its position, so
 * the board lines run on unbroken across the panels around each door.
 */
function Panel({ maps, w, h, position, rotationY = 0, tint, u0 = 0, v0 = 0 }: {
  maps: Maps;
  w: number;
  h: number;
  position: [number, number, number];
  rotationY?: number;
  tint: string;
  /** Where this panel starts along the wall and up from the floor, in metres. */
  u0?: number;
  v0?: number;
}) {
  const local = useMemo(() => {
    const out = {} as Maps;
    (Object.keys(maps) as (keyof Maps)[]).forEach((k) => {
      const c = maps[k].clone();
      c.needsUpdate = true;
      c.wrapS = c.wrapT = THREE.RepeatWrapping;
      c.repeat.set(w / TILE_W, h / TILE_H);
      c.offset.set(u0 / TILE_W, v0 / TILE_H);
      out[k] = c;
    });
    return out;
  }, [maps, w, h, u0, v0]);
  const ns = useMemo(() => new THREE.Vector2(0.75, 0.75), []);
  if (w <= 0.01 || h <= 0.01) return null;
  return (
    <mesh position={position} rotation={[0, rotationY, 0]} receiveShadow>
      <planeGeometry args={[w, h]} />
      <meshStandardMaterial
        map={local.map}
        normalMap={local.normalMap}
        roughnessMap={local.roughnessMap}
        normalScale={ns}
        color={tint}
        roughness={0.92}
        metalness={0}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

/** Thin over-bright strip; the bloom pass turns it into a line of light. */
function Strip({ w, h, position, rotation, color }: {
  w: number;
  h: number;
  position: [number, number, number];
  rotation?: [number, number, number];
  color: [number, number, number];
}) {
  const c = useMemo(() => new THREE.Color(...color), [color]);
  return (
    <mesh position={position} rotation={rotation}>
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial color={c} toneMapped={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

/** Soft light on the floor in front of a door, in the colour of the room beyond. */
function Spill({ x, z, color }: { x: number; z: number; color: [number, number, number] }) {
  const material = useMemo(() => {
    const m = createGlowMaterial('#ffffff');
    m.uniforms.uColor.value = new THREE.Color(color[0] * 0.55, color[1] * 0.55, color[2] * 0.55);
    m.uniforms.uInner.value.set(0.16, 0.05);
    m.uniforms.uSoftness.value = 0.3;
    m.uniforms.uAspect.value = 1.1;
    m.uniforms.uOpacity.value = 0.16;
    m.uniforms.uHollow.value = 0;
    return m;
  }, [color]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.004, z]} material={material} renderOrder={1}>
      <planeGeometry args={[DOOR_W * 2.2, 4.4]} />
    </mesh>
  );
}

function Door({ wl, maps, onEnter, showArrow }: {
  wl: WingLayout;
  maps: Maps;
  onEnter: (wing: number) => void;
  showArrow: boolean;
}) {
  const x = wl.doorX;
  const z = -FOYER.depth;
  const mood = MOODS[wl.mood];
  const ink = MOODS[FOYER_MOOD];
  const portal = mood.portal;
  const label = `ROOM ${String(wl.index + 1).padStart(2, '0')}`;
  const count = wl.placements.length;
  const subtitle = wl.wing.subtitle ? `${wl.wing.subtitle}` : `${count} works`;

  return (
    <group>
      {/* Jambs and soffit: the wall has thickness, so the opening reads as a doorway. */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[x + s * (DOOR_W / 2), DOOR_H / 2, z - JAMB_DEPTH / 2]} rotation={[0, (s * -Math.PI) / 2, 0]}>
          <planeGeometry args={[JAMB_DEPTH, DOOR_H]} />
          <meshStandardMaterial color={REVEAL} roughness={1} side={THREE.DoubleSide} />
        </mesh>
      ))}
      <mesh position={[x, DOOR_H, z - JAMB_DEPTH / 2]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[DOOR_W, JAMB_DEPTH]} />
        <meshStandardMaterial color={REVEAL} roughness={1} side={THREE.DoubleSide} />
      </mesh>

      {/* A frame of light around the opening, in this room's colour. */}
      {[-1, 1].map((s) => (
        <Strip key={`p${s}`} w={0.04} h={DOOR_H + 0.08} position={[x + s * (DOOR_W / 2 + 0.07), (DOOR_H + 0.08) / 2, z + 0.012]} color={portal} />
      ))}
      <Strip w={DOOR_W + 0.18} h={0.04} position={[x, DOOR_H + 0.07, z + 0.012]} color={portal} />

      <Spill x={x} z={z + 1.7} color={portal} />

      {/* Click anywhere in the opening, too: the arrow is not the only way in. */}
      <mesh
        position={[x, DOOR_H / 2, z + 0.02]}
        onClick={(e) => { e.stopPropagation(); onEnter(wl.index); }}
        onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { document.body.style.cursor = ''; }}
      >
        <planeGeometry args={[DOOR_W, DOOR_H]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      <Text font={ITALIC} fontSize={0.11} letterSpacing={0.2} color="#e0663d" anchorX="center" anchorY="bottom" position={[x, DOOR_H + 1.16, z + 0.02]}>
        {label}
      </Text>
      <Text font={SERIF} fontSize={0.42} letterSpacing={-0.012} color={ink.ink} anchorX="center" anchorY="bottom" textAlign="center" maxWidth={5.2} position={[x, DOOR_H + 0.62, z + 0.02]}>
        {wl.wing.title}
      </Text>
      <Text font={ITALIC} fontSize={0.145} lineHeight={1.3} color={ink.inkDim} anchorX="center" anchorY="top" textAlign="center" maxWidth={3.8} position={[x, DOOR_H + 0.5, z + 0.02]}>
        {subtitle}
      </Text>

      <PulseArrow
        position={[x, 0, z + 1.75]}
        rotationY={0}
        visible={showArrow}
        onActivate={showArrow ? () => onEnter(wl.index) : undefined}
      />
    </group>
  );
}

export function Foyer({ maps, onEnter, showArrows }: {
  maps: Maps;
  onEnter: (wing: number) => void;
  /** Arrows hide once you are inside a wing; they are behind you then. */
  showArrows: boolean;
}) {
  const { depth: D, halfWidth: HW, back: B, height: H } = FOYER;
  const tint = MOODS[FOYER_MOOD].wallTint;
  const cove = MOODS[FOYER_MOOD].cove;
  const ceiling = MOODS[FOYER_MOOD].ceiling;

  // Far-wall panels between the openings, plus a lintel over each.
  const farPanels = useMemo(() => {
    const xs = WING_LAYOUTS.map((w) => w.doorX).sort((a, b) => a - b);
    const out: { x0: number; x1: number }[] = [];
    let cursor = -HW;
    for (const x of xs) {
      out.push({ x0: cursor, x1: x - DOOR_W / 2 });
      cursor = x + DOOR_W / 2;
    }
    out.push({ x0: cursor, x1: HW });
    return out.filter((p) => p.x1 - p.x0 > 0.01);
  }, [HW]);

  const depthTotal = D + B;
  const zMid = (B - D) / 2;

  return (
    <group>
      {/* Far wall, in pieces around the doors */}
      {farPanels.map((p, i) => (
        <Panel key={`f${i}`} maps={maps} w={p.x1 - p.x0} h={H} position={[(p.x0 + p.x1) / 2, H / 2, -D]} tint={tint} u0={p.x0 + HW} />
      ))}
      {WING_LAYOUTS.map((wl) => (
        <Panel
          key={`l${wl.index}`}
          maps={maps}
          w={DOOR_W}
          h={H - DOOR_H}
          position={[wl.doorX, DOOR_H + (H - DOOR_H) / 2, -D]}
          tint={tint}
          u0={wl.doorX - DOOR_W / 2 + HW}
          v0={DOOR_H}
        />
      ))}

      {/* Side walls and the back wall */}
      {[-1, 1].map((s) => (
        <Panel key={`s${s}`} maps={maps} w={depthTotal} h={H} position={[s * HW, H / 2, zMid]} rotationY={(s * -Math.PI) / 2} tint={tint} />
      ))}
      <Panel maps={maps} w={HW * 2} h={H} position={[0, H / 2, B]} rotationY={Math.PI} tint={tint} />

      {/* Ceiling, higher than the rooms', with cove light along every edge */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, H, zMid]}>
        <planeGeometry args={[HW * 2, depthTotal]} />
        <meshStandardMaterial color={ceiling} roughness={1} side={THREE.DoubleSide} />
      </mesh>
      {[-1, 1].map((s) => (
        <Strip key={`c${s}`} w={0.07} h={depthTotal} position={[s * (HW - 0.06), H - 0.02, zMid]} rotation={[Math.PI / 2, 0, 0]} color={cove} />
      ))}
      <Strip w={HW * 2} h={0.07} position={[0, H - 0.02, -D + 0.06]} rotation={[Math.PI / 2, 0, 0]} color={cove} />

      {/* Shadow gap at the skirting */}
      {[-1, 1].map((s) => (
        <mesh key={`g${s}`} position={[s * (HW - 0.01), 0.035, zMid]} rotation={[0, (s * -Math.PI) / 2, 0]}>
          <planeGeometry args={[depthTotal, 0.07]} />
          <meshBasicMaterial color="#0d0c0b" side={THREE.DoubleSide} />
        </mesh>
      ))}

      {/* Light for the far wall and its labels */}
      <pointLight position={[0, H - 0.5, -D + 4]} intensity={16} distance={26} decay={1.35} color="#ffe6cc" />

      {WING_LAYOUTS.map((wl) => (
        <Door key={wl.index} wl={wl} maps={maps} onEnter={onEnter} showArrow={showArrows} />
      ))}
    </group>
  );
}
