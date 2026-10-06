'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Lenis from 'lenis';
import { HERO_SRC } from '@/data/exhibition';
import {
  ARRIVE_BEFORE,
  DECISION_S,
  END_S,
  ENTRY_INSIDE,
  INTRO_PX,
  PX_PER_M,
  WING_LAYOUTS,
  inFoyerAt,
  introProgressForScroll,
  roomAt,
  sForScroll,
  scrollForS,
  scrollLengthFor,
  walkFor,
} from '@/lib/layout';
import { MOODS } from '@/lib/moods';
import { getCameraZ, getInFoyer, subscribeRegion } from '@/lib/cameraStore';
import { Hud } from './Hud';
import { Intro } from './Intro';
import { RoomPicker } from './RoomPicker';
import { EndPanel } from './EndPanel';
import { Loader } from './Loader';

/**
 * The 3D scene — three.js, the post-processing stack, troika — is the heavy
 * part of the page. It mounts at once, behind the loading screen, and does
 * all of its first-time work there: building every room, compiling every
 * shader, putting the photographs on the GPU. Only when that is finished
 * does the loading screen lift onto the landing page, so nothing can stall
 * once you start walking.
 */
const Scene = dynamic(() => import('./Scene').then((m) => m.Scene), { ssr: false });

/**
 * Every visit starts at the top. Scroll position means a place in a room
 * that may not be chosen yet on a fresh load, so a restored position would
 * drop you somewhere arbitrary — or into a room before it is ready.
 */
if (typeof window !== 'undefined' && 'scrollRestoration' in history) history.scrollRestoration = 'manual';

/** How much forward scrolling at a dead end carries you on to the next room. */
const PUSH_PX = 850;

const WINGS_N = WING_LAYOUTS.length;
/** With a single wing there is nothing to choose: walk straight in. */
const INITIAL_WING: number | null = WINGS_N === 1 ? 0 : null;
const FADE_MS = 420;

