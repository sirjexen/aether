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
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('file://' + distIndex);
await page.waitForTimeout(2500);
await page.getByRole('button', { name: 'Converge' }).click();
await page.waitForTimeout(2600); // mid-formation
await page.screenshot({ path: `${outDir}/scene-01-converge.png` });
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
