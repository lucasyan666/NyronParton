import puppeteer from 'puppeteer-core';
const [base, out] = process.argv.slice(2);
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
const scrollTo = async (p) => { await page.evaluate((p) => window.scrollTo(0, p * (document.documentElement.scrollHeight - innerHeight)), p); await sleep(4000); };
await scrollTo(0.47); await page.screenshot({ path: `${out}/fix-salon.png` });
await scrollTo(0.66); await page.screenshot({ path: `${out}/fix-end.png` });
// stand before work 3 and focus it; wait long enough for software GL
await scrollTo(0.30);
await page.evaluate(() => window.__nyron.select(2));
await sleep(16000);
await page.screenshot({ path: `${out}/fix-focused.png` });
console.log(await page.evaluate(() => JSON.stringify(window.__nyron.camera())));
await browser.close();
