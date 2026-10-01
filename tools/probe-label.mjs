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
await page.evaluate(() => window.dispatchEvent(new Event('scroll')));
await page.waitForFunction(() => !!window.__nyronReady, { timeout: 180000 });
await page.evaluate(() => window.__nyronScroll(1));
await sleep(3000);
await page.evaluate(() => window.__nyronWing(0));
await page.waitForFunction(() => !window.__nyronState().navigating, { timeout: 60000, polling: 500 });
const corner = await page.evaluate(() => window.__nyronCorners().find((c) => c.wing === 0).s);
await page.evaluate((s) => window.__nyronGoS(s), corner - 3.2);
await page.mouse.move(720, 450);
await sleep(14000);
const info = await page.evaluate(() => {
  const scene = window.__nyronScene;
  const cam = window.__nyron.camera();
  const hits = [];
  scene.traverse((o) => {
    if (o.text && /Across the Table/.test(o.text)) {
      o.updateWorldMatrix(true, false);
      const e = o.matrixWorld.elements;
      // text faces its local +z
      const nz = [e[8], e[9], e[10]];
      const len = Math.hypot(...nz);
      let vis = true; let p = o; while (p) { if (!p.visible) vis = false; p = p.parent; }
      const pos = [e[12], e[13], e[14]];
      const toCam = [cam.p[0] - pos[0], cam.p[1] - pos[1], cam.p[2] - pos[2]];
      hits.push({ pos: pos.map((v) => +v.toFixed(2)), facing: nz.map((v) => +(v / len).toFixed(2)), drawn: vis,
        camInFront: toCam[0] * nz[0] + toCam[1] * nz[1] + toCam[2] * nz[2] > 0,
        side: o.material?.side, depthTest: o.material?.depthTest, renderOrder: o.renderOrder });
    }
  });
  return { cam: cam.p.map((v) => +v.toFixed(2)), look: cam.look.map((v) => +v.toFixed(2)), hits };
});
console.log(JSON.stringify(info, null, 1));
await page.screenshot({ path: `${out}/probe-normal.png` });
// hide the reflector and look again
await page.evaluate(() => {
  window.__nyronScene.traverse((o) => { if (o.material && /Reflector/i.test(o.material.type || o.material.constructor?.name || '')) o.visible = false; });
});
await sleep(1500);
await page.screenshot({ path: `${out}/probe-noreflect.png` });
await browser.close();
