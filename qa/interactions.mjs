/**
 * Interaction smoke test: exercises the main interactive paths in the
 * production build and fails on any page/console error.
 * Run: node qa/interactions.mjs
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
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
});

await page.goto('file://' + distIndex);
await page.waitForTimeout(2000);

// Scene 01: click canvas (ripple), click Converge, press C to release
await page.mouse.click(720, 450);
await page.waitForTimeout(600);
await page.getByRole('button', { name: 'Converge' }).click();
await page.waitForTimeout(4500); // hold + release cycle
await page.keyboard.press('c');
await page.waitForTimeout(800);

// Scene 02: drag on the sculpture
await page.getByRole('button', { name: /Scene 02/ }).click();
await page.waitForTimeout(1200);
await page.mouse.move(720, 400);
await page.mouse.down();
await page.mouse.move(900, 550, { steps: 20 });
await page.mouse.move(800, 350, { steps: 20 });
await page.mouse.up();
await page.waitForTimeout(800);

// Scene 03: cycle all 4 modes via stage clicks + Next button
await page.getByRole('button', { name: /Scene 03/ }).click();
await page.waitForTimeout(1000);
for (let i = 0; i < 3; i++) {
  await page.getByRole('button', { name: /Next mode/ }).click();
  await page.waitForTimeout(900);
}
// keyboard arrows still switch scenes (1-4 keys)
await page.keyboard.press('4');
await page.waitForTimeout(1000);

// Scene 04: walk artworks via arrows, click canvas (bloom on III), Fin
await page.keyboard.press('ArrowRight'); // III (exhibition arrows captured by scene)
await page.waitForTimeout(800);
await page.mouse.click(720, 450); // plant a bloom
await page.waitForTimeout(1200);
await page.keyboard.press('ArrowRight'); // Fin
await page.waitForTimeout(800);
await page.mouse.move(400, 450, { steps: 10 });
await page.mouse.move(1000, 450, { steps: 10 });
await page.waitForTimeout(800);
// back to start via shell nav
await page.getByRole('button', { name: /Scene 01/ }).click();
await page.waitForTimeout(1200);

console.log('INTERACTION ERRORS:', errors.length ? '' : 'none');
for (const e of errors) console.log(' ', e);
await browser.close();
process.exit(errors.length ? 1 : 0);
