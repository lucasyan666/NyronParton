'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Placement } from '@/lib/layout';
import { peek, prefetch, release, request } from '@/lib/useProximityTexture';
import { getActiveWing, getCameraZ, getInFoyer } from '@/lib/cameraStore';
import { isOccluded } from '@/lib/occluders';
import { FrameLabel } from './FrameLabel';
import { createGlowMaterial } from '@/lib/glowMaterial';

/** Frame moulding depth and the mount's margin around the print. */
const FRAME_DEPTH = 0.045;
const MOULDING = 0.022;
const MOUNT = 0.075;

/** Past this the frame stops drawing; fog has swallowed it well before. */
const CULL = 34;
/** Thumbnails are cheap: warm them for anything this far ahead. */
const PREFETCH_THUMB = 120;
/** The full print is requested only when genuinely near... */
const PREFETCH = 60;
/** ...and released far beyond the cull, so a visible frame never loses it. */
const DROP = 95;

const GLOW_SPREAD = 3.0;
const LIFT_HOVER = 0.07;
const LIFT_HELD = 0.14;

type Props = {
  placement: Placement;
  revealed: boolean;
  dimmed: boolean;
  onSelect: (id: string) => void;
  /** This work's wing has a later room that crosses another wing's first. */
  crosses: boolean;
  ink?: string;
  inkDim?: string;
};

/**
 * Every work in the building is mounted once, at start-up, and decides each
 * frame whether to draw. Mounting works as you enter a room — materials,
 * labels, textures — was a source of hitches at every door.
 *
 *  · The chosen wing's works draw, except a later room that crosses another
 *    wing's first room, which waits until you are past the foyer.
 *  · Other wings show only their first room, only from the foyer, through
 *    their doors — and only at thumbnail resolution, which is all a glimpse
 *    through a doorway needs.
 */
function allowedNow(p: Placement, crosses: boolean) {
  const active = getActiveWing();
  const inFoyer = getInFoyer();
  if (p.wing === active) return p.roomIndex === 0 || !crosses || !inFoyer;
  return p.roomIndex === 0 && inFoyer;
}

