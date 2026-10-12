import { chromium } from 'playwright-core';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(fileURLToPath(import.meta.url));
const distIndex = path.join(root, '..', 'dist', 'index.html');
const outDir = '/home/hatch/workspace/your_files/aether/screenshots';

const browser = await chromium.launch({
  executablePath: '/opt/meta-chromium/chrome',
  args: ['--no-sandbox', '--allow-file-access-from-files', '--disable-dev-shm-usage'],
});
const errors = [];
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('file://' + distIndex);
await page.waitForTimeout(2500);
await page.screenshot({ path: `${outDir}/mobile-01-universe.png` });
await page.getByRole('button', { name: /Scene 03/ }).click();
await page.waitForTimeout(1500);
await page.screenshot({ path: `${outDir}/mobile-03-type.png` });
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
