import * as THREE from 'three';

/**
 * Procedural board-marked concrete.
 *
 * Generated on canvas rather than shipped as scans: a full PBR set at 2K runs
 * ~5MB per material, which on a photography site would outweigh the actual
 * photographs. This costs zero bytes and stays tunable in code.
 *
 * Produces a real PBR set — colour, normal, roughness, AO — where the normal
 * map is Sobel-derived from an independent height field rather than faked by
 * desaturating the colour map. That distinction matters here because the
 * gallery is lit by raking spotlights, and a true normal map is what makes
 * shuttering seams and aggregate catch that light.
 */

type Maps = {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
  aoMap: THREE.Texture;
};

/**
 * Texture resolution. 512 halves generation time versus 1024 and is plenty
 * here: wall tiles repeat every ~4.5m and the scene is dim and fogged, so the
 * extra detail is not resolvable in practice. Raise to 1024 if you ever light
 * a wall brightly enough for the difference to show.
 */
const S = 768;
const DEFAULT_S = S;

/** Feature sizes in pixels, scaled from the 1024 originals. */
const SEAM_W = Math.max(4, Math.round(9 * (S / 1024)));
const TIE_R = Math.max(5, Math.round(9 * (S / 1024)));

/** Floor resolution — see createFloor. */
const FLOOR_S = S / 2;

function canvas2d(size: number) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return { c, ctx: c.getContext('2d', { willReadFrequently: true })! };
}

/* ------------------------------------------------------------------ noise */