function FrameImpl({ placement, revealed, dimmed, onSelect, crosses, ink, inkDim }: Props) {
  const { photo, position, rotationY, height } = placement;
  const width = height * photo.aspect;

  const group = useRef<THREE.Group>(null);
  const plate = useRef<THREE.Group>(null);
  const glow = useRef<THREE.Mesh>(null);
  const shadow = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);

  /** Unlit and untoned: the print renders exactly as shot. */
  const material = useMemo(
    () => new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, fog: true }),
    [],
  );

  const mountW = width + MOUNT * 2;
  const mountH = height + MOUNT * 2;
  const frameW = mountW + MOULDING * 2;
  const frameH = mountH + MOULDING * 2;

  /**
   * Two soft fields behind the frame, same falloff shader:
   *  - a contact shadow (normal blending, dark) that deepens as the plate lifts,
   *    which is what sells the lift as physical;
   *  - a faint warm glow (additive) for hover and selection.
   */
  const glowMaterial = useMemo(() => {
    const m = createGlowMaterial('#fff4e2');
    const inner = 0.5 / GLOW_SPREAD;
    m.uniforms.uInner.value.set(inner, inner);
    m.uniforms.uSoftness.value = (0.5 - inner) * 0.95;
    m.uniforms.uAspect.value = frameW / frameH;
    return m;
  }, [frameW, frameH]);

  const shadowMaterial = useMemo(() => {
    const m = createGlowMaterial('#2a2622', THREE.NormalBlending);
    const inner = 0.5 / 1.6;
    m.uniforms.uInner.value.set(inner, inner);
    m.uniforms.uSoftness.value = (0.5 - inner) * 0.95;
    m.uniforms.uAspect.value = frameW / frameH;
    m.uniforms.uOpacity.value = 0.22;
    return m;
  }, [frameW, frameH]);

  const visible = useRef(false);
  const holding = useRef(false);
  const warmed = useRef(false);
  const applied = useRef<THREE.Texture | null>(null);

  const level = useRef(0.86);
  const lift = useRef(0);
  const glowAmount = useRef(0);
  const shadowAmount = useRef(0.22);
  const emphasis = useRef(0);

  useEffect(() => {
    return () => {
      if (holding.current) release(photo.src);
      material.dispose();
      glowMaterial.dispose();
      shadowMaterial.dispose();
    };
  }, [material, glowMaterial, shadowMaterial, photo.src]);

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    const distance = revealed ? 0 : Math.abs(getCameraZ() - placement.focusS);
    const mine = placement.wing === getActiveWing();

    // Residency is decided BEFORE the cull check, so a culled frame is
    // already holding its texture by the time it comes back into view. Only
    // the chosen wing holds full prints; a doorway glimpse uses the thumb.
    if (!warmed.current && distance < PREFETCH_THUMB) {
      warmed.current = true;
      prefetch(photo.src);
    }
    if (!holding.current && mine && distance < PREFETCH) {
      holding.current = true;
      request(photo.src);
    } else if (holding.current && (!mine || distance > DROP)) {
      holding.current = false;
      release(photo.src);
    }

    // Best texture already on the GPU: full print, else thumb, else nothing.
    // The map define does not change once set, so this never recompiles.
    const tex = holding.current || warmed.current ? peek(photo.src) : null;
    if (tex !== applied.current) {
      const hadMap = applied.current !== null;
      applied.current = tex;
      material.map = tex;
      if (!hadMap || !tex) material.needsUpdate = true;
    }

    const shouldShow = allowedNow(placement, crosses) && distance <= CULL;
    if (shouldShow !== visible.current && group.current) {
      visible.current = shouldShow;
      group.current.visible = shouldShow;
    }
    if (!shouldShow) return;

    const active = revealed || hovered;

    // Brightness: full when active, a touch reserved at rest, receded while
    // another work leads.
    const levelTarget = revealed ? 1 : dimmed ? 0.42 : hovered ? 1 : 0.9;
    level.current = THREE.MathUtils.damp(level.current, levelTarget, 5, delta);
    material.color.setScalar(level.current);

    // Lift: out fast, settle slow, so it feels like weight.
    const liftTarget = revealed ? LIFT_HELD : hovered ? LIFT_HOVER : 0;
    lift.current = THREE.MathUtils.damp(
      lift.current, liftTarget, liftTarget > lift.current ? 6 : 3.5, delta,
    );
    // The label is always on the wall (museum style); emphasis brightens it.
    emphasis.current = THREE.MathUtils.damp(emphasis.current, active ? 1 : 0.42, 5, delta);

    if (plate.current) {
      plate.current.position.z = lift.current;
      const s = 1 + lift.current * 0.05;
      plate.current.scale.set(s, s, 1);
    }

    // Shadow deepens and spreads as the frame comes off the wall.
    const shadowTarget = 0.22 + lift.current * 0.7;
    shadowAmount.current = THREE.MathUtils.damp(shadowAmount.current, shadowTarget, 5, delta);
    shadowMaterial.uniforms.uOpacity.value = shadowAmount.current;
    if (shadow.current) {
      const sp = 1 + lift.current * 0.5;
      shadow.current.scale.set(sp, sp, 1);
      shadow.current.position.y = -0.03 - lift.current * 0.5;
    }

    // Glow: faint spill on a pale wall; breathes gently while held.
    const breathe = revealed ? 1 + Math.sin(performance.now() * 0.0016) * 0.09 : 1;
    const glowTarget = (revealed ? 0.06 : hovered ? 0.04 : 0) * breathe;
    glowAmount.current = THREE.MathUtils.damp(glowAmount.current, glowTarget, 5, delta);
    glowMaterial.uniforms.uOpacity.value = glowAmount.current;
    if (glow.current) {
      glow.current.visible = glowAmount.current > 0.002;
      const g = 1 + glowAmount.current * 0.08;
      glow.current.scale.set(g, g, 1);
    }
  });

  return (
    <group ref={group} position={position} rotation={[0, rotationY, 0]} visible={false}>
      {/* Stays on the wall while the plate lifts. The frame's back sits on
          the wall's face, so these lie a hair in front of it. */}
      <mesh ref={shadow} position={[0, -0.03, 0.002]} material={shadowMaterial} renderOrder={1}>
        <planeGeometry args={[frameW * 1.5, frameH * 1.5]} />
      </mesh>
      <mesh ref={glow} position={[0, 0, 0.004]} material={glowMaterial} visible={false} renderOrder={2}>
        <planeGeometry args={[frameW * GLOW_SPREAD, frameH * GLOW_SPREAD]} />
      </mesh>

      <group ref={plate}>
        {/* Thin dark moulding. */}
        <mesh position={[0, 0, FRAME_DEPTH / 2]} castShadow>
          <boxGeometry args={[frameW, frameH, FRAME_DEPTH]} />
          <meshStandardMaterial color="#1d1b18" roughness={0.55} metalness={0.08} />
        </mesh>
        {/* White mount, sitting just proud of the moulding's front face. */}
        <mesh position={[0, 0, FRAME_DEPTH + 0.001]}>
          <planeGeometry args={[mountW, mountH]} />
          <meshStandardMaterial color="#f7f5f0" roughness={0.95} metalness={0} />
        </mesh>
        <mesh
          position={[0, 0, FRAME_DEPTH + 0.003]}
          onClick={(e) => {
            // Raycasts ignore visibility and pass through walls: only a work
            // you can actually see may be opened.
            if (!visible.current || isOccluded(e.ray, e.distance)) return;
            e.stopPropagation();
            onSelect(photo.id);
          }}
          onPointerOver={(e) => {
            if (!visible.current || isOccluded(e.ray, e.distance)) return;
            e.stopPropagation();
            setHovered(true);
            document.body.style.cursor = 'pointer';
          }}
          onPointerOut={() => { setHovered(false); document.body.style.cursor = ''; }}
          material={material}
        >
          <planeGeometry args={[width, height]} />
        </mesh>

        <FrameLabel photo={photo} width={width} height={mountH} emphasisRef={emphasis} ink={ink} inkDim={inkDim} />
      </group>
    </group>
  );
}

export const Frame = memo(FrameImpl);
