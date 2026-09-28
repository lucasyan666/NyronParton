/**
 * Render the site in headless Chrome and screenshot it along the walk.
 *   node tools/shoot.mjs <baseUrl> <outDir> [label]
 * Also writes <outDir>/<label>-console.txt with every console error/warning.
 */
import puppeteer from 'puppeteer-core';
import { mkdir, writeFile } from 'node:fs/promises';

const [base = 'http://localhost:3050', out = 'shots', label = 'run'] = process.argv.slice(2);
await mkdir(out, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--window-size=1440,900'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));

await page.goto(base, { waitUntil: 'networkidle0', timeout: 180000 });
await page.waitForSelector('.intro', { timeout: 60000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(800);
await page.screenshot({ path: `${out}/${label}-0-hero.png` });

// intent → scene mounts; wait for first frame
await page.evaluate(() => window.dispatchEvent(new Event('scroll')));
await page.waitForFunction(() => !document.querySelector('.boot-quiet'), { timeout: 120000 }).catch(() => logs.push('warn: scene never reported ready'));
await sleep(1500);

// Lenis smooths scroll per animation frame; at software-GL frame rates that
// takes ages, so the dev hook jumps the scroll immediately and we wait only
// for the camera damping (which is timestep-clamped, hence the long sleep).
const scrollTo = async (p) => {
  await page.evaluate((p) => {
    if (window.__nyronScroll) window.__nyronScroll(p);
    else window.scrollTo(0, p * (document.documentElement.scrollHeight - window.innerHeight));
  }, p);
  await sleep(9000);
};

const stops = [[0.10, '1-profile'], [0.18, '2-room1'], [0.30, '3-corridor'], [0.42, '4-corner'], [0.52, '5-salon'], [0.66, '6-turn'], [0.82, '7-room3'], [0.97, '8-exit']];
for (const [p, name] of stops) {
  await scrollTo(p);
  await page.screenshot({ path: `${out}/${label}-${name}.png` });
}

// Burst: 6 frames 120ms apart while stationary, to catch flashing.
for (let i = 0; i < 6; i++) {
  await page.screenshot({ path: `${out}/${label}-burst-${i}.png` });
  await sleep(120);
}

// Stand in front of the 3rd work, then focus it via the dev hook.
const placements = await page.evaluate(() => window.__nyron?.placements ?? []);
if (placements[2]) {
  await page.evaluate((z) => {
    const p = (window.__nyron.progressFor ?? null);
  }, 0);
  await page.keyboard.press('j'); await sleep(1200);
  await page.keyboard.press('j'); await sleep(1200);
  await page.keyboard.press('j'); await sleep(2200);
  await page.screenshot({ path: `${out}/${label}-7-standing.png` });
  await page.evaluate(() => window.__nyron.select(2));
  // software GL runs at ~2 fps; the 50 ms timestep clamp makes the glide ~10x slower here
  await sleep(15000);
  await page.screenshot({ path: `${out}/${label}-8-focused.png` });
  const cam = await page.evaluate(() => JSON.stringify(window.__nyron.camera()));
  logs.push('camera after focus: ' + cam + ' target: ' + JSON.stringify(placements[2]));
}

const stats = await page.evaluate(() => document.querySelector('.stats')?.textContent || '');
if (stats) logs.push('stats: ' + stats);
await writeFile(`${out}/${label}-console.txt`, logs.join('\n') + '\n');
console.log(`wrote ${stops.length + 8} shots; ${logs.length} console lines`);
await browser.close();
