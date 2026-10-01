# Nyron Parton — a moving exhibition

A scroll-driven virtual showroom for a film photographer. You arrive in a
foyer: a tall concrete hall with one door per style of work, each with its
title above it, a frame of light in that room's colour, and a pulsing arrow on
the floor leading in. Choose a door (click it, the arrow, the picker at the
bottom of the screen, or press 1–9) and you walk through into that room.

Each room has its own look (warm concrete, near-black noir, or pale gallery)
and lights each print with its own stage light that strikes on as you
approach. Long rooms turn corners. At the far end a door stands open onto the
next room's light: walk through it, or go back to the foyer (H).

## Run it

```bash
npm install
npm run photos:placeholders   # grey stand-ins so the demo renders
npm run dev                   # http://localhost:3000
```

`?stats` on the URL shows a live FPS / draw-call readout.

## Your photographs

**One folder per room**, inside `drop/`:

```
drop/
  hero.jpg                 the landing photograph (optional)
  01-nights/               → the room "Nights"
  02-black-and-white/
    room.json              { "title", "subtitle", "mood": "concrete" | "noir" | "gallery" }
  03-travel/
```

```bash
npm run photos:scan        # → public/photos/*.webp + .thumb.webp, data/generated.json
```

Restart the dev server. `drop/README.md` has the details. Loose files with no
folder are dealt into rooms automatically, for a quick look. Delete
`data/generated.json` to return to the built-in demo.

Every image is written twice: a 2048px WebP (the print) and a 400px thumb the
loader shows first so a frame is never blank. Target under 150 KB per print;
the scan reports the average.

**Hand-curated** shows can be written straight into `data/exhibition.ts` as
`WINGS` (a wing is a room in the foyer; it can hold several rooms of its own).
`npm run photos:import` prints a block to paste.

## Structure

```
app/page.tsx              Gate → Exhibition (3D) | FlatGallery (touch, reduced motion)
                          SemanticIndex (always: crawlers, screen readers)

components/Intro.tsx      full-bleed hero → profile, scroll-linked via --p
components/Scene.tsx      camera rig, focus glide, adaptive resolution
components/Frame.tsx      one print: mount, moulding, shadow, hover lift, thumb→full
components/FrameLabel.tsx 3D hover title (troika, bundled Instrument Serif)
components/Caption.tsx    click caption, DOM in 3D via <Html transform>
components/Foyer.tsx      the hall: doors, titles, light frames, floor spill, arrows
components/PulseArrow     floor chevrons with a travelling pulse (bloom does the glow)
components/Architecture   every room in its own frame; corner walls, end doors
components/RoomPicker     the foyer's choice in the DOM: keyboard, screen readers
components/EndPanel       end of a room: next room, back to the foyer, contact
components/WallText.tsx   room title + statement on the wall at each entrance
components/Footer.tsx     rises over the final room

lib/layout.ts             foyer + one walk per wing; rooms as path segments with turns;
                          print placement checked against real wall extents
lib/moods.ts              the three room looks: walls, lamps, fog, ink
lib/cameraStore.ts        camera z outside React (see Performance)
lib/useProximityTexture   two-tier residency: thumb far, full near
lib/concrete.ts           procedural plaster / floor, generated on the client
```

## How the building works

`lib/layout.ts` builds a foyer and, for each wing, a **walk**: a path of
straight segments in their own local frames (forward = −z, x across). A walk
crosses the foyer to its door (straight, or an S-bend for an off-centre door),
then runs through the wing's rooms, turning left and right so you never scroll
into a wall. Only the chosen wing's walk is followed. The page is as long as
that walk, and scroll maps to path distance in pixels, so the page can grow
and shrink as you change rooms without the camera jumping.

Wings fan apart from the foyer. If a later room of one wing would pass where
another wing's first room stands, the two are never drawn at once: first rooms
of other wings show only while you are in the foyer, seen through their doors.

At a corner the inner wall stops short and the outer wall runs on. The room
turning out draws the corner wall you face, so the view down a room is closed
even when the next room is not drawn. Corridor prints are placed against the
real extent of the wall they hang on, using their actual width. A wide
landscape print is pushed along rather than allowed to hang past the end of
its wall.

Moving between wings from inside a room fades through black, arrives in the
foyer just short of the new door, and walks you in, so the foyer stays the map.

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

`tools/tour.mjs` walks every room in headless Chrome (foyer, each door, both
sides of every corner, each end) and writes screenshots. It is the only honest
way to check what a room looks like without opening it. `tools/test-lock.mjs`
checks that a held photo cannot be scrolled away from. Both use dev-only hooks,
so run them against `npm run dev`.
Software GL runs at a few fps, so animations take ~10× longer to settle there.

Surface relief (plaster, floor) is generated procedurally at idle, after first
paint, and swapped in — the first frames draw flat plaster. A service worker
(`public/sw.js`, production only) makes repeat visits load from cache.

## Keyboard

`1`–`9` choose a room · `H` back to the foyer · hold `W` / `↑` to walk, `S` / `↓` to walk back · `J` / `→` next work · `K` / `←` previous · `Enter` open / close · `Esc` close
