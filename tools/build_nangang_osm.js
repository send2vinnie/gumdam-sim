// Rebuild cities/taipei/nangang-osm-v2.geojson: OpenStreetMap buildings around the Nangang start screen.
// usage: node --use-system-ca tools/build_nangang_osm.js [radius_m]
// Heights: height tag, else building:levels x 3.2 m (+ roof:levels), else a default by building type.
// Bases: min_height, else building:min_level x 3.2 m. Multipolygon relations keep their holes.
// Data © OpenStreetMap contributors, ODbL 1.0.
const fs = require("fs"), path = require("path");
const LAT0 = 25.0556, LON0 = 121.6176, R = +(process.argv[2] || 1000);
const OUT = path.join(__dirname, "..", "cities", "taipei", "nangang-osm-v2.geojson");
const LEVEL = 3.2;
const DEFAULTS = { house: 7, detached: 7, residential: 10, apartments: 18, roof: 4, shed: 3, garage: 3, garages: 3, kiosk: 3, toilets: 3, hut: 3, service: 4, transformer_tower: 6, construction: 10 };
const num = (v) => { if (v == null) return NaN; const m = String(v).replace(",", ".").match(/-?\d+(\.\d+)?/); return m ? +m[0] : NaN; };

function heights(t) {
  let h = num(t.height);
  if (!(h > 0)) { const lv = num(t["building:levels"]); if (lv > 0) h = (lv + (num(t["roof:levels"]) || 0)) * LEVEL; }
  if (!(h > 0)) h = DEFAULTS[t.building] || 10;
  let mh = num(t.min_height);
  if (!(mh >= 0)) { const ml = num(t["building:min_level"]); mh = ml > 0 ? ml * LEVEL : 0; }
  if (mh >= h) mh = 0;
  return { h: +h.toFixed(1), mh: +mh.toFixed(1) };
}

// join way segments (lists of [lon,lat]) into closed rings
function rings(segs) {
  const out = [], pool = segs.map((s) => s.slice());
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  while (pool.length) {
    let ring = pool.shift();
    let grew = true;
    while (!same(ring[0], ring[ring.length - 1]) && grew) {
      grew = false;
      for (let i = 0; i < pool.length; i++) {
        const s = pool[i], end = ring[ring.length - 1];
        if (same(s[0], end)) ring = ring.concat(s.slice(1));
        else if (same(s[s.length - 1], end)) ring = ring.concat(s.slice(0, -1).reverse());
        else continue;
        pool.splice(i, 1); grew = true; break;
      }
    }
    if (ring.length >= 4 && same(ring[0], ring[ring.length - 1])) out.push(ring);
  }
  return out;
}

(async () => {
  const q = `[out:json][timeout:120];(way[building](around:${R},${LAT0},${LON0});relation[building][type=multipolygon](around:${R},${LAT0},${LON0}););out geom;`;
  let j;
  const servers = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
  for (let attempt = 0; attempt < 8 && !j; attempt++) {   // public Overpass servers are often busy: retry with backoff
    const url = servers[attempt % servers.length];
    if (attempt > 1) await new Promise((r) => setTimeout(r, 5000 * attempt));
    try {
      const r = await fetch(url, { method: "POST", headers: { "User-Agent": "gundam-sim-city-builder" }, body: "data=" + encodeURIComponent(q) });
      j = JSON.parse(await r.text()); break;
    } catch (e) { console.warn(url, e.message.slice(0, 80)); }
  }
  if (!j) throw new Error("no Overpass server answered");
  const pt = (g) => [+g.lon.toFixed(6), +g.lat.toFixed(6)];
  const feats = [];
  for (const e of j.elements) {
    let polys = [];
    if (e.type === "way" && e.geometry) {
      const ring = e.geometry.map(pt);
      if (ring.length >= 4 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) polys = [[ring]];
    } else if (e.type === "relation") {
      const outer = rings(e.members.filter((m) => m.role === "outer" && m.geometry).map((m) => m.geometry.map(pt)));
      const inner = rings(e.members.filter((m) => m.role === "inner" && m.geometry).map((m) => m.geometry.map(pt)));
      polys = outer.map((o) => [o, ...inner]);   // holes attached to each outer (Cesium ignores holes outside it)
    }
    const { h, mh } = heights(e.tags || {});
    for (const coords of polys) feats.push({ type: "Feature", properties: mh ? { h, mh } : { h }, geometry: { type: "Polygon", coordinates: coords } });
  }
  const fc = { type: "FeatureCollection", attribution: "© OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright)",
    source: `Overpass API, OSM data as of ${j.osm3s.timestamp_osm_base}, buildings within ${R} m of ${LAT0},${LON0}`, features: feats };
  fs.writeFileSync(OUT, JSON.stringify(fc));
  const tagged = j.elements.filter((e) => e.tags && (e.tags.height || e.tags["building:levels"])).length;
  console.log(`${feats.length} buildings (${tagged} with height or levels), ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB -> ${OUT}`);
})().catch((e) => { console.error(e); process.exit(1); });
