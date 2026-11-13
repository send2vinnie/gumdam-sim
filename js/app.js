/* Gundam Flight Simulator — CesiumJS + Google Photorealistic 3D Tiles.
 * All distances are metres. Models are authored at true scale:
 *   gundam_rx78_18m.glb         static flight model, 18.0 m head height, feet at origin, faces +X
 *   gundam_rx78_pullup_18m.glb  skinned model with a 14.7 s "PullUp" loop (3 reps), same scale
 *   pilot_*.glb                 1.75 m pilots, faces +X
 * Models are added with scale 1 and minimumPixelSize 0, so nothing is ever enlarged on screen.
 */
(function () {
  "use strict";
  // ---- on-screen error overlay (so problems are visible on phones) ----------
  let fatalBox = null;
  function showFatal(msg) {
    try {
      if (!fatalBox) {
        fatalBox = document.createElement("div");
        fatalBox.style.cssText = "position:fixed;left:8px;right:8px;bottom:8px;max-height:60vh;overflow:auto;z-index:2147483647;" +
          "background:rgba(10,12,20,0.94);color:#fff;font:12px/1.4 monospace;white-space:pre-wrap;word-wrap:break-word;" +
          "padding:12px;border:1px solid #f55;border-radius:8px;";
        fatalBox.title = "Tap to dismiss";
        fatalBox.addEventListener("click", () => { fatalBox.remove(); fatalBox = null; });
        (document.body || document.documentElement).appendChild(fatalBox);
        fatalBox.textContent = "Device: " + navigator.userAgent + "\n(tap to dismiss)";
      }
      fatalBox.textContent = String(msg) + "\n\n" + fatalBox.textContent;
    } catch (e) { /* ignore */ }
  }
  window.addEventListener("error", (e) => showFatal("JS error: " + e.message + " @" + e.filename + ":" + e.lineno));
  window.addEventListener("unhandledrejection", (e) => showFatal("Promise error: " + ((e.reason && (e.reason.stack || e.reason.message)) || e.reason)));
  if (typeof Cesium === "undefined") { showFatal("CesiumJS failed to load from cdn.jsdelivr.net"); return; }
  const C = Cesium;
  const CFG = window.SIM_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const DEG = Math.PI / 180;
  const R_EARTH = 6378137;

  // ---- true-scale constants -------------------------------------------------
  const MS_HEIGHT = 18.0;          // RX-78-02 head height (m)
  const MS_CENTER = 9.0;           // pivot for lean/bank (m above feet)
  const PILOT_HEIGHT = 1.75;
  const BAR_HEIGHT = 22.18;        // centre of the closed fists in the pull-up rig (feet 0.6 m off the ground at full hang)
  const BAR_FORWARD = 0.21;        // bar offset along the Gundam's facing axis (the fists close around it)
  const BAR_RADIUS = 0.20;         // round bar the fingers wrap around
  const BAR_LENGTH = 13.0;
  const POST_SPAN = 6.2;           // half distance between the two posts

  // ---- settings (localStorage, guarded) ------------------------------------
  const store = {
    get(k, d) { try { const v = localStorage.getItem("gfs." + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("gfs." + k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  };
  const isTouch = window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
  const settings = {
    key: (store.get("key", "") || CFG.googleMapsApiKey || "").trim(),
    quality: store.get("quality", isTouch ? "low" : "medium"),
    invertY: store.get("invertY", false),
    showFps: store.get("showFps", false)
  };
  // 3D detail: chosen live in Settings. Until the user picks, the defaults follow the graphics quality.
  const CITY_SSE = { verylow: 64, low: 32, medium: 16, high: 8, ultra: 4 };
  const CITY_NAMES = { verylow: "Very low", low: "Low", medium: "Medium", high: "High", ultra: "Ultra" };
  const MODEL_NAMES = { low: "Low", medium: "Medium", high: "High" };
  const lowMem = isTouch && navigator.deviceMemory !== undefined && navigator.deviceMemory <= 4;
  const storedCity = store.get("cityDetail", null);
  settings.cityDetail = CITY_SSE[storedCity] ? storedCity
    : lowMem ? "verylow" : ({ low: "low", medium: "medium", high: "high" }[settings.quality] || (isTouch ? "low" : "medium"));
  settings.modelDetail = MODEL_NAMES[store.get("modelDetail", null)] ? store.get("modelDetail", null) : (isTouch ? "medium" : "high");
  function modelUrl(kind) {
    const base = kind === "pullup" ? "models/gundam_rx78_pullup_18m" : "models/gundam_rx78_18m";
    return base + ({ low: "_low", medium: "_med", high: "" }[settings.modelDetail] || "") + ".glb";
  }
  const QUALITY = {
    low:    { sse: 32, browserRes: true,  fxaa: false, shadows: false, cacheBytes: 256 * 1024 * 1024 },
    medium: { sse: 16, browserRes: true,  fxaa: true,  shadows: false, cacheBytes: 512 * 1024 * 1024 },
    high:   { sse: 8,  browserRes: false, fxaa: true,  shadows: true,  cacheBytes: 1024 * 1024 * 1024 }
  }[settings.quality] || { sse: 16, browserRes: true, fxaa: true, shadows: false, cacheBytes: 512 * 1024 * 1024 };

  // ---- viewer ---------------------------------------------------------------
  function makeViewer(extra) {
    return new C.Viewer("cesiumContainer", Object.assign({
      baseLayer: false, baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false,
      navigationHelpButton: false, animation: false, timeline: false, fullscreenButton: false, infoBox: false,
      selectionIndicator: false, vrButton: false, projectionPicker: false,
      terrainProvider: new C.EllipsoidTerrainProvider(),
      useBrowserRecommendedResolution: QUALITY.browserRes,
      msaaSamples: QUALITY.fxaa ? 4 : 1,
      shadows: QUALITY.shadows
    }, extra || {}));
  }
  let viewer;
  try {
    viewer = makeViewer(isTouch ? {
      msaaSamples: 1,
      contextOptions: { webgl: { powerPreference: "default", antialias: false, preserveDrawingBuffer: false, failIfMajorPerformanceCaveat: false } }
    } : undefined);
  } catch (e1) {
    console.error(e1);
    try {
      document.getElementById("cesiumContainer").innerHTML = "";
      viewer = makeViewer({ msaaSamples: 1, contextOptions: { requestWebgl1: true, webgl: { antialias: false, failIfMajorPerformanceCaveat: false } } });
    } catch (e2) {
      console.error(e2);
      showFatal("WebGL could not start: " + (e2.message || e2) + "\n(first attempt: " + (e1.message || e1) + ")");
      return;
    }
  }
  const scene = viewer.scene;
  const camera = scene.camera;
  scene.renderError.addEventListener((s, e) => showFatal("Render error: " + ((e && (e.stack || e.message)) || e)));
  scene.postProcessStages.fxaa.enabled = isTouch ? false : QUALITY.fxaa;
  scene.screenSpaceCameraController.enableInputs = false;
  scene.skyAtmosphere.show = true;
  scene.fog.enabled = true;
  scene.highDynamicRange = false;
  viewer.clock.shouldAnimate = true;
  viewer.clock.multiplier = 1;
  // early afternoon local time (UTC+8 Taipei / UTC+9 Tokyo) for good sun on the city
  viewer.clock.currentTime = C.JulianDate.fromIso8601("2026-05-02T05:00:00Z");
  if (viewer.shadowMap) { viewer.shadowMap.maximumDistance = 600; viewer.shadowMap.softShadows = true; viewer.shadowMap.darkness = 0.55; }

  // ---- lighting: fill the shadow sides ------------------------------------------
  // Cesium's default sky light leaves walls facing away from the sun nearly black. A bright, even sky fill
  // (spherical harmonics, constant term only) lifts them while sunlit walls keep the normal sun.
  const SKY_FILL = [new C.Cartesian3(1.60, 1.63, 1.72)].concat(Array.from({ length: 8 }, () => new C.Cartesian3(0, 0, 0)));
  const skyLight = () => new C.ImageBasedLighting({ sphericalHarmonicCoefficients: SKY_FILL, imageBasedLightingFactor: new C.Cartesian2(1.0, 0.6) });
  // extruded OSM buildings: same idea, as a small shader (ambient floor + sun term)
  const OSM_FS = `
in vec3 v_positionEC;
in vec3 v_normalEC;
in vec4 v_color;
void main() {
  vec3 n = normalize(v_normalEC);
  float sun = max(dot(n, czm_lightDirectionEC), 0.0);
  out_FragColor = vec4(min(v_color.rgb * (0.78 + 0.32 * sun), vec3(1.0)), v_color.a);
}`;

  // City source: "google" (Photorealistic 3D Tiles, online, needs a key) or "local" (bundled PLATEAU Tokyo + OSM Nangang)
  const CITY_SOURCES = { local: "Local (offline): PLATEAU Tokyo + OSM Nangang", google: "Google Photorealistic (online, needs API key)" };
  // Local maps are the default for everyone. Google is used only after the user picks it in Settings
  // ("citySourceChosen" marks a real choice; values saved automatically by older versions are ignored).
  settings.citySource = store.get("citySourceChosen", false) && CITY_SOURCES[store.get("citySource", null)] ? store.get("citySource", null) : "local";
  const tilesets = [];          // every 3D Tiles city layer currently shown
  let worldMode = "demo";       // "google" | "local" | "demo"
  let demoMode = false;
  let localWorld = null;        // { ground, osm: { features } } once the local city is loaded
  const allTilesLoaded = () => tilesets.every((t) => t.tilesLoaded);

  async function initWorld() {
    if (settings.citySource === "google") {
      if (settings.key) {
        try {
          C.GoogleMaps.defaultApiKey = settings.key;
          const ts = await C.createGooglePhotorealistic3DTileset(undefined, {
            maximumScreenSpaceError: CITY_SSE[settings.cityDetail],
            cacheBytes: lowMem ? 192 * 1024 * 1024 : QUALITY.cacheBytes,
            showCreditsOnScreen: true,
            imageBasedLighting: skyLight(),
            dynamicScreenSpaceError: true,
            preferLeaves: false
          });
          scene.primitives.add(ts); tilesets.push(ts);
          scene.globe.show = false;
          worldMode = "google";
          return;
        } catch (e) {
          console.error(e);
          showFatal("Google 3D Tiles failed to load: " + (e.message || e));
          setStatus("Google 3D Tiles failed to load: " + (e.message || e) + ". Check the API key and that the Map Tiles API is enabled. Using the offline city instead.", true);
        }
      } else {
        setStatus("Google city needs an API key (Settings). Using the offline city instead.", true);
      }
    }
    try { await initLocalWorld(); worldMode = "local"; return; }
    catch (e) { console.error(e); showFatal("Offline city failed to load: " + (e.message || e)); }
    demoMode = true;
    scene.globe.show = true;
    scene.globe.baseColor = C.Color.fromCssColorString("#2b3442");
    viewer.imageryLayers.addImageryProvider(new C.GridImageryProvider({
      cells: 8, color: C.Color.fromCssColorString("#7dffb0").withAlpha(0.35),
      glowColor: C.Color.TRANSPARENT, backgroundColor: C.Color.fromCssColorString("#1d2633"), tileWidth: 256, tileHeight: 256
    }));
  }

  // ---- local (offline) city -------------------------------------------------
  // PLATEAU tiles use ellipsoidal heights. The ground under them is a terrain built from each building's base height
  // (cities/tokyo/ground.json + .bin grids), so streets, roofs and landing all line up. Elsewhere the ground is the ellipsoid.
  const LOCAL_WARDS = ["shinjuku", "shibuya", "minato", "chiyoda", "sumida", "koto"];
  const LOCAL_CREDITS = {
    plateau: "3D都市モデル Project PLATEAU（国土交通省）を加工して作成",
    osm: "© OpenStreetMap contributors (ODbL)"
  };
  async function loadGround() {
    const idx = await (await fetch("cities/tokyo/ground.json")).json();
    const areas = await Promise.all(idx.areas.map(async (a) => {
      const buf = await (await fetch("cities/tokyo/" + a.file)).arrayBuffer();
      return Object.assign({}, a, { data: new Int16Array(buf) });
    }));
    const MARGIN = 0.2; // degrees (~20 km): beyond a grid's edge its border height is held this far, then the ellipsoid
    function heightAt(lon, lat) {
      let best = null, bestD = Infinity;
      for (const a of areas) {
        const dx = lon < a.west ? a.west - lon : lon > a.east ? lon - a.east : 0;
        const dy = lat < a.south ? a.south - lat : lat > a.north ? lat - a.north : 0;
        const d = Math.max(dx, dy); if (d < bestD) { bestD = d; best = a; }
      }
      if (!best || bestD > MARGIN) return 0;
      const a = best, n = a.size;
      const fx = Math.min(Math.max((lon - a.west) / (a.east - a.west), 0), 1) * (n - 1);
      const fy = Math.min(Math.max((lat - a.south) / (a.north - a.south), 0), 1) * (n - 1);
      const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(x0 + 1, n - 1), y1 = Math.min(y0 + 1, n - 1), tx = fx - x0, ty = fy - y0;
      const v = (x, y) => a.data[y * n + x] / 10;
      return (v(x0, y0) * (1 - tx) + v(x1, y0) * tx) * (1 - ty) + (v(x0, y1) * (1 - tx) + v(x1, y1) * tx) * ty;
    }
    return { heightAt, geoidOffset: idx.geoidOffset };
  }
  async function initLocalWorld() {
    const ground = await loadGround();
    const W = 33, H = 33;
    const provider = new C.CustomHeightmapTerrainProvider({
      width: W, height: H,
      callback: (x, y, level) => {
        const rect = provider.tilingScheme.tileXYToRectangle(x, y, level);
        const out = new Float32Array(W * H);
        for (let r = 0; r < H; r++) {
          const lat = (rect.north - (rect.north - rect.south) * r / (H - 1)) / DEG;
          for (let c = 0; c < W; c++) out[r * W + c] = ground.heightAt((rect.west + (rect.east - rect.west) * c / (W - 1)) / DEG, lat);
        }
        return out;
      }
    });
    scene.terrainProvider = provider;
    scene.globe.show = true;
    scene.globe.depthTestAgainstTerrain = true;
    scene.globe.baseColor = C.Color.fromCssColorString("#4a4f55");
    viewer.imageryLayers.addImageryProvider(new C.GridImageryProvider({
      cells: 4, color: C.Color.fromCssColorString("#ffffff").withAlpha(0.08),
      glowColor: C.Color.TRANSPARENT, backgroundColor: C.Color.fromCssColorString("#4a4f55"), tileWidth: 256, tileHeight: 256
    }));
    for (const w of LOCAL_WARDS) {
      const ts = await C.Cesium3DTileset.fromUrl("cities/tokyo/" + w + "/tileset.json", {
        maximumScreenSpaceError: CITY_SSE[settings.cityDetail],
        cacheBytes: lowMem ? 128 * 1024 * 1024 : Math.min(QUALITY.cacheBytes, 512 * 1024 * 1024),
        dynamicScreenSpaceError: true,
        imageBasedLighting: skyLight(),
        shadows: QUALITY.shadows ? C.ShadowMode.ENABLED : C.ShadowMode.DISABLED
      });
      scene.primitives.add(ts); tilesets.push(ts);
    }
    const osm = await (await fetch("cities/taipei/nangang-buildings.geojson")).json();
    const instances = [];
    for (const f of osm.features) {
      const ring = f.geometry.coordinates[0];
      const holes = f.geometry.coordinates.slice(1).map((h) => new C.PolygonHierarchy(C.Cartesian3.fromDegreesArray(h.flat())));
      try {
        instances.push(new C.GeometryInstance({
          geometry: new C.PolygonGeometry({
            polygonHierarchy: new C.PolygonHierarchy(C.Cartesian3.fromDegreesArray(ring.flat()), holes),
            height: f.properties.mh || 0, extrudedHeight: f.properties.h, vertexFormat: C.PerInstanceColorAppearance.VERTEX_FORMAT
          }),
          attributes: { color: C.ColorGeometryInstanceAttribute.fromColor(C.Color.fromCssColorString("#b9b6ae")) }
        }));
      } catch (e) { /* skip a malformed footprint */ }
    }
    scene.primitives.add(new C.Primitive({ geometryInstances: instances, appearance: new C.PerInstanceColorAppearance({ translucent: false, fragmentShaderSource: OSM_FS }), shadows: QUALITY.shadows ? C.ShadowMode.ENABLED : C.ShadowMode.DISABLED }));
    for (const txt of [LOCAL_CREDITS.plateau, LOCAL_CREDITS.osm]) viewer.creditDisplay.addStaticCredit(new C.Credit(txt, true));
    localWorld = { ground, osm };
  }

  // open, level ground near a point from the OSM footprints: the nearest grid point at least 25 m from every building
  function openGroundFromOsm(lat0, lon0, radius) {
    const mLat = R_EARTH * DEG, mLon = R_EARTH * DEG * Math.cos(lat0 * DEG);
    const polys = localWorld.osm.features.map((f) => f.geometry.coordinates[0].map(([x, y]) => [(x - lon0) * mLon, (y - lat0) * mLat]));
    const inside = (px, py, p) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const [xi, yi] = p[i], [xj, yj] = p[j]; if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c; } return c; };
    const segDist = (px, py, [ax, ay], [bx, by]) => { const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy; const t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0; return Math.hypot(px - ax - t * dx, py - ay - t * dy); };
    const clearance = (px, py) => { let d = Infinity; for (const p of polys) { if (inside(px, py, p)) return 0; for (let i = 1; i < p.length; i++) d = Math.min(d, segDist(px, py, p[i - 1], p[i])); } return d; };
    const cands = [];
    for (let y = -radius; y <= radius; y += 10) for (let x = -radius; x <= radius; x += 10) if (x * x + y * y <= radius * radius) cands.push([x, y, Math.hypot(x, y)]);
    cands.sort((a, b) => a[2] - b[2]);
    for (const [x, y] of cands) if (clearance(x, y) >= 32) return { lat: lat0 + y / mLat, lon: lon0 + x / mLon, h: 0 };
    return { lat: lat0, lon: lon0, h: 0 };
  }

  function setStatus(msg, warn) { const s = $("status"); s.textContent = msg || ""; s.classList.toggle("warn", !!warn); }

  // ---- helpers ---------------------------------------------------------------
  const scratchCarto = new C.Cartographic();
  function groundHeightAt(lon, lat, exclude) {
    // height of the rendered surface (roof, street or terrain) below this point, metres above ellipsoid
    if (!scene.sampleHeightSupported) return undefined;
    scratchCarto.longitude = lon * DEG; scratchCarto.latitude = lat * DEG; scratchCarto.height = 0;
    if (demoMode) return 0;
    let h;
    try { h = scene.sampleHeight(scratchCarto, exclude, 1.5); } catch (e) { h = undefined; }
    if (localWorld) {
      // the street level is known from the data, so it is the floor: picking the globe can hit a coarse terrain
      // tile's skirt far below the street before the detailed tile has loaded
      const street = localWorld.ground.heightAt(lon, lat);
      if (h === undefined || !isFinite(h) || h < street - 1) h = street;
    }
    return h;
  }
  function offsetLL(lat, lon, east, north) {
    return { lat: lat + (north / R_EARTH) / DEG, lon: lon + (east / (R_EARTH * Math.cos(lat * DEG))) / DEG };
  }
  function modelMatrixFor(lat, lon, h, azimuthDeg, pitch, roll, pivot) {
    const center = C.Cartesian3.fromDegrees(lon, lat, h + (pivot || 0));
    const hpr = new C.HeadingPitchRoll((azimuthDeg - 90) * DEG, pitch || 0, roll || 0); // Cesium heading 0 = +X east
    const m = C.Transforms.headingPitchRollToFixedFrame(center, hpr);
    if (pivot) C.Matrix4.multiply(m, C.Matrix4.fromTranslation(new C.Cartesian3(0, 0, -pivot)), m);
    return m;
  }
  async function loadModel(url, matrix, opts) {
    const model = await C.Model.fromGltfAsync(Object.assign({
      url, modelMatrix: matrix, scale: 1.0, forwardAxis: C.Axis.X, upAxis: C.Axis.Y, minimumPixelSize: 0, maximumScale: 1.0,
      shadows: QUALITY.shadows ? C.ShadowMode.ENABLED : C.ShadowMode.DISABLED,
      backFaceCulling: false,
      imageBasedLighting: skyLight()
    }, opts || {}));
    scene.primitives.add(model);
    return model;
  }
  // Turn a model's "head" node (split out of the flight model, pivoted at the neck; model units, face along +Z, up +Y).
  // yaw > 0 turns the head to the character's right, pitch > 0 looks up.
  const HEAD_PIVOT = new C.Cartesian3(0, 40.45, 0);
  const scratchHeadRot = new C.Matrix3(), scratchHeadYaw = new C.Matrix3(), scratchHeadPitch = new C.Matrix3();
  function poseHead(model, yaw, pitch) {
    if (!model || !model.ready) return;
    let node = model.__headNode;
    if (node === undefined) { try { node = model.getNode("head") || null; } catch (e) { node = null; } model.__headNode = node; }
    if (!node) return;
    C.Matrix3.fromRotationY(-yaw, scratchHeadYaw);
    C.Matrix3.fromRotationX(-pitch, scratchHeadPitch);
    C.Matrix3.multiply(scratchHeadYaw, scratchHeadPitch, scratchHeadRot);
    node.matrix = C.Matrix4.fromRotationTranslation(scratchHeadRot, HEAD_PIVOT, node.matrix ? C.Matrix4.clone(node.matrix) : new C.Matrix4());
  }

  function whenReady(model) {
    return new Promise((resolve) => {
      if (model.ready) return resolve(true);
      model.readyEvent.addEventListener(() => resolve(true));
      model.errorEvent.addEventListener(() => resolve(false));
    });
  }

  // ---- 3D detail (applied live from Settings) -------------------------------
  function applyCityDetail() {
    for (const t of tilesets) t.maximumScreenSpaceError = CITY_SSE[settings.cityDetail];
  }
  function updateDetailInfo() {
    const txt = "Gundam: " + MODEL_NAMES[settings.modelDetail] + " · City: " + CITY_NAMES[settings.cityDetail];
    for (const id of ["detailInfoPause", "detailInfoSettings"]) { const el = $(id); if (el) el.textContent = txt; }
  }
  let modelGen = 0;
  async function swapModel(old, url, opts, onReady) {
    // load the replacement next to the old one, then remove the old one once the new one can draw
    const m = await loadModel(url, old.modelMatrix, opts);
    m.show = old.show;
    if (onReady) m.readyEvent.addEventListener(() => onReady(m));
    return m;
  }
  async function setModelDetail(level) {
    if (!MODEL_NAMES[level]) return;
    settings.modelDetail = level;
    store.set("modelDetail", level);
    updateDetailInfo();
    const gen = ++modelGen;
    const jobs = [];
    if (fly.model) {
      jobs.push((async () => {
        const old = fly.model;
        const m = await swapModel(old, modelUrl("flight"));
        fly.pendingModel = m;   // follows the flight path while it loads (see updateFlight)
        const ok = await whenReady(m);
        if (fly.pendingModel === m) fly.pendingModel = null;
        if (gen !== modelGen || !ok) { scene.primitives.remove(m); return; }
        m.modelMatrix = fly.model.modelMatrix; m.show = fly.model.show;
        scene.primitives.remove(fly.model);
        fly.model = m;
      })());
    }
    const oldPull = lobby.models[0];
    if (oldPull) {
      jobs.push((async () => {
        const m = await swapModel(oldPull, modelUrl("pullup"), { forwardAxis: C.Axis.Z },
          (mm) => mm.activeAnimations.addAll({ loop: C.ModelAnimationLoop.REPEAT, multiplier: 1.0 }));
        const ok = await whenReady(m);
        if (gen !== modelGen || !ok || lobby.models[0] !== oldPull) { scene.primitives.remove(m); return; }
        scene.primitives.remove(oldPull);
        lobby.models[0] = m;
      })());
    }
    try { await Promise.all(jobs); }
    catch (e) { console.error(e); fly.pendingModel = null; showFatal("Could not load the " + MODEL_NAMES[level] + " Gundam model: " + (e.message || e)); }
  }

  function waitForTiles(timeoutMs) {
    return new Promise((resolve) => {
      if (!tilesets.length) return resolve();
      const t0 = performance.now();
      const tick = () => {
        if (allTilesLoaded() || performance.now() - t0 > timeoutMs) return resolve();
        setTimeout(tick, 200);
      };
      setTimeout(tick, 400);
    });
  }
  function fade(on) { $("fade").classList.toggle("on", on); return new Promise((r) => setTimeout(r, 650)); }

  // ---- start screen (game hall) at Nangang Exhibition Center ---------------
  const lobby = { models: [], entities: [], lat: 0, lon: 0, ground: 0, heading: 0, orbit: 0, active: false };

  async function findOpenGround(lat0, lon0, radius) {
    // Look for flat, open ground (a plaza or wide road) near the requested point by
    // sampling the 3D tiles. A spot is "open" when a 20 m ring around it is level with it.
    if (worldMode === "local") return openGroundFromOsm(lat0, lon0, radius);
    if (demoMode || !tilesets.length) return { lat: lat0, lon: lon0, h: 0 };
    const pts = [], meta = [];
    const step = 25;
    for (let y = -radius; y <= radius; y += step) for (let x = -radius; x <= radius; x += step) {
      if (x * x + y * y > radius * radius) continue;
      const c = offsetLL(lat0, lon0, x, y); pts.push(C.Cartographic.fromDegrees(c.lon, c.lat)); meta.push({ x, y, ...c });
    }
    let res;
    try { res = await scene.sampleHeightMostDetailed(pts); } catch (e) { return { lat: lat0, lon: lon0, h: 0 }; }
    const hs = res.map((p) => (p && isFinite(p.height) ? p.height : NaN));
    const valid = hs.filter((h) => isFinite(h)); if (!valid.length) return { lat: lat0, lon: lon0, h: 0 };
    valid.sort((a, b) => a - b);
    const streetLevel = valid[Math.floor(valid.length * 0.15)];
    // candidates near street level, then check a ring of 8 points at 20 m
    const cands = meta.map((m, i) => ({ ...m, h: hs[i], d: Math.hypot(m.x, m.y) }))
      .filter((m) => isFinite(m.h) && Math.abs(m.h - streetLevel) < 2.5).sort((a, b) => a.d - b.d).slice(0, 24);
    for (const c of cands) {
      const ring = []; for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; const o = offsetLL(c.lat, c.lon, 20 * Math.cos(a), 20 * Math.sin(a)); ring.push(C.Cartographic.fromDegrees(o.lon, o.lat)); }
      let rr; try { rr = await scene.sampleHeightMostDetailed(ring); } catch (e) { continue; }
      if (rr.every((p) => p && isFinite(p.height) && Math.abs(p.height - c.h) < 1.8)) return c;
    }
    return cands[0] || { lat: lat0, lon: lon0, h: streetLevel };
  }

  async function buildLobby() {
    const L = CFG.lobby || { lat: 25.0556, lon: 121.6176, searchRadius: 250, heading: 0 };
    camera.setView({ destination: C.Cartesian3.fromDegrees(L.lon, L.lat - 0.0025, 260), orientation: { heading: 0, pitch: -30 * DEG, roll: 0 } });
    await waitForTiles(12000);
    const spot = await findOpenGround(L.lat, L.lon, L.searchRadius || 250);
    lobby.lat = spot.lat; lobby.lon = spot.lon; lobby.ground = spot.h || 0; lobby.heading = L.heading || 0;
    const H = lobby.heading;

    // Gundam on the pull-up bar (faces azimuth H)
    const gm = await loadModel(modelUrl("pullup"), modelMatrixFor(lobby.lat, lobby.lon, lobby.ground, H), { forwardAxis: C.Axis.Z }); // this file faces +Z
    gm.readyEvent.addEventListener(() => gm.activeAnimations.addAll({ loop: C.ModelAnimationLoop.REPEAT, multiplier: 1.0 }));
    lobby.models.push(gm);

    // Pull-up frame: two posts and a bar, true size (bar centre 22.07 m above ground)
    const fwd = { e: Math.sin(H * DEG), n: Math.cos(H * DEG) }, right = { e: Math.cos(H * DEG), n: -Math.sin(H * DEG) };
    const at = (f, r) => offsetLL(lobby.lat, lobby.lon, fwd.e * f + right.e * r, fwd.n * f + right.n * r);
    const orient = (p, hgt) => C.Transforms.headingPitchRollQuaternion(C.Cartesian3.fromDegrees(p.lon, p.lat, hgt), new C.HeadingPitchRoll((H - 90) * DEG, 0, 0));
    const steel = new C.ColorMaterialProperty(C.Color.fromCssColorString("#3d4552"));
    const yellow = new C.ColorMaterialProperty(C.Color.fromCssColorString("#d9a514"));
    for (const side of [-1, 1]) {
      const p = at(BAR_FORWARD, side * POST_SPAN);
      const postH = BAR_HEIGHT + 1.2;
      lobby.entities.push(viewer.entities.add({ position: C.Cartesian3.fromDegrees(p.lon, p.lat, lobby.ground + postH / 2), orientation: orient(p, lobby.ground + postH / 2),
        box: { dimensions: new C.Cartesian3(1.0, 1.0, postH), material: steel } }));
      lobby.entities.push(viewer.entities.add({ position: C.Cartesian3.fromDegrees(p.lon, p.lat, lobby.ground + 0.3), orientation: orient(p, lobby.ground + 0.3),
        box: { dimensions: new C.Cartesian3(4.0, 3.0, 0.6), material: yellow } }));
    }
    const bc = at(BAR_FORWARD, 0);
    // round bar: a cylinder's axis is its local Z, so roll it 90 degrees to lie along the bar direction
    lobby.entities.push(viewer.entities.add({ position: C.Cartesian3.fromDegrees(bc.lon, bc.lat, lobby.ground + BAR_HEIGHT),
      orientation: C.Transforms.headingPitchRollQuaternion(C.Cartesian3.fromDegrees(bc.lon, bc.lat, lobby.ground + BAR_HEIGHT), new C.HeadingPitchRoll((H - 90) * DEG, 0, Math.PI / 2)),
      cylinder: { length: BAR_LENGTH + 1.0, topRadius: BAR_RADIUS, bottomRadius: BAR_RADIUS, slices: 24, material: new C.ColorMaterialProperty(C.Color.fromCssColorString("#9aa3ad")) } }));
    // safety mat under the Gundam
    const mc = at(0, 0);
    lobby.entities.push(viewer.entities.add({ position: C.Cartesian3.fromDegrees(mc.lon, mc.lat, lobby.ground + 0.08), orientation: orient(mc, lobby.ground + 0.08),
      box: { dimensions: new C.Cartesian3(16, 16, 0.16), material: new C.ColorMaterialProperty(C.Color.fromCssColorString("#26324a")) } }));

    // Pilots watching, 14–24 m in front of the mobile suit, facing it
    const variants = ["stand", "point", "hips", "helmetless", "cross"];
    const crowd = [
      [14, -5], [15, 0.5], [14.5, 4.5], [17, -9], [18, 8.5], [19.5, -2.5], [20, 3], [22, -6], [23, 7], [16.5, 11.5], [21, -12], [24.5, 0]
    ];
    for (let i = 0; i < crowd.length; i++) {
      const [f, r] = crowd[i];
      const p = at(f, r);
      const ph = groundHeightAt(p.lon, p.lat, lobby.models) ?? lobby.ground;
      const faceAz = Math.atan2(-(fwd.e * f + right.e * r), -(fwd.n * f + right.n * r)) / DEG + (i % 3 - 1) * 8;
      const m = await loadModel("models/pilot_" + variants[i % variants.length] + ".glb", modelMatrixFor(p.lat, p.lon, Math.abs(ph - lobby.ground) < 1.5 ? ph : lobby.ground, faceAz));
      lobby.models.push(m);
    }
    lobby.active = true;
    $("scaleCard").innerHTML =
      "<b>True scale on this screen</b><br>Gundam (head height): <b>18.0 m</b> · Pilots: <b>1.75 m</b> (≈ 1/10 of the Gundam)<br>" +
      "Pull-up bar: <b>22.1 m</b> high · " + (worldMode === "google" ? "Real buildings: Google 3D Tiles" : worldMode === "local"
        ? "Offline city: PLATEAU Tokyo (MLIT) · OSM Nangang" : "Demo grid (no city)");
  }

  function lobbyCamera(dt) {
    lobby.orbit += dt * 4 * DEG;
    const target = C.Cartesian3.fromDegrees(lobby.lon, lobby.lat, lobby.ground + 12);
    camera.lookAtTransform(C.Transforms.eastNorthUpToFixedFrame(target),
      new C.HeadingPitchRange(lobby.heading * DEG + Math.PI + Math.sin(lobby.orbit) * 0.9 + look.yaw, -8 * DEG + look.pitch, 58 * look.zoom));
  }

  // ---- input ------------------------------------------------------------------
  const keys = new Set();
  const input = { fwd: 0, strafe: 0, turn: 0, vert: 0, boost: false, lookX: 0, lookY: 0 };
  const look = { yaw: 0, pitch: 0, zoom: 1 };
  window.addEventListener("keydown", (e) => {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "SELECT")) return;
    keys.add(e.code);
    if (e.code === "Space") e.preventDefault();
    if (state.mode === "fly") {
      if (e.code === "KeyV") cycleCamera();
      if (e.code === "Escape") togglePause();
    } else if (state.mode === "pause" && e.code === "Escape") togglePause();
  });
  window.addEventListener("keyup", (e) => keys.delete(e.code));
  window.addEventListener("blur", () => keys.clear());

  // mouse / touch look on the 3D canvas
  const canvas = scene.canvas;
  let dragId = null, lastX = 0, lastY = 0;
  canvas.addEventListener("pointerdown", (e) => { dragId = e.pointerId; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerId !== dragId) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY; lastX = e.clientX; lastY = e.clientY;
    look.yaw += dx * 0.005; look.pitch += (settings.invertY ? 1 : -1) * dy * 0.004;
    look.pitch = Math.max(-70 * DEG, Math.min(25 * DEG, look.pitch));
  });
  const endDrag = (e) => { if (e.pointerId === dragId) dragId = null; };
  canvas.addEventListener("pointerup", endDrag); canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("wheel", (e) => { look.zoom = Math.max(0.35, Math.min(4, look.zoom * (e.deltaY > 0 ? 1.1 : 0.9))); e.preventDefault(); }, { passive: false });
  canvas.addEventListener("dblclick", () => { look.yaw = 0; look.pitch = 0; look.zoom = 1; });

  // start-screen panel: collapse to a pill, or hide it by tapping the 3D view
  function setLobbyCollapsed(c) {
    $("lobbyCard").classList.toggle("collapsed", c);
    const b = $("collapseBtn");
    b.setAttribute("aria-expanded", String(!c));
    b.title = c ? "Expand panel" : "Collapse panel";
    b.querySelector(".sr").textContent = b.title;
    store.set("lobbyCollapsed", c);
  }
  function setLobbyPanelOff(off) {
    $("lobby").classList.toggle("panel-off", off);
    $("showMenuBtn").hidden = !off;
  }
  setLobbyCollapsed(store.get("lobbyCollapsed", isTouch));
  $("collapseBtn").onclick = () => setLobbyCollapsed(!$("lobbyCard").classList.contains("collapsed"));
  $("showMenuBtn").onclick = () => { setLobbyCollapsed(true); setLobbyPanelOff(false); };
  let tap = null;
  canvas.addEventListener("pointerdown", (e) => { tap = e.isPrimary ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, moved: 0 } : null; });
  canvas.addEventListener("pointermove", (e) => { if (tap && e.pointerId === tap.id) tap.moved = Math.max(tap.moved, Math.hypot(e.clientX - tap.x, e.clientY - tap.y)); });
  canvas.addEventListener("pointercancel", () => { tap = null; });
  canvas.addEventListener("pointerup", (e) => {
    const t = tap; tap = null;
    if (!t || t.id !== e.pointerId || state.mode !== "lobby" || $("lobby").hidden) return;
    // only a quick tap with little movement counts; dragging to look around does not.
    // Event timestamps are used so a busy phone (frames still rendering) doesn't turn a quick tap into a "long press".
    const moved = Math.max(t.moved, Math.hypot(e.clientX - t.x, e.clientY - t.y));
    if (moved > (e.pointerType === "touch" ? 12 : 8) || e.timeStamp - t.t > 500) return;
    const off = !$("lobby").classList.contains("panel-off");
    if (!off) setLobbyCollapsed(true);
    setLobbyPanelOff(off);
  });

  // virtual sticks
  const sticks = {};
  function setupStick(id) {
    const el = $(id), knob = el.querySelector(".knob"); const s = { x: 0, y: 0, id: null };
    const upd = (e) => {
      const r = el.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2, max = r.width / 2 - 20;
      let dx = e.clientX - cx, dy = e.clientY - cy; const d = Math.hypot(dx, dy); if (d > max) { dx *= max / d; dy *= max / d; }
      s.x = dx / max; s.y = dy / max; knob.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    el.addEventListener("pointerdown", (e) => { s.id = e.pointerId; el.setPointerCapture(e.pointerId); upd(e); e.preventDefault(); });
    el.addEventListener("pointermove", (e) => { if (e.pointerId === s.id) upd(e); });
    const end = (e) => { if (e.pointerId !== s.id) return; s.id = null; s.x = 0; s.y = 0; knob.style.transform = ""; };
    el.addEventListener("pointerup", end); el.addEventListener("pointercancel", end);
    sticks[id] = s;
  }
  setupStick("stickL"); setupStick("stickR");
  let touchBoost = false;
  const bb = $("boostBtn");
  bb.addEventListener("pointerdown", (e) => { touchBoost = true; bb.classList.add("on"); bb.setPointerCapture(e.pointerId); e.preventDefault(); });
  const bbEnd = () => { touchBoost = false; bb.classList.remove("on"); };
  bb.addEventListener("pointerup", bbEnd); bb.addEventListener("pointercancel", bbEnd);

  // gamepad
  let padPrev = {};
  const dz = (v) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
  function readInput() {
    const k = (c) => keys.has(c);
    let fwd = (k("KeyW") || k("ArrowUp") ? 1 : 0) - (k("KeyS") || k("ArrowDown") ? 1 : 0);
    let turn = (k("KeyD") || k("ArrowRight") ? 1 : 0) - (k("KeyA") || k("ArrowLeft") ? 1 : 0);
    let strafe = (k("KeyE") ? 1 : 0) - (k("KeyQ") ? 1 : 0);
    let vert = (k("Space") || k("KeyR") ? 1 : 0) - (k("KeyC") || k("KeyF") ? 1 : 0);
    let boost = k("ShiftLeft") || k("ShiftRight");
    let lookX = 0, lookY = 0;
    const L = sticks.stickL, Rr = sticks.stickR;
    if (L && (L.x || L.y)) { fwd += -L.y; turn += L.x; }
    if (Rr && (Rr.x || Rr.y)) { vert += -Rr.y; strafe += Rr.x; }
    if (touchBoost) boost = true;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      const a = gp.axes, b = gp.buttons;
      strafe += dz(a[0] || 0); fwd += -dz(a[1] || 0); turn += dz(a[2] || 0); lookY += dz(a[3] || 0);
      const rt = b[7] ? b[7].value : 0, lt = b[6] ? b[6].value : 0; vert += rt - lt;
      if (b[0] && b[0].pressed) boost = true;
      if (b[12] && b[12].pressed) vert += 1; if (b[13] && b[13].pressed) vert -= 1;
      const pressed = (i) => b[i] && b[i].pressed && !padPrev[gp.index + ":" + i];
      if (state.mode === "fly" && pressed(3)) cycleCamera();
      if (pressed(9)) togglePause();
      const now = {}; b.forEach((x, i) => { if (x.pressed) now[gp.index + ":" + i] = 1; });
      for (const kk in padPrev) if (kk.startsWith(gp.index + ":")) delete padPrev[kk];
      Object.assign(padPrev, now);
      break; // first active pad
    }
    const cl = (v) => Math.max(-1, Math.min(1, v));
    input.fwd = cl(fwd); input.turn = cl(turn); input.strafe = cl(strafe); input.vert = cl(vert); input.boost = boost;
    input.lookY = lookY;
  }

  // ---- flight -------------------------------------------------------------------
  const MAX_FWD = 75, MAX_BACK = 20, MAX_STRAFE = 30, MAX_VERT = 28, BOOST = 2.4, TURN_RATE = 55 * DEG, MAX_ALT_AGL = 2500;
  const fly = { model: null, lat: 0, lon: 0, h: 0, az: 0, vf: 0, vs: 0, vu: 0, yawRate: 0, lean: 0, bank: 0, ground: undefined, grounded: false, impactT: 0, cam: 0, spawn: null, frame: 0 };
  const CAMS = [{ name: "CHASE CAM", range: 55, pitch: -10 }, { name: "FAR CAM", range: 160, pitch: -18 }, { name: "COCKPIT", range: 0, pitch: 0 }, { name: "SIDE CAM", range: 45, pitch: -4, yaw: 90 }];
  function cycleCamera() { fly.cam = (fly.cam + 1) % CAMS.length; look.yaw = 0; look.pitch = 0; $("hudCam").textContent = CAMS[fly.cam].name; }

  async function startFlight(spawn) {
    await fade(true);
    if (!fly.model) {
      const lvl = settings.modelDetail;
      fly.model = await loadModel(modelUrl("flight"), C.Matrix4.IDENTITY);
      if (lvl !== settings.modelDetail) setModelDetail(settings.modelDetail); // detail changed while loading
    }
    placeAt(spawn);
    state.mode = "fly";
    lobby.active = false;
    $("lobby").hidden = true; $("pause").hidden = true; $("hud").hidden = false; $("touch").hidden = !isTouch;
    $("hudLoc").textContent = spawn.name;
    look.yaw = 0; look.pitch = 0; look.zoom = 1;
    updateFlight(0); updateCamera();
    await fade(false);
  }
  function placeAt(spawn) {
    fly.spawn = spawn;
    fly.lat = spawn.lat; fly.lon = spawn.lon; fly.az = spawn.heading || 0;
    fly.vf = fly.vs = fly.vu = 0; fly.yawRate = 0; fly.lean = fly.bank = 0;
    fly.h = 40 + (spawn.alt || 150);  // Tokyo geoid ≈ +37 m; corrected to true AGL once tiles report ground
    fly.needsAglFix = spawn.alt || 150;
    fly.ground = undefined;
  }

  function updateFlight(dt) {
    readInput();
    const boost = input.boost ? BOOST : 1;
    const resp = 1 - Math.exp(-dt * 2.2);
    const tf = input.fwd >= 0 ? input.fwd * MAX_FWD * boost : input.fwd * MAX_BACK;
    fly.vf += (tf - fly.vf) * resp;
    fly.vs += (input.strafe * MAX_STRAFE * (input.boost ? 1.6 : 1) - fly.vs) * resp;
    fly.vu += (input.vert * MAX_VERT * (input.boost ? 1.8 : 1) - fly.vu) * (1 - Math.exp(-dt * 3));
    fly.yawRate += (input.turn * TURN_RATE - fly.yawRate) * (1 - Math.exp(-dt * 4));
    fly.az = (fly.az + fly.yawRate / DEG * dt + 360) % 360;

    // proposed move
    const s = Math.sin(fly.az * DEG), c = Math.cos(fly.az * DEG);
    let ve = fly.vf * s + fly.vs * c, vn = fly.vf * c - fly.vs * s;
    const excl = [fly.model, fly.pendingModel].filter(Boolean);

    // ground under us (sampled every frame; cheap enough at 1.5 m footprint)
    const g = groundHeightAt(fly.lon, fly.lat, excl);
    if (g !== undefined && isFinite(g)) {
      fly.ground = g;
      if (fly.needsAglFix) { fly.h = g + fly.needsAglFix; fly.needsAglFix = 0; }
    }

    // collision with buildings ahead: probe along horizontal velocity
    const hs = Math.hypot(ve, vn);
    if (hs > 0.5 && fly.ground !== undefined && (fly.frame++ % 2 === 0 || hs > 40)) {
      const dist = 6 + hs * 0.18, ue = ve / hs, un = vn / hs;
      for (const side of [0, -1, 1]) {
        const pe = ue * dist + (-un) * side * 3.5, pn = un * dist + ue * side * 3.5;
        const p = offsetLL(fly.lat, fly.lon, pe, pn);
        const ph = groundHeightAt(p.lon, p.lat, excl);
        if (ph !== undefined && ph > fly.h + 3.0) { // a wall taller than a step: blocked
          const into = ve * ue + vn * un;
          if (into > 0) { ve -= into * ue; vn -= into * un; }
          if (hs > 25) { fly.impactT = 0.7; }
          // remove forward speed so we don't grind into the wall
          fly.vf *= 0.4; fly.vs *= 0.6;
          break;
        }
      }
    }
    const np = offsetLL(fly.lat, fly.lon, ve * dt, vn * dt);
    fly.lat = np.lat; fly.lon = np.lon;
    fly.h += fly.vu * dt;
    if (fly.ground !== undefined) {
      if (fly.h <= fly.ground + 0.02) { fly.h = fly.ground; if (fly.vu < 0) fly.vu = 0; fly.grounded = true; } else fly.grounded = false;
      if (fly.h > fly.ground + MAX_ALT_AGL) { fly.h = fly.ground + MAX_ALT_AGL; fly.vu = Math.min(fly.vu, 0); }
    }

    // body attitude: lean into motion, bank into turns (only when airborne)
    const air = fly.grounded ? 0.15 : 1;
    // lean forward with speed, back when climbing and forward when diving
    const targetLean = ((fly.vf / (MAX_FWD * BOOST)) * 55 - (fly.vu / (MAX_VERT * 1.8)) * 18) * DEG * air;
    const targetBank = (fly.yawRate / TURN_RATE) * 22 * DEG * air + (fly.vs / MAX_STRAFE) * 12 * DEG * air;
    const k = 1 - Math.exp(-dt * 3);
    fly.lean += (targetLean - fly.lean) * k; fly.bank += (targetBank - fly.bank) * k;
    // head: looks into the turn (up to 30 deg) and a little up/down with climbs and dives
    const kh = 1 - Math.exp(-dt * 5);
    const turn = Math.max(-1, Math.min(1, fly.yawRate / TURN_RATE + 0.35 * fly.vs / MAX_STRAFE));
    fly.headYaw = (fly.headYaw || 0) + (turn * 30 * DEG - (fly.headYaw || 0)) * kh;
    fly.headPitch = (fly.headPitch || 0) + (Math.max(-1, Math.min(1, fly.vu / MAX_VERT)) * 12 * DEG - (fly.headPitch || 0)) * kh;
    if (fly.model) { fly.model.modelMatrix = modelMatrixFor(fly.lat, fly.lon, fly.h, fly.az, -fly.lean, fly.bank, MS_CENTER); poseHead(fly.model, fly.headYaw, fly.headPitch); }
    fly.model && (fly.model.show = CAMS[fly.cam].range !== 0);
    if (fly.pendingModel && fly.model) { fly.pendingModel.modelMatrix = fly.model.modelMatrix; fly.pendingModel.show = fly.model.show; }

    if (fly.impactT > 0) fly.impactT -= dt;
    // HUD
    const spd = Math.hypot(ve, vn, fly.vu) * 3.6;
    const agl = fly.ground !== undefined ? fly.h - fly.ground : NaN;
    $("hudSpeed").textContent = spd.toFixed(0);
    $("hudThrust").style.width = Math.min(100, Math.abs(fly.vf) / (MAX_FWD * BOOST) * 100) + "%";
    $("hudAgl").textContent = isFinite(agl) ? agl.toFixed(0) : "--";
    $("hudAglMs").textContent = isFinite(agl) ? (agl / MS_HEIGHT).toFixed(1) + " × MS height" : "";
    $("hudElev").textContent = (fly.h - (demoMode ? 0 : 37)).toFixed(0);
    $("hudVs").textContent = fly.vu.toFixed(1);
    $("hudMode").textContent = fly.grounded ? "LANDED" : input.boost ? "BOOST" : "HOVER";
    $("impact").classList.toggle("on", fly.impactT > 0);
    $("loadingTiles").classList.toggle("on", tilesets.length > 0 && !allTilesLoaded() && fly.ground === undefined);
    drawCompass();
  }

  function updateCamera() {
    const cam = CAMS[fly.cam];
    look.pitch = Math.max(-70 * DEG, Math.min(25 * DEG, look.pitch + input.lookY * (settings.invertY ? -1 : 1) * 0.03));
    if (cam.range === 0) {
      // cockpit: eye at head height, looking forward
      camera.lookAtTransform(C.Matrix4.IDENTITY);
      const s = Math.sin(fly.az * DEG), c = Math.cos(fly.az * DEG);
      const eye = offsetLL(fly.lat, fly.lon, s * 1.5, c * 1.5);
      camera.setView({ destination: C.Cartesian3.fromDegrees(eye.lon, eye.lat, fly.h + 16.6),
        orientation: { heading: fly.az * DEG + look.yaw, pitch: -fly.lean * 0.5 + look.pitch, roll: fly.bank * 0.5 } });
      return;
    }
    const target = C.Cartesian3.fromDegrees(fly.lon, fly.lat, fly.h + MS_CENTER + 2);
    let range = cam.range * look.zoom;
    let pitch = cam.pitch * DEG + look.pitch;
    // keep the camera above street level
    if (fly.ground !== undefined) {
      const camUp = MS_CENTER + 2 - Math.sin(-pitch) * range;
      if (fly.h + camUp < fly.ground + 2) pitch = -Math.asin(Math.min(1, (fly.h + MS_CENTER + 2 - fly.ground - 2) / range));
    }
    camera.lookAtTransform(C.Transforms.eastNorthUpToFixedFrame(target),
      new C.HeadingPitchRange(fly.az * DEG + (cam.yaw || 0) * DEG + look.yaw, pitch, range));
  }

  function drawCompass() {
    const tape = $("compassTape");
    if (!tape.childElementCount) {
      const lbl = (d) => ({ 0: "N", 45: "NE", 90: "E", 135: "SE", 180: "S", 225: "SW", 270: "W", 315: "NW" }[d] || String(d));
      let html = ""; for (let r = 0; r < 3; r++) for (let d = 0; d < 360; d += 15) html += `<span>${lbl(d)}</span>`;
      tape.innerHTML = html;
    }
    const w = tape.parentElement.clientWidth;
    tape.style.left = (w / 2 - 15 - (360 + fly.az) / 15 * 30) + "px";
  }

  // ---- main loop ------------------------------------------------------------
  const state = { mode: "lobby" };
  let last = performance.now(), fpsAcc = 0, fpsN = 0;
  scene.preUpdate.addEventListener(() => {
    const now = performance.now(); const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (state.mode === "fly") { updateFlight(dt); updateCamera(); }
    else if (state.mode === "lobby" && lobby.active) { readInput(); lobbyCamera(dt); }
    else if (state.mode === "pause") readInput();
    if (settings.showFps) { fpsAcc += dt; fpsN++; if (fpsAcc > 0.5) { $("hudFps").textContent = " · " + (fpsN / fpsAcc).toFixed(0) + " fps"; fpsAcc = 0; fpsN = 0; } }
  });

  function togglePause() {
    if (state.mode === "fly") { state.mode = "pause"; $("pause").hidden = false; $("touch").hidden = true; viewer.clock.shouldAnimate = false; }
    else if (state.mode === "pause") { state.mode = "fly"; $("pause").hidden = true; $("touch").hidden = !isTouch; viewer.clock.shouldAnimate = true; last = performance.now(); }
  }

  // ---- UI wiring ----------------------------------------------------------------
  const spawns = CFG.spawns || [];
  for (const sel of [$("spawnSelect"), $("teleportSelect")]) spawns.forEach((s, i) => sel.add(new Option(s.name, i)));
  $("startBtn").onclick = () => startFlight(spawns[+$("spawnSelect").value] || spawns[0]);
  $("resumeBtn").onclick = togglePause;
  $("teleportBtn").onclick = () => { placeAt(spawns[+$("teleportSelect").value]); $("hudLoc").textContent = fly.spawn.name; togglePause(); };
  $("toLobbyBtn").onclick = async () => {
    await fade(true);
    state.mode = "lobby"; viewer.clock.shouldAnimate = true;
    $("pause").hidden = true; $("hud").hidden = true; $("touch").hidden = true; $("lobby").hidden = false;
    if (fly.model) fly.model.show = false;
    lobby.active = true; look.yaw = 0; look.pitch = 0; look.zoom = 1;
    await fade(false);
  };
  $("camBtn").onclick = cycleCamera;
  $("menuBtn").onclick = togglePause;
  const openSettings = () => {
    $("citySource").value = settings.citySource; $("keyInput").value = settings.key; $("qualitySelect").value = settings.quality;
    $("invertY").checked = settings.invertY; $("showFps").checked = settings.showFps; $("settingsDlg").showModal();
  };
  $("settingsBtn").onclick = openSettings; $("pSettingsBtn").onclick = openSettings;
  $("cityDetail").value = settings.cityDetail; $("modelDetail").value = settings.modelDetail;
  $("cityDetail").onchange = () => {
    const v = $("cityDetail").value; if (!CITY_SSE[v]) return;
    settings.cityDetail = v; store.set("cityDetail", v); applyCityDetail(); updateDetailInfo();
  };
  $("modelDetail").onchange = () => setModelDetail($("modelDetail").value);
  updateDetailInfo();
  $("saveSettings").onclick = () => {
    if ($("citySource").value !== settings.citySource) { store.set("citySource", $("citySource").value); store.set("citySourceChosen", true); }
    store.set("key", $("keyInput").value.trim()); store.set("quality", $("qualitySelect").value);
    store.set("invertY", $("invertY").checked); store.set("showFps", $("showFps").checked);
    setTimeout(() => location.reload(), 50);
  };
  $("helpBtn").onclick = () => $("helpDlg").showModal(); $("pHelpBtn").onclick = () => $("helpDlg").showModal();
  $("creditsBtn").onclick = () => $("creditsDlg").showModal();

  // service worker (installable app on Windows and Android)
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  // expose for debugging / automated tests
  window.GFS = { viewer, fly, lobby, state, input, keys, settings, startFlight, spawns, get demoMode() { return demoMode; }, get worldMode() { return worldMode; }, tilesets, get localWorld() { return localWorld; } };

  (async () => {
    $("startBtn").disabled = true; $("startBtn").textContent = "Loading…";
    await initWorld();
    try { await buildLobby(); } catch (e) { console.error(e); showFatal("Could not build the start scene: " + ((e && (e.stack || e.message)) || e)); setStatus("Could not build the start scene: " + (e.message || e), true); }
    $("startBtn").disabled = false; $("startBtn").textContent = "Launch";
    window.GFS.ready = true;
  })();
})();
