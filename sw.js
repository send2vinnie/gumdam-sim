// App-shell cache so the simulator installs and starts like an app on Windows and Android.
// Google map tiles are never cached here (they are streamed live, per Google's terms).
const CACHE = "gfs-v6";
const SHELL = ["./", "index.html", "config.js", "css/style.css", "js/app.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "models/gundam_rx78_18m.glb", "models/gundam_rx78_pullup_18m.glb",
  "models/gundam_rx78_18m_med.glb", "models/gundam_rx78_18m_low.glb", "models/gundam_rx78_pullup_18m_med.glb", "models/gundam_rx78_pullup_18m_low.glb",
  "models/pilot_stand.glb", "models/pilot_point.glb", "models/pilot_hips.glb", "models/pilot_helmetless.glb", "models/pilot_cross.glb"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== "GET") return; // CDN + Google tiles go straight to network
  // "no-cache" makes the browser check with the server every time, so a new version is never mixed with
  // files the browser's own HTTP cache still holds from the previous one (GitHub Pages allows 10 minutes).
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then((r) => { const copy = r.clone(); if (r.ok) caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});
