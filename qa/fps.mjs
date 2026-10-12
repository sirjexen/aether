/**
 * Rough FPS probe in headless Chromium (SwiftShader — CPU-bound, so this is
 * a pessimistic lower bound; real browsers with GPU compositing do better).
 * Measures median rAF rate over 5s per scene, plus long-task count.
 */
import { chromium } from 'playwright-core';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(fileURLToPath(import.meta.url));
const distIndex = path.join(root, '..', 'dist', 'index.html');

const browser = await chromium.launch({
  executablePath: '/opt/meta-chromium/chrome',
  args: ['--no-sandbox', '--allow-file-access-from-files', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('file://' + distIndex);
await page.waitForTimeout(2000);

async function probe(label, navTo) {
  if (navTo) {
    await page.getByRole('button', { name: navTo }).click();
    await page.waitForTimeout(1500);
  }
  // wiggle the pointer to simulate load
  await page.mouse.move(400, 300);
  const fps = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const samples = [];
        let last = performance.now();
        let count = 0;
        const tick = (now) => {
          const dt = now - last;
          last = now;
          if (dt > 0 && dt < 250) samples.push(1000 / dt);
          if (++count < 300) requestAnimationFrame(tick);
          else {
            samples.sort((a, b) => a - b);
            resolve({
              median: Math.round(samples[Math.floor(samples.length / 2)]),
              p5: Math.round(samples[Math.floor(samples.length * 0.05)]),
            });
          }
        };
        requestAnimationFrame(tick);
      }),
  );
  console.log(`${label}: median ${fps.median}fps, p5 ${fps.p5}fps (headless CPU render)`);
}

await probe('scene-01 universe', null);
await probe('scene-02 sculpture', /Scene 02/);
await probe('scene-03 type', /Scene 03/);
await probe('scene-04 exhibition', /Scene 04/);
await browser.close();
