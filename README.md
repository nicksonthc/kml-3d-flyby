# kml-3d-flyby

> Turn any Garmin KML activity into a cinematic 3D flyby MP4 — duration scales with route length, Strava-style.

![5-second teaser of the cinematic flyby](docs/demo.gif)

![End card with final distance, time, and average pace](docs/demo-end.png)

MapLibre GL (no API key) + Playwright + ffmpeg. Satellite tiles, banking
camera, Strava-orange glow, distance / pace / elapsed overlays, end card.

## Quickstart

```sh
npm install
npx playwright install chromium
node render.js kml/activity_22906933937.kml
```

Output: `out/<name>.mp4` at 1080×1920 portrait / 30fps. Length is computed
from route distance (~25 s for a quick 2 km loop, ~45 s for a 10 K,
~2 min for a marathon — see [Duration scaling](#duration-scaling)).

## Live preview in a browser

**Hosted:** <https://nicksonthc.github.io/kml-3d-flyby/> — no install, just drop a KML.

Or run locally:

```sh
open flyby.html
```

Pick a Garmin-exported KML in the file input — the flyby plays live, no ffmpeg needed.

![flyby.html opened in a browser, showing the KML file picker](docs/flyby-html-import.png)

## Get a KML from Garmin Connect

Open your activity on [Garmin Connect](https://connect.garmin.com/), click the
gear icon, and choose **Export to Google Earth**. You'll get a `.kml` file
ready to drop into the picker above or pass to `render.js`.

![Garmin Connect activity menu with 'Export to Google Earth' highlighted](docs/garming-export-kml.png)

## How it works

- KML `<LineString>` → `[lon, lat]` array; cumulative distances via haversine.
- MapLibre renders ESRI World Imagery satellite tiles.
- A glowing line layer progressively reveals along the route.
- Camera tracks position at pitch 60°, bearing = chord direction
  (50 m behind → 150 m ahead), eased with a ~1.5 s time constant for a
  smooth pan without vertigo.
- Camera zoom is close (17.4) during the flight, then eases out to 15.2
  in the final ~18 % of the timeline so the full route is visible before
  the end card.
- Overlay shows distance / pace / elapsed / lap chip, end card fades in.
- `?render=1` swaps wall-clock animation for deterministic
  `window.renderFrame(t)` calls driven by Playwright; ffmpeg encodes the
  PNG stream into MP4.

## Duration scaling

Fixed-length flybys feel rushed for a marathon and dragged-out for a
parkrun, so duration scales with the activity's distance — same idea
Strava uses for its 3D Flyover. The formula (top of `flyby.html`):

```
duration_s = clamp(20 + km × 2.5, 25, 150)
```

| Distance | Flyby length |
|---:|---:|
| 2 km   | 25 s (min) |
| 5 km   | 32.5 s |
| 10 km  | 45 s |
| 21 km  | 72.5 s |
| 42 km  | 125 s |
| 60+ km | 150 s (max) |

`flyby.html` recomputes this each time a KML loads and exposes it as
`window.flybyDurationS`; `render.js` reads it back to size the MP4 frame
count, so live preview and exported video stay in sync.

## Tweak

| Knob | File | Default |
|---|---|---|
| Duration curve | `flyby.html` `DURATION_BASE_S` / `DURATION_PER_KM_S` | 20 s + 2.5 s/km |
| Duration clamp | `flyby.html` `DURATION_MIN_S` / `DURATION_MAX_S` | 25 s / 150 s |
| Route color | `flyby.html` `ROUTE_COLOR` | `#FC4C02` |
| Pitch | `flyby.html` `PITCH` | 60° |
| Zoom (close / wide) | `flyby.html` `ZOOM_FLY` / `ZOOM_END` | 17.4 / 15.2 |
| Pull-back start | `flyby.html` `ZOOM_OUT_START` | 0.82 (82 % through) |
| Camera ease | `flyby.html` `BEARING_TIME_CONSTANT_S` | 1.5 s |
| Output FPS / size | `render.js` `FPS` / `WIDTH` / `HEIGHT` | 30 / 1080 / 1920 |

## Input format

The parser reads the first `Placemark > LineString > coordinates` plus the
optional `Folder > name`, start description (date / total time / official
distance), and `Lap N` placemarks for pace.

## Roadmap

- [ ] **GPX import** — Garmin / Strava / most watches' default export.
- [ ] **TCX import** — Garmin's training-centric format (laps, HR, cadence).
- [ ] **FIT import** — Garmin's native binary format (richest data, smallest file).
- [ ] **Auto-detect format** — sniff the file and pick the right parser.

PRs welcome. Each new parser only needs to return the same shape as
`parseKml()` in `flyby.html` (coords array + optional total time, distance,
laps, name, date) — the renderer downstream is format-agnostic.

## License

MIT — see [LICENSE](LICENSE).
