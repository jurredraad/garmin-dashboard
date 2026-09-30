// Zet een Strava-archief (activities.csv + activities/) om naar src/strava.json,
// in hetzelfde formaat als de Garmin-activiteiten in data.json.
//   node tools/strava-import.mjs [map-met-export]     standaard: src/strava
// Ontdubbelen tegen Garmin gebeurt in de browser (app.js), zodat het klopt met de nieuwste Garmin-data.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { parseFit, FIT_MANUFACTURER } from "./fit.mjs";

const DIR = process.argv[2] ?? "src/strava";
const OUT = "src/strava.json";

// ---------- CSV (RFC 4180, velden kunnen komma's en regeleinden bevatten) ----------
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Kolommen op positie: de export heeft dubbele kolomnamen (bv. twee keer "Afstand", in km en in m).
const C = { id: 0, date: 1, name: 2, type: 3, file: 12, elapsed: 15, moving: 16, distance_m: 17,
  ascent: 20, avg_cadence: 29, max_hr: 30, avg_hr: 31, calories: 34 };
const num = s => s === "" || s == null ? null : Number(s.replace(",", "."));
const pos = v => v != null && v > 0 ? v : null;

// "29 sep 2026, 16:05:27" (UTC, Nederlandse maandnamen)
const MONTHS = { jan: 0, feb: 1, mrt: 2, apr: 3, mei: 4, jun: 5, jul: 6, aug: 7, sep: 8, okt: 9, nov: 10, dec: 11 };
function parseUtc(s) {
  const m = s.match(/(\d+) (\w+)\.? (\d{4}), (\d+):(\d+):(\d+)/);
  if (!m || MONTHS[m[2]] == null) throw new Error(`Onbekende datum: ${s}`);
  return Date.UTC(+m[3], MONTHS[m[2]], +m[1], +m[4], +m[5], +m[6]);
}
const localFmt = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit",
  day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const toLocal = ms => localFmt.format(new Date(ms)); // "2026-09-29 18:05:27"

const TYPES = { Hardloopsessie: "running", Wandeling: "walking", Krachttraining: "strength_training",
  Zwemmen: "lap_swimming", Fietsrit: "cycling", Wandeltocht: "hiking", Training: "training" };

