/**
 * Find what lands on a slow frame. Real GPU, production build with ?stats.
 *   node tools/hitch.mjs <url>
 * Loads, waits for the loading screen to lift, scrolls past the landing, and
 * prints every frame over 33 ms with the GPU residency changes (geometry /
 * textures / programs, logged by Stats.tsx) and DOM changes around it.
 */
import puppeteer from 'puppeteer-core';

const [base] = process.argv.slice(2);
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
  window.__dom = [];
  let last = performance.now();
  let chrome = null, intro = null;
  const tick = (t) => {
    window.__frames.push([t, t - last]); last = t;
    if (!window.__goneAt && window.__warmAt === undefined && document.querySelector('.loader.is-leaving')) window.__warmAt = t;
    if (window.__warmAt && !window.__goneAt && !document.querySelector('.loader')) window.__goneAt = t;
    const c = document.querySelector('.picker.is-on') ? 'picker on' : 'picker off';
    if (c !== chrome) { chrome = c; window.__dom.push([t, c]); }
    const i = document.querySelector('.intro');
    const op = i ? getComputedStyle(i).opacity : 'gone';
    const iv = op === '0' ? 'intro hidden' : op === 'gone' ? 'intro gone' : 'intro shown';
    if (iv !== intro) { intro = iv; window.__dom.push([t, iv]); }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 180000 });
const until = Date.now() + 60000;
while (Date.now() < until) {
  if (await page.evaluate(() => window.__goneAt ?? null).catch(() => null)) break;
  await sleep(100);
}
await sleep(1500);
const tStart = await page.evaluate(() => performance.now());
await page.mouse.move(720, 450);
for (let i = 0; i < 26; i++) { await page.mouse.wheel({ deltaY: 100 }); await sleep(40); }
await sleep(3000);

const { frames, glog, dom, warm } = await page.evaluate(() => ({
  frames: window.__frames, glog: window.__glog ?? [], dom: window.__dom, warm: window.__warmAt,
}));
const r = (x) => Math.round(x);
console.log(`warm at ${r(warm)} ms; scroll began at ${r(tStart)} ms`);
console.log('GPU residency during warm-up, last entry:', glog.filter(([t]) => t < tStart).slice(-1)[0]?.map(r).join(' / '));
const slow = frames.filter(([t, dt]) => t > tStart && dt > 33.4);
console.log(`slow frames after scrolling began: ${slow.length}`);
for (const [t, dt] of slow) {
  const t0 = t - dt - 50, t1 = t + 50;
  const g = glog.filter(([gt]) => gt >= t0 && gt <= t1).map(([gt, a, b, c]) => `${r(gt)}: geo ${a} tex ${b} prog ${c}`);
  const d = dom.filter(([dt2]) => dt2 >= t0 - 300 && dt2 <= t1).map(([dt2, s]) => `${r(dt2)}: ${s}`);
  console.log(`- frame ending ${r(t)} took ${r(dt)} ms`);
  g.forEach((x) => console.log(`    gl  ${x}`));
  d.forEach((x) => console.log(`    dom ${x}`));
}
console.log('all GPU residency changes after scrolling began:');
glog.filter(([t]) => t > tStart).forEach(([t, a, b, c]) => console.log(`  ${r(t)}: geo ${a} tex ${b} prog ${c}`));
await browser.close();
