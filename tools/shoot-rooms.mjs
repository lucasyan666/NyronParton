/**
 * Walk the foyer-and-rooms flow in headless Chrome and screenshot each stage.
 *   node tools/shoot-rooms.mjs <url> <outDir> [label]
 * Uses the dev-only hooks (__nyronScroll / __nyronWing / __nyronNext /
 * __nyronFoyer / __nyronState), so run it against `next dev`.
 */
import puppeteer from 'puppeteer-core';
import { mkdir, writeFile } from 'node:fs/promises';

const [base, out = 'shots', label = 'rooms'] = process.argv.slice(2);
await mkdir(out, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--window-size=1440,900'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (name) => page.screenshot({ path: `${out}/${label}-${name}.png` });
const state = () => page.evaluate(() => window.__nyronState?.());

/** Wait until the camera stops moving (software GL makes glides slow). */
async function settle(maxMs = 45000) {
  const t0 = Date.now();
  let prev = null;
  while (Date.now() - t0 < maxMs) {
    await sleep(1200);
    const c = await page.evaluate(() => window.__nyron?.camera?.());
    const st = await state();
    if (c && prev && !st?.navigating && Math.hypot(c.p[0] - prev[0], c.p[2] - prev[2]) < 0.01) return;
    prev = c?.p;
  }
  logs.push('warn: settle timed out');
}
async function waitNav(maxMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    await sleep(800);
    const st = await state();
    if (st && !st.navigating) return;
  }
  logs.push('warn: navigation never finished');
}

await page.goto(base, { waitUntil: 'networkidle0', timeout: 180000 });
await page.waitForSelector('.intro');
await sleep(600);
await shot('0-hero');

await page.evaluate(() => window.dispatchEvent(new Event('scroll')));
await page.waitForFunction(() => !!window.__nyronReady, { timeout: 180000 });
await sleep(1500);

// The foyer: to the end of the page, which is the decision point.
await page.evaluate(() => window.__nyronScroll(1));
await page.mouse.move(720, 450);
await settle();
await sleep(1500);
await shot('1-foyer');
logs.push('foyer state: ' + JSON.stringify(await state()));

// Look left and right with the pointer.
await page.mouse.move(80, 430); await settle(); await shot('2-foyer-left');
await page.mouse.move(1360, 430); await settle(); await shot('3-foyer-right');
await page.mouse.move(720, 450); await settle();

// Choose room 1 (index 0): walk through its door.
await page.evaluate(() => window.__nyronWing(0));
await sleep(2500);
await shot('4-walking-in');
await waitNav();
await settle();
await shot('5-inside-1');
logs.push('inside 1: ' + JSON.stringify(await state()));

// To the end of the wing: the end panel and the door onward.
await page.evaluate(() => window.__nyronScroll(1));
await settle();
await sleep(1500);
await shot('6-end-1');

// Next room (through the light, arrive in the foyer, walk on in).
await page.evaluate(() => window.__nyronNext());
await sleep(300);
await shot('7-fade');
await waitNav();
await settle();
await shot('8-inside-2');
logs.push('inside 2: ' + JSON.stringify(await state()));
await page.evaluate(() => { const L = window.__nyronLayout()[1]; window.__nyronGoS((L.doorS + L.length) / 2); });
await settle();
await shot('9-room-2-mid');

// Straight to room 3 from inside room 2.
await page.evaluate(() => window.__nyronWing(2));
await waitNav();
await settle();
await shot('10-inside-3');
await page.evaluate(() => { const L = window.__nyronLayout()[2]; window.__nyronGoS((L.doorS + L.length) / 2); });
await settle();
await shot('11-room-3-mid');
await page.evaluate(() => window.__nyronScroll(1));
await settle();
await sleep(1500);
await shot('11b-room-3-end');
logs.push('inside 3: ' + JSON.stringify(await state()));

// Back to the foyer.
await page.evaluate(() => window.__nyronFoyer());
await waitNav();
await settle();
await shot('12-back-in-foyer');
logs.push('foyer again: ' + JSON.stringify(await state()));

const stats = await page.evaluate(() => document.querySelector('.stats')?.textContent || '');
if (stats) logs.push('stats: ' + stats);
await writeFile(`${out}/${label}-console.txt`, logs.join('\n') + '\n');
console.log(`done; ${logs.length} log lines`);
await browser.close();
