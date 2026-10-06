'use client';

import { useEffect, useState } from 'react';
import { subscribeWarmup } from '@/lib/warmup';
import { getMotion } from '@/lib/motion';
import { LITE, TOUCH } from '@/lib/device';

/**
 * `?debug` on the URL: a small panel of what the page is doing, for phones,
 * where there is no console to look at. A screenshot of it says what went
 * wrong. Errors are collected from the moment this module loads.
 */
const log: string[] = [];
const push = (s: string) => {
  log.push(s.slice(0, 220));
  if (log.length > 10) log.shift();
};
if (typeof window !== 'undefined' && window.location.search.includes('debug')) {
  window.addEventListener('error', (e) => push(`error: ${e.message} (${(e.filename || '').split('/').pop()}:${e.lineno})`));
  window.addEventListener('unhandledrejection', (e) =>
    push(`rejected: ${String((e.reason as Error)?.message ?? e.reason)}`),
  );
  const original = console.error;
  console.error = (...args: unknown[]) => {
    push(`console: ${args.map(String).join(' ')}`);
    original(...args);
  };
}

function gpuName() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    const name = info ? String(gl!.getParameter(info.UNMASKED_RENDERER_WEBGL)) : gl ? 'webgl2 (no name)' : 'no webgl2';
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch {
    return 'unknown';
  }
}

export function DebugPanel() {
  const [, setTick] = useState(0);
  const [warm, setWarm] = useState('0%');
  const [fps, setFps] = useState(0);
  const [gpu, setGpu] = useState('');

  useEffect(() => setGpu(gpuName()), []);
  useEffect(() => subscribeWarmup((p, w) => setWarm(w ? 'warm' : `${Math.round(p * 100)}%`)), []);
  useEffect(() => {
    let n = 0;
    let t0 = performance.now();
    let raf = 0;
    const frame = (t: number) => {
      n++;
      if (t - t0 >= 1000) {
        setFps(Math.round((n * 1000) / (t - t0)));
        n = 0;
        t0 = t;
        setTick((x) => x + 1);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const m = getMotion();
  const deg = (r: number) => Math.round((r * 180) / Math.PI);
  return (
    <pre className="debug" aria-hidden>
      {[
        `warm-up ${warm} · ${fps} fps · scroll ${Math.round(typeof window !== 'undefined' ? window.scrollY : 0)}`,
        `${typeof window !== 'undefined' ? `${innerWidth}×${innerHeight} @${devicePixelRatio}x` : ''} · touch ${TOUCH} · lite ${LITE}`,
        `motion ${m.on ? (m.fresh ? `on ${deg(m.yaw)}° ${deg(m.pitch)}°` : 'on, no readings yet') : 'off'}`,
        `gpu ${gpu}`,
        ...(log.length ? log : ['no errors']),
      ].join('\n')}
    </pre>
  );
}
