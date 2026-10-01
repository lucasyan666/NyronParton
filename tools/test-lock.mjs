/** Focus a work, then try hard to scroll; the camera must not move. */
import puppeteer from 'puppeteer-core';
const base = process.argv[2];
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--window-size=1440,900'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await page.goto(base, { waitUntil: 'networkidle0', timeout: 180000 });
await page.waitForSelector('.intro');
await page.evaluate(() => window.dispatchEvent(new Event('scroll')));
await page.waitForFunction(() => !document.querySelector('.boot-quiet'), { timeout: 120000 }).catch(() => {});
// Works only hang in a chosen room now: walk into the first one.
await page.evaluate(() => window.__nyronScroll(1));
await sleep(3000);
await page.evaluate(() => window.__nyronWing(0));
await page.waitForFunction(() => !window.__nyronState().navigating, { timeout: 90000, polling: 500 });
await sleep(4000);

await page.evaluate(() => window.__nyron.select(2));
/*
 * Wait for the focus glide to CONVERGE, not a fixed sleep. Damping is
 * exponential, and under software GL it takes ~30 s to settle — sampling
 * early reads the tail of the glide as drift.
 */
const settle = async () => {
  let prev = null;
  for (let i = 0; i < 25; i++) {
    await sleep(1500);
    const c = await page.evaluate(() => window.__nyron.camera());
    if (prev && Math.hypot(c.p[0] - prev[0], c.p[2] - prev[2]) < 0.002) return;
    prev = c.p;
  }
};
await settle();
const before = await page.evaluate(() => ({ ...window.__nyron.camera(), scroll: window.scrollY }));

// wheel, keys, and a direct scroll attempt
for (let i = 0; i < 12; i++) { await page.mouse.wheel({ deltaY: 400 }); await sleep(60); }
await page.keyboard.down('w'); await sleep(1200); await page.keyboard.up('w');
await page.keyboard.press('j');
await page.evaluate(() => window.scrollBy(0, 2000));
await settle();
const after = await page.evaluate(() => ({ ...window.__nyron.camera(), scroll: window.scrollY }));

const dz = Math.abs(after.z - before.z);
const dp = Math.hypot(after.p[0] - before.p[0], after.p[2] - before.p[2]);
console.log('held id     :', before.selected, '->', after.selected);
console.log('walk s      :', before.z.toFixed(3), '->', after.z.toFixed(3), ' delta', dz.toFixed(3));
console.log('camera xz   : delta', dp.toFixed(3));
console.log('window.scrollY:', before.scroll, '->', after.scroll);
console.log(dz < 0.05 && dp < 0.02 && after.scroll === before.scroll && after.selected === before.selected
  ? 'PASS: locked' : 'FAIL: moved while held');

// and it must release cleanly
await page.keyboard.press('Escape');
await sleep(2000);
for (let i = 0; i < 6; i++) { await page.mouse.wheel({ deltaY: 400 }); await sleep(60); }
await sleep(7000);
const freed = await page.evaluate(() => window.__nyron.camera());
console.log('after Esc, walk s:', freed.z.toFixed(3), Math.abs(freed.z - after.z) > 0.5 ? 'PASS: scroll released' : 'FAIL: still locked');
await browser.close();
