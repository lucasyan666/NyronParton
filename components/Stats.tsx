'use client';

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';

/**
 * Perf probe. With an EffectComposer in the loop, `gl.info` auto-resets on
 * every render call, so by the time anything reads it only the final
 * fullscreen pass remains ("1 call · 1 tris"). Auto-reset is switched off and
 * the counters are reset here once per frame, so they accumulate across all
 * passes and the numbers are real.
 */
export function Stats({ onSample }: { onSample: (line: string) => void }) {
  const { gl } = useThree();
  const frames = useRef(0);
  const last = useRef(performance.now());
  const calls = useRef(0);
  const tris = useRef(0);

  useEffect(() => {
    gl.info.autoReset = false;
    return () => { gl.info.autoReset = true; };
  }, [gl]);

  useFrame(() => {
    // Previous frame's totals, then reset for this one.
    calls.current = gl.info.render.calls;
    tris.current = gl.info.render.triangles;
    gl.info.reset();

    frames.current++;
    const now = performance.now();
    if (now - last.current >= 500) {
      const fps = (frames.current * 1000) / (now - last.current);
      onSample(`${fps.toFixed(0)} fps · ${calls.current} calls · ${tris.current.toLocaleString()} tris`);
      frames.current = 0;
      last.current = now;
    }
  }, -10);

  return null;
}
