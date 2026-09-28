'use client';

import { useEffect, useRef } from 'react';

/**
 * The end of the walk. Discreet: a line, three links, and the name. It rises
 * over the last room as the scroll runs out and stays out of the way until
 * then. Driven from a ref like the intro, so it costs no renders.
 */
export function Footer({
  progressRef,
}: {
  /** 0..1 over the final stretch of the walk. */
  progressRef: React.MutableRefObject<number>;
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
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [progressRef]);

  return (
    <footer className="footer" ref={root} style={{ ['--f' as string]: 0 }}>
      <p className="footer-line">
        Thank you for walking through. <em>The prints are real; ask.</em>
      </p>
      <nav className="footer-links" aria-label="Contact and elsewhere">
        <a href="https://www.instagram.com/nyronparton" target="_blank" rel="noopener noreferrer">
          Instagram
        </a>
        <a href="https://www.instagram.com/nizprints" target="_blank" rel="noopener noreferrer">
          Prints
        </a>
        <a
          href="https://www.instagram.com/nyronparton"
          target="_blank"
          rel="noopener noreferrer"
          className="footer-book"
        >
          Book a commission
        </a>
      </nav>
      <p className="footer-mark">Nyron Parton · Manchester</p>
    </footer>
  );
}
