/**
 * Measures actual per-frame JS+paint cost by timing 120 rAF callbacks'
 * share of wall time vs idle — a rough indicator of main-thread pressure.
 * Run: node qa/paint-cost.mjs
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

async function frameBudget(label, navTo) {
  if (navTo) {
    await page.getByRole('button', { name: navTo }).click();
    await page.waitForTimeout(1500);
  }
  const r = await page.evaluate(
    () =>
      new Promise((resolve) => {
        let frames = 0;
        let busy = 0;
        const N = 120;
        const tick = () => {
          const t0 = performance.now();
          if (++frames >= N) {
            resolve({ avgFps: Math.round((N / busy) * 1000) });
            return;
          }
          // yield to let the scene's own rAF paint, then measure gap
          requestAnimationFrame(() => {
            busy += performance.now() - t0;
            tick();
          });
        };
        tick();
      }),
  );
  console.log(`${label}: ~${r.avgFps}fps combined load (higher is better)`);
}

await frameBudget('scene-01 universe', null);
await frameBudget('scene-04 tidal', /Scene 04/);
await browser.close();
