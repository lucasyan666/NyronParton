'use client';

import { useEffect, useState } from 'react';
import { subscribeWarmup } from '@/lib/warmup';

/**
 * The loading screen. It is in the server-rendered page, so it is the first
 * thing painted on every load and every refresh, and it stays until the
 * gallery is genuinely ready: rooms built, every shader compiled, the
 * photographs on the GPU, and a couple of frames already drawn.
 *
 * The pulse and the progress bar are CSS (opacity and transform), which the
 * browser animates off the main thread — so they keep moving smoothly even
 * while the warm-up is doing heavy work underneath.
 *
 * The wordmark sits exactly where the landing page's name will be, so when
 * the screen fades the name stays put and the photograph appears around it.
 */
export function LoaderView({ progress = 0, leaving = false }: { progress?: number; leaving?: boolean }) {
  return (
    <div className={`loader ${leaving ? 'is-leaving' : ''}`} role="status" aria-live="polite" aria-busy={!leaving}>
      <span className="loader-mark">Nyron Parton</span>
      <div className="loader-foot">
        <span className="loader-bar" aria-hidden>
          <i style={{ transform: `scaleX(${Math.max(0.04, progress)})` }} />
        </span>
        <span className="loader-line">{leaving ? 'Welcome' : 'Preparing the rooms'}</span>
      </div>
    </div>
  );
}

/** Live version: follows the warm-up, fades out when it is done, then unmounts. */
export function Loader() {
  const [progress, setProgress] = useState(0);
  const [warm, setWarm] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => subscribeWarmup((p, w) => { setProgress(p); setWarm(w); }), []);
  useEffect(() => {
    if (!warm) return;
    const t = window.setTimeout(() => setGone(true), 950);
    return () => clearTimeout(t);
  }, [warm]);

  if (gone) return null;
  return <LoaderView progress={progress} leaving={warm} />;
}
