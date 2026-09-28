'use client';

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Html } from '@react-three/drei';
import type { Placement } from '@/lib/layout';

/**
 * The description panel, in 3D space beside the print.
 *
 * The body copy is DOM rather than 3D text: it must be selectable, readable by
 * assistive tech, and set with real typographic control. `Html transform`
 * keeps it pinned in perspective so it still belongs to the wall.
 *
 * The entrance is a genuine 3D move — the panel swings in around its left
 * edge, from a steep angle, while lines stagger up behind it. Everything is
 * driven from a ref inside useFrame, so none of it costs a React render.
 */
export function Caption({
  placement,
  amountRef,
}: {
  placement: Placement;
  /** Live focus value 0..1, damped by the Scene. */
  amountRef: React.MutableRefObject<number>;
}) {
  const { photo, position, rotationY, height } = placement;
  const width = height * photo.aspect;

  const group = useRef<THREE.Group>(null);
  const el = useRef<HTMLDivElement>(null);

  // Anchor to the right of the print, aligned to its top edge. The offset runs
  // along the wall, so it has to be rotated with the frame.
  const pos = useMemo<[number, number, number]>(() => {
    const alongX = Math.cos(rotationY);
    const alongZ = -Math.sin(rotationY);
    const gap = width / 2 + 0.78;
    return [
      position[0] + alongX * gap,
      position[1] + height / 2 - 0.15,
      position[2] + alongZ * gap,
    ];
  }, [position, rotationY, width, height]);

  useFrame(() => {
    const a = amountRef.current;
    const g = group.current;
    if (!g) return;

    g.visible = a > 0.004;
    if (!g.visible) return;

    /*
     * Swing in around the panel's left edge. The pivot is the group origin, so
     * rotating Y here reads as a page turning toward the viewer rather than a
     * flat slide — the part that makes it feel three-dimensional.
     */
    const ease = 1 - Math.pow(1 - a, 3);
    g.rotation.y = rotationY + (1 - ease) * -1.15;
    g.position.z = pos[2] + (1 - ease) * 0.5 * Math.cos(rotationY);
    g.position.x = pos[0] + (1 - ease) * 0.5 * Math.sin(rotationY);
    g.scale.setScalar(0.94 + ease * 0.06);

    const node = el.current;
    if (node) {
      node.style.opacity = String(Math.min(1, a * 1.4));
      // Feed the stagger to CSS so each line can lift on its own delay.
      node.style.setProperty('--reveal', String(ease));
    }
  });

  return (
    <group ref={group} position={pos} rotation={[0, rotationY, 0]} visible={false}>
      <Html
        transform
        occlude={false}
        distanceFactor={2.5}
        zIndexRange={[10, 0]}
        style={{ pointerEvents: 'none' }}
      >
        <div ref={el} className="label" style={{ opacity: 0 }}>
          <p className="label-meta">
            {[photo.year, photo.medium, photo.place].filter(Boolean).join(' · ')}
          </p>
          <h2 className="label-title">{photo.title}</h2>
          <div className="label-rule" />
          <p className="label-caption">{photo.caption}</p>
        </div>
      </Html>
    </group>
  );
}