/** Deterministic hash so a given seed always regenerates the same wall. */
function mulberry(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Tiling fractal noise, baked to a flat S x S table.
 *
 * Sampling through nested closures per pixel measured ~680ms per material —
 * two seconds of blocked main thread across the three surfaces. Baking each
 * field once and reading it as a plain array brings that to a few tens of ms.
 */
function bakeFbm(
  seed: number,
  baseFreq: number,
  octaves: number,
  size = S,
): Float32Array {
  const rnd = mulberry(seed);
  const out = new Float32Array(size * size);
  let norm = 0;
  for (let o = 0; o < octaves; o++) norm += Math.pow(0.5, o);

  for (let o = 0; o < octaves; o++) {
    const period = Math.max(2, Math.round(baseFreq * Math.pow(2, o)));
    const amp = Math.pow(0.5, o) / norm;

    const g = new Float32Array(period * period);
    for (let i = 0; i < g.length; i++) g[i] = rnd();

    for (let y = 0; y < size; y++) {
      const fy = (y / size) * period;
      const yi = Math.floor(fy);
      const yf = fy - yi;
      const v = yf * yf * (3 - 2 * yf);
      const y0 = (yi % period) * period;
      const y1 = ((yi + 1) % period) * period;

      for (let x = 0; x < size; x++) {
        const fx = (x / size) * period;
        const xi = Math.floor(fx);
        const xf = fx - xi;
        const u = xf * xf * (3 - 2 * xf);
        const x0 = xi % period;
        const x1 = (xi + 1) % period;

        out[y * size + x] +=
          (g[y0 + x0] * (1 - u) * (1 - v) +
            g[y0 + x1] * u * (1 - v) +
            g[y1 + x0] * (1 - u) * v +
            g[y1 + x1] * u * v) *
          amp;
      }
    }
  }
  return out;
}

/**
 * Bake a field at reduced resolution and bilinearly upsample it.
 *
 * A field whose finest octave has a period of, say, 16 carries no detail a
 * 768px buffer can represent that a 192px one cannot — baking it full-size is
 * 16x the work for identical output. Low-frequency fields (broad pour
 * variation, staining, blotching) go through here; only genuinely fine fields
 * like aggregate and grit are baked at full resolution.
 */
function bakeFbmScaled(
  seed: number,
  baseFreq: number,
  octaves: number,
  divisor: number,
  target = S,
): Float32Array {
  const small = Math.max(16, Math.round(target / divisor));
  const src = bakeFbm(seed, baseFreq, octaves, small);
  if (small === target) return src;

  const out = new Float32Array(target * target);
  const ratio = small / target;

  for (let y = 0; y < target; y++) {
    const fy = y * ratio;
    const y0 = Math.floor(fy);
    const yf = fy - y0;
    const r0 = (y0 % small) * small;
    const r1 = ((y0 + 1) % small) * small;

    for (let x = 0; x < target; x++) {
      const fx = x * ratio;
      const x0 = Math.floor(fx);
      const xf = fx - x0;
      const c0 = x0 % small;
      const c1 = (x0 + 1) % small;

      out[y * target + x] =
        src[r0 + c0] * (1 - xf) * (1 - yf) +
        src[r0 + c1] * xf * (1 - yf) +
        src[r1 + c0] * (1 - xf) * yf +
        src[r1 + c1] * xf * yf;
    }
  }
  return out;
}

/** Sample a baked field with vertical scaling, for streak-style stretching. */
function sampleScaled(field: Float32Array, x: number, y: number, yScale: number) {
  const sy = Math.floor(((y * yScale) % S + S) % S);
  return field[sy * S + x];
}

/* ------------------------------------------------------- height -> normal */

/**
 * Sobel the height field into a tangent-space normal map. Wrapping the sample
 * indices keeps the result seamless, which matters because these textures are
 * tiled many times along a corridor wall.
 */
function heightToNormal(height: Float32Array, size: number, strength: number) {
  const { c, ctx } = canvas2d(size);
  const img = ctx.createImageData(size, size);
  const d = img.data;

  const h = (x: number, y: number) =>
    height[(((y % size) + size) % size) * size + (((x % size) + size) % size)];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const tl = h(x - 1, y - 1), t = h(x, y - 1), tr = h(x + 1, y - 1);
      const l = h(x - 1, y), r = h(x + 1, y);
      const bl = h(x - 1, y + 1), b = h(x, y + 1), br = h(x + 1, y + 1);

      const dx = tl + 2 * l + bl - (tr + 2 * r + br);
      const dy = tl + 2 * t + tr - (bl + 2 * b + br);

      let nx = dx * strength;
      let ny = dy * strength;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len;
      const nzz = nz / len;

      const i = (y * size + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nzz * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  return c;
}

/** Pack a 0..1 float field into a greyscale canvas. */
function fieldToCanvas(field: Float32Array, size: number, lo = 0, hi = 1) {
  const { c, ctx } = canvas2d(size);
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let i = 0; i < field.length; i++) {
    const v = Math.max(0, Math.min(1, lo + field[i] * (hi - lo))) * 255;
    const j = i * 4;
    d[j] = d[j + 1] = d[j + 2] = v;
    d[j + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function texture(c: HTMLCanvasElement, srgb: boolean) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/**
 * THREE.Color stores components in LINEAR space — `new Color('#57544b')` holds
 * 0.095, not the 0.341 the hex implies. Writing that straight into a texture
 * tagged SRGBColorSpace renders it ~3.5x too dark, so read it back out in sRGB.
 */
function srgbComponents(hex: string) {
  const c = new THREE.Color(hex);
  const out = { r: 0, g: 0, b: 0 };
  c.getRGB(out as unknown as THREE.Color, THREE.SRGBColorSpace);
  return out;
}

/* --------------------------------------------------------------- concrete */

export type ConcreteOptions = {
  seed?: number;
  base?: string;
  /** Shuttering boards across the tile. 0 disables board marking. */
  boards?: number;
  /** Tie-bolt hole grid. 0 disables. */
  tieCols?: number;
  tieRows?: number;
  /** Vertical rain streaking, 0..1. */
  streak?: number;
  /**
   * Overall relief and tonal variation, 1 = concrete. Around 0.25 with boards
   * and ties off gives matte gallery plaster: present under raking light,
   * invisible head-on.
   */
  amplitude?: number;
  /** Texture edge in px. Board-marked concrete wants 768; flat plaster is fine at 512. */
  size?: number;
};

export function createConcrete({
  seed = 1,
  base = '#57544b',
  boards = 6,
  tieCols = 3,
  tieRows = 4,
  streak = 0.5,
  amplitude = 1,
  size = DEFAULT_S,
}: ConcreteOptions = {}): Maps {
  const A = amplitude;
  const S = size;
  const rnd = mulberry(seed);

  // Layered noise: broad pour variation, mid mottling, fine aggregate.
  const pour = bakeFbmScaled(seed, 2, 3, 8, S);
  const mottle = bakeFbmScaled(seed + 91, 8, 4, 4, S);
  const aggregate = bakeFbm(seed + 613, 40, 3, S);
  const grit = bakeFbm(seed + 1777, 128, 2, S);
  const streakField = bakeFbmScaled(seed + 55, 6, 2, 8, S);
  // Warp field for timber grain, and a broad blotch field for pour staining.
  const warp = bakeFbmScaled(seed + 331, 5, 2, 8, S);
  const blotch = bakeFbmScaled(seed + 8123, 2, 4, 6, S);

  const height = new Float32Array(S * S);
  const rough = new Float32Array(S * S);
  const ao = new Float32Array(S * S);

  const boardH = boards > 0 ? S / boards : S;
  // Each board pulls slightly differently from the form.
  const boardBias = Array.from({ length: Math.max(boards, 1) }, () => rnd() * 0.06 - 0.03);
  const boardGrainSeed = Array.from({ length: Math.max(boards, 1) }, () => rnd() * 1000);

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const i = y * S + x;

      // Base surface: gentle undulation plus fine aggregate pitting.
      let hgt =
        0.5 +
        A *
          ((pour[i] - 0.5) * 0.28 +
            (mottle[i] - 0.5) * 0.16 +
            (aggregate[i] - 0.5) * 0.1 +
            (grit[i] - 0.5) * 0.05);

      let rgh = 0.72 + A * ((mottle[i] - 0.5) * 0.22 + (grit[i] - 0.5) * 0.12);
      let occ = 1;

      if (boards > 0) {
        const bi = Math.floor(y / boardH);
        const withinBoard = (y % boardH) / boardH;

        // Per-board offset — timber never sits perfectly flush.
        hgt += boardBias[bi % boardBias.length];

        // Board face bows very slightly outward at its centre.
        hgt += Math.sin(withinBoard * Math.PI) * 0.03;

        // Wood grain pressed into the surface, running along the board.
        const gs = boardGrainSeed[bi % boardGrainSeed.length];
        // Timber grain: fine lines running lengthwise along the board, the way
        // sawn shuttering boards actually sit. The warp is deliberately small —
        // enough to stop the lines being mechanically straight, not so much
        // that they swirl into plywood burl.
        const w = warp[i] - 0.5;
        const grainCoord = withinBoard * 30 + gs + w * 1.1;
        const grain = Math.sin(grainCoord * Math.PI * 2);
        // Sharpen into distinct lines rather than a smooth wave.
        const grainLine = Math.sign(grain) * Math.pow(Math.abs(grain), 0.6);
        hgt += grainLine * 0.016;
        rgh += grainLine * 0.05;

        // The seam between boards: a recessed line with a lip of grout bleed.
        // Widths are in pixels, so they scale with S — at 512 a 3.5px seam
        // was too abrupt for the Sobel and fringed the normal map.
        const seamW = SEAM_W;
        const seamDist = Math.min(withinBoard, 1 - withinBoard) * boardH;
        if (seamDist < seamW) {
          const t = 1 - seamDist / seamW;
          // Smoothstep the recess so the normal gradient stays continuous.
          const e = t * t * (3 - 2 * t);
          hgt -= e * 0.2;
          occ -= t * 0.55;
          rgh += t * 0.16;
        } else if (seamDist < seamW * 2) {
          // Slight bulge where cement squeezed out against the form edge.
          const t = 1 - (seamDist - seamW) / seamW;
          hgt += t * 0.05;
        }
      }

      // Tie-bolt holes: recessed cones on a regular grid.
      if (tieCols > 0 && tieRows > 0) {
        const cw = S / tieCols;
        const ch = S / tieRows;
        const cx = (Math.floor(x / cw) + 0.5) * cw;
        const cy = (Math.floor(y / ch) + 0.5) * ch;
        const d = Math.hypot(x - cx, y - cy);
        const R = TIE_R;
        if (d < R * 2.6) {
          if (d < R) {
            const t = 1 - d / R;
            hgt -= t * t * 0.75;
            occ -= t * 0.8;
            rgh += t * 0.2;
          } else {
            // Staining halo weeping down from the hole.
            const t = 1 - (d - R) / (R * 1.6);
            occ -= t * 0.16;
          }
        }
      }

      // Rain streaking: vertical runs of darker, smoother surface. Sampling
      // the field with a compressed Y stretches it into vertical runs.
      if (streak > 0) {
        const sv = sampleScaled(streakField, x, y, 0.12);
        const run = Math.pow(Math.max(0, sv - 0.42) / 0.58, 1.6);
        occ -= run * 0.3 * streak;
        rgh -= run * 0.14 * streak;
      }

      height[i] = Math.max(0, Math.min(1, hgt));
      rough[i] = Math.max(0, Math.min(1, rgh));
      ao[i] = Math.max(0, Math.min(1, occ));
    }
  }

  /* ---- colour: base tint modulated by AO, height and mineral variation --- */

  const { c: colC, ctx: colCtx } = canvas2d(S);
  const bc = srgbComponents(base);
  const img = colCtx.createImageData(S, S);
  const d = img.data;
  const stain = bakeFbmScaled(seed + 4242, 3, 3, 8, S);

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;

      // Concrete is never one colour: cement paste, sand and shadow.
      const lift = (height[i] - 0.5) * 0.34;
      const shade = ao[i];
      const mineral = (stain[i] - 0.5) * 0.22 * A;
      // Broad pour blotching — the patchiness of a wall poured in one go.
      const patch = (blotch[i] - 0.5) * 0.3 * A;
      const tone = 1 + lift + mineral + patch;

      let r = bc.r * tone * shade;
      let g = bc.g * (tone - mineral * 0.15) * shade;
      let b = bc.b * (tone - mineral * 0.4) * shade;

      // Exposed aggregate flecks — small, bright, sparse.
      const fleck = grit[i];
      if (fleck > 0.86) {
        const k = (fleck - 0.86) / 0.14;
        r += k * 0.16; g += k * 0.16; b += k * 0.15;
      }

      const j = i * 4;
      d[j] = Math.max(0, Math.min(1, r)) * 255;
      d[j + 1] = Math.max(0, Math.min(1, g)) * 255;
      d[j + 2] = Math.max(0, Math.min(1, b)) * 255;
      d[j + 3] = 255;
    }
  }
  colCtx.putImageData(img, 0, 0);

  return {
    map: texture(colC, true),
    normalMap: texture(heightToNormal(height, S, 1.6), false),
    roughnessMap: texture(fieldToCanvas(rough, S, 0.35, 1), false),
    aoMap: texture(fieldToCanvas(ao, S), false),
  };
}

