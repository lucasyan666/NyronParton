/** Same measurement, but with real GPU acceleration (no SwiftShader). */
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: false,                      // headless forces software GL on macOS
  args: ['--no-sandbox','--window-size=1440,900','--window-position=-2400,0'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const renderer = await page.evaluate(() => {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2');
  const d = gl && gl.getExtension('WEBGL_debug_renderer_info');
  return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown';
}).catch(() => 'unknown');
console.log('GPU:', renderer);
const t0 = Date.now();
await page.goto(process.argv[2], { waitUntil: 'domcontentloaded', timeout: 180000 });
const at = {};
const wait = async (n, fn) => { await page.waitForFunction(fn, { timeout:180000, polling:30 }).catch(()=>{}); at[n]=Date.now()-t0; };
await wait('hero',   () => { const i=document.querySelector('.hero-media'); return i && i.complete && i.naturalWidth>0; });
await wait('canvas', () => !!document.querySelector('canvas'));
await wait('draws',  () => { const s=document.querySelector('.stats')?.textContent ?? ''; const m=s.match(/(\d+) calls/); return m && +m[1] > 20; });
for (const [k,v] of Object.entries(at)) console.log(`  ${String(v).padStart(6)} ms  ${k}`);
console.log(`  ------ lag window (hero -> draws): ${at.draws - at.hero} ms`);
await browser.close();
