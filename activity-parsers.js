// Activity parsing + geo helpers shared by flyby.html and world.html.
// Extracted from flyby.html (which keeps its own copies for now). Classic
// script — sets window.ActivityParsers — so it loads over file:// where
// module imports of local files are blocked.
(function () {
'use strict';

function haversineM(a, b) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const s = Math.sin(dLat/2)**2 + Math.sin(dLon/2)**2 * Math.cos(lat1) * Math.cos(lat2);
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1-s));
}

function bearingDeg(a, b) {
  const toRad = d => d * Math.PI / 180;
  const toDeg = r => r * 180 / Math.PI;
  const lat1 = toRad(a[1]), lat2 = toRad(b[1]);
  const dLon = toRad(b[0] - a[0]);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function parseKml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const lsNode = doc.querySelector('Placemark LineString coordinates');
  if (!lsNode) throw new Error('No LineString found in KML');
  const coords = lsNode.textContent.trim().split(/\s+/).map(s => {
    const [lon, lat] = s.split(',').map(Number);
    return [lon, lat];
  }).filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));

  const cumDists = [0];
  for (let i = 1; i < coords.length; i++) {
    cumDists.push(cumDists[i-1] + haversineM(coords[i-1], coords[i]));
  }
  const totalM = cumDists[cumDists.length - 1];

  const folderName = doc.querySelector('Folder > name')?.textContent?.trim() ?? 'Activity';

  const startDesc = doc.querySelector('Placemark > description')?.textContent ?? '';
  let totalSec = null;
  const mt = startDesc.match(/Time\s*:?\s*<\/td>\s*<td[^>]*>\s*(\d+):(\d+):(\d+)/);
  if (mt) totalSec = parseInt(mt[1])*3600 + parseInt(mt[2])*60 + parseInt(mt[3]);
  let officialKm = null;
  const md = startDesc.match(/Distance:\s*<\/td>\s*<td[^>]*>\s*([\d.]+)/);
  if (md) officialKm = parseFloat(md[1]);

  let dateText = '';
  const dm = startDesc.match(/\b(\w{3})\s+(\w{3})\s+(\d{1,2})\s+\d{1,2}:\d{2}:\d{2}\s+\w+\s+(\d{4})/);
  if (dm) dateText = `${dm[3]} ${dm[2].toUpperCase()} ${dm[4]}`;

  const laps = [];
  doc.querySelectorAll('Placemark').forEach(pm => {
    const nm = pm.querySelector('name')?.textContent ?? '';
    if (!/^Lap \d+$/.test(nm)) return;
    const desc = pm.querySelector('description')?.textContent ?? '';
    const tm = desc.match(/Time:\s*<\/td>\s*<td[^>]*>\s*(\d+):(\d+):(\d+)/);
    const dmm = desc.match(/Distance:\s*<\/td>\s*<td[^>]*>\s*([\d.]+)/);
    if (tm) {
      const sec = parseInt(tm[1])*3600 + parseInt(tm[2])*60 + parseInt(tm[3]);
      const km = dmm ? parseFloat(dmm[1]) : 1.0;
      laps.push({ name: nm, sec, km });
    }
  });

  return {
    coords, cumDists,
    totalKm: totalM / 1000,
    officialKm,
    totalSec,
    laps,
    name: folderName,
    dateText,
    // KML carries no heart rate or per-point time — no HR readout, no splits.
    hr: null, hasHr: false, avgHr: null, maxHr: null,
    splits: []
  };
}