// ---------- bestanden → punten { t (s), lat, lon, hr, dist (m), alt } ----------
const R = 6371000, rad = d => d * Math.PI / 180;
const haversine = (a, b) => {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

function readGpx(xml) {
  const pts = [];
  for (const m of xml.matchAll(/<trkpt lat="([-\d.]+)" lon="([-\d.]+)">([\s\S]*?)<\/trkpt>/g)) {
    const time = m[3].match(/<time>([^<]+)<\/time>/)?.[1];
    if (!time) continue;
    pts.push({ ms: Date.parse(time), lat: +m[1], lon: +m[2],
      alt: num(m[3].match(/<ele>([^<]+)<\/ele>/)?.[1] ?? ""),
      hr: num(m[3].match(/<(?:gpxtpx:)?hr>(\d+)</)?.[1] ?? "") });
  }
  let d = 0;
  pts.forEach((p, i) => { if (i) d += haversine(pts[i - 1], p); p.dist = d; });
  return { pts, device: "Strava-app" };
}

function readFitFile(buf) {
  const fit = parseFit(buf);
  const man = fit.file_id[0]?.manufacturer;
  const pts = fit.record.filter(r => r.timestamp).map(r => ({ ms: r.timestamp, lat: r.lat, lon: r.lon,
    alt: r.altitude, hr: pos(r.hr), dist: r.distance, cadence: pos(r.cadence) }));
  // Runna e.d. schrijven soms geen afstand per record: dan uit GPS berekenen
  if (!pts.some(p => p.dist > 0)) {
    let d = 0, prev = null;
    for (const p of pts) { if (p.lat != null) { if (prev) d += haversine(prev, p); prev = p; } p.dist = d; }
  }
  return { pts, device: FIT_MANUFACTURER[man] ?? (man === 337 ? "Runna" : `fabrikant ${man}`), session: fit.session[0] };
}

// ---------- afgeleide velden in Garmin-formaat ----------
const paceStr = (s, m) => {
  if (!s || !m || m < 100) return null;
  const spk = s / (m / 1000);
  return `${Math.floor(spk / 60)}:${String(Math.round(spk % 60)).padStart(2, "0")} /km`.replace(/:60 /, ":59 ");
};

// Series: [sec, hr, speed m/s, dist m, elev] — zoals Garmin, maximaal ~800 punten.
function toDetail(pts) {
  if (pts.length < 2) return null;
  const t0 = pts[0].ms;
  const step = Math.max(1, Math.ceil(pts.length / 800));
  const series = [];
  for (let i = 0; i < pts.length; i += step) {
    const p = pts[i];
    // snelheid over ±10 s om GPS-ruis te dempen
    const a = pts[Math.max(0, i - 5 * step)], b = pts[Math.min(pts.length - 1, i + 5 * step)];
    const dt = (b.ms - a.ms) / 1000;
    const speed = dt > 0 && b.dist != null && a.dist != null ? (b.dist - a.dist) / dt : null;
    series.push([Math.round((p.ms - t0) / 1000), p.hr ?? null, speed != null ? +speed.toFixed(2) : null,
      p.dist != null ? Math.round(p.dist) : null, p.alt != null ? +p.alt.toFixed(1) : null]);
  }
  const gps = pts.filter(p => p.lat != null && p.lon != null);
  const rstep = Math.max(1, Math.ceil(gps.length / 400));
  const route = gps.filter((_, i) => i % rstep === 0 || i === gps.length - 1).map(p => [+p.lat.toFixed(5), +p.lon.toFixed(5)]);

  // rondes per km + snelste 1/5/10 km (tweepuntsvenster over de afstand)
  const laps = [], best = {};
  let lapStart = pts[0];
  for (const p of pts) {
    if (p.dist - lapStart.dist >= 1000 || p === pts[pts.length - 1]) {
      const seg = pts.filter(q => q.ms >= lapStart.ms && q.ms <= p.ms);
      const hrs = seg.map(q => q.hr).filter(Boolean);
      let gain = 0;
      for (let i = 1; i < seg.length; i++) { const d = (seg[i].alt ?? 0) - (seg[i - 1].alt ?? 0); if (d > 0) gain += d; }
      if (p.dist - lapStart.dist > 20) laps.push({ distance: Math.round(p.dist - lapStart.dist), duration: (p.ms - lapStart.ms) / 1000,
        avg_hr: hrs.length ? Math.round(hrs.reduce((x, y) => x + y, 0) / hrs.length) : null,
        max_hr: hrs.length ? Math.max(...hrs) : null, elev_gain: +gain.toFixed(1), cadence: null });
      lapStart = p;
    }
  }
  for (const [k, m] of [["1k", 1000], ["5k", 5000], ["10k", 10000]]) {
    let j = 0, bestS = Infinity;
    for (let i = 0; i < pts.length; i++) {
      while (j < pts.length && pts[j].dist - pts[i].dist < m) j++;
      if (j >= pts.length) break;
      bestS = Math.min(bestS, (pts[j].ms - pts[i].ms) / 1000);
    }
    if (bestS < Infinity) best[k] = Math.round(bestS);
  }
  return { series, route, laps, best };
}

// Hartslagzones: grenzen afleiden uit de Garmin-activiteiten (tijd per zone vs. hartslagverloop).
function inferZoneBounds() {
  if (!existsSync("src/data.json")) return null;
  const acts = JSON.parse(readFileSync("src/data.json", "utf8")).activities
    .filter(a => a.zones && a.detail?.series?.filter(r => r[1]).length > 100);
  if (!acts.length) return null;
  const cost = bounds => acts.reduce((sum, a) => {
    const got = [0, 0, 0, 0, 0], s = a.detail.series;
    for (let i = 1; i < s.length; i++) {
      const hr = s[i][1]; if (!hr) continue;
      const z = bounds.filter(b => hr >= b).length - 1;
      if (z >= 0) got[z] += s[i][0] - s[i - 1][0];
    }
    return sum + got.reduce((e, g, k) => e + Math.abs(g - (a.zones[k] || 0)), 0);
  }, 0);
  let b = [100, 120, 140, 160, 175], c = cost(b);
  for (let pass = 0; pass < 6; pass++) {
    for (let k = 0; k < 5; k++) for (const d of [-8, -4, -2, -1, 1, 2, 4, 8]) {
      const nb = b.slice(); nb[k] += d;
      if (nb.some((v, i) => i && v <= nb[i - 1])) continue;
      const nc = cost(nb); if (nc < c) { b = nb; c = nc; }
    }
  }
  return b;
}

function zonesFrom(pts, bounds) {
  if (!bounds || !pts.some(p => p.hr)) return null;
  const z = [0, 0, 0, 0, 0];
  for (let i = 1; i < pts.length; i++) {
    const hr = pts[i].hr; if (!hr) continue;
    const k = bounds.filter(b => hr >= b).length - 1;
    if (k >= 0) z[k] += Math.min(10, (pts[i].ms - pts[i - 1].ms) / 1000);
  }
  return z.map(v => Math.round(v));
}

// ---------- hoofdprogramma ----------
const [header, ...rows] = parseCsv(readFileSync(`${DIR}/activities.csv`, "utf8"));
if (header[C.date] !== "Datum van activiteit") throw new Error(`Onverwachte kolommen: ${header.slice(0, 4).join(", ")}`);
const bounds = inferZoneBounds();
console.log(bounds ? `Hartslagzones afgeleid uit Garmin: vanaf ${bounds.join(" / ")} bpm` : "Geen Garmin-data voor hartslagzones");

const out = [];
let skipped = 0;
for (const r of rows.filter(r => r[C.id])) {
  const startMs = parseUtc(r[C.date]);
  let file = null;
  if (r[C.file]) {
    const path = `${DIR}/${r[C.file]}`;
    if (existsSync(path)) {
      const raw = readFileSync(path);
      const buf = path.endsWith(".gz") ? gunzipSync(raw) : raw;
      file = path.includes(".fit") ? readFitFile(buf) : path.includes(".gpx") ? readGpx(buf.toString("utf8")) : null;
    }
  }
  // Opgenomen met een Garmin: die staat al in Garmin Connect en dus in data.json
  if (file?.device === "Garmin") { skipped++; continue; }
  const pts = file?.pts ?? [];
  const hrs = pts.map(p => p.hr).filter(Boolean);
  const type = TYPES[r[C.type]] ?? r[C.type].toLowerCase();
  const distance_m = pos(num(r[C.distance_m]));
  const moving = pos(num(r[C.moving]));
  // Strava's cadans is per been; Garmin toont stappen per minuut (×2)
  const cad = pos(num(r[C.avg_cadence])) ?? pos(file?.session?.avg_cadence);
  out.push({
    id: `strava-${r[C.id]}`,
    source: "strava",
    device: file?.device ?? "handmatig",
    name: r[C.name],
    type,
    start: toLocal(startMs),
    start_utc: new Date(startMs).toISOString(),
    duration_s: num(r[C.elapsed]),
    moving_s: moving,
    distance_km: distance_m ? +(distance_m / 1000).toFixed(2) : null,
    pace: type.includes("run") || type === "walking" ? paceStr(moving, distance_m) : null,
    avg_hr: pos(num(r[C.avg_hr])) ?? (hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null),
    max_hr: pos(num(r[C.max_hr])) ?? (hrs.length ? Math.max(...hrs) : null),
    calories: pos(num(r[C.calories])),
    elevation_gain_m: pos(num(r[C.ascent])),
    avg_cadence: cad ? Math.round(cad * 2) : null,
    zones: zonesFrom(pts, bounds),
    effect: null, aerobic_te: null, anaerobic_te: null, vo2max: null,
    detail: toDetail(pts),
  });
}
out.sort((a, b) => b.start.localeCompare(a.start));
writeFileSync(OUT, JSON.stringify(out));
const by = out.reduce((m, a) => (m[a.device] = (m[a.device] || 0) + 1, m), {});
console.log(`${out.length} Strava-activiteiten naar ${OUT} (${skipped} van een Garmin overgeslagen):`, by);
