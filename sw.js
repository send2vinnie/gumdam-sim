// App-shell cache so the simulator installs and starts like an app on Windows and Android.
// Google map tiles are never cached here (they are streamed live, per Google's terms).
// The bundled offline city (cities/: PLATEAU Tokyo + OSM Nangang) is not precached because it is large;
// each file is cached the first time it is used, so areas you have visited also work offline.
const CACHE = "gfs-v34";
const CITY_CACHE = "gfs-cities-v1"; // kept across app updates; bump only when the city data changes
const SHELL = ["./", "index.html", "config.js", "css/style.css", "js/app.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "models/gundam_rx78_18m.glb", "models/gundam_rx78_pullup_18m.glb",
  "models/gundam_rx78_18m_med.glb", "models/gundam_rx78_18m_low.glb", "models/gundam_rx78_pullup_18m_med.glb", "models/gundam_rx78_pullup_18m_low.glb",
  "models/dragon.glb", "models/dragon_stand.glb", "models/trainer_stand.glb", "models/pilot_stand.glb", "models/pilot_point.glb", "models/pilot_hips.glb", "models/pilot_helmetless.glb", "models/pilot_cross.glb"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k !== CITY_CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== "GET") return; // CDN + Google tiles go straight to network
  if (url.pathname.includes("/cities/")) {
    // city data: cache-first (it only changes when CITY_CACHE is bumped)
    e.respondWith(caches.open(CITY_CACHE).then((c) => c.match(e.request).then((hit) => hit || fetch(e.request).then((r) => {
      if (r.ok) c.put(e.request, r.clone());
      return r;
    }))));
    return;
  }
  // "no-cache" makes the browser check with the server every time, so a new version is never mixed with
  // files the browser's own HTTP cache still holds from the previous one (GitHub Pages allows 10 minutes).
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then((r) => { const copy = r.clone(); if (r.ok) caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});
