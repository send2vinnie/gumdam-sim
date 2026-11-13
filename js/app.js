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

  // ---- characters ---------------------------------------------------------------
  // Dragon: shown at a rideable size instead of its official 1.7 m. The rider is built into models/dragon.glb (skinned
  // to the dragon so its hands stay on the horns), sized 1.75 m for this dragon height: after changing DRAGON_HEIGHT_M,
  // rebuild the model with tools/build_dragon_rider.js <height> so the rider stays 1.75 m.
  const DRAGON_HEIGHT_M = 4.0;
  const DRAGON_NATIVE_H = 18.16;   // standing height (horn tips) in dragon.glb units
  const DRAGON_SCALE = DRAGON_HEIGHT_M / DRAGON_NATIVE_H;
  const RIDER_HEIGHT_M = 1.75;
  const RIDER_EYE = [6.24, 11.78];         // rider eye in dragon.glb (flight frame X fwd, Y up; dragon units)
  const D_PITCH = 55 * DEG;                // body pitch baked into dragon.glb (native joints are in the upright frame)
  const DRAGON_JOINTS = {
    head: { p: [0, -3.0, 12.8], rest: -45 * DEG }, tail: { p: [0, 2.6, 4.5], rest: -52 * DEG },
    wingL: { p: [2.6, 0.5, 11.0] }, wingR: { p: [-2.6, 0.5, 11.0] }
  };
  const D_UP = [0, Math.sin(D_PITCH), Math.cos(D_PITCH)];     // flight "up" in the dragon's native frame (yaw axis)
  const D_FWD = [0, -Math.cos(D_PITCH), Math.sin(D_PITCH)];   // flight "forward" in the native frame (wing-beat axis)
  const CHARACTERS = {
    gundam: { name: "Gundam RX-78-02 (18 m)", leanMax: 55, phys: { mass: 43.4, thrust: 7, climb: 5, rollRate: 45 * DEG, lift: "thrusters", stall: 0 }, center: MS_CENTER, eye: 16.6, eyeFwd: 1.5, height: MS_HEIGHT, unit: "MS height", cams: [55, 160, 45] },
    dragon: { name: "Dragon + rider (rideable " + DRAGON_HEIGHT_M + " m)", leanMax: 12, phys: { mass: 0.9, thrust: 14, climb: 9, rollRate: 110 * DEG, lift: "wings", stall: 22 }, center: 6.0 * DRAGON_SCALE, eye: RIDER_EYE[1] * DRAGON_SCALE, eyeFwd: RIDER_EYE[0] * DRAGON_SCALE + 0.15, height: DRAGON_HEIGHT_M, unit: "dragon heights", cams: [8 + 3 * DRAGON_HEIGHT_M, 20 + 8 * DRAGON_HEIGHT_M, 6 + 2.5 * DRAGON_HEIGHT_M] }
  };
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
    showFps: store.get("showFps", false),
    autoRes: store.get("autoRes", true)
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
  settings.character = CHARACTERS[store.get("character", null)] ? store.get("character", null) : "gundam";
  const DIFFICULTIES = { easy: "Easy", medium: "Medium", hard: "Hard" };
  settings.difficulty = DIFFICULTIES[store.get("difficulty", null)] ? store.get("difficulty", null) : "medium";
  const CH = () => CHARACTERS[fly.character || settings.character];
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
  // Low graphics: draw only what is near. The far plane cuts everything (city tiles, models, effects) beyond RENDER_DISTANCE,
  // denser fog hides the edge, and the canvas renders at 75 % resolution.
  const LOW_GFX = settings.quality === "low";
  const RENDER_DISTANCE = LOW_GFX ? 3000 : null;
  if (LOW_GFX) { camera.frustum.far = RENDER_DISTANCE; scene.fog.density = 7.5e-4; scene.fog.minimumBrightness = 0.35; viewer.resolutionScale = 0.75;
    // the sky dome lies beyond the far plane, so paint a hazy sky instead; the cut-off then reads as distance haze
    scene.skyAtmosphere.show = false; scene.skyBox && (scene.skyBox.show = false); scene.backgroundColor = C.Color.fromCssColorString("#a9c6e2"); }
  const nearOnly = () => (LOW_GFX ? new C.DistanceDisplayCondition(0, 450) : undefined);   // small props: pilots, dragon scene
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
    // Tokyo areas stream in when the camera comes near them and are dropped (memory freed) when it leaves, so the start
    // screen in Taipei loads no Tokyo tiles at all and a flight keeps only the area(s) around it.
    await Promise.all(LOCAL_WARDS.map(async (w) => {
      const j = await (await fetch("cities/tokyo/" + w + "/tileset.json")).json();
      const [west, south, east, north] = j.root.boundingVolume.region;
      wardSlots.push({ name: w, west, south, east, north, ts: null, loading: null, want: false });
    }));
    for (const txt of [LOCAL_CREDITS.plateau, LOCAL_CREDITS.osm]) viewer.creditDisplay.addStaticCredit(new C.Credit(txt, true));
    await loadNangang(ground);
  }

  const WARD_LOAD_M = (LOW_GFX ? RENDER_DISTANCE : 6000) + 1000;   // load an area when the camera is this close to its edge
  const WARD_DROP_M = WARD_LOAD_M + 1500;                             // drop it beyond this (no flicker at the boundary)
  const wardSlots = [];
  function wardDistance(s, lon, lat) {   // metres from a point (radians) to an area's rectangle, 0 inside
    const dx = lon < s.west ? s.west - lon : lon > s.east ? lon - s.east : 0;
    const dy = lat < s.south ? s.south - lat : lat > s.north ? lat - s.north : 0;
    return Math.hypot(dx * R_EARTH * Math.cos(lat), dy * R_EARTH);
  }
  async function openWard(s) {
    const ts = await C.Cesium3DTileset.fromUrl("cities/tokyo/" + s.name + "/tileset.json", {
        maximumScreenSpaceError: CITY_SSE[settings.cityDetail],
        cacheBytes: lowMem || LOW_GFX ? 128 * 1024 * 1024 : Math.min(QUALITY.cacheBytes, 512 * 1024 * 1024),
        maximumCacheOverflowBytes: LOW_GFX ? 64 * 1024 * 1024 : undefined,
        cullRequestsWhileMoving: true, cullRequestsWhileMovingMultiplier: LOW_GFX ? 30 : 60,   // skip tile requests while the camera moves fast
        dynamicScreenSpaceError: true,
        imageBasedLighting: skyLight(),
        shadows: QUALITY.shadows ? C.ShadowMode.ENABLED : C.ShadowMode.DISABLED
      });
    ts.tileLoad.addEventListener((tile) => reapplyHidden(tile));   // destroyed buildings stay destroyed when tiles reload
    return ts;
  }
  // called about once a second (and right after a teleport): open areas near the camera, drop far ones
  let wardCheckT = 0;
  function updateWards(force) {
    if (!wardSlots.length || (!force && performance.now() - wardCheckT < 1000)) return;
    wardCheckT = performance.now();
    const c = camera.positionCartographic;
    for (const s of wardSlots) {
      const d = wardDistance(s, c.longitude, c.latitude);
      if (d < WARD_LOAD_M) s.want = true; else if (d > WARD_DROP_M) s.want = false;
      if (s.want && !s.ts && !s.loading) {
        s.loading = openWard(s).then((ts) => {
          s.loading = null;
          if (!s.want) { ts.destroy(); return; }
          s.ts = ts; ts.maximumScreenSpaceError = CITY_SSE[settings.cityDetail];
          scene.primitives.add(ts); tilesets.push(ts);
        }).catch((e) => { s.loading = null; console.error(e); });
      } else if (!s.want && s.ts) {
        const i = tilesets.indexOf(s.ts); if (i >= 0) tilesets.splice(i, 1);
        scene.primitives.remove(s.ts);   // destroys it and frees its tiles
        s.ts = null;
      }
    }
  }
  async function loadNangang(ground) {
    // refreshed OSM buildings (tools/build_nangang_osm.js); the older, smaller export is the fallback
    let osm;
    for (const f of ["cities/taipei/nangang-osm-v2.geojson", "cities/taipei/nangang-buildings.geojson"]) {
      try { const r = await fetch(f); if (r.ok) { osm = await r.json(); break; } } catch (e) { /* try the next file */ }
    }
    if (!osm) osm = { type: "FeatureCollection", features: [] };
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
          id: "osm-" + instances.length,
          attributes: Object.assign({ color: C.ColorGeometryInstanceAttribute.fromColor(C.Color.fromCssColorString("#b9b6ae")), show: new C.ShowGeometryInstanceAttribute(true) },
            LOW_GFX ? { distanceDisplayCondition: new C.DistanceDisplayConditionGeometryInstanceAttribute(0, RENDER_DISTANCE) } : {})
        }));
      } catch (e) { /* skip a malformed footprint */ }
    }
    const osmPrimitive = scene.primitives.add(new C.Primitive({ geometryInstances: instances, appearance: new C.PerInstanceColorAppearance({ translucent: false, fragmentShaderSource: OSM_FS }), shadows: QUALITY.shadows ? C.ShadowMode.ENABLED : C.ShadowMode.DISABLED }));
    localWorld = { ground, osm, osmPrimitive };
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

  // Dragon joints (dragon.glb): node matrices are local to the dragon's flight-frame root, in its native upright frame.
  // yaw > 0 turns the head to its right, pitch > 0 looks up, wing > 0 raises both wings, tailYaw swings the tail.
  const scratchQ = new C.Quaternion(), scratchQ2 = new C.Quaternion(), scratchM3 = new C.Matrix3();
  const axisQ = (a, ang, res) => C.Quaternion.fromAxisAngle(new C.Cartesian3(a[0], a[1], a[2]), ang, res);
  function setJoint(node, p, q) { node.matrix = C.Matrix4.fromRotationTranslation(C.Matrix3.fromQuaternion(q, scratchM3), new C.Cartesian3(p[0], p[1], p[2]), new C.Matrix4()); }
  function poseDragon(model, yaw, pitch, wing, tailYaw) {
    if (!model || !model.ready) return;
    if (!model.__nodes) { const n = {}; for (const k of ["head", "wingL", "wingR", "tail"]) { try { n[k] = model.getNode(k); } catch (e) { n[k] = null; } } model.__nodes = n; }
    const N = model.__nodes, J = DRAGON_JOINTS;
    if (N.head) { // yaw about flight-up, then pitch about the lateral axis, on top of the resting head angle
      C.Quaternion.multiply(axisQ(D_UP, -yaw, scratchQ), axisQ([1, 0, 0], -pitch * 0.8 + J.head.rest, scratchQ2), scratchQ);
      setJoint(N.head, J.head.p, scratchQ);
    }
    // left wing is on native +x: a positive turn about the forward axis lifts it; the right wing mirrors
    if (N.wingL) setJoint(N.wingL, J.wingL.p, axisQ(D_FWD, wing, scratchQ));
    if (N.wingR) setJoint(N.wingR, J.wingR.p, axisQ(D_FWD, -wing, scratchQ));
    if (N.tail) { C.Quaternion.multiply(axisQ(D_UP, tailYaw, scratchQ), axisQ([1, 0, 0], J.tail.rest, scratchQ2), scratchQ); setJoint(N.tail, J.tail.p, scratchQ); }
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
    if (fly.model && fly.character === "gundam") {   // the dragon has a single detail level
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
        refreshPickHighlight();
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
      const m = await loadModel("models/pilot_" + variants[i % variants.length] + ".glb", modelMatrixFor(p.lat, p.lon, Math.abs(ph - lobby.ground) < 1.5 ? ph : lobby.ground, faceAz), { distanceDisplayCondition: nearOnly() });
      lobby.models.push(m);
    }
    // the trainer trains the dragon to jump, on the plaza to the Gundam's left (clear of the rig and the crowd)
    try {
      const dp = at(3, -19), tp = at(9.5, -15.5);
      const gh = (p) => { const h = groundHeightAt(p.lon, p.lat, lobby.models); return h !== undefined && Math.abs(h - lobby.ground) < 1.5 ? h : lobby.ground; };
      const azTo = (a, b) => Math.atan2((b.lon - a.lon) * Math.cos(a.lat * DEG), b.lat - a.lat) / DEG;
      lobby.jump = { d: dp, t: tp, dh: gh(dp), th: gh(tp), dAz: azTo(dp, tp), tAz: azTo(tp, dp), time: 0 };
      lobby.dragon = await loadModel("models/dragon_stand.glb", modelMatrixFor(dp.lat, dp.lon, lobby.jump.dh, lobby.jump.dAz), { scale: DRAGON_SCALE, maximumScale: undefined, distanceDisplayCondition: nearOnly() });
      lobby.trainer = await loadModel("models/trainer_stand.glb", modelMatrixFor(tp.lat, tp.lon, lobby.jump.th, lobby.jump.tAz), { scale: TRAINER_SCALE, maximumScale: undefined, distanceDisplayCondition: nearOnly() });
    } catch (e) { console.error(e); }
    refreshPickHighlight();
    lobby.active = true;
    $("scaleCard").innerHTML =
      "<b>True scale on this screen</b><br>Gundam (head height): <b>18.0 m</b> · Pilots: <b>1.75 m</b> (≈ 1/10 of the Gundam)<br>" +
      "Pull-up bar: <b>22.1 m</b> high · " + (worldMode === "google" ? "Real buildings: Google 3D Tiles" : worldMode === "local"
        ? "Offline city: PLATEAU Tokyo (MLIT) · OSM Nangang" : "Demo grid (no city)");
  }

  // ---- camera collision ------------------------------------------------------------
  // A ray from the focus point toward the wanted camera position (character excluded). If a building or object is in the
  // way, the camera moves in to just short of it; it eases back out when the way is clear. The ray is cast at most
  // ~14 times a second (~9 on phones) and reused in between, so it stays cheap.
  const camCol = { key: "", t: 0, allowed: Infinity, range: null };
  const CAM_RAY_MS = isTouch ? 110 : 70;
  const scratchDir = new C.Cartesian3(), scratchDirW = new C.Cartesian3(), scratchRay = new C.Ray();
  function collideRange(key, target, heading, pitch, range, exclude, margin, minRange, dt) {
    const now = performance.now();
    if (camCol.key !== key) { camCol.key = key; camCol.range = null; camCol.t = 0; camCol.allowed = Infinity; }
    if (now - camCol.t > CAM_RAY_MS && scene.pickPositionSupported !== false) {
      camCol.t = now;
      // direction from the target to the camera, east-north-up (camera looks along heading/pitch toward the target)
      C.Cartesian3.fromElements(-Math.sin(heading) * Math.cos(pitch), -Math.cos(heading) * Math.cos(pitch), -Math.sin(pitch), scratchDir);
      C.Matrix4.multiplyByPointAsVector(C.Transforms.eastNorthUpToFixedFrame(target), scratchDir, scratchDirW);
      C.Cartesian3.normalize(scratchDirW, scratchDirW);
      scratchRay.origin = target; scratchRay.direction = scratchDirW;
      let hit; try { hit = scene.pickFromRay(scratchRay, exclude, 0.5); } catch (e) { hit = undefined; }
      let allowed = Infinity;
      if (hit && hit.position) { const d = C.Cartesian3.distance(target, hit.position); if (d < range + margin) allowed = Math.max(minRange, d - margin); }
      camCol.allowed = allowed;
    }
    const want = Math.min(range, camCol.allowed);
    if (camCol.range === null) camCol.range = want;
    // move in at once (never show the inside of a wall), ease back out without jitter
    camCol.range = want < camCol.range ? want : camCol.range + (want - camCol.range) * (1 - Math.exp(-dt * 1.6));
    return camCol.range;
  }

  function lobbyCamera(dt) {
    lobby.orbit += dt * 4 * DEG;
    // frame the Gundam and the dragon scene; drift toward whichever character is selected
    const want = settings.character === "dragon" ? 1 : 0;
    lobby.focus = (lobby.focus === undefined ? want : lobby.focus) + (want - (lobby.focus === undefined ? want : lobby.focus)) * (1 - Math.exp(-dt * 1.5));
    const H = lobby.heading * DEG, side = -9 - 3 * lobby.focus, height = 12 - 4 * lobby.focus;
    const tgt = offsetLL(lobby.lat, lobby.lon, Math.cos(H) * side, -Math.sin(H) * side);
    const target = C.Cartesian3.fromDegrees(tgt.lon, tgt.lat, lobby.ground + height);
    const heading = H + Math.PI + Math.sin(lobby.orbit) * 0.9 + look.yaw, pitch = -8 * DEG + look.pitch;
    const range = collideRange("lobby", target, heading, pitch, (66 - 12 * lobby.focus) * look.zoom, lobbyPickables().concat(lobby.models), 2.0, 12, dt);
    camera.lookAtTransform(C.Transforms.eastNorthUpToFixedFrame(target), new C.HeadingPitchRange(heading, pitch, range));
    updateLobbyActors(dt);
  }

  // ---- start-screen actors: the dragon's jump loop and the trainer's gestures ----
  const TRAINER_SCALE = 1.75 / 17.62;
  const JUMP = { period: 3.6, crouch: 0.45, air: 0.95, land: 0.3, height: 2.6 };
  function setNode(model, name, p, axis, ang) {
    if (!model || !model.ready) return; model.__n = model.__n || {};
    if (model.__n[name] === undefined) { try { model.__n[name] = model.getNode(name) || null; } catch (e) { model.__n[name] = null; } }
    const n = model.__n[name]; if (!n) return;
    n.matrix = C.Matrix4.fromRotationTranslation(C.Matrix3.fromQuaternion(C.Quaternion.fromAxisAngle(axis, ang)), new C.Cartesian3(p[0], p[1], p[2]));
  }
  const AX_X = C.Cartesian3.UNIT_X, AX_Z = C.Cartesian3.UNIT_Z;
  function updateLobbyActors(dt) {
    const J = lobby.jump; if (!J || !lobby.dragon) return;
    J.time = (J.time + dt) % JUMP.period; const t = J.time;
    const ease = (x) => x * x * (3 - 2 * x);
    let lift = 0, sy = 1, sxz = 1, wing = 0, armUp = 0;
    const c0 = JUMP.crouch, a0 = c0 + JUMP.air, l0 = a0 + JUMP.land;
    if (t < c0) { const u = ease(t / c0); sy = 1 - 0.13 * u; sxz = 1 + 0.06 * u; wing = 25 * DEG * u; armUp = u; }       // crouch, wings up
    else if (t < a0) { const u = (t - c0) / JUMP.air; lift = JUMP.height * 4 * u * (1 - u); sy = 1 + 0.07 * Math.max(0, 1 - u * 3); sxz = 1 - 0.03 * Math.max(0, 1 - u * 3);
      wing = 40 * DEG * Math.cos(u * Math.PI * 3); armUp = 1; }                                                        // leap with wing beats
    else if (t < l0) { const u = (t - a0) / JUMP.land; const sq = Math.sin(u * Math.PI); sy = 1 - 0.12 * sq; sxz = 1 + 0.06 * sq; wing = -10 * DEG * sq; armUp = 1 - ease(u); } // land: squash
    else { wing = 4 * DEG * Math.sin(t * 2.2); }                                                                        // pause, gentle wing idle
    const m = modelMatrixFor(J.d.lat, J.d.lon, J.dh + lift, J.dAz);
    lobby.dragon.modelMatrix = C.Matrix4.multiply(m, C.Matrix4.fromScale(new C.Cartesian3(sxz, sxz, sy)), m);
    setNode(lobby.dragon, "wingL", [-1.5, 11.0, -2.6], AX_X, wing);
    setNode(lobby.dragon, "wingR", [-1.5, 11.0, 2.6], AX_X, -wing);
    if (lobby.trainer) {
      // the trainer points up for each jump, bobs a little and follows the dragon with a slight turn
      const bob = 0.03 * Math.sin(t * Math.PI * 2 / JUMP.period * 2);
      lobby.trainer.modelMatrix = modelMatrixFor(J.t.lat, J.t.lon, J.th + Math.max(0, bob), J.tAz + 6 * Math.sin(t * 1.3), -4 * DEG * (lift / JUMP.height));
      setNode(lobby.trainer, "armR", [0, 13.1, 2.15], AX_Z, armUp * 135 * DEG);
    }
  }

  // ---- pick the character on the start screen by clicking / tapping it ----
  const lobbyPickables = () => [lobby.dragon, lobby.trainer].filter(Boolean);
  function pickedCharacter(x, y) {
    let picked; try { picked = scene.pick(new C.Cartesian2(x, y)); } catch (e) { picked = undefined; }
    const prim = picked && picked.primitive;
    if (!prim) return null;
    if (prim === lobby.dragon || prim === lobby.trainer) return "dragon";
    if (prim === lobby.models[0]) return "gundam";
    return null;
  }
  function refreshPickHighlight() {
    const sel = settings.character;
    const set = (m, on) => { if (!m) return; m.silhouetteColor = C.Color.YELLOW; m.silhouetteSize = on ? 2.0 : 0.0; };
    set(lobby.models[0], sel === "gundam"); set(lobby.dragon, sel === "dragon"); set(lobby.trainer, sel === "dragon");
    const lab = $("pickLabel"); if (lab) { lab.textContent = "Selected: " + (sel === "dragon" ? "Dragon (with rider)" : "Gundam RX-78-02") + " · tap a character to choose"; lab.hidden = !lobby.models.length; }
  }
  function selectCharacter(ch) {
    if (!CHARACTERS[ch]) return;
    settings.character = ch; store.set("character", ch);
    const s = $("characterSelect"); if (s) s.value = ch;
    if (typeof charNote === "function") charNote();
    refreshPickHighlight();
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
      if (e.code === "KeyF" && !e.repeat) requestFire();
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
  // desktop: pointer cursor over a pickable character (checked at most ~8 times a second)
  let hoverT = 0;
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse" || state.mode !== "lobby" || tap) return;
    if (e.timeStamp - hoverT < 120) return; hoverT = e.timeStamp;
    const r = canvas.getBoundingClientRect();
    canvas.style.cursor = pickedCharacter((e.clientX - r.left) * (canvas.width / r.width), (e.clientY - r.top) * (canvas.height / r.height)) ? "pointer" : "";
  });
  canvas.addEventListener("pointerup", (e) => {
    const t = tap; tap = null;
    if (t && t.id === e.pointerId && state.mode === "fly" && e.pointerType === "mouse" && e.button === 0 &&
        Math.max(t.moved, Math.hypot(e.clientX - t.x, e.clientY - t.y)) <= 6 && e.timeStamp - t.t < 400) { requestFire(); return; }
    if (!t || t.id !== e.pointerId || state.mode !== "lobby" || $("lobby").hidden) return;
    // only a quick tap with little movement counts; dragging to look around does not.
    // Event timestamps are used so a busy phone (frames still rendering) doesn't turn a quick tap into a "long press".
    const moved = Math.max(t.moved, Math.hypot(e.clientX - t.x, e.clientY - t.y));
    if (moved > (e.pointerType === "touch" ? 12 : 8) || e.timeStamp - t.t > 500) return;
    // tapping a character selects it; tapping anywhere else hides / shows the panel
    const r = canvas.getBoundingClientRect();
    const ch = pickedCharacter((e.clientX - r.left) * (canvas.width / r.width), (e.clientY - r.top) * (canvas.height / r.height));
    if (ch) { selectCharacter(ch); return; }
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
    let vert = (k("Space") || k("KeyR") ? 1 : 0) - (k("KeyC") ? 1 : 0);
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
      if (state.mode === "fly" && (pressed(5) || pressed(2))) requestFire();
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

  async function loadCharacter(ch) {
    if (fly.model && fly.character === ch) return;
    if (fly.model) { scene.primitives.remove(fly.model); fly.model = null; }
    if (fly.rider) { scene.primitives.remove(fly.rider); fly.rider = null; }
    fly.character = ch; fly.headYaw = fly.headPitch = 0; fly.wingPhase = 0;
    if (ch === "dragon") {
      fly.model = await loadModel("models/dragon.glb", C.Matrix4.IDENTITY, { scale: DRAGON_SCALE, maximumScale: undefined }); // rider included
    } else {
      const lvl = settings.modelDetail;
      fly.model = await loadModel(modelUrl("flight"), C.Matrix4.IDENTITY);
      if (lvl !== settings.modelDetail) setModelDetail(settings.modelDetail); // detail changed while loading
    }
  }
  async function startFlight(spawn) {
    await fade(true);
    await loadCharacter(settings.character);
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
    fly.vf = fly.vs = fly.vu = 0; fly.yawRate = 0; fly.lean = fly.bank = 0; fly.bankH = 0; fly.stamina = 1;
    fly.h = 40 + (spawn.alt || 150);  // Tokyo geoid ≈ +37 m; corrected to true AGL once tiles report ground
    fly.needsAglFix = spawn.alt || 150;
    fly.ground = undefined;
  }

  function updateFlight(dt) {
    readInput();
    const diff = settings.difficulty;
    // boost gauge (Hard): drains while boosting, recharges otherwise; Easy/Medium have unlimited boost
    if (fly.stamina === undefined) fly.stamina = 1;
    let boosting = input.boost;
    if (diff === "hard") {
      if (boosting && fly.stamina > 0) fly.stamina = Math.max(0, fly.stamina - dt * 0.22);
      else { boosting = false; fly.stamina = Math.min(1, fly.stamina + dt * (input.boost ? 0.04 : 0.12)); }
    } else fly.stamina = 1;
    fly.boosting = boosting;
    const boost = boosting ? BOOST : 1;
    const tf = input.fwd >= 0 ? input.fwd * MAX_FWD * boost : input.fwd * MAX_BACK;
    const ts = input.strafe * MAX_STRAFE * (boosting ? 1.6 : 1), tu = input.vert * MAX_VERT * (boosting ? 1.8 : 1);
    if (diff === "easy") {
      // arcade: velocities follow the stick at once, no gravity or inertia, direct turns
      fly.vf = tf; fly.vs = ts; fly.vu = tu; fly.yawRate = input.turn * TURN_RATE; fly.bankH = 0;
    } else if (diff === "medium") {
      const resp = 1 - Math.exp(-dt * 2.2);
      fly.vf += (tf - fly.vf) * resp;
      fly.vs += (ts - fly.vs) * resp;
      const sink = fly.grounded || Math.abs(input.vert) > 0.05 ? 0 : -2.5;      // gentle sink without vertical thrust
      fly.vu += ((Math.abs(input.vert) > 0.05 ? tu : sink) - fly.vu) * (1 - Math.exp(-dt * 3));
      fly.yawRate += (input.turn * TURN_RATE - fly.yawRate) * (1 - Math.exp(-dt * 4));
      fly.bankH = 0;
    } else {
      // Hard: forces per unit mass. Thrust accelerates, drag ~ v^2, gravity 9.81 against vertical thrust/lift.
      const P = CH().phys, g = 9.81;
      const aF = P.thrust * (boosting ? 1.9 : 1), vMax = MAX_FWD * (boosting ? BOOST : 1);
      const kF = aF / (vMax * vMax), kS = P.thrust * 0.6 / (MAX_STRAFE * MAX_STRAFE), kU = (P.climb + 2) / (MAX_VERT * MAX_VERT * 1.8);
      fly.vf += ((input.fwd >= 0 ? input.fwd * aF : input.fwd * aF * 0.5) - kF * fly.vf * Math.abs(fly.vf)) * dt;
      fly.vs += (input.strafe * P.thrust * 0.6 - kS * fly.vs * Math.abs(fly.vs)) * dt;
      // vertical: the Gundam's thrusters hold ~98% of its weight at neutral; the dragon's lift grows with airspeed (sinks/stalls when slow)
      const speed = Math.hypot(fly.vf, fly.vs);
      const hold = P.lift === "wings" ? g * (0.55 + 0.45 * Math.min(1, (speed / P.stall) ** 2)) : g * 0.98;
      const up = hold + input.vert * (input.vert > 0 ? P.climb * (boosting ? 1.6 : 1) : g * 0.8);
      // wings resist vertical motion more the faster the dragon flies (so a sink stops once it has airspeed)
      const wingDamp = P.lift === "wings" ? 1.6 * Math.min(1.5, speed / P.stall) : 0;
      fly.vu += (up - g - kU * fly.vu * Math.abs(fly.vu) - wingDamp * fly.vu) * dt;
      if (fly.grounded && fly.vu < 0) fly.vu = 0;
      // coordinated turns: the stick rolls the body; turn rate = g * tan(bank) / speed. No auto-level.
      fly.bankH = Math.max(-60 * DEG, Math.min(60 * DEG, (fly.bankH || 0) + input.turn * P.rollRate * dt));
      if (fly.grounded) fly.bankH *= Math.exp(-dt * 4);
      const coordinated = g * Math.tan(fly.bankH) / Math.max(speed, 12);
      // a little direct thruster yaw at hover for the Gundam, so it can still turn on the spot
      const hoverYaw = P.lift === "wings" ? 0 : input.turn * TURN_RATE * 0.35 * Math.max(0, 1 - speed / 20);
      fly.yawRate = Math.max(-TURN_RATE * 1.3, Math.min(TURN_RATE * 1.3, coordinated + hoverYaw));
    }
    fly.az = (fly.az + fly.yawRate / DEG * dt + 360) % 360;

    // proposed move
    const s = Math.sin(fly.az * DEG), c = Math.cos(fly.az * DEG);
    let ve = fly.vf * s + fly.vs * c, vn = fly.vf * c - fly.vs * s;
    const excl = [fly.model, fly.pendingModel, fly.rider].filter(Boolean);

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
    const targetLean = ((fly.vf / (MAX_FWD * BOOST)) * CH().leanMax - (fly.vu / (MAX_VERT * 1.8)) * 18) * DEG * air;
    const targetBank = settings.difficulty === "hard" ? (fly.bankH || 0) * air + (fly.vs / MAX_STRAFE) * 8 * DEG * air
      : (fly.yawRate / TURN_RATE) * 22 * DEG * air + (fly.vs / MAX_STRAFE) * 12 * DEG * air;
    const k = 1 - Math.exp(-dt * 3);
    fly.lean += (targetLean - fly.lean) * k; fly.bank += (targetBank - fly.bank) * k;
    // head: looks into the turn (up to 30 deg) and a little up/down with climbs and dives
    const kh = 1 - Math.exp(-dt * 5);
    const turn = Math.max(-1, Math.min(1, fly.yawRate / TURN_RATE + 0.35 * fly.vs / MAX_STRAFE));
    fly.headYaw = (fly.headYaw || 0) + (turn * 30 * DEG - (fly.headYaw || 0)) * kh;
    fly.headPitch = (fly.headPitch || 0) + (Math.max(-1, Math.min(1, fly.vu / MAX_VERT)) * 12 * DEG - (fly.headPitch || 0)) * kh;
    if (fly.model) {
      fly.model.modelMatrix = modelMatrixFor(fly.lat, fly.lon, fly.h, fly.az, -fly.lean, fly.bank, CH().center);
      if (fly.character === "dragon") {
        // wings: slow beats when cruising, faster and deeper on boost, nearly folded when landed
        const beat = fly.grounded ? 0.35 : input.boost ? 2.2 : 0.9 + 0.6 * Math.min(1, Math.abs(fly.vu) / MAX_VERT);
        fly.wingPhase = ((fly.wingPhase || 0) + dt * beat * 2 * Math.PI) % (2 * Math.PI);
        const amp = (fly.grounded ? 4 : input.boost ? 34 : 22) * DEG;
        fly.wingAmp = (fly.wingAmp || amp) + (amp - (fly.wingAmp || amp)) * (1 - Math.exp(-dt * 3));
        // the rider sits on the neck holding the horns, so the head turns a little less than the Gundam's
        const fa = dragonFireAnim();
        poseDragon(fly.model, fly.headYaw * 0.7, fly.headPitch * 0.7 + fa[0], fly.wingAmp * Math.sin(fly.wingPhase) + (fly.grounded ? 25 * DEG : 0) + fa[1], -fly.headYaw * 0.6);
      } else {
        // while aiming, the head looks along the line of fire
        const aiming = fly.fireT !== undefined && fly.fireT < 1.4;
        poseHead(fly.model, aiming ? fly.headYaw * 0.3 : fly.headYaw, aiming ? Math.max(-25 * DEG, Math.min(25 * DEG, (fly.aimPitch || 0) + fly.lean)) : fly.headPitch);
        poseGundamArm(dt);
      }
    }
    fly.model && (fly.model.show = CAMS[fly.cam].range !== 0);
    if (fly.pendingModel && fly.model) { fly.pendingModel.modelMatrix = fly.model.modelMatrix; fly.pendingModel.show = fly.model.show; }

    if (fly.impactT > 0) fly.impactT -= dt;
    // HUD
    const spd = Math.hypot(ve, vn, fly.vu) * 3.6;
    const agl = fly.ground !== undefined ? fly.h - fly.ground : NaN;
    $("hudSpeed").textContent = spd.toFixed(0);
    $("hudThrust").style.width = Math.min(100, Math.abs(fly.vf) / (MAX_FWD * BOOST) * 100) + "%";
    $("hudAgl").textContent = isFinite(agl) ? agl.toFixed(0) : "--";
    $("hudAglMs").textContent = isFinite(agl) ? (agl / CH().height).toFixed(1) + " × " + CH().unit : "";
    $("hudElev").textContent = (fly.h - (demoMode ? 0 : 37)).toFixed(0);
    $("hudVs").textContent = fly.vu.toFixed(1);
    $("hudMode").textContent = (fly.grounded ? "LANDED" : fly.boosting ? "BOOST" : settings.difficulty === "hard" && fly.vu < -6 ? "SINK" : "HOVER") + " · " + DIFFICULTIES[settings.difficulty].toUpperCase();
    const hard = settings.difficulty === "hard"; $("hudBoostRow").hidden = !hard;
    if (hard) { $("hudBoost").style.width = (fly.stamina * 100).toFixed(0) + "%"; $("hudBoost").classList.toggle("low", fly.stamina < 0.2); }
    $("impact").classList.toggle("on", fly.impactT > 0);
    $("loadingTiles").classList.toggle("on", tilesets.length > 0 && !allTilesLoaded() && fly.ground === undefined);
    drawCompass();
  }

  function updateCamera(dt) {
    const cam = CAMS[fly.cam], ch = CH();
    look.pitch = Math.max(-70 * DEG, Math.min(25 * DEG, look.pitch + input.lookY * (settings.invertY ? -1 : 1) * 0.03));
    if (cam.range === 0) {
      // cockpit (Gundam) / rider's eye view (dragon): eye at head height, looking forward
      camera.lookAtTransform(C.Matrix4.IDENTITY);
      const s = Math.sin(fly.az * DEG), c = Math.cos(fly.az * DEG);
      const eye = offsetLL(fly.lat, fly.lon, s * ch.eyeFwd, c * ch.eyeFwd);
      camera.setView({ destination: C.Cartesian3.fromDegrees(eye.lon, eye.lat, fly.h + ch.eye),
        orientation: { heading: fly.az * DEG + look.yaw, pitch: -fly.lean * 0.5 + look.pitch, roll: fly.bank * 0.5 } });
      return;
    }
    // chase / far / side distances suit the character's size
    // the camera looks just above the character, so the crosshair (screen centre) and the line of fire clear its head
    const lift = ch.center + ch.height * (fly.cam === 2 ? 0.11 : 0.62);
    const target = C.Cartesian3.fromDegrees(fly.lon, fly.lat, fly.h + lift);
    const baseRange = fly.cam === 0 ? ch.cams[0] : fly.cam === 1 ? ch.cams[1] : ch.cams[2];
    let range = baseRange * look.zoom;
    let pitch = cam.pitch * DEG + look.pitch;
    // keep the camera above street level
    if (fly.ground !== undefined) {
      const camUp = lift - Math.sin(-pitch) * range;
      if (fly.h + camUp < fly.ground + 2) pitch = -Math.asin(Math.min(1, Math.max(-1, (fly.h + lift - fly.ground - 2) / range)));
    }
    const heading = fly.az * DEG + (cam.yaw || 0) * DEG + look.yaw;
    const small = fly.character === "dragon";
    range = collideRange("fly" + fly.cam + fly.character, target, heading, pitch, range, [fly.model, fly.rider, fly.pendingModel].filter(Boolean),
      small ? 0.8 : 2.0, small ? 3.5 : 12, dt || 0.016);
    camera.lookAtTransform(C.Transforms.eastNorthUpToFixedFrame(target), new C.HeadingPitchRange(heading, pitch, range));
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

  // ---- weapons: beam rifle (Gundam) and fireball (dragon); destructible buildings ----------------------
  // One ray per shot (from the crosshair) finds what it will hit; the projectile then just flies there, so firing stays cheap.
  const WEAPONS = { gundam: { speed: 600, range: 1600, cooldown: 0.35 }, dragon: { speed: 80, range: 800, cooldown: 0.9 } };
  const MAX_SHOTS = LOW_GFX ? 3 : 6, MAX_FX = LOW_GFX ? 5 : 10, MAX_CLIPS = LOW_GFX ? 6 : 12, FX_SCALE = LOW_GFX ? 0.5 : 1;   // fewer projectiles/particles on Low
  const ARM_PIVOT = [-6.4, 38.6, -0.9], MUZZLE = [0.01, -36.79, 1.38];             // gundam_rx78_18m*.glb: armR node (model units)
  const BODY_T = [-0.23696897, 0, 0], BODY_S = 0.3889163389802798;                   // body node transform (rotation +90 deg about Y)
  const DRAGON_MOUTH = [12.23, 8.22, 0.22];                                         // dragon.glb flight frame (dragon units)
  const shots = [], effects = [];
  const hiddenFeatures = new Map();   // tile content url -> Set(featureId) of destroyed PLATEAU buildings
  const hiddenOsm = new Set();
  let fireCooldown = 0, shake = 0, clipCount = 0;
  const beamLines = scene.primitives.add(new C.PolylineCollection());
  const glowPoints = scene.primitives.add(new C.PointPrimitiveCollection());
  const sprite = (() => { const cache = {}; return (inner, outer) => { const k = inner + outer; if (cache[k]) return cache[k];
    const cv = document.createElement("canvas"); cv.width = cv.height = 64; const g = cv.getContext("2d"); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, inner); gr.addColorStop(0.45, outer); gr.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return (cache[k] = cv); }; })();
  // model-space (Cesium: X fwd, Y left, Z up, metres) -> world, through the character's current model matrix
  const toWorld = (m, p) => C.Matrix4.multiplyByPoint(m, new C.Cartesian3(p[0], p[1], p[2]), new C.Cartesian3());
  function gundamMuzzleWorld(armAngle) {
    // arm node local (x left, y up, z fwd) -> rotate about x at the shoulder -> body node -> glTF -> Cesium model space
    const c = Math.cos(armAngle), s = Math.sin(armAngle), m = MUZZLE;
    const a = [m[0] + ARM_PIVOT[0], m[1] * c - m[2] * s + ARM_PIVOT[1], m[1] * s + m[2] * c + ARM_PIVOT[2]];
    const g = [BODY_T[0] + BODY_S * a[2], BODY_T[1] + BODY_S * a[1], BODY_T[2] - BODY_S * a[0]];   // Ry(+90): (x,y,z) -> (z, y, -x)
    return toWorld(fly.model.modelMatrix, [g[0], -g[2], g[1]]);                                 // glTF Y-up -> Cesium Z-up
  }
  function dragonMouthWorld() { const s = DRAGON_SCALE, m = DRAGON_MOUTH; return toWorld(fly.model.modelMatrix, [m[0] * s, -m[2] * s, m[1] * s]); }
  function addEffect(sys, life) { scene.primitives.add(sys); effects.push({ sys, t: 0, life }); while (effects.length > MAX_FX) { const e = effects.shift(); scene.primitives.remove(e.sys); } }
  function burst(pos, o) {
    const gravity = o.gravity || 0, sc = new C.Cartesian3();
    addEffect(new C.ParticleSystem({
      image: sprite(o.inner, o.outer), modelMatrix: C.Transforms.eastNorthUpToFixedFrame(pos), emitter: new C.SphereEmitter(o.radius || 2),
      startColor: C.Color.fromCssColorString(o.c0), endColor: C.Color.fromCssColorString(o.c1), startScale: o.s0 || 1, endScale: o.s1 || 3,
      minimumParticleLife: o.life * 0.6, maximumParticleLife: o.life, minimumSpeed: o.v0, maximumSpeed: o.v1, imageSize: new C.Cartesian2(o.px, o.px),
      emissionRate: 0, bursts: [new C.ParticleBurst({ time: 0, minimum: Math.round(o.n * FX_SCALE), maximum: Math.round(o.n * FX_SCALE) })], lifetime: 60, loop: false, sizeInMeters: true,   // one burst; removed by updateEffects
      updateCallback: gravity ? (p, dt) => { C.Cartesian3.normalize(p.position, sc); C.Cartesian3.multiplyByScalar(sc, -gravity * dt, sc); C.Cartesian3.add(p.velocity, sc, p.velocity); } : undefined
    }), o.life + 0.3);
  }
  function flash(pos, color, size, life) { const pt = glowPoints.add({ position: pos, color: C.Color.fromCssColorString(color), pixelSize: size, outlineWidth: 0, disableDepthTestDistance: 0 });
    effects.push({ point: pt, t: 0, life, size }); }
  function explode(pos, big) {
    const k = big ? 1.6 : 1;
    burst(pos, { inner: "rgba(255,255,230,1)", outer: "rgba(255,150,30,1)", c0: "rgba(255,215,130,1)", c1: "rgba(200,60,0,0)", n: 50 * k, v0: 6, v1: 22 * k, life: 1.3, px: 7 * k, s0: 1, s1: 3.5, radius: 2 * k });
    burst(pos, { inner: "rgba(120,120,120,0.9)", outer: "rgba(70,70,70,0.6)", c0: "rgba(110,105,100,0.8)", c1: "rgba(60,60,60,0)", n: 26 * k, v0: 3, v1: 9, life: 2.6, px: 10 * k, s0: 1, s1: 4, radius: 3 * k });
    burst(pos, { inner: "rgba(60,55,50,1)", outer: "rgba(40,35,30,1)", c0: "#4a443d", c1: "rgba(40,35,30,0)", n: 30 * k, v0: 10, v1: 30, life: 2.2, px: 1.2, s0: 1, s1: 1, radius: 1, gravity: 9.8 });
    flash(pos, "rgba(255,240,200,0.95)", 90 * k, 0.18);
    const d = C.Cartesian3.distance(camera.positionWC, pos); shake = Math.max(shake, Math.min(1, (big ? 120 : 60) / Math.max(20, d)));
  }
  function collapse(pos) { // dust cloud and falling debris where a building came down
    burst(pos, { inner: "rgba(200,190,170,0.9)", outer: "rgba(150,140,125,0.6)", c0: "rgba(190,180,160,0.85)", c1: "rgba(150,140,125,0)", n: 60, v0: 2, v1: 8, life: 4.5, px: 18, s0: 1, s1: 5, radius: 15 });
    burst(pos, { inner: "rgba(90,85,80,1)", outer: "rgba(70,65,60,1)", c0: "#5a544c", c1: "rgba(60,55,50,0)", n: 50, v0: 3, v1: 14, life: 3.0, px: 1.8, s0: 1, s1: 1, radius: 10, gravity: 9.8 });
  }
  function destroyAt(hit) {
    const obj = hit.object, pos = hit.position;
    if (obj instanceof C.Cesium3DTileFeature) {             // PLATEAU building: hide it (and keep it hidden when its tile reloads)
      const url = obj.content && obj.content.url; const id = obj.featureId;
      setTimeout(() => { try { obj.show = false; } catch (e) { /* tile unloaded */ } }, 350);
      if (url !== undefined) { if (!hiddenFeatures.has(url)) hiddenFeatures.set(url, new Set()); hiddenFeatures.get(url).add(id); }
      collapse(pos); return;
    }
    if (obj && obj.primitive && typeof obj.id === "string" && obj.id.startsWith("osm-")) { // OSM building (Nangang)
      try { obj.primitive.getGeometryInstanceAttributes(obj.id).show = C.ShowGeometryInstanceAttribute.toValue(false); hiddenOsm.add(obj.id); } catch (e) { /* ignore */ }
      collapse(pos); return;
    }
    if (worldMode === "google" && tilesets[0] && (obj && obj.primitive === tilesets[0] || hit.object === undefined)) { // one big mesh: cut a building-sized hole
      const ts = tilesets[0];
      if (!ts.clippingPolygons) ts.clippingPolygons = new C.ClippingPolygonCollection();
      const cp = ts.clippingPolygons; if (cp.length >= MAX_CLIPS) cp.remove(cp.get(0));
      const carto = C.Cartographic.fromCartesian(pos), lat = carto.latitude / DEG, lon = carto.longitude / DEG, r = 16;
      const ring = [[-r, -r], [r, -r], [r, r], [-r, r]].map(([e, n]) => { const o = offsetLL(lat, lon, e, n); return C.Cartesian3.fromDegrees(o.lon, o.lat); });
      cp.add(new C.ClippingPolygon({ positions: ring })); clipCount++;
      collapse(pos);
    }
  }
  function reapplyHidden(tile) {
    const set = tile && tile.content && hiddenFeatures.get(tile.content.url); if (!set) return;
    for (const id of set) { try { if (id < tile.content.featuresLength) tile.content.getFeature(id).show = false; } catch (e) { /* ignore */ } }
  }
  function rebuildCity() {
    for (const ts of tilesets) { if (ts.clippingPolygons) ts.clippingPolygons.removeAll();
      // show every feature of loaded tiles again
      try { ts.root && (function walk(t) { if (t.content && t.content.featuresLength) for (let i = 0; i < t.content.featuresLength; i++) t.content.getFeature(i).show = true; (t.children || []).forEach(walk); })(ts.root); } catch (e) { /* ignore */ } }
    hiddenFeatures.clear();
    if (localWorld && localWorld.osmPrimitive) for (const id of hiddenOsm) { try { localWorld.osmPrimitive.getGeometryInstanceAttributes(id).show = C.ShowGeometryInstanceAttribute.toValue(true); } catch (e) { /* ignore */ } }
    hiddenOsm.clear(); clipCount = 0;
  }
  function requestFire() {
    if (state.mode !== "fly" || !fly.model || fireCooldown > 0) return;
    const W = WEAPONS[fly.character || "gundam"]; fireCooldown = W.cooldown;
    // aim: through the crosshair (screen centre)
    const cv = scene.canvas, ray = camera.getPickRay(new C.Cartesian2(cv.clientWidth / 2, cv.clientHeight / 2));
    // ignore the character, its own shots and all effects (smoke would otherwise stop the ray)
    // first real hit along the ray: skip our own effects (smoke billboards, glow points, beams), which are picked per billboard
    const ours = new Set([beamLines, glowPoints].concat(effects.map((e) => e.sys && e.sys._billboardCollection), shots.map((s) => s.trail && s.trail._billboardCollection)).filter(Boolean));
    let hit;
    try { hit = scene.drillPickFromRay(ray, 6, [fly.model, fly.pendingModel].filter(Boolean), 1.0).find((r) => !(r.object && (ours.has(r.object.collection) || ours.has(r.object.primitive)))); } catch (e) { hit = undefined; }
    let target = hit && hit.position && C.Cartesian3.distance(ray.origin, hit.position) < W.range + 200 ? hit.position : C.Cartesian3.add(ray.origin, C.Cartesian3.multiplyByScalar(ray.direction, W.range, new C.Cartesian3()), new C.Cartesian3());
    if (!(hit && hit.position && target === hit.position)) hit = null;
    // aim pitch (world) for the animation: angle of the line of fire above the horizon
    const up = C.Cartesian3.normalize(fly.model ? C.Matrix4.getTranslation(fly.model.modelMatrix, new C.Cartesian3()) : ray.origin, new C.Cartesian3());
    fly.aimPitch = Math.asin(Math.max(-1, Math.min(1, C.Cartesian3.dot(ray.direction, up))));
    fly.fireT = 0; fly.fireTarget = target; fly.fireHit = hit; fly.fireDone = false;
    if (fly.character !== "dragon") launch();   // the beam leaves at once; the fireball leaves at the end of the head lunge
  }
  function launch() {
    fly.fireDone = true;
    const W = WEAPONS[fly.character || "gundam"], dragon = fly.character === "dragon";
    const from = dragon ? dragonMouthWorld() : gundamMuzzleWorld(fly.armAngle || 0);
    const dir = C.Cartesian3.normalize(C.Cartesian3.subtract(fly.fireTarget, from, new C.Cartesian3()), new C.Cartesian3());
    const dist = C.Cartesian3.distance(from, fly.fireTarget);
    if (shots.length >= MAX_SHOTS) { const o = shots.shift(); removeShot(o); }
    const s = { dragon, pos: C.Cartesian3.clone(from), dir, speed: W.speed, travelled: 0, dist, hit: fly.fireHit };
    if (dragon) {
      s.point = glowPoints.add({ position: from, color: C.Color.fromCssColorString("#ff8a1e"), pixelSize: 26, outlineColor: C.Color.fromCssColorString("rgba(255,220,120,0.8)"), outlineWidth: 4 });
      s.trail = scene.primitives.add(new C.ParticleSystem({ image: sprite("rgba(255,240,180,1)", "rgba(255,110,20,0.9)"), modelMatrix: C.Transforms.eastNorthUpToFixedFrame(from), emitter: new C.SphereEmitter(0.4),
        startColor: C.Color.fromCssColorString("#ffcf6a"), endColor: C.Color.fromCssColorString("rgba(120,30,0,0)"), startScale: 1.2, endScale: 0.2, minimumParticleLife: 0.25, maximumParticleLife: 0.5,
        minimumSpeed: 0.5, maximumSpeed: 2, imageSize: new C.Cartesian2(1.6, 1.6), sizeInMeters: true, emissionRate: 45, lifetime: 30, loop: true }));
      flash(from, "rgba(255,170,60,0.9)", 40, 0.15);
    } else {
      s.line = beamLines.add({ positions: [from, from], width: 16, material: C.Material.fromType("PolylineGlow", { color: C.Color.fromCssColorString("#ff8ae0"), glowPower: 0.45, taperPower: 0.5 }) });
      s.point = glowPoints.add({ position: from, color: C.Color.fromCssColorString("#fff0fb"), pixelSize: 12, outlineColor: C.Color.fromCssColorString("rgba(255,110,220,0.8)"), outlineWidth: 5 });
      flash(from, "rgba(255,200,240,0.95)", 46, 0.08);   // muzzle flash
      fly.vf -= 4;                                          // recoil
    }
    shots.push(s);
  }
  function removeShot(s) { if (s.line) beamLines.remove(s.line); if (s.point) glowPoints.remove(s.point); if (s.trail) scene.primitives.remove(s.trail); }
  function updateWeapons(dt) {
    fireCooldown = Math.max(0, fireCooldown - dt);
    if (fly.fireT !== undefined) { fly.fireT += dt; if (fly.character === "dragon" && !fly.fireDone && fly.fireT >= 0.24) launch(); }
    for (let i = shots.length - 1; i >= 0; i--) {
      const s = shots[i]; const step = Math.min(s.speed * dt, s.dist - s.travelled); s.travelled += step;
      C.Cartesian3.add(s.pos, C.Cartesian3.multiplyByScalar(s.dir, step, new C.Cartesian3()), s.pos);
      if (s.line) { const tail = C.Cartesian3.subtract(s.pos, C.Cartesian3.multiplyByScalar(s.dir, Math.min(70, s.travelled), new C.Cartesian3()), new C.Cartesian3()); s.line.positions = [tail, C.Cartesian3.clone(s.pos)]; }
      if (s.point) s.point.position = s.pos;
      if (s.trail) s.trail.modelMatrix = C.Transforms.eastNorthUpToFixedFrame(s.pos);
      if (s.travelled >= s.dist - 1e-3) {
        removeShot(s); shots.splice(i, 1);
        if (s.hit) { explode(s.pos, s.dragon); destroyAt(s.hit); } else explode(s.pos, false);
      }
    }
    updateEffects(dt);
  }
  function updateEffects(dt) {
    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i]; e.t += dt;
      if (e.point) { const u = e.t / e.life; e.point.pixelSize = e.size * (1 + u); e.point.color = e.point.color.withAlpha(Math.max(0, 1 - u)); }
      if (e.t >= e.life) { if (e.sys) scene.primitives.remove(e.sys); if (e.point) glowPoints.remove(e.point); effects.splice(i, 1); }
    }
  }
  function applyShake(dt) {
    if (shake <= 0.001) return;
    const a = shake * 0.02; camera.lookRight((Math.random() - 0.5) * a); camera.lookUp((Math.random() - 0.5) * a);
    shake *= Math.exp(-dt * 6);
  }
  // fire animations
  function poseGundamArm(dt) {
    const t = fly.fireT === undefined ? 99 : fly.fireT;
    // raise and aim for 1.4 s after a shot, then lower; arm angle about the shoulder (negative = forward/up), -90 deg = level
    const aim = t < 1.4 ? -(90 * DEG + (fly.aimPitch || 0) + fly.lean * 0.6) : 0;
    const recoil = t < 0.25 ? 10 * DEG * Math.exp(-t * 18) : 0;
    fly.armAngle = (fly.armAngle || 0) + (aim - (fly.armAngle || 0)) * (1 - Math.exp(-dt * (aim ? 14 : 4)));
    const ang = fly.armAngle + recoil;
    const n = fly.model && fly.model.ready && (fly.model.__arm !== undefined ? fly.model.__arm : (fly.model.__arm = (() => { try { return fly.model.getNode("armR") || null; } catch (e) { return null; } })()));
    if (n) n.matrix = C.Matrix4.fromRotationTranslation(C.Matrix3.fromRotationX(ang), new C.Cartesian3(ARM_PIVOT[0], ARM_PIVOT[1], ARM_PIVOT[2]));
  }
  function dragonFireAnim() { // [extra head pitch, extra wing] for the rear-back / lunge
    const t = fly.fireT === undefined ? 99 : fly.fireT;
    if (t < 0.18) { const u = t / 0.18; return [22 * DEG * u, 30 * DEG * u]; }
    if (t < 0.4) { const u = (t - 0.18) / 0.22; return [22 * DEG - 40 * DEG * Math.sin(u * Math.PI / 2), 30 * DEG * (1 - u)]; }
    if (t < 0.8) { const u = (t - 0.4) / 0.4; return [-18 * DEG * (1 - u), 0]; }
    return [0, 0];
  }
  $("rebuildBtn").onclick = () => { rebuildCity(); };
  $("fireBtn").addEventListener("pointerdown", (e) => { $("fireBtn").classList.add("on"); requestFire(); e.preventDefault(); });
  $("fireBtn").addEventListener("pointerup", () => $("fireBtn").classList.remove("on"));
  $("fireBtn").addEventListener("pointercancel", () => $("fireBtn").classList.remove("on"));

  // ---- main loop ------------------------------------------------------------
  const state = { mode: "lobby" };
  let last = performance.now(), fpsAcc = 0, fpsN = 0;
  // automatic resolution: when the frame rate stays below the target, render fewer pixels (the canvas is scaled up);
  // raise it again slowly once frames are fast enough. Every 2 s, between RES_MIN and the quality's normal scale.
  const RES_MAX = LOW_GFX ? 0.75 : 1.0, RES_MIN = LOW_GFX ? 0.5 : 0.6, FPS_TARGET = LOW_GFX ? 30 : 50;
  const autoRes = { t: 0, n: 0, good: 0 };
  function updateAutoRes(rawDt) {
    if (!settings.autoRes || document.hidden || state.mode === "pause" || rawDt > 1) { autoRes.t = autoRes.n = 0; return; }
    autoRes.t += rawDt; autoRes.n++;
    if (autoRes.t < 2) return;
    const fps = autoRes.n / autoRes.t; autoRes.t = autoRes.n = 0;
    let s = viewer.resolutionScale;
    if (fps < FPS_TARGET * 0.85) { s = Math.max(RES_MIN, s - 0.1); autoRes.good = 0; }
    else if (fps >= FPS_TARGET * 0.95) { if (++autoRes.good >= 3) { s = Math.min(RES_MAX, s + 0.05); autoRes.good = 0; } }
    else autoRes.good = 0;
    if (Math.abs(s - viewer.resolutionScale) > 0.001) viewer.resolutionScale = +s.toFixed(2);
  }
  // Low: 30 FPS cap (steadier frames, less heat and battery). Paused: 10 FPS (the menu still reads the gamepad).
  const FRAME_CAP = LOW_GFX ? 30 : undefined;
  if (FRAME_CAP) viewer.targetFrameRate = FRAME_CAP;
  scene.preUpdate.addEventListener(() => {
    const now = performance.now(); const rawDt = (now - last) / 1000; const dt = Math.min(0.1, rawDt); last = now;
    updateWards(); updateAutoRes(rawDt);
    if (state.mode === "fly") { updateFlight(dt); updateWeapons(dt); updateCamera(dt); applyShake(dt); }
    else if (state.mode === "lobby" && lobby.active) { readInput(); lobbyCamera(dt); }
    else if (state.mode === "pause") readInput();
    if (state.mode !== "fly") updateEffects(dt);
    if (settings.showFps) { fpsAcc += dt; fpsN++; if (fpsAcc > 0.5) { $("hudFps").textContent = " · " + (fpsN / fpsAcc).toFixed(0) + " fps"; fpsAcc = 0; fpsN = 0; } }
  });

  function togglePause() {
    if (state.mode === "fly") { state.mode = "pause"; $("pause").hidden = false; $("touch").hidden = true; viewer.clock.shouldAnimate = false; viewer.targetFrameRate = 10; }
    else if (state.mode === "pause") { state.mode = "fly"; $("pause").hidden = true; $("touch").hidden = !isTouch; viewer.clock.shouldAnimate = true; viewer.targetFrameRate = FRAME_CAP; last = performance.now(); }
  }

  // ---- UI wiring ----------------------------------------------------------------
  const spawns = CFG.spawns || [];
  for (const sel of [$("spawnSelect"), $("teleportSelect")]) spawns.forEach((s, i) => sel.add(new Option(s.name, i)));
  $("startBtn").onclick = () => startFlight(spawns[+$("spawnSelect").value] || spawns[0]);
  const charNote = () => { $("characterNote").textContent = settings.character === "dragon"
    ? "The dragon is shown at a rideable " + DRAGON_HEIGHT_M + " m (its official height is 1.7 m), with a 1.75 m rider on its back."
    : "True scale: the mobile suit stands 18.0 m."; };
  $("characterSelect").value = settings.character; charNote();
  $("characterSelect").onchange = () => selectCharacter($("characterSelect").value);
  // flight difficulty: start screen and Settings stay in sync, applied at once
  const DIFF_NOTES = { easy: "Easy: arcade - stops when you let go, no gravity, direct turns.", medium: "Medium: some inertia and drag, gentle sink without vertical thrust.",
    hard: "Hard: mass and momentum, full gravity, drag, banked turns, no auto-level; boost uses a recharging gauge." };
  function setDifficulty(d) { if (!DIFFICULTIES[d]) return; settings.difficulty = d; store.set("difficulty", d);
    for (const id of ["difficultySelect", "difficultySetting"]) { const el = $(id); if (el) el.value = d; }
    $("difficultyNote").textContent = DIFF_NOTES[d]; fly.bankH = 0; }
  $("difficultySelect").onchange = () => setDifficulty($("difficultySelect").value);
  $("difficultySetting").onchange = () => setDifficulty($("difficultySetting").value);
  setDifficulty(settings.difficulty);
  $("resumeBtn").onclick = togglePause;
  $("teleportBtn").onclick = () => { placeAt(spawns[+$("teleportSelect").value]); $("hudLoc").textContent = fly.spawn.name; togglePause(); };
  $("toLobbyBtn").onclick = async () => {
    await fade(true);
    state.mode = "lobby"; viewer.clock.shouldAnimate = true;
    $("pause").hidden = true; $("hud").hidden = true; $("touch").hidden = true; $("lobby").hidden = false;
    if (fly.model) fly.model.show = false;
    if (fly.rider) fly.rider.show = false;
    lobby.active = true; look.yaw = 0; look.pitch = 0; look.zoom = 1;
    await fade(false);
  };
  $("camBtn").onclick = cycleCamera;
  $("menuBtn").onclick = togglePause;
  const openSettings = () => {
    $("citySource").value = settings.citySource; $("keyInput").value = settings.key; $("qualitySelect").value = settings.quality;
    $("invertY").checked = settings.invertY; $("showFps").checked = settings.showFps; $("autoRes").checked = settings.autoRes; $("settingsDlg").showModal();
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
    store.set("invertY", $("invertY").checked); store.set("showFps", $("showFps").checked); store.set("autoRes", $("autoRes").checked);
    setTimeout(() => location.reload(), 50);
  };
  $("helpBtn").onclick = () => $("helpDlg").showModal(); $("pHelpBtn").onclick = () => $("helpDlg").showModal();
  $("creditsBtn").onclick = () => $("creditsDlg").showModal();

  // service worker (installable app on Windows and Android)
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  // expose for debugging / automated tests
  window.GFS = { viewer, fly, lobby, state, input, keys, settings, startFlight, spawns, get demoMode() { return demoMode; }, get worldMode() { return worldMode; }, get destroyed() { let n = 0; for (const s of hiddenFeatures.values()) n += s.size; return n + hiddenOsm.size + clipCount; }, requestFire, rebuildCity, shots, effects, explode, collapse, beamLines, glowPoints, tilesets, wardSlots, get localWorld() { return localWorld; } };

  (async () => {
    $("startBtn").disabled = true; $("startBtn").textContent = "Loading…";
    await initWorld();
    try { await buildLobby(); } catch (e) { console.error(e); showFatal("Could not build the start scene: " + ((e && (e.stack || e.message)) || e)); setStatus("Could not build the start scene: " + (e.message || e), true); }
    $("startBtn").disabled = false; $("startBtn").textContent = "Launch";
    window.GFS.ready = true;
  })();
})();
