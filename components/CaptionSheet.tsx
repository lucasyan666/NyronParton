'use client';

import { useEffect, useRef } from 'react';
import type { Placement } from '@/lib/layout';
import { setSheetShare } from '@/lib/cameraStore';

/**
 * The description on a portrait screen.
 *
 * On a wide screen it hangs in 3D beside the print (Caption.tsx); beside the
 * print is off the edge of a phone. Here it swings up from the bottom of the
 * screen instead, and the camera frames the print in the space above it: the
 * sheet measures how much of the screen it covers and the camera reads that.
 */
export function CaptionSheet({ placement, onClose }: { placement: Placement; onClose: () => void }) {
  const { photo } = placement;
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => {
      // Against the canvas, which runs under a phone's toolbars (see .stage).
      const stage = document.querySelector<HTMLElement>('.stage');
      const h = stage?.clientHeight || window.innerHeight;
      // offsetTop ignores the entrance transform, so this is the resting place.
      setSheetShare((h - el.offsetTop + 14) / h);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [photo.id]);

  const meta = [photo.year, photo.medium, photo.place].filter(Boolean).join(' · ');

  return (
    <aside ref={root} className="sheet" key={photo.id} aria-live="polite">
      <button type="button" className="sheet-close" onClick={onClose} aria-label="Close">
        <span aria-hidden>×</span>
      </button>
      {meta && <p className="label-meta">{meta}</p>}
      <h2 className="label-title">{photo.title}</h2>
      <div className="label-rule" />
      {photo.caption && <p className="label-caption">{photo.caption}</p>}
    </aside>
  );
}
