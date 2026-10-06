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

There are no dead ends. At the doors in the foyer, or at the end of a room,
keep scrolling and you are carried on into the next room (the foyer offers
the next one you have not seen). The button for where you are going fills as
you scroll; scrolling back cancels it.

The site opens on a loading screen (the name, a pulsing line, a thin progress
bar) that stays up while the whole gallery is built and warmed, then lifts
onto the landing page. See Performance.

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
components/Loader.tsx     the loading screen, server-rendered so it is the first paint
components/Scene.tsx      camera rig, focus glide, the warm-up
components/Frame.tsx      one print: mount, moulding, shadow, hover lift, thumb→full
components/FrameLabel.tsx 3D hover title (troika, bundled Instrument Serif)
components/Caption.tsx    click caption, DOM in 3D via <Html transform>
components/Foyer.tsx      the hall: doors, titles, light frames, floor spill, arrows
components/PulseArrow     floor chevrons with a travelling pulse (bloom does the glow)
components/Architecture   every room in its own frame; corner walls, end doors
components/LampPool       five stage lights that move to the nearest works
components/RoomPicker     the foyer's choice in the DOM: keyboard, screen readers
components/EndPanel       end of a room: next room, back to the foyer, contact
components/WallText.tsx   room title + statement on the wall at each entrance

lib/layout.ts             foyer + one walk per wing; rooms as path segments with turns;
                          print placement checked against real wall extents
lib/moods.ts              the three room looks: walls, lamps, fog, ink
lib/cameraStore.ts        camera z, region and chosen wing, outside React (see Performance)
lib/warmup.ts             warm-up stages and progress, for the loading screen
lib/occluders.ts          clicks and hovers only reach what you can actually see
lib/useProximityTexture   two-tier residency, thumb far, full near; uploads metered per frame
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

### Nothing first-time happens while you walk

Every stall the walk ever had was something happening for the first time:
a shader compiling, a photograph going up to the GPU, a light or a room
mounting. So all of it now happens up front, behind the loading screen
(`components/Loader.tsx`, progress in `lib/warmup.ts`):

1. **Build everything.** Every room of every wing, every frame, every label is
   mounted once and only ever shown or hidden. Nothing mounts as you walk.
2. **Compile everything.** Most of the building is hidden at any moment, and
   three.js only compiles what is visible, so for one synchronous call every
   object is made visible, `compileAsync` is started, and visibility is put
   back (`compileEverything` in `Scene.tsx`).
3. **Upload the photographs.** Thumbnails for every work and the first two
   full prints of each room, a metered amount per frame.
4. **Pre-draw.** A compiled shader is not the whole cost: the GPU driver builds
   a pipeline the first time each shader is drawn with a given blending and
   render target, and geometry uploads on first draw. For two frames every
   object is drawn with culling off, through the real pipeline (reflection,
   scene, post), then put back.
5. Two ordinary frames, then the screen lifts.

It is capped (12 s of drawn frames) so a slow connection still gets in; any
photographs still outstanding then stream in at a few milliseconds per frame.

Measured on the real GPU (Apple M5, production build, `tools/perf.mjs`): the
loading screen lifts after 1.3–1.9 s locally; past it, landing → foyer →
room → open a photo → close → next room all run at 60 fps with no frame over
18 ms (an occasional single 34 ms frame scrolling off the landing). Before:
a 517 ms freeze opening a photo and a 150 ms one scrolling off the landing.

### The budgets

Blowing any one of these is what makes it stutter:

- **Light count.** Every lit material is compiled for an exact number of
  lights, so adding or removing one recompiles the whole building. There are
  always five stage lights (`LampPool.tsx`); they move to the nearest works
  and fade, they never mount or unmount.
- **React renders.** Camera position never touches React state. Frames read it
  in their own `useFrame`; nothing re-renders as you walk. Components that
  hold GPU resources are memoised: drei's floor reflector rebuilds its render
  targets (and leaks the old ones) whenever a prop changes identity, so its
  `blur` array is a module constant.
- **Post-processing.** One merged pass: depth of field, bloom (coves only,
  threshold 1.0), vignette. Depth of field stays mounted at zero strength
  while walking; mounting it on click rebuilt the merged shader. There is
  deliberately no film-grain pass: it is temporal noise, and on still
  photographs it reads as pixels flashing.
- **The floor reflection** (`MeshReflectorMaterial`, 384px) renders the scene a
  second time. It is the most expensive single thing here and the most
  atmospheric; lower `resolution` first if a device struggles.

Timesteps are clamped to 50 ms so a tab switch cannot snap the camera. There
is no adaptive resolution: dropping pixel ratio while moving made the prints
visibly soften, which on a photography site is worse than a lower frame rate.

**Judging smoothness on a laptop:** on battery with Low Power Mode or Chrome's
Energy Saver on, Chrome caps every page at 30 fps (an empty page measures
29.9). Plug in, or switch those off, before deciding the walk is slow.

### Lighthouse

Lighthouse 13, production build, headless Chrome (software GL), measured
before the loading screen existed:

| | Perf | A11y | Best | SEO | TBT | LCP |
|---|---|---|---|---|---|---|
| Mobile  | 99  | 96–100 | 100 | 100 | 10 ms | 2.0 s |
| Desktop | 100 | 98–100 | 100 | 100 | 0 ms  | 0.5 s |

The 3D route now loads three.js straight away and does its warm-up on the
main thread behind the loading screen, so expect a higher TBT on the desktop
run; re-measure before quoting these. The mobile run gets the flat gallery
and is unaffected. `Gate` still never creates a throwaway WebGL context to
test for support; the real canvas is the only context made, and an error
boundary falls back to the flat gallery if that fails.

### Tools

`tools/tour.mjs` walks every room in headless Chrome (foyer, each door, both
sides of every corner, each end) and writes screenshots. It is the only honest
way to check what a room looks like without opening it. `tools/test-lock.mjs`
checks that a held photo cannot be scrolled away from. Both use dev-only hooks,
so run them against `npm run dev`. Software GL runs at a few fps, so
animations take ~10× longer to settle there.

`tools/perf.mjs <url>` drives a production build on the real GPU like a
visitor would (wheel, keys, mouse) and prints frame times per phase.
`tools/hitch.mjs <url>?stats` lists every slow frame with the GPU resources
that appeared around it. A new texture or geometry mid-walk is a first-use
cost the warm-up missed.

The wall surfaces are generated procedurally behind the loading screen. A
service worker (`public/sw.js`, production only) makes repeat visits load from
cache.

## Keyboard

`1`–`9` choose a room · `H` back to the foyer · hold `W` / `↑` to walk (and, at a dead end, on into the next room), `S` / `↓` to walk back · `J` / `→` next work · `K` / `←` previous · `Enter` open / close · `Esc` close
