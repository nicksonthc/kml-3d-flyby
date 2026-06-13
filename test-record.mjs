// MediaRecorder smoke test: load world.html live, play the sample run,
// record it, and verify the downloaded video file.
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const url = 'file://' + path.join(__dirname, 'world.html') + '?speed=fast&camera=thirdperson&name=Nickson';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 540, height: 960 } });
page.on('pageerror', e => console.error('[pageerror]', e.message));
page.on('console', m => console.log('[browser]', m.text()));

await page.goto(url);
await page.waitForFunction(() => window.worldReady === true, { timeout: 20000 });
await page.click('#sampleBtn');
// Wait until the world is built and the AUTO-PLAY is running (has-kml + playing),
// then hit Record mid-autoplay — it must interrupt the autoplay and record the
// full run from the start (the bug: Record was a no-op until autoplay finished).
await page.waitForFunction(
  () => document.body.classList.contains('has-kml') && document.body.classList.contains('playing'),
  null, { timeout: 240000 });
await page.waitForTimeout(2000);  // let the autoplay run a couple of seconds first
const playingBefore = await page.evaluate(() => document.body.classList.contains('playing'));
console.log('autoplay running (playing=' + playingBefore + '); clicking Record mid-autoplay…');

const downloadP = page.waitForEvent('download', { timeout: 240000 });
await page.click('#recordBtn');
const download = await downloadP;
const out = path.join(__dirname, 'out', 'mediarecorder-test' + path.extname(download.suggestedFilename()));
await download.saveAs(out);
console.log('saved:', out, '(suggested:', download.suggestedFilename() + ')');
await browser.close();
