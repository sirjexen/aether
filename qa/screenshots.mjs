/**
 * QA screenshot script: renders the production build in headless Chromium
 * and captures every scene at desktop + mobile viewports.
 * Run: node qa/screenshots.mjs  (expects dist/ to exist)
 */
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.dirname(fileURLToPath(import.meta.url));
const distIndex = path.join(root, '..', 'dist', 'index.html');
const outDir = '/home/hatch/workspace/your_files/aether/screenshots';

const browser = await chromium.launch({
  executablePath: '/opt/meta-chromium/chrome',
  args: [
    '--no-sandbox',
    '--allow-file-access-from-files',
    '--disable-dev-shm-usage',
    '--force-device-scale-factor=1',
  ],
});

const errors = [];

async function capture(viewport, name, actions) {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (e) => errors.push(`[${name}] pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[${name}] console: ${m.text()}`);
  });
  await page.goto('file://' + distIndex);
  await page.waitForTimeout(2500); // let fonts + first frames settle
  if (actions) await actions(page);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${outDir}/${name}.png` });
  await page.close();
  console.log('captured', name);
}

const DESK = { width: 1440, height: 900 };
const MOB = { width: 390, height: 844 };

// Desktop: all four scenes via nav buttons
await capture(DESK, 'scene-01-universe', null);
await capture(DESK, 'scene-02-sculpture', async (p) => {
  await p.getByRole('button', { name: /Scene 02/ }).click();
});
await capture(DESK, 'scene-03-type', async (p) => {
  await p.getByRole('button', { name: /Scene 03/ }).click();
});
await capture(DESK, 'scene-04-exhibition', async (p) => {
  await p.getByRole('button', { name: /Scene 04/ }).click();
});

// Exhibition: second artwork + Fin closing
await capture(DESK, 'scene-04-exhibition-ii', async (p) => {
  await p.getByRole('button', { name: /Scene 04/ }).click();
  await p.waitForTimeout(800);
  await p.getByRole('button', { name: /Silent Machines/ }).click();
});
await capture(DESK, 'scene-04-exhibition-fin', async (p) => {
  await p.getByRole('button', { name: /Scene 04/ }).click();
  await p.waitForTimeout(800);
  await p.getByRole('button', { name: /Fin/ }).click();
});

// Kinetic type: second mode (click stage once)
await capture(DESK, 'scene-03-type-scatter', async (p) => {
  await p.getByRole('button', { name: /Scene 03/ }).click();
  await p.waitForTimeout(800);
  await p.getByRole('button', { name: /Next mode/ }).click();
});

// Mobile: universe + exhibition
await capture(MOB, 'mobile-01-universe', null);
await capture(MOB, 'mobile-04-exhibition', async (p) => {
  await p.getByRole('button', { name: /Scene 04/ }).click();
});

await browser.close();

console.log('ERRORS:', errors.length ? '' : 'none');
for (const e of errors) console.log(' ', e);
process.exit(errors.length ? 1 : 0);