// Garmin TCX — richer than KML: every <Trackpoint> carries position AND
// heart rate. Returns the same shape as parseKml() plus a per-point `hr`
// array (parallel to coords).
function parseTcx(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const tps = Array.from(doc.getElementsByTagName('Trackpoint'));

  const coords = [];
  const hr = [];
  let lastHr = null;
  for (const tp of tps) {
    const latN = tp.getElementsByTagName('LatitudeDegrees')[0];
    const lonN = tp.getElementsByTagName('LongitudeDegrees')[0];
    if (!latN || !lonN) continue;  // paused/indoor points carry no position
    const lon = parseFloat(lonN.textContent);
    const lat = parseFloat(latN.textContent);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;

    const hrN = tp.getElementsByTagName('HeartRateBpm')[0];
    let bpm = null;
    if (hrN) {
      const v = hrN.getElementsByTagName('Value')[0];
      if (v) bpm = parseInt(v.textContent, 10);
    }
    if (bpm == null || !Number.isFinite(bpm)) bpm = lastHr;  // carry forward gaps
    else lastHr = bpm;

    coords.push([lon, lat]);
    hr.push(bpm);
  }
  if (coords.length < 2) throw new Error('No positioned trackpoints found in TCX');

  // Backfill any leading nulls (HR before the first valid reading).
  const firstHr = hr.find(v => v != null) ?? null;
  for (let i = 0; i < hr.length; i++) if (hr[i] == null) hr[i] = firstHr;

  const cumDists = [0];
  for (let i = 1; i < coords.length; i++) {
    cumDists.push(cumDists[i-1] + haversineM(coords[i-1], coords[i]));
  }
  const totalM = cumDists[cumDists.length - 1];

  // Laps → totals + pace + per-km splits (moving time, pause-corrected).
  const laps = [];
  const splits = [];
  let totalSec = 0, officialM = 0;
  const lapNum = (n) => {
    const v = n?.getElementsByTagName('Value')[0]?.textContent;
    const x = v ? parseInt(v, 10) : NaN;
    return Number.isFinite(x) ? x : null;
  };
  Array.from(doc.getElementsByTagName('Lap')).forEach((lap, i) => {
    const sec = parseFloat(lap.getElementsByTagName('TotalTimeSeconds')[0]?.textContent ?? '0');
    const m = parseFloat(lap.getElementsByTagName('DistanceMeters')[0]?.textContent ?? '0');
    if (Number.isFinite(sec)) totalSec += sec;
    if (Number.isFinite(m)) officialM += m;
    if (sec > 0 && m > 0) {
      const km = m / 1000;
      laps.push({ name: `Lap ${i+1}`, sec, km });
      splits.push({
        idx: splits.length + 1,
        km, sec,
        paceSecPerKm: sec / km,
        avgHr: lapNum(lap.getElementsByTagName('AverageHeartRateBpm')[0]),
        maxHr: lapNum(lap.getElementsByTagName('MaximumHeartRateBpm')[0]),
        partial: km < 0.9
      });
    }
  });

  // HR summary for the end card.
  let hrSum = 0, hrCount = 0, maxHr = 0;
  for (const v of hr) {
    if (v == null) continue;
    hrSum += v; hrCount++;
    if (v > maxHr) maxHr = v;
  }
  const avgHr = hrCount ? Math.round(hrSum / hrCount) : null;

  // Name + date from the Activity (TCX has no friendly title — use the sport).
  const sport = doc.querySelector('Activity')?.getAttribute('Sport') ?? '';
  const idText = (doc.querySelector('Activity > Id') ?? doc.querySelector('Id'))
    ?.textContent?.trim() ?? '';
  let dateText = '';
  const d = idText ? new Date(idText) : null;
  if (d && !isNaN(d.getTime())) {
    const mon = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][d.getMonth()];
    dateText = `${d.getDate()} ${mon} ${d.getFullYear()}`;
  }

  return {
    coords, cumDists,
    totalKm: totalM / 1000,
    officialKm: officialM > 0 ? officialM / 1000 : null,
    totalSec: totalSec > 0 ? totalSec : null,
    laps,
    name: sport ? sport.toUpperCase() : 'ACTIVITY',
    dateText,
    hr, hasHr: hrCount > 0, avgHr, maxHr: maxHr || null,
    splits
  };
}

// Sniff the file: TCX has a TrainingCenterDatabase root, everything else
// falls through to the KML parser.
function parseActivity(text) {
  return /<TrainingCenterDatabase[\s>]/.test(text) ? parseTcx(text) : parseKml(text);
}

// Position interpolated at a distance along the route. Parameterized on
// routeData (flyby.html's copy reads a global instead).
function pointAtDist(routeData, d) {
  const { coords, cumDists } = routeData;
  const total = cumDists[cumDists.length-1];
  if (d <= 0) return coords[0];
  if (d >= total) return coords[coords.length-1];
  let lo = 0, hi = cumDists.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cumDists[mid] <= d) lo = mid; else hi = mid;
  }
  const segLen = cumDists[hi] - cumDists[lo];
  const f = segLen === 0 ? 0 : (d - cumDists[lo]) / segLen;
  return [
    coords[lo][0] + f * (coords[hi][0] - coords[lo][0]),
    coords[lo][1] + f * (coords[hi][1] - coords[lo][1])
  ];
}

// Heart rate interpolated at a distance along the route — mirrors pointAtDist.
function hrAtDist(routeData, d) {
  const { hr, cumDists } = routeData;
  if (!hr || hr.length === 0) return null;
  const total = cumDists[cumDists.length - 1];
  if (d <= 0) return hr[0];
  if (d >= total) return hr[hr.length - 1];
  let lo = 0, hi = cumDists.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cumDists[mid] <= d) lo = mid; else hi = mid;
  }
  const segLen = cumDists[hi] - cumDists[lo];
  const f = segLen === 0 ? 0 : (d - cumDists[lo]) / segLen;
  return hr[lo] + f * (hr[hi] - hr[lo]);
}

function fmtTime(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}
function fmtPace(secPerKm) {
  if (!isFinite(secPerKm) || secPerKm <= 0) return '—:—';
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2,'0')}`;
}

window.ActivityParsers = {
  haversineM, bearingDeg,
  parseKml, parseTcx, parseActivity,
  pointAtDist, hrAtDist,
  fmtTime, fmtPace
};
})();
