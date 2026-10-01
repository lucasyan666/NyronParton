// For every print: is it fully on a wall that exists? Mirrors Architecture's
// wall extents (with the corner closer: the outer wall of a turn-in now
// starts at -(prevHalf+OFF), the turn-out room draws the far corner wall).
const L: any = await import('../lib/layout.ts');
const { WING_LAYOUTS, OFF } = L;
let bad = 0, checked = 0;
for (const wl of WING_LAYOUTS) {
  for (const seg of wl.rooms) {
    const { halfWidth: hw, length, turnIn, turnOut, prevHalf, nextHalf, roomIndex, origin, heading } = seg;
    const inner = (t: any, side: number) => t === (side === -1 ? 'left' : 'right');
    const span = (side: number) => {
      const zStart = roomIndex === 0 ? 0 : inner(turnIn, side) ? -(prevHalf + OFF) : -(prevHalf + OFF); // outer now starts at the closer's end
      const zEnd = turnOut ? (inner(turnOut, side) ? -(length - nextHalf - OFF) : -(length + nextHalf + OFF)) : -length;
      // inner-in walls start at -(prevHalf+OFF); outer-in walls too (closer covers the square)
      return { from: -zStart, to: -zEnd };
    };
    for (const p of wl.placements.filter((q: any) => q.roomIndex === seg.roomIndex)) {
      // back to room-local
      const dx = p.position[0] - origin[0], dz = p.position[2] - origin[1];
      const c = Math.cos(heading), s = Math.sin(heading);
      const x = dx * c - dz * s, z = dx * s + dz * c;
      const half = (p.height * p.photo.aspect) / 2;
      checked++;
      if (Math.abs(Math.abs(x) - (hw + OFF)) < 0.02) {
        const side = Math.sign(x);
        const sp = span(side);
        const near = -z - half, far = -z + half;
        const ok = near >= sp.from - 1e-6 && far <= sp.to + 1e-6;
        if (!ok) bad++;
        if (!ok || process.env.V) console.log(`${ok ? 'ok ' : 'BAD'} w${wl.index} r${roomIndex} ${p.photo.id} side ${side} print [${near.toFixed(2)}, ${far.toFixed(2)}] wall [${sp.from.toFixed(2)}, ${sp.to.toFixed(2)}]`);
      } else if (Math.abs(x) > hw + OFF + 0.02) {
        bad++; console.log(`BAD w${wl.index} r${roomIndex} ${p.photo.id} outside the room x=${x.toFixed(2)}`);
      }
    }
  }
}
console.log(`${checked} prints checked, ${bad} off their walls`);
