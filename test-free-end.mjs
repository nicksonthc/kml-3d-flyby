// Verify the free-camera END scene: load live (no render mode), camera=free,
// let the run play to completion, and capture the final frame — it must show
// the full-route overview, not stay locked on the runner.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const url = 'file://' + path.join(__dirname, 'world.html') + '?camera=free&speed=fast';
const activityText = fs.readFileSync(path.join(__dirname, 'tcx/activity_22906933937.tcx'), 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.error('[pageerror]', e.message); });

await page.goto(url);
await page.waitForFunction(() => window.worldReady === true, { timeout: 20000 });
await page.evaluate(text => window.loadActivityText(text), activityText);
console.log('loaded; playing to completion (free camera)…');
// has-kml is added post-build; `playing` is removed when the run finishes.
await page.waitForFunction(
  () => document.body.classList.contains('has-kml') && !document.body.classList.contains('playing'),
  null, { timeout: 180000 });

fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
await page.screenshot({ path: path.join(__dirname, 'out/free-end-final.png') });
console.log('captured final frame');

if (errors.length) { console.error('FAIL: page errors:', errors); process.exit(1); }
console.log('PASS');
await browser.close();
