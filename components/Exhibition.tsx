'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import dynamic from 'next/dynamic';
import Lenis from 'lenis';
import { ALL_PHOTOS, HERO_SRC } from '@/data/exhibition';
import { warmAllThumbs } from '@/lib/useProximityTexture';
import {
  INTRO_FRACTION,
  WALK_LENGTH,
  WALK_ORDER,
  introProgress,
  progressForS,
  roomAtS,
} from '@/lib/layout';
import { getCameraZ } from '@/lib/cameraStore';
import { Hud } from './Hud';
import { Intro } from './Intro';
import { Footer } from './Footer';

/**
 * The 3D scene — three.js, the post-processing stack, troika — is by far the
 * heaviest thing on the page, and none of it is needed to paint the hero.
 *
 * It is therefore NOT loaded on the first scroll: waiting for intent put the
 * whole cost (bundle, WebGL init, shader compilation, procedural plaster,
 * first textures) directly in the path of the gesture, which read as a
 * 2-second stall the moment you moved. Instead the hero paints first, then
 * the scene mounts on its own a beat later, hidden behind the hero, and warms
 * up while you are reading. By the time you scroll it is already running.
 */
const Scene = dynamic(() => import('./Scene').then((m) => m.Scene), { ssr: false });

/** Scroll page height. More pixels per world unit = a slower, calmer walk. */
const PIXELS_PER_UNIT = 130;
/** The footer rises over this last slice of the scroll. */
const FOOTER_FRACTION = 0.05;

