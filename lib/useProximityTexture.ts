'use client';

import * as THREE from 'three';
import { midOf, thumbOf } from '@/data/exhibition';
import { LITE } from '@/lib/device';

/**
 * Photograph residency, in three steps, driven imperatively from each Frame's
 * render loop rather than through React state:
 *
 *   requested → decoded (the browser has the image) → uploaded (on the GPU)
 *
 * The last step is the one that stalls. Uploading a 2048px print and building
 * its mipmaps is a synchronous GPU call of several milliseconds, and before
 * this queue existed a dozen of them could land in the same frame — measured
 * as a 200 ms+ freeze. Now decoded images wait in a queue, and `pumpUploads`
 * moves them to the GPU a few milliseconds' worth per frame, thumbnails
 * first. A frame only switches to a texture once it has actually been
 * uploaded, so nothing is ever uploaded mid-draw.
 *
 * Every photograph has a small companion (`<name>.thumb.webp`, ~400px) that is
 * cheap enough to keep for every work in the show. Full prints are held only
 * near the camera. On phones the "full" print is the 1280px step: a phone
 * screen cannot show more, and it takes a third of the GPU memory.
 */

/** The print to hold near the camera on this device. */
const fullOf = (src: string) => (LITE ? midOf(src) : src);

const resident = new Map<string, THREE.Texture>();
const queued = new Map<string, THREE.Texture>();
const inflight = new Set<string>();
const failed = new Set<string>();
const refs = new Map<string, number>();
const loader = new THREE.TextureLoader();

let maxAnisotropy = 8;

/** Set once the renderer exists; already-loaded textures are upgraded too. */
export function setMaxAnisotropy(n: number) {
  maxAnisotropy = Math.max(1, Math.min(16, n));
  const up = (tex: THREE.Texture) => {
    if (tex.anisotropy !== maxAnisotropy) {
      tex.anisotropy = maxAnisotropy;
      tex.needsUpdate = true;
    }
  };
  resident.forEach(up);
  queued.forEach(up);
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
  if (resident.has(url) || queued.has(url) || inflight.has(url) || failed.has(url)) return;
  inflight.add(url);
  loader.load(
    url,
    (tex) => {
      inflight.delete(url);
      queued.set(url, configure(tex));
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

const isThumb = (url: string) => url.endsWith('.thumb.webp');

/**
 * Move decoded textures to the GPU within a time budget. Thumbnails go first
 * (they are what keeps a frame from being blank), then full prints. At least
 * one texture moves per call, so the queue always drains.
 */
export function pumpUploads(gl: THREE.WebGLRenderer, budgetMs: number) {
  if (queued.size === 0) return 0;
  const order = [...queued.keys()].sort((a, b) => Number(isThumb(b)) - Number(isThumb(a)));
  const t0 = performance.now();
  let n = 0;
  for (const url of order) {
    if (n > 0 && performance.now() - t0 > budgetMs) break;
    const tex = queued.get(url)!;
    queued.delete(url);
    gl.initTexture(tex);
    resident.set(url, tex);
    n++;
  }
  return n;
}

/** Warm the thumbnail only. Cheap; call for anything vaguely ahead. */
export function prefetch(src: string) {
  load(thumbOf(src));
}

/** Hold a reference to the full print and make sure both tiers are on their way. */
export function request(src: string) {
  const full = fullOf(src);
  refs.set(full, (refs.get(full) ?? 0) + 1);
  load(thumbOf(src));
  load(full);
}

export function release(src: string) {
  const full = fullOf(src);
  const n = (refs.get(full) ?? 1) - 1;
  if (n <= 0) refs.delete(full);
  else refs.set(full, n);
}

/** Best texture already on the GPU for this photo: full, else thumb, else null. */
export function peek(src: string): THREE.Texture | null {
  return resident.get(fullOf(src)) ?? resident.get(thumbOf(src)) ?? null;
}

/** Drop full-size textures nothing references. Thumbs are small; keep them. */
export function evictUnreferenced() {
  resident.forEach((tex, url) => {
    if (isThumb(url)) return;
    if (!refs.has(url)) {
      tex.dispose();
      resident.delete(url);
    }
  });
}

/**
 * Warm a set of photographs: thumbnails for all of them, full prints for the
 * first `full`. Returns a function reporting 0..1 — the share now on the GPU
 * (or confirmed missing) — for the loading screen.
 */
export function warmSet(srcs: string[], full: number): () => number {
  const urls = [...new Set([...srcs.map(thumbOf), ...srcs.slice(0, full).map(fullOf)])];
  urls.forEach(load);
  return () => {
    if (!urls.length) return 1;
    let done = 0;
    for (const u of urls) if (resident.has(u) || failed.has(u)) done++;
    return done / urls.length;
  };
}
