/**
 * Frame-time timeline on the REAL GPU (headful Chrome → Metal), production
 * build, driven only by input a visitor would give (wheel, keys, mouse).
 *   node tools/perf.mjs <url> [label]
 * Prints, per phase, frame-time stats from requestAnimationFrame deltas and
 * the long tasks that landed in it.
 */
import puppeteer from 'puppeteer-core';

const [base, label = 'run'] = process.argv.slice(2);
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: false,
  defaultViewport: null,
  args: [
    '--no-sandbox', '--window-size=1440,960', '--window-position=-2600,0',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion',
  ],
});
const page = await browser.newPage();
for (const p of await browser.pages()) if (p !== page) await p.close().catch(() => {});
await page.setViewport({ width: 1440, height: 900 });
await page.evaluateOnNewDocument(() => {
  window.__frames = [];
  window.__long = [];
  let last = performance.now();
  const tick = (t) => {
    window.__frames.push([t, t - last]); last = t;
    // When the loading screen starts to lift, and when it is gone.
    if (!window.__warmAt && document.querySelector('.loader.is-leaving')) window.__warmAt = t;
    if (window.__warmAt && !window.__goneAt && !document.querySelector('.loader')) window.__goneAt = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  try {
    new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push([e.startTime, e.duration]))).observe({ type: 'longtask', buffered: true });
  } catch {}
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => page.evaluate(() => performance.now());
const phases = [];
async function phase(name, fn) {
  const t0 = await now();
  await fn();
  const t1 = await now();
  phases.push([name, t0, t1]);
}

await phase('A load → warm (behind loader)', async () => {
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 180000 });
  // Poll rather than waitForFunction: Chrome may swap the main frame during
  // the first navigation, and a wait task bound to the old one throws.
  const until = Date.now() + 60000;
  while (Date.now() < until) {
    const gone = await page.evaluate(() => window.__goneAt ?? null).catch(() => null);
    if (gone) break;
    await sleep(100);
  }
});
await phase('A2 landing, idle', async () => { await sleep(2000); });
const renderer = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const d = gl && gl.getExtension('WEBGL_debug_renderer_info');
  return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown';
});
await page.mouse.move(720, 450);
await phase('B wheel past the landing', async () => {
  for (let i = 0; i < 26; i++) { await page.mouse.wheel({ deltaY: 100 }); await sleep(40); }
  await sleep(3000);
});
await phase('C foyer, looking around', async () => {
  for (let i = 0; i <= 40; i++) { await page.mouse.move(420 + i * 15, 430 + (i % 7) * 6); await sleep(50); }
});
await phase('D keep scrolling: into room 1', async () => {
  for (let i = 0; i < 24; i++) { await page.mouse.wheel({ deltaY: 100 }); await sleep(40); }
  await sleep(5000);
});
const roomAfterPush = await page.evaluate(() => document.querySelector('.hud-room')?.textContent ?? '(none)');
await phase('E wheel through room 1', async () => {
  for (let i = 0; i < 50; i++) { await page.mouse.wheel({ deltaY: 90 }); await sleep(40); }
  await sleep(2500);
});
await phase('E2 hover across the walls', async () => {
  for (let i = 0; i <= 60; i++) { await page.mouse.move(80 + i * 21, 380 + Math.sin(i / 4) * 90); await sleep(45); }
});
await phase('F Enter: open nearest work', async () => {
  await page.keyboard.press('Enter');
  await sleep(4000);
});
await phase('G Esc: close it', async () => {
  await page.keyboard.press('Escape');
  await sleep(3000);
});
await phase('H key 2: through to room 2', async () => {
  await page.keyboard.press('2');
  await sleep(6000);
});

const frames = await page.evaluate(() => window.__frames);
const longs = await page.evaluate(() => window.__long);
const pct = (a, p) => a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : 0;
const t = await page.evaluate(() => ({
  fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime,
  warm: window.__warmAt, gone: window.__goneAt,
}));
console.log(`[${label}] GPU: ${renderer}`);
console.log(`first paint ${Math.round(t.fcp ?? -1)} ms · gallery warm ${Math.round(t.warm)} ms · loader gone ${Math.round(t.gone)} ms`);
console.log(`after keep-scrolling at the doors: ${roomAfterPush.replace(/\s+/g, ' ').trim()}`);
console.log('phase                            frames  fps   p50   p95    max  >33ms >50ms >100ms  long tasks');
for (const [name, t0, t1] of phases) {
  const d = frames.filter(([t]) => t >= t0 && t <= t1).map(([, dt]) => dt).slice(1);
  const s = [...d].sort((a, b) => a - b);
  const fps = d.length / ((t1 - t0) / 1000);
  const lt = longs.filter(([t]) => t >= t0 && t <= t1).map(([, dur]) => Math.round(dur));
  console.log(
    `${name.padEnd(32)} ${String(d.length).padStart(6)} ${fps.toFixed(0).padStart(4)} ${pct(s, .5).toFixed(1).padStart(5)} ${pct(s, .95).toFixed(1).padStart(5)} ${(s[s.length - 1] ?? 0).toFixed(0).padStart(6)}` +
    ` ${String(d.filter((x) => x > 33.4).length).padStart(6)} ${String(d.filter((x) => x > 50).length).padStart(5)} ${String(d.filter((x) => x > 100).length).padStart(6)}  ${lt.sort((a, b) => b - a).slice(0, 5).join(',') || '-'}`,
  );
}
await browser.close();