/* ------------------------------------------------------------------ floor */

/** Poured slab with expansion joints, power-float sheen and wear. */
/**
 * Floor. Generated at half the wall resolution: it tiles every ~4m and is only
 * ever seen at grazing angles, where mip levels 2-3 dominate and the extra
 * detail is not resolvable. Halving it saves ~85ms of startup.
 */
export function createFloor({ seed = 7, base = '#4a4842', amplitude = 1, size = FLOOR_S } = {}): Maps {
  const S = size;
  const A = amplitude;
  const pour = bakeFbmScaled(seed, 3, 3, 6, S);
  const mottle = bakeFbmScaled(seed + 31, 12, 4, 3, S);
  const grit = bakeFbm(seed + 907, 90, 2, S);
  const wear = bakeFbmScaled(seed + 2200, 5, 3, 6, S);

  const height = new Float32Array(S * S);
  const rough = new Float32Array(S * S);
  const ao = new Float32Array(S * S);

  const cells = 2;
  const cell = S / cells;

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const u = x / S;

      let hgt = 0.5 + A * ((pour[i] - 0.5) * 0.2 + (mottle[i] - 0.5) * 0.1 + (grit[i] - 0.5) * 0.04);
      // Power-floated floors are smoother than walls, and polished by traffic.
      let rgh = 0.5 + (mottle[i] - 0.5) * 0.2;
      let occ = 1;

      // Expansion joints: sawn channels between slabs.
      const dx = Math.min(x % cell, cell - (x % cell));
      const dy = Math.min(y % cell, cell - (y % cell));
      const dJoint = Math.min(dx, dy);
      if (dJoint < 3) {
        const t = 1 - dJoint / 3;
        hgt -= t * 0.55 * A;
        occ -= t * 0.7 * A;
        rgh += t * 0.25 * A;
      }

      // Walked paths: darker and glossier down the middle of the corridor.
      const path = Math.pow(Math.max(0, 1 - Math.abs(u - 0.5) / 0.35), 2);
      const w = wear[i];
      rgh -= path * (0.18 + w * 0.1);
      occ -= path * 0.06;

      height[i] = Math.max(0, Math.min(1, hgt));
      rough[i] = Math.max(0, Math.min(1, rgh));
      ao[i] = Math.max(0, Math.min(1, occ));
    }
  }

  const { c: colC, ctx } = canvas2d(S);
  const bc = srgbComponents(base);
  const img = ctx.createImageData(S, S);
  const d = img.data;
  for (let i = 0; i < S * S; i++) {
    const lift = (height[i] - 0.5) * 0.3;
    const shade = ao[i];
    const j = i * 4;
    d[j] = Math.max(0, Math.min(1, bc.r * (1 + lift) * shade)) * 255;
    d[j + 1] = Math.max(0, Math.min(1, bc.g * (1 + lift) * shade)) * 255;
    d[j + 2] = Math.max(0, Math.min(1, bc.b * (1 + lift) * shade)) * 255;
    d[j + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  return {
    map: texture(colC, true),
    normalMap: texture(heightToNormal(height, S, 1.8), false),
    roughnessMap: texture(fieldToCanvas(rough, S, 0.22, 0.95), false),
    aoMap: texture(fieldToCanvas(ao, S), false),
  };
}
