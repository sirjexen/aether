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
await page.waitForTimeout(2500);
await page.waitForTimeout(1200);
await page.screenshot({ path: '/tmp/dbg-scene1.png' });
console.log('counter:', JSON.stringify(await page.textContent('.aether-counter')));
await browser.close();
