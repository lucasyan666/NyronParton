'use client';

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import * as THREE from 'three';
import type { Photo } from '@/data/exhibition';

/**
 * Font for the 3D titles.
 *
 * Left unset, troika resolves a default over the network from jsDelivr, which
 * means the first hover title waits on a fetch. Drop a .ttf/.otf/.woff (NOT
 * woff2 — troika cannot parse it) into public/fonts/ and set this to its path
 * to remove that dependency and pick the face deliberately.
 *
 *   const TITLE_FONT = '/fonts/YourDisplay.woff';
 *
 * A condensed grotesque suits the rest of the type here.
 */
const TITLE_FONT = '/fonts/InstrumentSerif-Regular.ttf';
const META_FONT = '/fonts/InstrumentSerif-Italic.ttf';

/**
 * The hover title: real 3D text, parented to the plate so it lifts with it.
 *
 * drei's <Text> renders through troika as a signed-distance field, so it stays
 * crisp at any distance and any angle — unlike a texture atlas, and unlike DOM
 * text it cannot be occluded incorrectly or break the depth sort.
 *
 * The animation is driven from a ref rather than props: this runs every frame
 * and must never trigger a React render.
 */
export function FrameLabel({
  photo,
  width,
  height,
  emphasisRef,
  ink = '#e6e0d4',
  inkDim = '#a39c90',
}: {
  photo: Photo;
  width: number;
  height: number;
  /** 0..1 hover/selection weight, damped by the parent Frame. */
  emphasisRef: React.MutableRefObject<number>;
  ink?: string;
  inkDim?: string;
}) {
  const group = useRef<THREE.Group>(null);
  const titleRef = useRef<THREE.Mesh>(null);
  const metaRef = useRef<THREE.Mesh>(null);

  // Scale type to the print so a small photo does not get a huge caption.
  const size = THREE.MathUtils.clamp(height * 0.062, 0.075, 0.1);

  useFrame(() => {
    const e = emphasisRef.current;
    const g = group.current;
    if (!g) return;

    g.visible = e > 0.004;
    if (!g.visible) return;

    // Sits just below the frame's lower-left corner like a wall label;
    // lifts a touch and brightens as emphasis rises.
    g.position.y = -height / 2 - 0.12 - (1 - e) * 0.02;
    g.position.z = 0.01 + e * 0.03;

    // Elements stagger: rule first, then title, then the meta line. Each uses
    // its own slice of the 0..1 emphasis so they arrive in sequence.
    const stagger = (start: number, span: number) =>
      THREE.MathUtils.clamp((e - start) / span, 0, 1);

    const titleT = stagger(0.0, 0.7);
    const metaT = stagger(0.15, 0.7);

    if (titleRef.current) {
      const m = titleRef.current.material as THREE.Material;
      m.opacity = titleT;
      titleRef.current.position.x = -width / 2 + (1 - titleT) * -0.02;
    }
    if (metaRef.current) {
      const m = metaRef.current.material as THREE.Material;
      m.opacity = metaT;
      metaRef.current.position.x = -width / 2 + (1 - metaT) * -0.02;
    }
  });

  return (
    <group ref={group} visible={false}>
      <Text
        ref={titleRef as never}
        font={TITLE_FONT}
        position={[-width / 2, 0, 0]}
        anchorX="left"
        anchorY="middle"
        fontSize={size}
        letterSpacing={-0.01}
        color={ink}
        outlineWidth={0}
        maxWidth={width * 1.4}
        material-transparent
        material-opacity={0}
        material-toneMapped={false}
        material-depthWrite={false}
      >
        {photo.title}
      </Text>

      <Text
        ref={metaRef as never}
        font={META_FONT}
        position={[-width / 2, -size * 1.25, 0]}
        anchorX="left"
        anchorY="middle"
        fontSize={size * 0.62}
        letterSpacing={0.01}
        color={inkDim}
        outlineWidth={0}
        material-transparent
        material-opacity={0}
        material-toneMapped={false}
        material-depthWrite={false}
      >
        {[photo.year, photo.medium].filter(Boolean).join('  ·  ')}
      </Text>
    </group>
  );
}
