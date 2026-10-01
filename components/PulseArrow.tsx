'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { createGlowMaterial } from '@/lib/glowMaterial';

/**
 * A way in: three chevrons on the floor, pointing through a door, with a
 * pulse that travels toward it — the floor itself saying "this way".
 *
 * Unlit and additive in an over-bright colour, so the bloom pass gives it a
 * soft halo without any extra lights. Clickable over a generous area: the
 * chevrons alone are a small target from across a room.
 */

const CHEVRONS = 3;
const SPACING = 0.38;

/** A "^" chevron in shape space (+y = forward), uniform thickness. */
function chevronShape(w = 0.46, h = 0.3, t = 0.15) {
  const s = new THREE.Shape();
  s.moveTo(-w, 0);
  s.lineTo(0, h);
  s.lineTo(w, 0);
  s.lineTo(w, -t);
  s.lineTo(0, h - t);
  s.lineTo(-w, -t);
  s.closePath();
  return s;
}

export function PulseArrow({
  position,
  rotationY = 0,
  color = [2.2, 0.95, 0.52],
  scale = 1,
  onActivate,
  visible = true,
}: {
  position: [number, number, number];
  /** World Y rotation; the arrow points along its local −z. */
  rotationY?: number;
  /** HDR colour: above 1.0 the bloom pass picks it up. */
  color?: [number, number, number];
  scale?: number;
  onActivate?: () => void;
  visible?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const geometry = useMemo(() => new THREE.ShapeGeometry(chevronShape()), []);
  const colorKey = color.join(',');

  const materials = useMemo(
    () =>
      Array.from({ length: CHEVRONS }, () =>
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(...color),
          transparent: true,
          opacity: 0.3,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [colorKey],
  );

  const pad = useMemo(() => {
    const m = createGlowMaterial('#ffffff');
    m.uniforms.uColor.value = new THREE.Color(color[0] * 0.5, color[1] * 0.5, color[2] * 0.5);
    m.uniforms.uInner.value.set(0.06, 0.12);
    m.uniforms.uSoftness.value = 0.36;
    m.uniforms.uAspect.value = 0.8;
    m.uniforms.uHollow.value = 0;
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorKey]);

  useEffect(() => () => {
    geometry.dispose();
    materials.forEach((m) => m.dispose());
    pad.dispose();
  }, [geometry, materials, pad]);

  const boost = useRef(1);
  const group = useRef<THREE.Group>(null);

  useFrame((state, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    boost.current = THREE.MathUtils.damp(boost.current, hovered ? 1.7 : 1, 8, delta);
    const t = state.clock.elapsedTime;

    // A wave running back-to-front, sharpened so each chevron flashes in turn.
    materials.forEach((m, i) => {
      const wave = 0.5 + 0.5 * Math.sin(t * 3.2 - i * 0.95);
      m.opacity = Math.min(1, (0.16 + 0.84 * wave ** 3) * boost.current);
    });
    pad.uniforms.uOpacity.value = (0.07 + 0.05 * Math.sin(t * 3.2)) * boost.current;

    // A breath of scale, so even a still frame reads as alive.
    if (group.current) {
      const b = scale * (1 + 0.035 * Math.sin(t * 1.6));
      group.current.scale.set(b, b, b);
    }
  });

  return (
    <group position={position} rotation={[0, rotationY, 0]} visible={visible}>
      <group ref={group}>
        {/* Lie flat: shape +y maps to world −z, so the chevrons point forward. */}
        <group rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
          {materials.map((m, i) => (
            <mesh key={i} geometry={geometry} material={m} position={[0, (i - 1) * SPACING, 0]} renderOrder={3} />
          ))}
        </group>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]} material={pad} renderOrder={2}>
          <planeGeometry args={[1.9, 2.2]} />
        </mesh>
      </group>

      {/* Click target: far bigger than the chevrons. */}
      {onActivate && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.02, 0]}
          onClick={(e) => { e.stopPropagation(); onActivate(); }}
          onPointerOver={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = 'pointer'; }}
          onPointerOut={() => { setHovered(false); document.body.style.cursor = ''; }}
        >
          <planeGeometry args={[1.8, 2.2]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}
