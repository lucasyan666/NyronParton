'use client';

import { useEffect, useRef } from 'react';
import type { WingLayout } from '@/lib/layout';
import { PulseChevrons } from './RoomPicker';

/**
 * The end of a wing. It rises over the last few steps toward the door: the
 * way on to the next room, the way back to the foyer, and — after the last
 * room — the thank-you. Driven from a ref like the intro, so it costs no
 * renders as you walk.
 */
export function EndPanel({ progressRef, wing, next, onNext, onFoyer, light }: {
  /** 0..1 over the final stretch of the wing. */
  progressRef: React.MutableRefObject<number>;
  wing: WingLayout | null;
  next: WingLayout | null;
  onNext: () => void;
  onFoyer: () => void;
  light: boolean;
}) {
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    let raf = 0;
    let last = -1;
    const tick = () => {
      const el = root.current;
      const f = progressRef.current;
      if (el && f !== last) {
        last = f;
        el.style.setProperty('--f', String(f));
        el.style.visibility = f <= 0.001 ? 'hidden' : 'visible';
        // Not clickable until it has mostly arrived, so a stray click while
        // it rises cannot send you anywhere.
        el.style.pointerEvents = f > 0.6 ? 'auto' : 'none';
        // The HUD's bottom line and room tag give way to this panel.
        document.querySelector('.hud')?.classList.toggle('is-ending', f > 0.15);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [progressRef]);

  return (
    <footer className={`endpanel ${light ? 'is-light' : ''}`} ref={root} style={{ ['--f' as string]: 0, visibility: 'hidden' }}>
      {wing && next ? (
        <p className="end-line">
          End of <em>{wing.wing.title}</em>.
        </p>
      ) : (
        <p className="end-line">
          Thank you for walking through. <em>The prints are real; ask.</em>
        </p>
      )}

      <div className="end-actions">
        {next && (
          <button type="button" className="end-next" onClick={onNext}>
            <span>
              Next room <em>{next.wing.title}</em>
            </span>
            <PulseChevrons />
          </button>
        )}
        <button type="button" className="end-foyer" onClick={onFoyer}>
          Back to the foyer
        </button>
      </div>
      {next && <p className="end-hint">or keep scrolling</p>}

      <nav className="footer-links" aria-label="Contact and elsewhere">
        <a href="https://www.instagram.com/nyronparton" target="_blank" rel="noopener noreferrer">
          Instagram
        </a>
        <a href="https://www.instagram.com/nizprints" target="_blank" rel="noopener noreferrer">
          Prints
        </a>
        <a href="https://www.instagram.com/nyronparton" target="_blank" rel="noopener noreferrer" className="footer-book">
          Book a commission
        </a>
      </nav>
      <p className="footer-mark">Nyron Parton · Manchester</p>
    </footer>
  );
}
