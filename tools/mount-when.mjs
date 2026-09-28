import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: false, args: ['--no-sandbox','--window-size=1440,900','--window-position=-2400,0'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.evaluateOnNewDocument(() => {
  window.__m = [];
  window.__M = (n) => window.__m.push([n, Math.round(performance.now())]);
  const obs = new MutationObserver(() => {
    if (document.querySelector('.intro') && !window.__a) { window.__a=1; window.__M('intro in DOM'); }
    const i = document.querySelector('.hero-media');
    if (i && i.complete && i.naturalWidth>0 && !window.__b) { window.__b=1; window.__M('hero painted'); }
    if (document.querySelector('canvas') && !window.__c) { window.__c=1; window.__M('canvas in DOM'); }
  });
  addEventListener('DOMContentLoaded', () => obs.observe(document.documentElement, { childList:true, subtree:true }));
});
await page.goto(process.argv[2], { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => { const s=document.querySelector('.stats')?.textContent ?? ''; const m=s.match(/(\d+) calls/); return m && +m[1] > 20; }, { timeout:180000, polling:30 }).catch(()=>{});
await page.evaluate(() => window.__M('room drawing'));
(await page.evaluate(() => window.__m)).forEach(([n,t]) => console.log(`  ${String(t).padStart(6)} ms  ${n}`));
await browser.close();