export function Exhibition() {
  const progress = useRef(0);
  const lenisRef = useRef<Lenis | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [room, setRoom] = useState(roomAtS(0));

  // Scroll-driven values stay in refs and are written straight to the DOM.
  // As state they re-rendered Exhibition → Scene → every Frame per event.
  const progressBar = useRef<HTMLDivElement>(null);
  const intro = useRef(0);
  const footer = useRef(0);
  const inIntro = useRef(true);
  const [chromeVisible, setChromeVisible] = useState(false);
  /** True once the visitor has actually moved. */
  const [started, setStarted] = useState(false);
  const [ready, setReady] = useState(false);
  const readyRef = useRef(false);
  /** Re-applies the scroll mapping; set once Lenis is constructed. */
  const applyScroll = useRef<(() => void) | null>(null);
  /** Starts background thumbnail warming, once the scene has drawn. */
  const warmWhenReady = useRef<(() => void) | null>(null);
  const [wantScene, setWantScene] = useState(false);
  const [stats, setStats] = useState<string | null>(null);
  /** -1, 0 or 1: the held walk key. */
  const walking = useRef(0);
  /** Current selection, for handlers bound once on mount. */
  const selectedRef = useRef<string | null>(null);
  const showStats =
    typeof window !== 'undefined' && window.location.search.includes('stats');

  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.5,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      touchMultiplier: 1.6,
    });
    lenisRef.current = lenis;

    let raf = 0;
    const loop = (time: number) => {
      lenis.raf(time);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const onScroll = ({ progress: rawP }: { progress: number }) => {
      let p = rawP;
      /*
       * Until the scene can draw, hold the walk just short of the threshold.
       * The intro still scrolls and the hero still moves, so the page never
       * feels stuck — but you cannot arrive in a room that is not ready yet,
       * which is what made the entrance jitter. `readyRef` flips on the
       * scene's first frame, and `catchUp` then releases the hold.
       */
      if (!readyRef.current) p = Math.min(p, INTRO_FRACTION * 0.92);
      progress.current = p;
      intro.current = introProgress(p);
      footer.current = Math.max(0, Math.min(1, (p - (1 - FOOTER_FRACTION)) / FOOTER_FRACTION));

      if (progressBar.current) {
        const walk = Math.max(0, (p - INTRO_FRACTION) / (1 - INTRO_FRACTION));
        progressBar.current.style.transform = `scaleY(${walk})`;
      }

      if (p > 0.004) setStarted(true);
      const past = p > INTRO_FRACTION * 0.82;
      if (past === inIntro.current) {
        inIntro.current = !past;
        setChromeVisible(past);
      }
    };
    lenis.on('scroll', onScroll);
    // Let readiness re-run the mapping without reaching for private API.
    applyScroll.current = () => onScroll({ progress: lenis.progress });

    // Dev hook for the screenshot harness: jump the scroll without smoothing.
    if (process.env.NODE_ENV !== 'production') {
      (window as unknown as { __nyronScroll: (p: number) => void }).__nyronScroll = (p) =>
        lenis.scrollTo(p * lenis.limit, { immediate: true });
    }

    return () => {
      cancelAnimationFrame(raf);
      lenis.destroy();
      lenisRef.current = null;
    };
  }, []);

  /**
   * Holding a work freezes the walk. Lenis keeps running its rAF loop (so the
   * camera's own damping still settles into the focus pose) but stops
   * consuming wheel and touch, and the keyboard walk is cleared — otherwise
   * you can scroll straight past the thing you just opened.
   */
  const heldScroll = useRef(0);
  useEffect(() => {
    selectedRef.current = selectedId;
    const lenis = lenisRef.current;
    if (!lenis) return;

    if (selectedId) {
      walking.current = 0;
      heldScroll.current = lenis.scroll;
      lenis.stop();
      /*
       * lenis.stop() blocks wheel and touch but not a programmatic scroll, a
       * keyboard PageDown, or a browser scroll restore. Any of those would
       * leave the page somewhere else, so Escape would drop you far from the
       * work you were looking at. Snap the page back for as long as the work
       * is held.
       */
      const pin = () => {
        if (Math.abs(window.scrollY - heldScroll.current) > 1) {
          window.scrollTo(0, heldScroll.current);
        }
      };
      window.addEventListener('scroll', pin, { passive: true });
      return () => window.removeEventListener('scroll', pin);
    }

    lenis.start();
  }, [selectedId]);

  /** Scroll so the camera stands at path distance s. */
  const goToZ = useCallback((s: number, duration = 1.4) => {
    const lenis = lenisRef.current;
    if (!lenis) return;
    lenis.scrollTo(progressForS(s) * lenis.limit, { duration });
  }, []);

  /*
   * Start DOWNLOADING the scene chunk immediately, in parallel with the hero
   * image. It is ~860 KB of three.js and is by far the longest pole: measured
   * cold, fetching and parsing it took ~2.9 s, while actually drawing the
   * first room took 144 ms. Kicking the import off at mount (rather than
   * after first paint) overlaps that download with the hero, so it is usually
   * finished before anyone scrolls.
   *
   * This only warms the module cache; mounting still waits for first paint
   * below, so the download never competes with the hero for main-thread time.
   */
  useEffect(() => {
    void import('./Scene').then(() => {
      if (process.env.NODE_ENV !== 'production') {
        (window as unknown as { __nyronSceneLoaded: boolean }).__nyronSceneLoaded = true;
      }
    });

    /*
     * Warm every thumbnail from the DOM layer, not from inside the Canvas.
     * These are ~23 KB each — the whole show is less than one full print —
     * and having them resident means no frame is ever blank when you walk
     * into a room. Running it here starts it alongside the hero rather than
     * waiting for WebGL to come up, which is why it previously never ran at
     * all on a fast load.
     */
    /*
     * Deliberately late, and only once the scene has drawn. Started earlier
     * these 24 small requests contend with the 675 KB scene chunk for the
     * connection, which measurably delayed the first frame — the thing the
     * visitor is actually waiting for.
     */
    let t = 0;
    const kick = () => {
      t = window.setTimeout(() => {
        void warmAllThumbs(ALL_PHOTOS.map((p) => p.src));
      }, 400);
    };
    if (readyRef.current) kick();
    else warmWhenReady.current = kick;
    return () => clearTimeout(t);
  }, []);

  /*
   * Mount the scene shortly after the hero has painted. Two frames of
   * headroom let the hero image decode and the first paint land, then the
   * canvas comes up behind it and warms up while the visitor reads. Any
   * earlier intent short-circuits the wait.
   */
  useEffect(() => {
    if (wantScene) return;
    /*
     * flushSync so the scene tree mounts in one synchronous commit. Left to
     * React's concurrent scheduler this state change is low priority: the
     * canvas element commits quickly, then the expensive subtree underneath
     * it renders in a later slice — measured as ~1.8 s during which the
     * canvas existed but WebGL had not been initialised. Nothing is on
     * screen yet (the hero covers it), so a long synchronous commit here
     * costs the visitor nothing and gets the warm-up genuinely started.
     */
    const go = () => flushSync(() => setWantScene(true));

    /*
     * One frame, not two plus a timer. The old gate cost ~440 ms of pure
     * waiting between the hero painting and the canvas mounting — measured,
     * and buying nothing: the hero is already on screen and covers the canvas
     * completely, so the scene can start setting up immediately behind it.
     */
    let raf1 = 0;
    const raf2 = 0, timer = 0;
    raf1 = requestAnimationFrame(go);

    const opts: AddEventListenerOptions = { passive: true, once: true };
    const events = ['wheel', 'touchstart', 'keydown', 'scroll', 'pointerdown'] as const;
    events.forEach((e) => window.addEventListener(e, go, opts));

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, go));
    };
  }, [wantScene]);

  const enter = useCallback(() => {
    setWantScene(true);
    const lenis = lenisRef.current;
    if (!lenis) return;
    lenis.scrollTo(INTRO_FRACTION * lenis.limit, { duration: 1.8 });
  }, []);

  /**
   * Keyboard, game-style: hold W / ↑ to walk forward and S / ↓ to walk back;
   * J / → and K / ← jump to the next or previous work; Enter opens the
   * nearest; Escape closes. Walking is a held key driving the scroll each
   * frame, so it goes through the same damping as the wheel and feels the
   * same.
   */
  useEffect(() => {
    let raf = 0;
    const step = () => {
      const lenis = lenisRef.current;
      if (lenis && walking.current !== 0) {
        lenis.scrollTo(lenis.scroll + walking.current * 11, { immediate: true });
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);

    const onUp = (e: KeyboardEvent) => {
      if (['w', 'W', 'ArrowUp', 's', 'S', 'ArrowDown'].includes(e.key)) walking.current = 0;
    };
    const onKey = (e: KeyboardEvent) => {
      const z = getCameraZ();
      const next = () => WALK_ORDER.find((p) => p.focusS > z + 1.5);
      const prev = () => [...WALK_ORDER].reverse().find((p) => p.focusS < z - 1.5);

      switch (e.key) {
        case 'Escape':
          setSelectedId(null);
          break;
        case 'w': case 'W': case 'ArrowUp':
          if (selectedRef.current) break;
          e.preventDefault(); setWantScene(true); walking.current = 1; break;
        case 's': case 'S': case 'ArrowDown':
          if (selectedRef.current) break;
          e.preventDefault(); walking.current = -1; break;
        case 'ArrowRight':
        case 'j': {
          if (selectedRef.current) break;
          e.preventDefault();
          const p = next();
          if (p) goToZ(p.focusS);
          break;
        }
        case 'ArrowLeft':
        case 'k': {
          if (selectedRef.current) break;
          e.preventDefault();
          const p = prev();
          if (p) goToZ(p.focusS);
          break;
        }
        case 'Enter': {
          let best: (typeof WALK_ORDER)[number] | null = null;
          let bestD = 12;
          for (const p of WALK_ORDER) {
            const d = Math.abs(p.focusS - z);
            if (d < bestD) { bestD = d; best = p; }
          }
          if (best) setSelectedId((cur) => (cur === best!.photo.id ? null : best!.photo.id));
          break;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onUp);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onUp);
    };
  }, [goToZ]);

  const handleCameraZ = useCallback((z: number) => {
    const next = roomAtS(z);
    setRoom((prev) => (prev?.id === next?.id ? prev : next));
  }, []);

  const selected = ALL_PHOTOS.find((p) => p.id === selectedId) ?? null;
  const heroSrc = HERO_SRC;

  return (
    <>
      {wantScene && (
        <Scene
          onReady={() => {
          readyRef.current = true;
          if (process.env.NODE_ENV !== 'production') {
            (window as unknown as { __nyronReady: boolean }).__nyronReady = true;
          }
          setReady(true);
          // Release the hold: re-apply the mapping for wherever the page
          // actually is now, so a visitor who scrolled ahead resumes there
          // instead of waiting for their next wheel event.
          applyScroll.current?.();
          warmWhenReady.current?.();
          warmWhenReady.current = null;
        }}
          onStats={showStats ? setStats : undefined}
          progress={progress}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onCameraZ={handleCameraZ}
        />
      )}

      {/* The scene warms up behind the hero, so there is normally nothing to
          wait for. This only appears if the visitor has already started
          walking and the first frame has still not landed. */}
      {wantScene && !ready && started && (
        <div className="boot boot-quiet" role="status">
          <em>Preparing the rooms</em>
        </div>
      )}

      {showStats && stats && <div className="stats">{stats}</div>}

      <Intro progressRef={intro} heroSrc={heroSrc} onEnter={enter} />
      <Hud room={room} barRef={progressBar} selected={!!selected} visible={chromeVisible} />
      <Footer progressRef={footer} />

      {/* Drives document height: intro + walk + a little run-off for the footer. */}
      <div
        style={{ height: (WALK_LENGTH * PIXELS_PER_UNIT) / (1 - INTRO_FRACTION) }}
        aria-hidden
      />
    </>
  );
}
