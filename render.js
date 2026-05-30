import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// --- Config ---
// DURATION_S is computed inside flyby.html based on route distance
// (Strava-style scaling) and read back here after the KML loads.
const FPS         = 30;
const WIDTH       = 1080;
const HEIGHT      = 1920;
const INITIAL_TILE_WAIT_MS = 3000;

const inputArg = process.argv[2];
if (!inputArg) {
  console.error('Usage: node render.js <path-to-kml-or-tcx>');
  process.exit(1);
}
const inputPath = path.resolve(inputArg);
if (!fs.existsSync(inputPath)) {
  console.error(`Activity file not found: ${inputPath}`);
  process.exit(1);
}
const activityText = fs.readFileSync(inputPath, 'utf8');
const baseName = path.basename(inputPath, path.extname(inputPath));
const outPath  = path.join(__dirname, 'out', `${baseName}.mp4`);
fs.mkdirSync(path.dirname(outPath), { recursive: true });

const flybyUrl = 'file://' + path.join(__dirname, 'flyby.html') + '?render=1';

console.log(`Rendering ${baseName} → ${outPath}`);
console.log(`  ${WIDTH}x${HEIGHT} @ ${FPS}fps · duration: scaling with distance…`);

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 1
});
page.on('console',  m => console.log('  [browser]', m.text()));
page.on('pageerror', e => console.error('  [browser-error]', e.message));

await page.goto(flybyUrl);
await page.evaluate(text => window.loadActivityText(text), activityText);
await page.waitForFunction(() => window.flybyReady === true, { timeout: 30000 });

const DURATION_S = await page.evaluate(() => window.flybyDurationS);
const TOTAL_FRAMES = Math.round(DURATION_S * FPS);
console.log(`  duration: ${DURATION_S.toFixed(1)}s · ${TOTAL_FRAMES} frames`);

console.log(`Warming tile cache for ${INITIAL_TILE_WAIT_MS}ms…`);
await page.waitForTimeout(INITIAL_TILE_WAIT_MS);

const ff = spawn('ffmpeg', [
  '-y',
  '-framerate', String(FPS),
  '-f',         'image2pipe',
  '-c:v',       'png',
  '-i',         '-',
  '-c:v',       'libx264',
  '-pix_fmt',   'yuv420p',
  '-crf',       '18',
  '-preset',    'medium',
  '-movflags',  '+faststart',
  outPath
], { stdio: ['pipe', 'inherit', 'inherit'] });

let ffFailed = false;
ff.on('error', e => { console.error('ffmpeg spawn error:', e); ffFailed = true; });
ff.on('exit',  c => { if (c !== 0 && c !== null) { console.error(`ffmpeg exited code ${c}`); ffFailed = true; } });

const t0 = Date.now();
for (let i = 0; i < TOTAL_FRAMES; i++) {
  if (ffFailed) break;
  const t = TOTAL_FRAMES === 1 ? 0 : i / (TOTAL_FRAMES - 1);
  await page.evaluate(t => window.renderFrame(t), t);
  const buf = await page.screenshot({ type: 'png' });
  await new Promise((resolve, reject) => {
    ff.stdin.write(buf, err => err ? reject(err) : resolve());
  });
  if ((i + 1) % 15 === 0 || i === TOTAL_FRAMES - 1) {
    const pct = ((i + 1) / TOTAL_FRAMES * 100).toFixed(1);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    process.stdout.write(`\r  frame ${i+1}/${TOTAL_FRAMES}  ${pct}%  ${elapsed}s elapsed `);
  }
}
process.stdout.write('\n');

ff.stdin.end();
await new Promise(resolve => ff.on('close', resolve));
await browser.close();

if (ffFailed) {
  console.error('Render failed.');
  process.exit(1);
}
console.log(`Done → ${outPath}`);
