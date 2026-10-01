/**
 * Tour every wing: foyer, then for each wing a few stops along its walk,
 * including either side of any corner. Dev server only (uses dev hooks).
 *   node tools/tour.mjs <url> <outDir> [label]
 */
import puppeteer from 'puppeteer-core';
import { mkdir, writeFile } from 'node:fs/promises';

const [base, out = 'shots', label = 'tour'] = process.argv.slice(2);
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
await page.evaluate(() => window.dispatchEvent(new Event('scroll')));
await page.waitForFunction(() => !!window.__nyronReady, { timeout: 180000 });
await sleep(1500);
await page.evaluate(() => window.__nyronScroll(1));
await page.mouse.move(720, 450);
await settle();
await sleep(1200);
await shot('foyer');

const layouts = await page.evaluate(() => window.__nyronLayout());
const corners = await page.evaluate(() => window.__nyronCorners?.() ?? []);
for (let k = 0; k < layouts.length; k++) {
  await page.evaluate((k) => window.__nyronWing(k), k);
  await waitNav();
  await settle();
  await shot(`w${k}-a-entered`);
  const L = layouts[k];
  const stops = [];
  for (const c of corners.filter((c) => c.wing === k)) stops.push([c.s - 3.2, 'b-before-corner'], [c.s + 2.4, 'c-after-corner']);
  stops.push([L.length - 0.01, 'd-end']);
  for (const [s, name] of stops) {
    await page.evaluate((s) => window.__nyronGoS(s), s);
    await settle();
    await sleep(800);
    await shot(`w${k}-${name}`);
  }
  logs.push(`wing ${k}: ` + JSON.stringify(await state()));
}

const stats = await page.evaluate(() => document.querySelector('.stats')?.textContent || '');
if (stats) logs.push('stats: ' + stats);
await writeFile(`${out}/${label}-console.txt`, logs.join('\n') + '\n');
console.log(`done; ${logs.length} log lines`);
await browser.close();
