const L: any = await import('../lib/layout.ts');
const { FOYER, WING_LAYOUTS, BOUNDS, FOYER_WALK, pathPoint, pathFrame, DECISION_S } = L;
console.log('foyer depth', FOYER.depth.toFixed(2), 'halfWidth', FOYER.halfWidth.toFixed(2), 'doors', FOYER.doors.map((d: any) => d.x.toFixed(2)).join(', '));
for (const w of WING_LAYOUTS) {
  const turns = w.rooms.map((r: any) => r.turnOut ?? '·').join('/');
  console.log(`wing ${w.index} "${w.wing.title}" mood=${w.mood} doorX=${w.doorX.toFixed(2)} doorS=${w.doorS.toFixed(2)} len=${w.length.toFixed(1)} rooms=${w.rooms.length} turns=${turns} crosses=${w.crosses} works=${w.placements.length}`);
  // path continuity: max step between consecutive samples
  let maxJump = 0, prev = pathPoint(w, -6);
  for (let s = -6; s <= w.length; s += 0.05) {
    const p = pathPoint(w, s);
    maxJump = Math.max(maxJump, Math.hypot(p[0] - prev[0], p[1] - prev[1]));
    prev = p;
  }
  const atDoor = pathPoint(w, w.doorS);
  console.log(`    path max step ${maxJump.toFixed(3)} (0.05 nominal)  at door -> (${atDoor[0].toFixed(2)}, ${atDoor[1].toFixed(2)})  expect (${w.doorX.toFixed(2)}, ${(-FOYER.depth).toFixed(2)})`);
}
console.log('bounds', JSON.stringify(Object.fromEntries(Object.entries(BOUNDS).map(([k, v]: any) => [k, +v.toFixed(1)]))));
const f = pathFrame(FOYER_WALK, DECISION_S);
console.log('decision point', f.x.toFixed(2), f.z.toFixed(2), 'facing', f.fx.toFixed(2), f.fz.toFixed(2));
