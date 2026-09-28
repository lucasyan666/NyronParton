'use client';

import * as THREE from 'three';
import { thumbOf } from '@/data/exhibition';

/**
 * Two-tier texture residency, driven imperatively from each Frame's render
 * loop rather than through React state.
 *
 * Every photograph has a small companion (`<name>.thumb.webp`, ~400px) that is
 * cheap enough to fetch for anything vaguely ahead of the camera. The full
 * print is requested only for frames that are genuinely near. `peek()` always
 * hands back the best thing currently decoded, so a frame swaps thumb → full
 * the moment the full arrives and is never blank in between.
 *
 * All of this is plain Maps and refcounts. No React, no re-renders.
 */

const cache = new Map<string, THREE.Texture>();
const inflight = new Set<string>();
const failed = new Set<string>();
const refs = new Map<string, number>();
const loader = new THREE.TextureLoader();

let maxAnisotropy = 8;

/** Set once the renderer exists; already-decoded textures are upgraded too. */
export function setMaxAnisotropy(n: number) {
  maxAnisotropy = Math.max(1, Math.min(16, n));
  cache.forEach((tex) => {
    if (tex.anisotropy !== maxAnisotropy) {
      tex.anisotropy = maxAnisotropy;
      tex.needsUpdate = true;
    }
  });
}

function configure(tex: THREE.Texture) {
  // sRGB source; Three uploads as SRGB8_ALPHA8 so the GPU linearises on read.
  tex.colorSpace = THREE.SRGBColorSpace;
  // Trilinear + max anisotropy: prints hang on side walls and are read at
  // glancing angles, exactly the case anisotropic filtering exists for.
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = maxAnisotropy;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

function load(url: string) {
  if (cache.has(url) || inflight.has(url) || failed.has(url)) return;
  inflight.add(url);
  loader.load(
    url,
    (tex) => {
      cache.set(url, configure(tex));
      inflight.delete(url);
    },
    undefined,
    () => {
      // Missing files are expected before photos are dropped in; remember the
      // failure so we do not retry every frame.
      inflight.delete(url);
      failed.add(url);
    },
  );
}

/** Warm the thumbnail only. Cheap; call for anything ahead of the camera. */
export function prefetch(src: string) {
  load(thumbOf(src));
}

/** Hold a reference and make sure both tiers are on their way. */
export function request(src: string) {
  refs.set(src, (refs.get(src) ?? 0) + 1);
  load(thumbOf(src));
  load(src);
}

export function release(src: string) {
  const n = (refs.get(src) ?? 1) - 1;
  if (n <= 0) refs.delete(src);
  else refs.set(src, n);
}

/** Best texture currently decoded for this photo: full, else thumb, else null. */
export function peek(src: string): THREE.Texture | null {
  return cache.get(src) ?? cache.get(thumbOf(src)) ?? null;
}

/** True once the full-resolution print is resident. */
export function isFull(src: string): boolean {
  return cache.has(src);
}

/** Drop full-size textures nothing references. Thumbs are small; keep them. */
export function evictUnreferenced() {
  cache.forEach((tex, url) => {
    if (url.endsWith('.thumb.webp')) return;
    if (!refs.has(url)) {
      tex.dispose();
      cache.delete(url);
    }
  });
}

/**
 * Warm the opening of the show.
 *
 * Thumbnails for the first `n` works, but full prints for only the first
 * `full` of them. A 2048px print is ~16 MB once decoded and uploaded, so
 * warming ten of them meant ~160 MB of texture traffic before the visitor
 * had seen anything — measured as the single largest item in the startup
 * profile. The rest stream in on approach, which is what the proximity
 * loader is for.
 */
export function preloadFirst(srcs: string[], n = 8, full = 2) {
  srcs.slice(0, n).forEach((s, i) => {
    load(thumbOf(s));
    if (i < full) load(s);
  });
}

/**
 * Fetch every thumbnail in the background, a few at a time.
 *
 * Thumbs are ~12 KB each, so the whole show is a few hundred KB — cheaper
 * than one full print. Warming them all during the intro means no frame is
 * ever blank when you walk into a room; the full-resolution print still
 * streams in on approach and replaces the thumb when it lands.
 *
 * Deliberately serialised in small batches so it cannot contend with the
 * full-size prints for the first room, which matter more.
 */
export async function warmAllThumbs(srcs: string[], batch = 4) {
  for (let i = 0; i < srcs.length; i += batch) {
    await Promise.all(
      srcs.slice(i, i + batch).map(
        (s) =>
          new Promise<void>((resolve) => {
            const url = thumbOf(s);
            if (cache.has(url) || failed.has(url)) return resolve();
            const img = new Image();
            img.onload = img.onerror = () => resolve();
            img.decoding = 'async';
            img.src = url;
          }),
      ),
    );
    // yield to the renderer between batches
    await new Promise((r) => setTimeout(r, 0));
  }
  // now hand them to three, which will hit the browser cache
  srcs.forEach((s) => load(thumbOf(s)));
}
