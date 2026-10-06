'use client';

import { Component, useEffect, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { FlatGallery } from './FlatGallery';
import { LoaderView } from './Loader';

// While the gallery's code arrives, the loading screen stays up — the same
// markup the server rendered, so there is no flash between them.
const Exhibition = dynamic(() => import('./Exhibition').then((m) => m.Exhibition), {
  ssr: false,
  loading: () => <LoaderView progress={0.04} />,
});

type Verdict = 'pending' | '3d' | 'flat';

/**
 * If the 3D route throws — most likely WebGL context creation failing on a
 * blocklisted GPU — fall back to the flat gallery rather than a blank page.
 * This is also how WebGL support is "detected": by using it once, for real,
 * instead of creating a throwaway context up front.
 */
class Fallback extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <FlatGallery /> : this.props.children;
  }
}

/**
 * Decide once, on mount, whether this device gets the walk or the flat show.
 * Phones and tablets get the walk (lighter, see lib/device.ts). The flat
 * gallery is for visitors who ask for reduced motion, browsers without
 * WebGL 2, and — through the error boundary — any device where the 3D fails.
 *
 * Deliberately no probe context. Creating a WebGL context just to test for
 * one is synchronous and, on software GL, can block the main thread for the
 * better part of a second — the single largest cost Lighthouse found, paid
 * even on the flat route where the context was thrown away. Media queries
 * and API presence decide; the real canvas is the only context ever made.
 */
export function Gate() {
  const [verdict, setVerdict] = useState<Verdict>('pending');

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const hasApi = typeof WebGL2RenderingContext !== 'undefined';

    setVerdict(!hasApi || reduced ? 'flat' : '3d');
  }, []);

  if (verdict === 'pending') return <LoaderView progress={0.02} />;

  return verdict === '3d' ? (
    <Fallback>
      <Exhibition />
    </Fallback>
  ) : (
    <FlatGallery />
  );
}
