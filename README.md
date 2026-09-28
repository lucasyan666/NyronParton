# Nyron Parton — a moving exhibition

A scroll-driven virtual showroom for a film photographer: a black-box gallery
of dark board-marked concrete where each print is lit by its own stage light,
which strikes on as you approach (`components/StageLight.tsx`). The walk is a
path, not a line: rooms turn left and right through the building, so you
never scroll into a wall — the camera looks ahead along the path and rounds
each corner on its own. A salon hangs its works on the wall you approach
before turning; the last room ends at an open door with light beyond it.
Scrolling (or holding W) walks you forward with a gentle bob; hovering a print
lifts it off the wall; clicking settles you in front of it and opens a
caption. Each room's title and statement are on the wall at its entrance, and
every print carries a small museum label.

## Run it

```bash
npm install
npm run photos:placeholders   # grey stand-ins so the demo renders
npm run dev                   # http://localhost:3000
```

`?stats` on the URL shows a live FPS / draw-call readout.

## Your photographs

**Quick look** — drop images (any names, formats, sizes) into `drop/` and:

```bash
npm run photos:scan   # → public/photos/*.webp + .thumb.webp, data/generated.json
```

A file named `hero.*` in `drop/` becomes the landing photograph instead of a
work in the show. Or set it directly: `npm run photos:hero -- path/to/image.jpg`.

Restart the dev server. Delete `data/generated.json` to return to the demo.

**Curated** — one folder per room, with a room title:

```bash
npm run photos:import -- ~/Photos/nights --room nights --title "Nights"
```

It prints a room block to paste into `EXHIBITION` in `data/exhibition.ts`.
Fill in `caption`, `year`, `medium`. Rooms of three to six works read best.

Every image is written twice: a 2048px WebP (the print) and a 400px thumb the
loader shows first so a frame is never blank. Target under 150 KB per print;
the scripts report the average.

## Structure

```
app/page.tsx              Gate → Exhibition (3D) | FlatGallery (touch, reduced motion)
                          SemanticIndex (always: crawlers, screen readers)

components/Intro.tsx      full-bleed hero → profile, scroll-linked via --p
components/Scene.tsx      camera rig, focus glide, adaptive resolution
components/Frame.tsx      one print: mount, moulding, shadow, hover lift, thumb→full
components/FrameLabel.tsx 3D hover title (troika, bundled Instrument Serif)
components/Caption.tsx    click caption, DOM in 3D via <Html transform>
components/Architecture   each room in its own frame; corner walls, vestibule, exit door
components/WallText.tsx   room title + statement on the wall at each entrance
components/Footer.tsx     rises over the final room

lib/layout.ts             rooms as path segments with turns; scroll ↔ path distance;
                          pathPoint/pathFrame for the camera; corner rounding
lib/cameraStore.ts        camera z outside React (see Performance)
lib/useProximityTexture   two-tier residency: thumb far, full near
lib/concrete.ts           procedural plaster / floor, generated on the client
```

## How the path works

Every room is a straight segment in its own local frame (forward = −z, x
across). `lib/layout.ts` lays each room out locally, then places it in the
world at the previous room's far corner, rotated ±90°. At a corner the inner
wall stops short to open into the next room and the outer wall runs on to
close it; the next room's outer wall begins behind its own origin, forming the
wall you faced on approach — which is where a salon hangs its works. Camera
position is a path distance `s`; `pathPoint(s)` rounds corners with a small
bezier, and the camera looks at `pathPoint(s + 6.5)`, so it turns before it
arrives. Custom-layout positions in `data/exhibition.ts` are in the room's
local frame.

## Design decisions worth keeping

- **Prints are unlit.** `MeshBasicMaterial`, `toneMapped: false`. A photograph
  renders as shot; the room is lit, the work is not relit.
- **Motion is scroll-linked, not timed.** The intro, HUD bar and footer read a
  single scroll value written to a CSS custom property. It tracks the scroll
  exactly and reverses cleanly. CSS transitions on their own clock fight the
  user.
- **The semantic layer is not dead code.** Everything in the canvas is invisible
  to Google and to screen readers. `SemanticIndex` is the site they see.
- **Touch and reduced-motion get a real page**, not a degraded one.
- **Fonts are self-hosted** (`next/font` at build; the 3D titles use the OFL
  Instrument Serif in `public/fonts`). No runtime font request.

## Performance

Lighthouse 13, production build, headless Chrome (software GL — real GPUs are
kinder to the 3D route than this):

| | Perf | A11y | Best | SEO | TBT | LCP |
|---|---|---|---|---|---|---|
| Mobile  | 99  | 96–100 | 100 | 100 | 10 ms | 2.0 s |
| Desktop | 100 | 98–100 | 100 | 100 | 0 ms  | 0.5 s |

The two changes that took it from 52/66 to 99/100:

- **No throwaway WebGL context.** `Gate` used to create a context just to test
  for support. On software GL that is ~1 s of synchronous main-thread work,
  paid even on the flat route. It now decides from media queries and API
  presence; the real canvas is the only context made, and an error boundary
  falls back to the flat gallery if that fails.
- **three.js loads on intent.** The hero is plain DOM. The scene bundle mounts
  on the first wheel / touch / key / scroll / Enter, so the opening screen
  paints from 91 KB and the walk is ready by the time the intro has played.

Three budgets. Blowing any one of them is what makes it stutter: Blowing any one of them is what makes it stutter:

- **Dynamic lights** — `MAX_PICTURE_LIGHTS` in `Lighting.tsx` caps them at 4.
- **React renders** — camera position never touches React state. Frames read it
  in their own `useFrame`; nothing re-renders as you walk.
- **Post-processing** — depth of field is unmounted while walking and runs at
  half resolution when focused. Bloom (coves only, threshold 1.0) and vignette
  are single cheap passes. There is deliberately no film-grain pass: it is
  temporal noise, and on still photographs it reads as pixels flashing.
- **The floor reflection** (`MeshReflectorMaterial`, 512px) renders the scene a
  second time. It is the most expensive single thing here and the most
  atmospheric; lower `resolution` first if a device struggles.

Timesteps are clamped to 50 ms so a tab switch cannot snap the camera. There
is no adaptive resolution: dropping pixel ratio while moving made the prints
visibly soften, which on a photography site is worse than a lower frame rate.

`tools/shoot.mjs` renders the walk in headless Chrome and writes screenshots —
the only honest way to check what the room looks like without opening it.
Software GL runs at a few fps, so animations take ~10× longer to settle there.

Surface relief (plaster, floor) is generated procedurally at idle, after first
paint, and swapped in — the first frames draw flat plaster. A service worker
(`public/sw.js`, production only) makes repeat visits load from cache.

## Keyboard

Hold `W` / `↑` to walk, `S` / `↓` to walk back · `J` / `→` next work · `K` / `←` previous · `Enter` open / close · `Esc` close
