// Smoke test for world.html under Playwright + file:// — checks that CDN ESM
// modules load, an activity builds a world, and frames render at several t.
// Usage: node test-world.mjs [osm=0] [camera=firstperson]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argPairs = process.argv.slice(2).filter(a => a.includes('='));
const fileArg = argPairs.find(a => a.startsWith('file='))?.slice(5)
  ?? 'tcx/activity_22906933937.tcx';
const tagArg = argPairs.find(a => a.startsWith('tag='))?.slice(4) ?? '';
const extra = argPairs.filter(a => !a.startsWith('file=') && !a.startsWith('tag='))
  .map(a => '&' + a).join('');
const url = 'file://' + path.join(__dirname, 'world.html') + '?render=1&debug=1' + extra;
const activityText = fs.readFileSync(path.join(__dirname, fileArg), 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', m => console.log('[browser]', m.text()));
page.on('pageerror', e => { errors.push(e.message); console.error('[pageerror]', e.message); });

await page.goto(url);
await page.waitForFunction(() => window.worldReady === true, { timeout: 20000 })
  .catch(() => { console.error('FAIL: worldReady never set (ESM import problem?)'); process.exit(1); });
console.log('OK: ESM modules loaded, renderer up');

await page.evaluate(text => window.loadActivityText(text), activityText);
await page.waitForFunction(() => window.flybyReady === true, { timeout: 150000 });
console.log('OK: flybyReady — duration', await page.evaluate(() => window.flybyDurationS));

fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
// Render sequentially (matching render.js) so lag-based cameras are caught up,
// screenshotting at the target times.
const targets = [0, 0.1, 0.3, 0.5, 0.85, 1];
const STEP = 1 / 200;
for (let t = 0, i = 0; i <= 200; i++, t = i * STEP) {
  await page.evaluate(t => window.renderFrame(t), Math.min(t, 1));
  const hit = targets.find(x => Math.abs(x - t) < STEP / 2);
  if (hit !== undefined) {
    await page.screenshot({ path: path.join(__dirname, `out/world${tagArg}-t${String(hit).replace('.', '_')}.png`) });
    console.log('frame t=' + hit, 'rendered');
  }
}

if (errors.length) { console.error('FAIL: page errors:', errors); process.exit(1); }
console.log('PASS');
await browser.close();
