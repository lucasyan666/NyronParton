/** What runs in the long frames during load, on the real GPU. */
import puppeteer from 'puppeteer-core';
const [base] = process.argv.slice(2);
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: false, defaultViewport: null,
  args: ['--no-sandbox', '--window-size=1440,960', '--window-position=-2600,0', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
});
const page = await browser.newPage();
for (const p of await browser.pages()) if (p !== page) await p.close().catch(() => {});
await page.setViewport({ width: 1440, height: 900 });
await page.evaluateOnNewDocument(() => {
  window.__frames = []; let last = performance.now();
  const tick = (t) => { window.__frames.push([t, t - last]); last = t; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  window.__marks = [];
  const mo = new MutationObserver(() => {
    if (!window.__c && document.querySelector('canvas')) { window.__c = 1; window.__marks.push(['canvas mounted', performance.now()]); }
  });
  addEventListener('DOMContentLoaded', () => mo.observe(document.documentElement, { childList: true, subtree: true }));
});
const cdp = await page.target().createCDPSession();
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
await cdp.send('Profiler.start');
await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 180000 });
await new Promise((r) => setTimeout(r, 7000));
const { profile } = await cdp.send('Profiler.stop');
const frames = await page.evaluate(() => window.__frames);
const marks = await page.evaluate(() => window.__marks);

// Long frames, and what was on the CPU during each.
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const parent = new Map();
profile.nodes.forEach((n) => (n.children || []).forEach((c) => parent.set(c, n.id)));
const t0 = profile.startTime; // µs
let t = t0;
const samples = profile.samples.map((id, i) => { t += profile.timeDeltas[i]; return [t, id]; });
// perf.now() origin vs profiler clock: align using navigation start ≈ first sample
const navOffset = (await page.evaluate(() => performance.timeOrigin)) * 1000 - 0; // not used directly
const long = frames.filter(([, dt]) => dt > 50);
console.log('marks:', marks.map(([n, ts]) => `${n}@${ts.toFixed(0)}`).join('  '));
console.log('long frames (end time ms, duration):', long.map(([ts, dt]) => `${ts.toFixed(0)}/${dt.toFixed(0)}`).join('  '));

// Aggregate self time by function+file over the whole window, top 18.
const self = new Map();
profile.samples.forEach((id, i) => {
  const n = byId.get(id); const f = n.callFrame;
  const key = `${f.functionName || '(anon)'} ${(f.url || '').split('/').pop()}:${f.lineNumber}`;
  self.set(key, (self.get(key) || 0) + profile.timeDeltas[i] / 1000);
});
console.log('\nself time over the first 7 s:');
[...self.entries()].filter(([k]) => !/^\(idle\)|^\(program\)|^\(garbage/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 18)
  .forEach(([k, v]) => console.log(`  ${v.toFixed(0).padStart(6)} ms  ${k}`));

// Inclusive time for a few suspects, by walking each sample's stack.
const suspects = ['compile', 'getProgram', 'initTexture', 'uploadTexture', 'texImage2D', 'generateMipmap', 'createConcrete', 'bakeFbm', 'heightToNormal',
  'linkProgram', 'getProgramParameter', 'MeshReflectorMaterial', 'render', 'Text', 'sync', 'troika', 'decode', 'warmAllThumbs', 'setSize', 'getContext'];
const incl = new Map(suspects.map((s) => [s, 0]));
profile.samples.forEach((id, i) => {
  const seen = new Set(); let cur = id;
  while (cur != null) {
    const fn = byId.get(cur)?.callFrame.functionName || '';
    for (const s of suspects) if (!seen.has(s) && fn === s) { seen.add(s); incl.set(s, incl.get(s) + profile.timeDeltas[i] / 1000); }
    cur = parent.get(cur);
  }
});
console.log('\ninclusive time in suspects:');
[...incl.entries()].filter(([, v]) => v > 5).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${v.toFixed(0).padStart(6)} ms  ${k}`));
await browser.close();
