'use client';

import { useEffect, useRef } from 'react';
import { midOf, thumbOf } from '@/data/exhibition';

/**
 * The entry: a full-bleed photograph, the name, one line, and a way in.
 *
 * As you scroll, the image drifts and dissolves, the name settles into the
 * top corner where it stays as the wordmark, and a short profile rises over
 * the room as the camera approaches the first hang. Everything is driven by
 * one scroll value written to a CSS custom property — no transitions with
 * their own clock, so it tracks the scroll exactly and reverses cleanly.
 */
export function Intro({
  progressRef,
  heroSrc,
  onEnter,
}: {
  /** Intro progress 0..1, updated by the scroll handler. */
  progressRef: React.MutableRefObject<number>;
  /** The hero photograph. */
  heroSrc: string;
  /** Scrolls to the start of the walk. */
  onEnter: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    let last = -1;
    const tick = () => {
      const el = root.current;
      const p = progressRef.current;
      if (el && p !== last) {
        last = p;
        el.style.setProperty('--p', String(p));
        el.style.visibility = p >= 0.999 ? 'hidden' : 'visible';
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [progressRef]);

  return (
    <div className="intro" ref={root} style={{ ['--p' as string]: 0 }}>
      <div className="hero" aria-hidden>
        {/*
          * Three candidates so the browser can pick one that suits the
          * viewport. `src` is the mid step, not the full size: with
          * sizes="100vw" a 2048w-only srcSet made most displays fetch the
          * largest file, and some browsers fetched `src` as well — two
          * 641 KB requests for one background.
          */}
        <img
          className="hero-media"
          src={midOf(heroSrc)}
          srcSet={`${thumbOf(heroSrc)} 400w, ${midOf(heroSrc)} 1280w, ${heroSrc} 2048w`}
          sizes="(max-width: 900px) 100vw, 1280px"
          alt=""
          decoding="async"
          fetchPriority="high"
        />
        <div className="hero-grain" />
        <div className="hero-vignette" />
      </div>

      <div className="intro-mark">
        <h1 className="intro-name">Nyron Parton</h1>
      </div>

      <div className="hero-copy">
        <p className="hero-line">
          Step into the light — <em>a moving exhibition of film photography.</em>
        </p>
        <button className="hero-cta" type="button" onClick={onEnter}>
          <span>Enter</span>
          <span className="hero-cta-line" />
        </button>
      </div>

      <div className="intro-body">
        <p className="intro-lead" data-i="0">
          Nights, friends, and the places in between.
        </p>
        <div className="intro-cols">
          <div className="intro-col" data-i="1">
            <span className="intro-key">Practice</span>
            <p>
              Shot on film. Dancefloors, back rooms, long walks in unfamiliar
              cities — the people I am actually with.
            </p>
          </div>
          <div className="intro-col" data-i="2">
            <span className="intro-key">Based</span>
            <p>Manchester and the West Midlands. Available for commissions and prints.</p>
          </div>
          <div className="intro-col" data-i="3">
            <span className="intro-key">Elsewhere</span>
            <p>
              <span className="intro-handle">@nyronparton</span> on Instagram.
              Prints at <span className="intro-handle">@nizprints</span>. Zines,
              occasionally.
            </p>
          </div>
        </div>
      </div>

      <div className="intro-cue" data-i="4">
        <span>Scroll</span>
        <span className="intro-cue-line" />
      </div>
    </div>
  );
}