/** The "keep scrolling" fill, written straight to a CSS variable: no renders. */
function setPushCue(v: number) {
  document.documentElement.style.setProperty('--push', String(Math.max(0, Math.min(1, v))));
}

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function Exhibition() {
  const lenisRef = useRef<Lenis | null>(null);

  /** The chosen wing; null while still choosing in the foyer. */
  const [active, setActive] = useState<number | null>(INITIAL_WING);
  const activeRef = useRef<number | null>(INITIAL_WING);
  const walk = walkFor(active);
  const wing = active == null ? null : WING_LAYOUTS[active];

  // The camera's target, as path distance, written by the scroll handler and
  // read every frame by the scene. Never React state: see cameraStore.
  const targetS = useRef(sForScroll(0));
  /** Bumped to make the camera jump rather than glide (door-to-door travel). */
  const teleport = useRef(0);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const [roomInfo, setRoomInfo] = useState<ReturnType<typeof roomAt>>(null);
  const [inFoyer, setInFoyer] = useState(true);
  useEffect(() => subscribeRegion(setInFoyer), []);

  // Scroll-driven values stay in refs and are written straight to the DOM.
  const progressBar = useRef<HTMLDivElement>(null);
  const intro = useRef(0);
  const endProgress = useRef(0);
  const inIntro = useRef(true);
  const [chromeVisible, setChromeVisible] = useState(false);
  /** The scene is built, compiled and uploaded; the loading screen has gone. */
  const readyRef = useRef(false);
  const applyScroll = useRef<(() => void) | null>(null);
  const [stats, setStats] = useState<string | null>(null);
  /** Rooms already walked, so the foyer's "keep scrolling" offers a new one. */
  const visited = useRef(new Set<number>());
  /** Forward scroll accumulated at a dead end (see PUSH_PX). */
  const push = useRef(0);
  const lastPush = useRef(0);
  /** When the walk came to rest at the end of the page; null while moving. */
  const atEndSince = useRef<number | null>(null);
  /** -1, 0 or 1: the held walk key. */
  const walking = useRef(0);
  /** A door transition is under way; ignore further navigation until done. */
  const navigating = useRef(false);
  const [navBusy, setNavBusy] = useState(false);
  const [fade, setFade] = useState<null | 'dark'>(null);
  const showStats = typeof window !== 'undefined' && window.location.search.includes('stats');

  /* ------------------------------------------------------------ scrolling */

  /** Where a push at a dead end leads: the next unseen room, or the next room on. */
  const pushTarget = useCallback((): number | null => {
    const a = activeRef.current;
    if (a == null) {
      for (let i = 0; i < WINGS_N; i++) if (!visited.current.has(i)) return i;
      return 0;
    }
    return a + 1 < WINGS_N ? a + 1 : null;
  }, []);
  const enterWingRef = useRef<(k: number) => void>(() => {});

  /**
   * Count forward scroll at a dead end; past PUSH_PX it carries you on. It
   * only counts once the walk has been at rest at the end for a moment, so
   * the momentum of the scroll that brought you there cannot carry you
   * straight through a choice you have not seen yet.
   */
  const addPush = useCallback((delta: number) => {
    const t = atEndSince.current;
    if (t == null || performance.now() - t < 450) return;
    const target = pushTarget();
    if (target == null) return;
    push.current += delta;
    lastPush.current = performance.now();
    setPushCue(push.current / PUSH_PX);
    if (push.current >= PUSH_PX) {
      push.current = 0;
      walking.current = 0;
      setPushCue(0);
      enterWingRef.current(target);
    }
  }, [pushTarget]);

  useEffect(() => {
    window.scrollTo(0, 0);
    const lenis = new Lenis({
      duration: 1.5,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      touchMultiplier: 1.6,
    });
    lenisRef.current = lenis;
    // Nothing moves until the gallery is warm; the loading screen is up.
    lenis.stop();

    let raf = 0;
    const loop = (time: number) => {
      lenis.raf(time);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const onScroll = ({ scroll }: { scroll: number }) => {
      // Held at the top until the gallery is warm (Lenis is stopped too).
      const y = readyRef.current ? scroll : 0;
      const s = sForScroll(y);
      targetS.current = s;
      intro.current = introProgressForScroll(y);

      const a = activeRef.current;
      const wl = a == null ? null : WING_LAYOUTS[a];
      endProgress.current = wl ? clamp01((s - (wl.length - END_S)) / END_S) : 0;
      if (progressBar.current) {
        const p = wl ? clamp01((s - wl.doorS) / Math.max(1, wl.length - wl.doorS)) : 0;
        progressBar.current.style.transform = `scaleY(${p})`;
      }

      const past = y > INTRO_PX * 0.82;
      if (past === inIntro.current) {
        inIntro.current = !past;
        setChromeVisible(past);
      }
    };
    lenis.on('scroll', onScroll);
    applyScroll.current = () => onScroll({ scroll: lenis.scroll });

    /*
     * A dead end should never feel like a freeze. When you are at the end of
     * the page — the foyer's decision point, or the end of a room — and keep
     * scrolling forward, that scroll builds up and, past a threshold, carries
     * you on: from the foyer into the next room you have not seen, from a
     * room through its door to the next. The arrow on screen fills as it
     * builds. Scrolling back resets it.
     */
    lenis.on('virtual-scroll', ({ deltaY }: { deltaY: number }) => {
      if (!readyRef.current || navigating.current || selectedRef.current) return;
      if (deltaY < 0) { push.current = 0; setPushCue(0); return; }
      addPush(deltaY);
    });

    return () => {
      cancelAnimationFrame(raf);
      lenis.destroy();
      lenisRef.current = null;
    };
  }, [addPush]);

  /*
   * The page is as long as the walk you are on: just the foyer while choosing,
   * the whole wing once inside. When the wing changes, Lenis must re-measure
   * before any scroll toward the new door — so actions that change the wing
   * queue their next step here, to run once the new length is in the DOM.
   */
  const afterLayout = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    activeRef.current = active;
    lenisRef.current?.resize();
    applyScroll.current?.();
    const fn = afterLayout.current;
    afterLayout.current = null;
    fn?.();
  }, [active]);

  const switchWing = useCallback((next: number | null, then: () => void) => {
    if (next === activeRef.current) {
      lenisRef.current?.resize();
      then();
      return;
    }
    afterLayout.current = then;
    setActive(next);
  }, []);

  const finishNav = useCallback(() => {
    navigating.current = false;
    setNavBusy(false);
    lenisRef.current?.start();
  }, []);

  /** Walk from wherever the camera is, through the door and a few steps in. */
  const walkThrough = useCallback((k: number) => {
    const lenis = lenisRef.current;
    if (!lenis) return;
    const to = scrollForS(WING_LAYOUTS[k].doorS + ENTRY_INSIDE);
    const metres = Math.abs(to - lenis.scroll) / PX_PER_M;
    lenis.start();
    lenis.scrollTo(to, {
      duration: Math.min(3.4, Math.max(1.3, 0.9 + metres * 0.11)),
      easing: easeInOutCubic,
      lock: true,
      force: true,
      onComplete: finishNav,
    });
  }, [finishNav]);

  const fadeOut = useCallback((then: () => void) => {
    lenisRef.current?.stop();
    setFade('dark');
    window.setTimeout(then, FADE_MS + 30);
  }, []);

  const fadeIn = useCallback((then: () => void) => {
    setFade(null);
    window.setTimeout(then, FADE_MS);
  }, []);

  /**
   * Into a wing. From the foyer you walk there; from inside another wing you
   * step through the light, arrive in the foyer just short of the new door,
   * and walk on in — so the foyer stays the map of the building.
   */
  const enterWing = useCallback((k: number) => {
    if (k < 0 || k >= WINGS_N || navigating.current || !readyRef.current) return;
    const lenis = lenisRef.current;
    if (!lenis) return;
    visited.current.add(k);
    push.current = 0;
    setPushCue(0);
    setSelectedId(null);
    navigating.current = true;
    setNavBusy(true);

    if (inFoyerAt(activeRef.current, getCameraZ())) {
      switchWing(k, () => walkThrough(k));
      return;
    }
    fadeOut(() => {
      switchWing(k, () => {
        lenis.scrollTo(scrollForS(WING_LAYOUTS[k].doorS - ARRIVE_BEFORE), { immediate: true, force: true });
        teleport.current += 1;
        fadeIn(() => walkThrough(k));
      });
    });
  }, [switchWing, walkThrough, fadeOut, fadeIn]);

  enterWingRef.current = enterWing;

  /** Back to the foyer, to choose again. */
  const backToFoyer = useCallback(() => {
    if (navigating.current || !readyRef.current) return;
    const lenis = lenisRef.current;
    if (!lenis) return;
    setSelectedId(null);
    navigating.current = true;
    setNavBusy(true);
    const next = INITIAL_WING;
    const target = scrollForS(next == null ? DECISION_S : 0.2);

    if (inFoyerAt(activeRef.current, getCameraZ())) {
      switchWing(next, () => {
        lenis.scrollTo(target, { duration: 1.2, easing: easeInOutCubic, force: true, onComplete: finishNav });
      });
      return;
    }
    fadeOut(() => {
      switchWing(next, () => {
        lenis.scrollTo(target, { immediate: true, force: true });
        teleport.current += 1;
        fadeIn(finishNav);
      });
    });
  }, [switchWing, fadeOut, fadeIn, finishNav]);

  const nextWing = useCallback(() => {
    const cur = activeRef.current;
    if (cur == null) return;
    if (cur + 1 < WINGS_N) enterWing(cur + 1);
    else backToFoyer();
  }, [enterWing, backToFoyer]);

  /* ------------------------------------------------- holding a work still */

  const heldScroll = useRef(0);
  useEffect(() => {
    selectedRef.current = selectedId;
    const lenis = lenisRef.current;
    if (!lenis) return;

    if (selectedId) {
      walking.current = 0;
      heldScroll.current = lenis.scroll;
      lenis.stop();
      // lenis.stop() blocks wheel and touch but not a programmatic scroll,
      // PageDown, or a scroll restore. Pin the page while the work is held.
      const pin = () => {
        if (Math.abs(window.scrollY - heldScroll.current) > 1) window.scrollTo(0, heldScroll.current);
      };
      window.addEventListener('scroll', pin, { passive: true });
      return () => window.removeEventListener('scroll', pin);
    }
    if (!navigating.current && readyRef.current) lenis.start();
  }, [selectedId]);

  /**
   * Clicks reach the canvas straight through the hero, which covers it while
   * the intro plays. Ignore them until the room is actually on screen, or a
   * click on the landing photograph could open a door behind it.
   */
  const select3D = useCallback<React.Dispatch<React.SetStateAction<string | null>>>((v) => {
    if (v !== null && intro.current < 0.8) return;
    setSelectedId(v);
  }, []);
  const enter3D = useCallback((k: number) => {
    if (intro.current < 0.8) return;
    enterWing(k);
  }, [enterWing]);

  /* --------------------------------------------------------------- warm-up */

  /** The scene is warm: let the visitor in. */
  const onWarm = useCallback(() => {
    if (readyRef.current) return;
    readyRef.current = true;
    if (process.env.NODE_ENV !== 'production') {
      (window as unknown as { __nyronReady: boolean }).__nyronReady = true;
    }
    window.scrollTo(0, 0);
    const lenis = lenisRef.current;
    if (lenis) {
      lenis.scrollTo(0, { immediate: true, force: true });
      lenis.start();
    }
    applyScroll.current?.();
  }, []);

  /** The hero's Enter: into the foyer, to the doors. */
  const enter = useCallback(() => {
    if (!readyRef.current) return;
    const lenis = lenisRef.current;
    if (!lenis) return;
    lenis.scrollTo(scrollForS(INITIAL_WING == null ? DECISION_S : 0.5), { duration: 1.8, easing: easeInOutCubic });
  }, []);

  /* -------------------------------------------------------------- keyboard */

  /** Scroll so the camera stands at path distance s. */
  const goToS = useCallback((s: number, duration = 1.4) => {
    lenisRef.current?.scrollTo(scrollForS(s), { duration });
  }, []);

  /**
   * Hold W / ↑ to walk, S / ↓ to walk back; J / → and K / ← jump between
   * works; Enter opens the nearest; Escape closes. 1–9 choose a room; H goes
   * back to the foyer.
   */
  useEffect(() => {
    let raf = 0;
    const step = () => {
      const lenis = lenisRef.current;
      if (lenis) {
        const atEnd = readyRef.current && !navigating.current && lenis.limit - lenis.scroll < 40;
        if (!atEnd) atEndSince.current = null;
        else if (atEndSince.current == null) atEndSince.current = performance.now();
      }
      if (lenis && walking.current !== 0 && !navigating.current) {
        lenis.scrollTo(lenis.scroll + walking.current * 11, { immediate: true });
        // Holding W at a dead end pushes on, like scrolling does.
        if (walking.current > 0) addPush(14);
      }
      // A push that is not kept up drains away.
      if (push.current > 0 && performance.now() - lastPush.current > 700) {
        push.current = Math.max(0, push.current - 40);
        setPushCue(push.current / PUSH_PX);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);

    const onUp = (e: KeyboardEvent) => {
      if (['w', 'W', 'ArrowUp', 's', 'S', 'ArrowDown'].includes(e.key)) walking.current = 0;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || !readyRef.current) return;
      const z = getCameraZ();
      const a = activeRef.current;
      const order = a == null ? [] : WING_LAYOUTS[a].order;

      if (/^[1-9]$/.test(e.key)) {
        const k = Number(e.key) - 1;
        if (k < WINGS_N) { e.preventDefault(); enterWing(k); }
        return;
      }
      switch (e.key) {
        case 'Escape':
          setSelectedId(null);
          break;
        case 'h': case 'H': case 'Home':
          if (selectedRef.current) break;
          e.preventDefault(); backToFoyer(); break;
        case 'w': case 'W': case 'ArrowUp':
          if (selectedRef.current) break;
          e.preventDefault(); walking.current = 1; break;
        case 's': case 'S': case 'ArrowDown':
          if (selectedRef.current) break;
          e.preventDefault(); walking.current = -1; break;
        case 'ArrowRight': case 'j': {
          if (selectedRef.current) break;
          e.preventDefault();
          const p = order.find((q) => q.focusS > z + 1.5);
          if (p) goToS(p.focusS);
          break;
        }
        case 'ArrowLeft': case 'k': {
          if (selectedRef.current) break;
          e.preventDefault();
          const p = [...order].reverse().find((q) => q.focusS < z - 1.5);
          if (p) goToS(p.focusS);
          break;
        }
        case 'Enter': {
          let best: (typeof order)[number] | null = null;
          let bestD = 12;
          for (const p of order) {
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
  }, [goToS, enterWing, backToFoyer, addPush]);

  /* ------------------------------------------------------ dev-only hooks */

  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const w = window as unknown as Record<string, unknown>;
    w.__nyronScroll = (p: number) => {
      const lenis = lenisRef.current;
      if (lenis) lenis.scrollTo(p * lenis.limit, { immediate: true, force: true });
    };
    w.__nyronGoS = (s: number) => lenisRef.current?.scrollTo(scrollForS(s), { immediate: true, force: true });
    w.__nyronLayout = () => WING_LAYOUTS.map((wl) => ({ doorS: wl.doorS, length: wl.length, mood: wl.mood }));
    w.__nyronCorners = () =>
      WING_LAYOUTS.flatMap((wl) => wl.rooms.filter((r) => r.turnOut).map((r) => ({ wing: wl.index, s: r.s0 + r.length })));
    w.__nyronWing = (k: number) => enterWing(k);
    w.__nyronFoyer = () => backToFoyer();
    w.__nyronNext = () => nextWing();
    w.__nyronState = () => ({
      active: activeRef.current,
      inFoyer: getInFoyer(),
      s: getCameraZ(),
      scroll: lenisRef.current?.scroll,
      limit: lenisRef.current?.limit,
      navigating: navigating.current,
    });
  }, [enterWing, backToFoyer, nextWing]);

  const handleCameraZ = useCallback((s: number) => {
    const next = roomAt(walkFor(activeRef.current), s);
    setRoomInfo((prev) => (prev?.room.id === next?.room.id ? prev : next));
  }, []);

  const lightRoom = !inFoyer && wing ? MOODS[wing.mood].light : false;
  const nextLayout = wing ? WING_LAYOUTS[wing.index + 1] ?? null : null;

  return (
    <>
      <Scene
        onWarm={onWarm}
        onStats={showStats ? setStats : undefined}
        targetS={targetS}
        teleport={teleport}
        active={active}
        selectedId={selectedId}
        onSelect={select3D}
        onCameraZ={handleCameraZ}
        onEnterWing={enter3D}
        onNextWing={nextWing}
        onFoyer={backToFoyer}
      />

      {showStats && stats && <div className="stats">{stats}</div>}

      <Intro progressRef={intro} heroSrc={HERO_SRC} onEnter={enter} />
      <Hud
        wing={wing}
        room={roomInfo}
        inFoyer={inFoyer}
        barRef={progressBar}
        selected={!!selectedId}
        visible={chromeVisible}
        light={lightRoom}
      />
      <RoomPicker
        visible={chromeVisible && inFoyer && WINGS_N > 1 && !selectedId && !navBusy}
        active={active}
        next={active == null ? pushTarget() : null}
        onEnter={enterWing}
      />
      <EndPanel
        progressRef={endProgress}
        wing={wing}
        next={nextLayout}
        onNext={nextWing}
        onFoyer={backToFoyer}
        light={lightRoom}
      />

      <div className={`fade ${fade ? 'is-on' : ''}`} aria-hidden />

      {/* Over everything until the gallery is warm; then it fades away. */}
      <Loader />

      {/* Drives document height: the intro, then the walk you are on. */}
      <div style={{ height: `calc(${scrollLengthFor(walk)}px + 100vh)` }} aria-hidden />
    </>
  );
}
