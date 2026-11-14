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
  const RIDER_EYE = [7.02, 11.70];         // rider eye in dragon.glb (flight frame X fwd, Y up; dragon units)
  const D_PITCH = 55 * DEG;                // body pitch baked into dragon.glb (native joints are in the upright frame)
  const DRAGON_JOINTS = {
    head: { p: [0, -3.0, 12.8], rest: -45 * DEG }, tail: { p: [0, 2.6, 4.5], rest: -52 * DEG },
    wingL: { p: [2.6, 0.5, 11.0] }, wingR: { p: [-2.6, 0.5, 11.0] }
  };
  const D_UP = [0, Math.sin(D_PITCH), Math.cos(D_PITCH)];     // flight "up" in the dragon's native frame (yaw axis)
  const D_FWD = [0, -Math.cos(D_PITCH), Math.sin(D_PITCH)];   // flight "forward" in the native frame (wing-beat axis)
  // walking legs (tools/build_dragon_legs.js): hip -> knee -> ankle under the body joint, native frame (+x its left, -y forward,
  // +z up); a negative turn about x swings a leg forward. Translations are relative to the parent joint.
  const DRAGON_HIP = [3.2, -0.6, 5.6], DRAGON_KNEE = [3.4, -1.0, 3.0], DRAGON_ANKLE = [3.4, -1.2, 1.0];
  const DRAGON_SOLE = [[3.4, 0.4, 0.0], [3.4, -3.7, 0.3]];   // heel and toe of the left foot (native)
  const DRAGON_ROOT = [0, 0, -1, 0, -0.57358, 0.81915, 0, 0, 0.81915, 0.57358, 0, 0, -7.94594, 3.08188, 0, 1];   // dragon.glb root: native -> flight frame
  const DRAGON_WALK_RAISE = 25 * DEG;   // on foot the body is raised from the flight attitude to stand (30 deg forward lean)
  const DRAGON_WALK_HEAD_TILT = 12 * DEG;   // at most this much head tilt to compensate, so the horns stay close to the rider's hands
  const CHARACTERS = {
    gundam: { name: "Gundam RX-78-02 (18 m)", leanMax: 55, phys: { mass: 43.4, thrust: 7, climb: 5, rollRate: 45 * DEG, lift: "thrusters", stall: 0 }, center: MS_CENTER, eye: 16.6, eyeFwd: 1.5, height: MS_HEIGHT, unit: "MS height", cams: [55, 160, 45],
      // walking (m/s, deg/s, m): run = Shift; step = highest ledge it steps onto (higher blocks), drop = edge it walks off,
      // enter = slowest ground speed that switches to walking, probe = how far ahead walls are checked
      walk: { walk: 4.5, run: 12, back: 2.5, side: 3, turn: 50, step: 3.0, drop: 4.0, jump: 9, enter: 18, probe: 5, probeSide: 3.5 } },
    dragon: { name: "Dragon + rider (rideable " + DRAGON_HEIGHT_M + " m)", leanMax: 12, phys: { mass: 0.9, thrust: 14, climb: 9, rollRate: 110 * DEG, lift: "wings", stall: 22 }, center: 6.0 * DRAGON_SCALE, eye: RIDER_EYE[1] * DRAGON_SCALE, eyeFwd: RIDER_EYE[0] * DRAGON_SCALE + 0.15, height: DRAGON_HEIGHT_M, unit: "dragon heights", cams: [8 + 3 * DRAGON_HEIGHT_M, 20 + 8 * DRAGON_HEIGHT_M, 6 + 2.5 * DRAGON_HEIGHT_M],
      walk: { walk: 2, run: 6, back: 1.2, side: 1.2, turn: 90, step: 0.8, drop: 1.5, jump: 6, enter: 9, probe: 2.5, probeSide: 1.0 } }
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
  // first launch: phones and weak computers (little memory or CPU, or a software-only GPU) start on Low graphics
  function weakDevice() {
    if (isTouch) return true;
    if ((navigator.deviceMemory || 8) <= 4 || (navigator.hardwareConcurrency || 8) <= 2) return true;
    try {
      const gl = document.createElement("canvas").getContext("webgl"); if (!gl) return true;
      const ext = gl.getExtension("WEBGL_debug_renderer_info"); const r = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "";
      const lose = gl.getExtension("WEBGL_lose_context"); if (lose) lose.loseContext();
      return /swiftshader|llvmpipe|software|basic render/i.test(r);
    } catch (e) { return false; }
  }
  const storedQuality = store.get("quality", null);
  const settings = {
    key: (store.get("key", "") || CFG.googleMapsApiKey || "").trim(),
    quality: storedQuality || (weakDevice() ? "low" : "medium"),
    qualityAuto: !storedQuality,   // not chosen by the user yet: the start screen checks the frame rate once
    invertY: store.get("invertY", false),
    showFps: store.get("showFps", false),
    autoRes: store.get("autoRes", true),
    camShake: store.get("impactShake", false)   // off by default (new key, so an older saved "on" does not carry over)
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
  // profiler (?profile=1): per-frame section times in ms, see the main loop
  const PROF = /[?&]profile=1\b/.test(location.search) ? { acc: {}, frames: 0, picks: 0, pickFrames: 0, shown: performance.now(), last: 0, tr: 0, report: null, el: null,
    add(k, t) { const n = performance.now(); this.acc[k] = (this.acc[k] || 0) + n - t; return n; } } : null;
  if (PROF) { PROF.el = document.createElement("pre"); PROF.el.id = "profOverlay";
    PROF.el.style.cssText = "position:fixed;left:8px;top:120px;z-index:50;margin:0;padding:6px 8px;font:11px/1.35 monospace;color:#9fffc8;background:rgba(0,0,0,.55);border-radius:6px;pointer-events:none;white-space:pre";
    document.body.appendChild(PROF.el); }
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
    scene.skyAtmosphere.show = false; scene.skyBox && (scene.skyBox.show = false); scene.backgroundColor = C.Color.fromCssColorString("#a9c6e2");
    // cheaper ground: no atmosphere tint on the globe, coarser ground mesh (the street grid is flat at this scale)
    scene.globe.showGroundAtmosphere = false; scene.globe.maximumScreenSpaceError = 4; }
  const nearOnly = () => (LOW_GFX ? new C.DistanceDisplayCondition(0, 450) : undefined);   // small props: pilots, dragon scene

  // Low: half-size city textures. Each Tokyo tile (b3dm) is rewritten as it arrives, before Cesium reads it: its embedded
  // images are scaled to half width and height (a quarter of the GPU memory) and stored back in their format (WebP). Any problem keeps
  // the original tile. Tiles are patched in the browser so the stored city data stays the same for Medium and High.
  if (LOW_GFX && typeof createImageBitmap === "function" && typeof OffscreenCanvas === "function") {
    const origFetch = C.Resource.prototype.fetchArrayBuffer;
    C.Resource.prototype.fetchArrayBuffer = function () {
      const p = origFetch.apply(this, arguments);
      if (!p || !/\/cities\/tokyo\/.*\.b3dm/.test(this.url)) return p;   // undefined = throttled; Cesium retries later
      return p.then((buf) => halveB3dmTextures(buf).catch((e) => { console.warn("texture downscale skipped", e); return buf; }));
    };
  }
  async function halveB3dmTextures(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    if (dv.getUint32(0, true) !== 0x6d643362) return buf;   // "b3dm"
    const head = 28 + dv.getUint32(12, true) + dv.getUint32(16, true) + dv.getUint32(20, true) + dv.getUint32(24, true);
    const g = head; if (dv.getUint32(g, true) !== 0x46546c67) return buf;   // "glTF"
    const jsonLen = dv.getUint32(g + 12, true);
    const json = JSON.parse(new TextDecoder().decode(u8.subarray(g + 20, g + 20 + jsonLen)));
    const binStart = g + 20 + jsonLen + 8, views = json.bufferViews || [];
    const imgViews = new Map();
    for (const im of json.images || []) if (im.bufferView !== undefined && /jpeg|png|webp/.test(im.mimeType || "")) imgViews.set(im.bufferView, im);
    if (!imgViews.size) return buf;
    const webpLost = new Set();
    const parts = await Promise.all(views.map(async (bv, i) => {
      const src = u8.subarray(binStart + (bv.byteOffset || 0), binStart + (bv.byteOffset || 0) + bv.byteLength);
      const im = imgViews.get(i); if (!im) return src;
      const bmp = await createImageBitmap(new Blob([src], { type: im.mimeType }));
      if (bmp.width < 128 || bmp.height < 128) { bmp.close(); return src; }
      const cv = new OffscreenCanvas(bmp.width >> 1, bmp.height >> 1);
      cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height); bmp.close();
      // keep WebP (PLATEAU tiles use EXT_texture_webp); browsers that cannot encode it return PNG, which then becomes the plain source
      const blob = await cv.convertToBlob({ type: im.mimeType === "image/png" ? "image/png" : im.mimeType, quality: 0.85 });
      if (blob.type !== im.mimeType) { im.mimeType = blob.type; webpLost.add(im); }
      return new Uint8Array(await blob.arrayBuffer());
    }));
    if (webpLost.size) {   // an image is no longer WebP: point its textures at it directly instead of through the WebP extension
      const idx = new Set([...webpLost].map((im) => json.images.indexOf(im)));
      for (const t of json.textures || []) { const w = t.extensions && t.extensions.EXT_texture_webp; if (w && idx.has(w.source)) { t.source = w.source; delete t.extensions.EXT_texture_webp; } }
    }
    let off = 0;   // repack the binary chunk (4-byte aligned); accessors stay valid, their offsets are view-relative
    views.forEach((bv, i) => { off = (off + 3) & ~3; bv.byteOffset = off; bv.byteLength = parts[i].length; off += parts[i].length; });
    const binLen = (off + 3) & ~3; json.buffers[0].byteLength = off;
    let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
    const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
    const glbLen = 12 + 8 + jsonBytes.length + jsonPad + 8 + binLen;
    const out = new Uint8Array(head + glbLen), o = new DataView(out.buffer);
    out.set(u8.subarray(0, head)); o.setUint32(8, out.length, true);
    o.setUint32(g, 0x46546c67, true); o.setUint32(g + 4, 2, true); o.setUint32(g + 8, glbLen, true);
    o.setUint32(g + 12, jsonBytes.length + jsonPad, true); o.setUint32(g + 16, 0x4e4f534a, true);   // "JSON"
    out.set(jsonBytes, g + 20); out.fill(0x20, g + 20 + jsonBytes.length, g + 20 + jsonBytes.length + jsonPad);
    const b = g + 20 + jsonBytes.length + jsonPad;
    o.setUint32(b, binLen, true); o.setUint32(b + 4, 0x004e4942, true);   // "BIN"
    views.forEach((bv, i) => out.set(parts[i], b + 8 + bv.byteOffset));
    return out.buffer;
  }
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
            enablePick: true,   // keep a CPU copy of the geometry for the CPU height/ray queries (else each one reads it back from the GPU)
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
        cacheBytes: LOW_GFX ? 64 * 1024 * 1024 : lowMem ? 128 * 1024 * 1024 : Math.min(QUALITY.cacheBytes, 512 * 1024 * 1024),
        maximumCacheOverflowBytes: LOW_GFX ? 32 * 1024 * 1024 : undefined,   // Low: half-size textures, so half the budget gives the same detail
        cullRequestsWhileMoving: true, cullRequestsWhileMovingMultiplier: LOW_GFX ? 30 : 60,   // skip tile requests while the camera moves fast
        dynamicScreenSpaceError: true,
        enablePick: true,   // keep a CPU copy of the geometry for the CPU height/ray queries (else each one reads it back from the GPU)
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
  // the ground and camera checks must not hit our own shots, smoke and flashes: a fireball leaving the dragon's mouth
  // was read as a roof, lifting the dragon (and the camera) for a frame. Hide them for the pick, then show them again.
  function withOwnFxHidden(fn) {
    if (typeof effects === "undefined" || (!effects.length && !shots.length)) return fn();
    const hidden = [beamLines, glowPoints].concat(effects.map((e) => e.sys), shots.map((x) => x.trail)).filter((p) => p && p.show);
    for (const p of hidden) p.show = false;
    try { return fn(); } finally { for (const p of hidden) p.show = true; }
  }
  // ---- CPU queries against the loaded city tiles (no GPU read-back) ---------------------------------------
  // A GPU pick (scene.sampleHeight / pickFromRay) reads pixels back, so it makes the CPU wait for the GPU: measured on an
  // Intel laptop GPU, frames take 6-8 ms without a pick and 48-104 ms with one. The city's 3D tiles keep their geometry on
  // the CPU for picking, so heights and rays are intersected there instead (about 1 ms). That only covers tiles being
  // drawn, so the GPU pick is still used (at most in pick frames) for spots outside the view, near destroyed buildings
  // (CPU picking still sees hidden ones) and where there are no tiles (the Nangang start screen).
  // On WebGL 2 Cesium keeps only the index data of tiles on the CPU; each CPU pick reads all vertex positions of the
  // candidate tiles back from the GPU (getBufferSubData, another stall). Tile geometry never changes, so the first read
  // of each static buffer is kept (with the buffer object, freed with it) and later picks copy from memory.
  if (C.Buffer && C.Buffer.prototype.getBufferData && C.BufferUsage) {
    const readBack = C.Buffer.prototype.getBufferData, kept = new WeakMap();
    C.Buffer.prototype.getBufferData = function (view, srcOffset, dstOffset, length) {
      if (srcOffset || dstOffset || length || this._usage !== C.BufferUsage.STATIC_DRAW || !view || !view.buffer) return readBack.apply(this, arguments);
      let bytes = kept.get(this);
      if (!bytes || bytes.byteLength < view.byteLength) { bytes = new Uint8Array(view.byteLength); readBack.call(this, bytes); kept.set(this, bytes); }
      new Uint8Array(view.buffer, view.byteOffset, view.byteLength).set(bytes.subarray(0, view.byteLength));
    };
  }
  const destroyedSpots = [];   // where buildings were destroyed (cleared by Rebuild city)
  const scratchCpuCg = new C.Cartographic(), scratchCpuPt = new C.Cartesian3(), scratchCpuHit = new C.Cartesian3(), scratchCpuBs = new C.BoundingSphere();
  const scratchCpuA = new C.Cartesian3(), scratchCpuB = new C.Cartesian3();
  function cityTilesetsAt(pt) {
    const out = [];
    for (const ts of tilesets) { try { if (ts.show && ts.root && C.Cartesian3.distance(ts.boundingSphere.center, pt) < ts.boundingSphere.radius) out.push(ts); } catch (e) { /* not ready */ } }
    return out;
  }
  function inView(pt, r) {
    const fs = scene.frameState; if (!fs || !fs.cullingVolume) return false;
    scratchCpuBs.center = pt; scratchCpuBs.radius = r; return fs.cullingVolume.computeVisibility(scratchCpuBs) !== C.Intersect.OUTSIDE;
  }
  function nearDestroyed(a, b, r) {   // any destroyed spot within r of the segment a-b (or of point a)
    for (const p of destroyedSpots) {
      if (!b) { if (C.Cartesian3.distanceSquared(p, a) < r * r) return true; continue; }
      const ab = C.Cartesian3.subtract(b, a, scratchCpuA), ap = C.Cartesian3.subtract(p, a, scratchCpuB);
      const t = Math.max(0, Math.min(1, C.Cartesian3.dot(ap, ab) / Math.max(1e-6, C.Cartesian3.magnitudeSquared(ab))));
      C.Cartesian3.multiplyByScalar(ab, t, ab); if (C.Cartesian3.distanceSquared(ap, ab) < r * r) return true;
    }
    return false;
  }
  const DESTROYED_R = () => (worldMode === "google" ? 40 : 90);
  // closest hit of a ray with the drawn tiles of a tileset within maxDist. Like Cesium3DTileset.pick, but only tiles whose
  // bounds meet this stretch of the ray are tested (nearest first, stopping once no closer hit is possible), so a short
  // camera ray or a vertical height query tests a few tiles instead of every tile along the infinite ray.
  const scratchIv = new C.Interval();
  // ---- triangle grids: each tile's triangles in world space, bucketed in a 3D grid, built once per tile -------------
  // Cesium's content.pick transforms every vertex of the tile with a matrix and tests every triangle on each query (tens
  // of milliseconds for the detailed Medium/High tiles). A tile's geometry never changes, so it is transformed once into
  // a grid of cells; a ray then walks only the cells it passes through and tests the few triangles in them.
  const triGrids = new WeakMap();   // tile content -> grid, or false (not indexable: Cesium's pick is used)
  let gridBuildsThisFrame = 0;
  function buildTriGrid(content) {
    const model = content && content._model; if (!model || !model._ready || !model.sceneGraph) return null;
    const sg = model.sceneGraph, P = [], F = [];   // P: world positions, 9 numbers per triangle; F: its building (feature id) or -1
    const M = new C.Matrix4(), v = new C.Cartesian3();
    for (const rn of sg._runtimeNodes) {
      if (rn.node && rn.node.instances) return false;
      C.Matrix4.multiplyTransformation(sg.computedModelMatrix, rn.computedTransform, M);
      for (const rp of rn.runtimePrimitives) {
        const prim = rp.primitive; if (!prim || !prim.indices || (prim.primitiveType !== undefined && prim.primitiveType !== C.PrimitiveType.TRIANGLES)) continue;
        const pa = prim.attributes.find((a) => a.semantic === "POSITION"); if (!pa) continue;
        let idx = prim.indices.typedArray;
        if (!idx) { const n = prim.indices.count, dt = prim.indices.indexDatatype;
          idx = dt === C.IndexDatatype.UNSIGNED_BYTE ? new Uint8Array(n) : dt === C.IndexDatatype.UNSIGNED_SHORT ? new Uint16Array(n) : new Uint32Array(n);
          if (!prim.indices.buffer) continue; prim.indices.buffer.getBufferData(idx); }
        const q = pa.quantization; if (q && q.octEncoded) return false;
        const dt = q ? q.componentDatatype : pa.componentDatatype, bytes = C.ComponentDatatype.getSizeInBytes(dt);
        let verts = pa.typedArray, stride = 3, off = 0;
        if (!verts) {
          if (!pa.buffer) continue;
          const inter = pa.byteStride !== undefined && pa.byteStride !== 3 * bytes;
          stride = inter ? pa.byteStride / bytes : 3; off = inter ? (pa.byteOffset || 0) / bytes : 0;
          verts = C.ComponentDatatype.createTypedArray(dt, pa.count * stride);
          pa.buffer.getBufferData(verts, inter ? 0 : (pa.byteOffset || 0), 0, pa.count * stride);
        }
        const norm = q && pa.normalized && C.AttributeCompression && C.AttributeCompression.dequantize;
        if (norm) { if (stride !== 3) return false; verts = C.AttributeCompression.dequantize(verts, dt, C.AttributeType.VEC3, pa.count); }
        const st = q && !norm ? q.quantizedVolumeStepSize : null, of = q && !norm ? q.quantizedVolumeOffset : null;
        // feature (building) id of each vertex, so triangles of destroyed (hidden) buildings can be skipped
        let fid = null; const fa = prim.attributes.find((a) => a.semantic === "_FEATURE_ID" && (a.setIndex === 0 || a.setIndex === undefined));
        if (fa && (fa.typedArray || fa.buffer)) { fid = fa.typedArray;
          if (!fid) { const fdt = fa.componentDatatype, fb = C.ComponentDatatype.getSizeInBytes(fdt), fst = fa.byteStride && fa.byteStride !== fb ? fa.byteStride / fb : 1;
            const raw = C.ComponentDatatype.createTypedArray(fdt, fa.count * fst); fa.buffer.getBufferData(raw, fst === 1 ? (fa.byteOffset || 0) : 0, 0, fa.count * fst);
            fid = new Float32Array(fa.count); const fo = fst === 1 ? 0 : (fa.byteOffset || 0) / fb; for (let i = 0; i < fa.count; i++) fid[i] = raw[fo + i * fst]; } }
        const W = new Float64Array(pa.count * 3);
        for (let i = 0; i < pa.count; i++) { const k = off + i * stride; v.x = verts[k]; v.y = verts[k + 1]; v.z = verts[k + 2];
          if (st) { v.x = v.x * st.x + of.x; v.y = v.y * st.y + of.y; v.z = v.z * st.z + of.z; }
          C.Matrix4.multiplyByPoint(M, v, v); W[i * 3] = v.x; W[i * 3 + 1] = v.y; W[i * 3 + 2] = v.z; }
        for (let i = 0; i + 2 < idx.length; i += 3) { for (const j of [idx[i], idx[i + 1], idx[i + 2]]) P.push(W[j * 3], W[j * 3 + 1], W[j * 3 + 2]); F.push(fid ? Math.round(fid[idx[i]]) : -1); }
      }
    }
    const nT = P.length / 9; if (!nT) return false;
    // relative to the first vertex (precision), axis-aligned box and cells of about 6 m (at most 48 per axis)
    const o = [P[0], P[1], P[2]], T = new Float32Array(P.length); const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < P.length; i++) { const a = i % 3; T[i] = P[i] - o[a]; if (T[i] < mn[a]) mn[a] = T[i]; if (T[i] > mx[a]) mx[a] = T[i]; }
    const n = [0, 1, 2].map((a) => Math.max(1, Math.min(48, Math.ceil((mx[a] - mn[a]) / 6)))), cs = [0, 1, 2].map((a) => Math.max(1e-3, (mx[a] - mn[a]) / n[a]));
    const cells = new Map();
    for (let t = 0; t < nT; t++) { const b = t * 9; const lo = [0, 1, 2].map((a) => Math.min(T[b + a], T[b + 3 + a], T[b + 6 + a])), hi = [0, 1, 2].map((a) => Math.max(T[b + a], T[b + 3 + a], T[b + 6 + a]));
      const c0 = [0, 1, 2].map((a) => Math.max(0, Math.min(n[a] - 1, Math.floor((lo[a] - mn[a]) / cs[a])))), c1 = [0, 1, 2].map((a) => Math.max(0, Math.min(n[a] - 1, Math.floor((hi[a] - mn[a]) / cs[a]))));
      for (let x = c0[0]; x <= c1[0]; x++) for (let y = c0[1]; y <= c1[1]; y++) for (let z = c0[2]; z <= c1[2]; z++) { const key = (x * n[1] + y) * n[2] + z; let l = cells.get(key); if (!l) cells.set(key, (l = [])); l.push(t); } }
    return { o, T, F: Int32Array.from(F), mn, mx, n, cs, cells, content };
  }
  // closest hit distance along a (unit) ray within maxDist, two-sided triangles; undefined if none
  function gridRay(g, ray, maxDist) {
    const O = [ray.origin.x - g.o[0], ray.origin.y - g.o[1], ray.origin.z - g.o[2]], D = [ray.direction.x, ray.direction.y, ray.direction.z];
    let t0 = 0, t1 = maxDist;
    for (let a = 0; a < 3; a++) { if (Math.abs(D[a]) < 1e-12) { if (O[a] < g.mn[a] || O[a] > g.mx[a]) return undefined; continue; }
      let ta = (g.mn[a] - O[a]) / D[a], tb = (g.mx[a] - O[a]) / D[a]; if (ta > tb) { const x = ta; ta = tb; tb = x; } t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) return undefined; }
    const cell = [0, 1, 2].map((a) => Math.max(0, Math.min(g.n[a] - 1, Math.floor((O[a] + D[a] * t0 - g.mn[a]) / g.cs[a]))));
    const step = D.map((d) => (d > 0 ? 1 : d < 0 ? -1 : 0));
    const tMax = [0, 1, 2].map((a) => (step[a] === 0 ? Infinity : (g.mn[a] + (cell[a] + (step[a] > 0 ? 1 : 0)) * g.cs[a] - O[a]) / D[a]));
    const tDelta = [0, 1, 2].map((a) => (step[a] === 0 ? Infinity : g.cs[a] / Math.abs(D[a])));
    let best = Infinity; const T = g.T;
    for (let guard = 0; guard < 400; guard++) {
      const l = g.cells.get((cell[0] * g.n[1] + cell[1]) * g.n[2] + cell[2]);
      if (l) for (const t of l) { const b = t * 9;   // Moller-Trumbore, two-sided
        const fi = g.F[t]; if (fi >= 0 && g.hidden && g.hidden.has(fi)) continue;   // a destroyed building
        const e1x = T[b + 3] - T[b], e1y = T[b + 4] - T[b + 1], e1z = T[b + 5] - T[b + 2], e2x = T[b + 6] - T[b], e2y = T[b + 7] - T[b + 1], e2z = T[b + 8] - T[b + 2];
        const px = D[1] * e2z - D[2] * e2y, py = D[2] * e2x - D[0] * e2z, pz = D[0] * e2y - D[1] * e2x, det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-12) continue; const inv = 1 / det;
        const sx = O[0] - T[b], sy = O[1] - T[b + 1], sz = O[2] - T[b + 2], u = (sx * px + sy * py + sz * pz) * inv; if (u < 0 || u > 1) continue;
        const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x, w = (D[0] * qx + D[1] * qy + D[2] * qz) * inv; if (w < 0 || u + w > 1) continue;
        const tt = (e2x * qx + e2y * qy + e2z * qz) * inv; if (tt >= 0 && tt <= maxDist && tt < best) best = tt; }
      const a = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : (tMax[1] < tMax[2] ? 1 : 2);
      if (best <= tMax[a]) break;                  // nothing in later cells can be closer
      if (tMax[a] > t1) break;
      cell[a] += step[a]; if (cell[a] < 0 || cell[a] >= g.n[a]) break; tMax[a] += tDelta[a];
    }
    return best < Infinity ? best : undefined;
  }
  function tileRayHit(content, ray, maxDist) {
    let g = triGrids.get(content);
    if (g === undefined && gridBuildsThisFrame < 1) { gridBuildsThisFrame++; try { g = buildTriGrid(content); } catch (e) { g = false; } if (g !== null) triGrids.set(content, g); }
    if (g) { g.hidden = typeof hiddenFeatures !== "undefined" && content.url !== undefined ? hiddenFeatures.get(content.url) : null; const d = gridRay(g, ray, maxDist); return d === undefined ? null : d; }
    const q = content.pick(ray, scene.frameState, scratchCpuHit);   // not indexed (yet): Cesium's own pick
    return q ? C.Cartesian3.distance(ray.origin, q) : null;
  }
  // CPU picks only see the tiles drawn now. Before trusting one, the tile tree is walked along the ray: every tile on it
  // must be drawn or have a drawn ancestor, else the answer is "unknown" (thrown; callers fall back to the GPU pick).
  const UNKNOWN = new Error("not known on the CPU"), selSets = new WeakMap(), scratchIv2 = new C.Interval();
  function drawnSet(ts) { const fn = scene.frameState.frameNumber; let e = selSets.get(ts); if (!e || e.fn !== fn) { e = { fn, set: new Set(ts._selectedTiles) }; selSets.set(ts, e); } return e.set; }
  // does the ray (within maxDist) pass through a tile's bounding volume? Its oriented box when it has one (tight),
  // else its bounding sphere
  const scratchAx = new C.Cartesian3(), scratchRel = new C.Cartesian3();
  function rayHitsVolume(ray, bv, maxDist) {
    const obb = bv && (bv._orientedBoundingBox || bv.orientedBoundingBox);
    if (!obb) { const iv = C.IntersectionTests.raySphere(ray, bv.boundingSphere, scratchIv2); return !!iv && iv.stop >= 0 && iv.start <= maxDist; }
    C.Cartesian3.subtract(ray.origin, obb.center, scratchRel); let t0 = 0, t1 = maxDist;
    for (let i = 0; i < 3; i++) {
      C.Matrix3.getColumn(obb.halfAxes, i, scratchAx); const e = C.Cartesian3.magnitude(scratchAx); if (e < 1e-9) continue;
      const o = C.Cartesian3.dot(scratchRel, scratchAx) / e, d = C.Cartesian3.dot(ray.direction, scratchAx) / e;
      if (Math.abs(d) < 1e-12) { if (Math.abs(o) > e) return false; continue; }
      let ta = (-e - o) / d, tb = (e - o) / d; if (ta > tb) { const x = ta; ta = tb; tb = x; }
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) return false;
    }
    return true;
  }
  function rayCovered(ts, ray, maxDist) {
    const drawn = drawnSet(ts), stack = [ts.root]; let visits = 0;
    while (stack.length) {
      const t = stack.pop(); if (!t || ++visits > 800) return false;
      if (!rayHitsVolume(ray, t.boundingVolume, maxDist)) continue;
      if (drawn.has(t)) continue;
      if (t.children && t.children.length) { for (const k of t.children) stack.push(k); continue; }
      const renderable = t.hasRenderableContent !== undefined ? t.hasRenderableContent : !t.hasEmptyContent && !t.hasTilesetContent;
      // a tile with buildings whose content lies on the ray but is not drawn now
      if (renderable && rayHitsVolume(ray, t.contentBoundingVolume || t.boundingVolume, maxDist)) return false;
    }
    return true;
  }
  function tilesetRay(ts, ray, maxDist) {
    const tiles = ts._selectedTiles; if (!tiles) return null;
    if (!rayCovered(ts, ray, maxDist)) throw UNKNOWN;
    const cand = [];
    for (const t of tiles) { if (!t.content) continue; const iv = C.IntersectionTests.raySphere(ray, t.contentBoundingVolume.boundingSphere, scratchIv);
      if (iv && iv.stop >= 0 && iv.start <= maxDist) cand.push([Math.max(0, iv.start), t]); }
    cand.sort((a, b) => a[0] - b[0]);
    let best = null, bd = maxDist;
    for (const [start, t] of cand) { if (start > bd) break;
      const d = tileRayHit(t.content, ray, bd); if (d === null || d > bd) continue;
      bd = d; best = C.Ray.getPoint(ray, d, new C.Cartesian3()); }
    return best ? { position: best, distance: bd } : null;
  }
  const scratchDown = new C.Cartesian3(), scratchTop = new C.Cartesian3(), scratchVRay = new C.Ray();
  // top surface of the city tiles at a point: a height, undefined (no tile surface there) or null (unknown on the CPU)
  function cpuHeightAt(lon, lat, street) {
    if (!tilesets.length || demoMode) return null;
    const pt = C.Cartesian3.fromDegrees(lon, lat, (street || 0) + 40, undefined, scratchCpuPt);
    const tss = cityTilesetsAt(pt); if (!tss.length) return null;
    if (nearDestroyed(pt, null, DESTROYED_R()) || !inView(pt, 60)) return null;
    // a vertical ray from 700 m above the street (above every roof in the play areas) down to below it
    C.Cartesian3.fromDegrees(lon, lat, (street || 0) + 700, undefined, scratchTop);
    C.Cartesian3.negate(C.Cartesian3.normalize(scratchTop, scratchDown), scratchDown);
    scratchVRay.origin = scratchTop; scratchVRay.direction = scratchDown;
    let h;
    for (const ts of tss) { let r; try { r = tilesetRay(ts, scratchVRay, 760); } catch (e) { return null; }
      if (r) { const hh = 700 + (street || 0) - r.distance; if (h === undefined || hh > h) h = hh; } }
    if (h === undefined && !localWorld) return null;   // Google tiles include the ground: no hit means not known
    return h;
  }
  // first surface (city tiles or ground) along a ray within maxDist: { position, distance }, undefined (nothing) or null
  // (unknown on the CPU). checkView: the far end must be in view too (camera rays start in view and run toward the camera).
  function cpuRay(ray, maxDist, checkView) {
    if (!tilesets.length || demoMode) return null;
    const end = C.Cartesian3.add(ray.origin, C.Cartesian3.multiplyByScalar(ray.direction, maxDist, scratchCpuA), new C.Cartesian3());
    if (!cityTilesetsAt(ray.origin).length) return null;
    if (checkView && (!inView(ray.origin, 1) || !inView(end, 1))) return null;
    if (nearDestroyed(ray.origin, end, DESTROYED_R())) return null;
    let best = null, bd = Infinity;
    for (const ts of tilesets) { if (!ts.show) continue; let r; try { r = tilesetRay(ts, ray, maxDist); } catch (e) { return null; }
      if (r && r.distance < bd) { bd = r.distance; best = r.position; } }
    if (scene.globe && scene.globe.show) { let q; try { q = scene.globe.pick(ray, scene, scratchCpuHit); } catch (e) { q = undefined; }
      if (q) { const d = C.Cartesian3.distance(ray.origin, q); if (d < bd) { bd = d; best = C.Cartesian3.clone(q); } } }
    return best && bd <= maxDist ? { position: best, distance: bd } : undefined;
  }
  const scratchCarto = new C.Cartographic();
  // recent heights on a 0.5 m grid, kept for half a second: hovering, standing or walking slowly costs nothing
  const heightCache = new Map();
  function groundHeightAt(lon, lat, exclude, gpuOk) {
    // height of the rendered surface (roof, street or terrain) below this point, metres above ellipsoid; undefined when
    // it can only be found with a GPU pick and gpuOk is false (callers then keep the last value)
    if (demoMode) return 0;
    const now = performance.now(), key = Math.round(lat * 222390) + ":" + Math.round(lon * 222390 * Math.cos(lat * DEG));
    const hit = heightCache.get(key); if (hit && now - hit.t < 500) return hit.h;
    const h = groundHeightNow(lon, lat, exclude, gpuOk);
    if (h !== undefined) { heightCache.set(key, { h, t: now }); if (heightCache.size > 256) heightCache.delete(heightCache.keys().next().value); }
    return h;
  }
  function groundHeightNow(lon, lat, exclude, gpuOk) {
    const street = localWorld ? localWorld.ground.heightAt(lon, lat) : undefined;
    let h = cpuHeightAt(lon, lat, street);
    if (h === null) {
      if (gpuOk === false || !scene.sampleHeightSupported) return undefined;
      scratchCarto.longitude = lon * DEG; scratchCarto.latitude = lat * DEG; scratchCarto.height = 0;
      try { h = withOwnFxHidden(() => scene.sampleHeight(scratchCarto, exclude, 1.5)); } catch (e) { h = undefined; }
    }
    if (localWorld) {
      // the street level is known from the data, so it is the floor: picking the globe can hit a coarse terrain
      // tile's skirt far below the street before the detailed tile has loaded
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
  function poseDragon(model, yaw, pitch, wing, tailYaw, walk) {
    if (!model || !model.ready) return;
    if (!model.__nodes) { const n = {}; for (const k of ["head", "wingL", "wingR", "tail", "hipL", "kneeL", "ankleL", "hipR", "kneeR", "ankleR"]) { try { n[k] = model.getNode(k); } catch (e) { n[k] = null; } } model.__nodes = n; }
    const N = model.__nodes, J = DRAGON_JOINTS, tilt = walk ? walk.tilt : 0;
    if (N.head) { // yaw about flight-up, then pitch about the lateral axis, on top of the resting head angle
      // (walking: tilted down by as much as the body is raised, so the head still looks ahead)
      C.Quaternion.multiply(axisQ(D_UP, -yaw, scratchQ), axisQ([1, 0, 0], -pitch * 0.8 + J.head.rest + tilt, scratchQ2), scratchQ);
      setJoint(N.head, J.head.p, scratchQ);
    }
    if (N.hipL && N.hipR) {   // legs (rest = identity, as in the model)
      const a = walk ? walk.legs : [0, 0, 0, 0, 0, 0];
      for (const [k, i, sx] of [["L", 0, 1], ["R", 3, -1]]) {
        setJoint(N["hip" + k], [DRAGON_HIP[0] * sx, DRAGON_HIP[1], DRAGON_HIP[2]], axisQ([1, 0, 0], a[i], scratchQ));
        setJoint(N["knee" + k], [(DRAGON_KNEE[0] - DRAGON_HIP[0]) * sx, DRAGON_KNEE[1] - DRAGON_HIP[1], DRAGON_KNEE[2] - DRAGON_HIP[2]], axisQ([1, 0, 0], a[i + 1], scratchQ));
        setJoint(N["ankle" + k], [0, DRAGON_ANKLE[1] - DRAGON_KNEE[1], DRAGON_ANKLE[2] - DRAGON_KNEE[2]], axisQ([1, 0, 0], a[i + 2], scratchQ));
      }
    }
    // left wing is on native +x: a positive turn about the forward axis lifts it; the right wing mirrors
    if (N.wingL) setJoint(N.wingL, J.wingL.p, axisQ(D_FWD, wing, scratchQ));
    if (N.wingR) setJoint(N.wingR, J.wingR.p, axisQ(D_FWD, -wing, scratchQ));
    if (N.tail) { C.Quaternion.multiply(axisQ(D_UP, tailYaw, scratchQ), axisQ([1, 0, 0], J.tail.rest + tilt, scratchQ2), scratchQ); setJoint(N.tail, J.tail.p, scratchQ); }
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
    if (LOW_GFX) crowd.length = 5;   // Low: the front row only (one of each pose)
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
  // Rays from the focus point toward the wanted camera position (character, rider, shots and effects excluded). When a
  // building or the ground is in the way, only the distance along the same line shortens: the view never turns or tilts.
  // Five rays (centre, and four aimed 1.5 m / 0.5 m right, left, above and below the camera spot) give a stable minimum,
  // so thin edges and tile detail changes don't make it jump. The centre ray and one side ray are cast ~14 times a second
  // (~9 on phones) and reused in between, so it stays cheap. The camera eases in within about 0.15 s, stays in until the
  // line has been clear for 0.5 s, then eases out slowly, so grazing an edge doesn't flicker in and out.
  const camCol = { key: "", t: 0, allowed: Infinity, range: null, rays: [Infinity, Infinity, Infinity, Infinity, Infinity], next: 1, clearT: 0 };
  const CAM_RAY_MS = isTouch ? 110 : 70;
  const CAM_SIDE = [null, [1, 0], [-1, 0], [0, 1], [0, -1]];   // [right, up] offsets of the side rays' end points
  const scratchDir = new C.Cartesian3(), scratchDirW = new C.Cartesian3(), scratchRay = new C.Ray(), scratchEnu = new C.Matrix4();
  const scratchSide = new C.Cartesian3(), scratchEnd = new C.Cartesian3();
  function camRay(k, target, heading, pitch, range, spread, exclude, gpuOk, gpuOnly) {
    // ray k toward the camera spot (k > 0: toward a point beside it); returns the hit distance along the centre line
    const sh = Math.sin(heading), chd = Math.cos(heading), sp = Math.sin(pitch), cp = Math.cos(pitch);
    C.Cartesian3.fromElements(-sh * cp, -chd * cp, -sp, scratchDir);                       // target -> camera (east-north-up)
    if (k > 0) {
      const o = CAM_SIDE[k];   // camera right = (cos h, -sin h, 0), camera up = (-sin p sin h, -sin p cos h, cos p)
      C.Cartesian3.fromElements(o[0] * chd - o[1] * sp * sh, -o[0] * sh - o[1] * sp * chd, o[1] * cp, scratchSide);
      C.Cartesian3.multiplyByScalar(scratchDir, range, scratchEnd);
      C.Cartesian3.add(scratchEnd, C.Cartesian3.multiplyByScalar(scratchSide, spread, scratchSide), scratchEnd);
      C.Cartesian3.normalize(scratchEnd, scratchEnd);
    } else C.Cartesian3.clone(scratchDir, scratchEnd);
    const cosToCentre = C.Cartesian3.dot(scratchEnd, scratchDir);
    C.Transforms.eastNorthUpToFixedFrame(target, undefined, scratchEnu);
    C.Matrix4.multiplyByPointAsVector(scratchEnu, scratchEnd, scratchDirW); C.Cartesian3.normalize(scratchDirW, scratchDirW);
    scratchRay.origin = target; scratchRay.direction = scratchDirW;
    const cr = gpuOnly ? null : cpuRay(scratchRay, range + 5, false);
    if (cr !== null) return cr ? cr.distance * cosToCentre : Infinity;
    if (!gpuOk) return NaN;   // keep the last result
    let hit; try { hit = withOwnFxHidden(() => scene.pickFromRay(scratchRay, exclude, 0.5)); } catch (e) { hit = undefined; }
    return hit && hit.position ? C.Cartesian3.distance(target, hit.position) * cosToCentre : Infinity;
  }
  function collideRange(key, target, heading, pitch, range, exclude, margin, minRange, dt) {
    const now = performance.now();
    if (camCol.key !== key) { camCol.key = key; camCol.range = null; camCol.t = 0; camCol.allowed = Infinity; camCol.rays.fill(Infinity); camCol.clearT = 0; }
    // rays on the CPU about 14 times a second (9 on phones); GPU picks only in pick frames (start screen: 4 times a second)
    const lobbyCam = key === "lobby";
    const moved = !camCol.lastTarget || C.Cartesian3.distanceSquared(camCol.lastTarget, target) > 0.25 || Math.abs(camCol.lastH - heading) > 0.01 || Math.abs(camCol.lastP - pitch) > 0.01 || Math.abs(camCol.lastR - range) > 0.5;
    if ((camCol.t === 0 || now - camCol.t > (lobbyCam ? 250 : moved ? CAM_RAY_MS : 500)) && scene.pickPositionSupported !== false) {
      camCol.lastTarget = C.Cartesian3.clone(target, camCol.lastTarget); camCol.lastH = heading; camCol.lastP = pitch; camCol.lastR = range;
      const first = camCol.t === 0; camCol.t = now;
      const spread = minRange < 6 ? 0.5 : 1.5;
      // the first time all five, then the centre plus one side ray in turn
      for (const k of first ? [0, 1, 2, 3, 4] : [0, camCol.next]) { const d = camRay(k, target, heading, pitch, range, spread, exclude, first || pickSlot, lobbyCam); if (!isNaN(d)) camCol.rays[k] = d; }
      camCol.next = camCol.next % 4 + 1;
      let allowed = Infinity;
      for (const d of camCol.rays) if (d < range + margin) allowed = Math.min(allowed, Math.max(minRange, d - margin));
      camCol.allowed = allowed;
    }
    const want = Math.min(range, camCol.allowed);
    if (camCol.range === null) camCol.range = want;
    if (want < camCol.range - 0.01) {          // blocked: ease in quickly (about 0.15 s)
      camCol.range += (want - camCol.range) * (1 - Math.exp(-dt / 0.05)); camCol.clearT = 0;
    } else if (want > camCol.range + 0.05) {   // clear: wait 0.5 s, then ease out slowly
      camCol.clearT += dt;
      if (camCol.clearT > 0.5) camCol.range += (want - camCol.range) * (1 - Math.exp(-dt * 1.2));
    } else { camCol.range = want; camCol.clearT = 0; }
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
  // x, y: CSS pixels from the canvas corner. scene.pick converts to drawing-buffer pixels itself, so they must not be
  // pre-scaled (the drawing buffer is smaller than the page when the resolution scale or automatic resolution is below 100 %).
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
    canvas.style.cursor = pickedCharacter(e.clientX - r.left, e.clientY - r.top) ? "pointer" : "";
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
    const ch = pickedCharacter(e.clientX - r.left, e.clientY - r.top);
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
    fly.walking = false; fly.stumbleT = 0; fly.walkBlend = 0; fly.block = null; fly.gait = 0; fly.gaitRun = 0; fly.walkPhase = 0; fly.bob = 0; fly.dragonLegs = null; fly.headTilt = 0;
  }

  function updateFlight(dt) {
    readInput();
    const diff = settings.difficulty;
    // boost gauge (Hard): drains while boosting, recharges otherwise; Easy/Medium have unlimited boost
    if (fly.stamina === undefined) fly.stamina = 1;
    let boosting = input.boost && !fly.walking;
    if (diff === "hard") {
      if (boosting && fly.stamina > 0) fly.stamina = Math.max(0, fly.stamina - dt * 0.22);
      else { boosting = false; fly.stamina = Math.min(1, fly.stamina + dt * (input.boost ? 0.04 : 0.12)); }
    } else fly.stamina = 1;
    fly.boosting = boosting;
    const boost = boosting ? BOOST : 1;
    const tf = input.fwd >= 0 ? input.fwd * MAX_FWD * boost : input.fwd * MAX_BACK;
    const ts = input.strafe * MAX_STRAFE * (boosting ? 1.6 : 1), tu = input.vert * MAX_VERT * (boosting ? 1.8 : 1);
    const WK = CH().walk;
    if (fly.walking) {
      // on foot: forward/back walks (Shift runs), left/right turns, Q/E sidesteps; up jumps and takes off
      const stumbling = fly.stumbleT > 0;
      if (stumbling) fly.stumbleT = Math.max(0, fly.stumbleT - dt);
      const run = input.boost && !stumbling;
      const wf = stumbling ? 0 : input.fwd >= 0 ? input.fwd * (run ? WK.run : WK.walk) : input.fwd * WK.back;
      const ws = stumbling ? 0 : input.strafe * WK.side;
      const kw = 1 - Math.exp(-dt * (stumbling ? 3 : 5));
      fly.vf += (wf - fly.vf) * kw; fly.vs += (ws - fly.vs) * kw; fly.vu = 0;
      fly.yawRate += ((stumbling ? 0 : input.turn * WK.turn * DEG) - fly.yawRate) * (1 - Math.exp(-dt * 8));
      fly.bankH = 0;
      if (!stumbling && input.vert > 0.3) { fly.walking = false; fly.vu = WK.jump; fly.h += 0.05; fly.grounded = false; }
    } else if (diff === "easy") {
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

    let tp = PROF ? performance.now() : 0;
    // ground under us: in pick frames (about 10-14 times a second; on the CPU when the spot is in view, else a GPU pick),
    // reused in between
    const g = pickSlot || fly.ground === undefined ? groundHeightAt(fly.lon, fly.lat, excl, true) : undefined;
    if (g !== undefined && isFinite(g)) {
      fly.ground = g;
      if (fly.needsAglFix) { fly.h = g + fly.needsAglFix; fly.needsAglFix = 0; }
    }

    // collision with buildings ahead: probe along horizontal velocity
    const hs = Math.hypot(ve, vn);
    if (pickSlot && fly.ground !== undefined) {
      fly.block = null;
      if (hs > 0.5) {
        // on foot: probe just ahead, and anything taller than a step blocks (the dragon steps up less than the Gundam).
        // The probe reaches further than the distance covered until the next pick frame.
        const dist = fly.walking ? WK.probe + hs * 0.3 : 6 + hs * 0.18, wide = fly.walking ? WK.probeSide : 3.5, stepUp = fly.walking ? WK.step : 3.0;
        const ue = ve / hs, un = vn / hs;
        for (const side of [0, -1, 1]) {
          const pe = ue * dist + (-un) * side * wide, pn = un * dist + ue * side * wide;
          const p = offsetLL(fly.lat, fly.lon, pe, pn);
          const ph = groundHeightAt(p.lon, p.lat, excl);
          if (ph !== undefined && ph > fly.h + stepUp) { // a wall taller than a step: blocked
            fly.block = { ue, un };
            if (hs > 25) { fly.impactT = 0.7; }
            // remove forward speed so we don't grind into the wall
            fly.vf *= 0.4; fly.vs *= 0.6;
            break;
          }
        }
      }
    }
    if (fly.block) {   // until the next probe: no motion into the wall that was found
      const into = ve * fly.block.ue + vn * fly.block.un;
      if (into > 0) { ve -= into * fly.block.ue; vn -= into * fly.block.un; }
    }
    if (PROF) tp = PROF.add("flight:ground+walls", tp);
    const np = offsetLL(fly.lat, fly.lon, ve * dt, vn * dt);
    fly.lat = np.lat; fly.lon = np.lon;
    fly.h += fly.vu * dt;
    if (fly.ground !== undefined) {
      if (fly.walking) {
        // feet stay on the surface: step up and down small ledges smoothly; walking off a higher edge drops into flight
        if (fly.ground < fly.h - WK.drop) { fly.walking = false; fly.grounded = false; fly.stumbleT = 0; }
        else { fly.h += (fly.ground - fly.h) * (1 - Math.exp(-dt * 12)); if (Math.abs(fly.ground - fly.h) < 0.02) fly.h = fly.ground; fly.grounded = true; }
      } else if (fly.h <= fly.ground + 0.02) {
        const touchdown = !fly.grounded, impact = Math.hypot(fly.vf, fly.vs, fly.vu);
        fly.h = fly.ground; if (fly.vu < 0) fly.vu = 0; fly.grounded = true;
        // Hard: touching down faster than 15 m/s stumbles (about a second without control), then walks
        if (touchdown && settings.difficulty === "hard" && impact > 15) { fly.walking = true; fly.stumbleT = 1.2; }
        // a slow touchdown (or slowing down on the ground) switches to walking
        else if (Math.hypot(fly.vf, fly.vs) <= WK.enter && input.vert < 0.3) fly.walking = true;
      } else fly.grounded = false;
      if (fly.h > fly.ground + MAX_ALT_AGL) { fly.h = fly.ground + MAX_ALT_AGL; fly.vu = Math.min(fly.vu, 0); }
    }
    fly.walkBlend = (fly.walkBlend || 0) + ((fly.walking ? 1 : 0) - (fly.walkBlend || 0)) * (1 - Math.exp(-dt * 2.5));

    // body attitude: lean into motion, bank into turns (only when airborne)
    const air = fly.grounded ? 0.15 : 1;
    // lean forward with speed, back when climbing and forward when diving
    const targetLean = ((fly.vf / (MAX_FWD * BOOST)) * CH().leanMax - (fly.vu / (MAX_VERT * 1.8)) * 18) * DEG * air;
    const targetBank = settings.difficulty === "hard" ? (fly.bankH || 0) * air + (fly.vs / MAX_STRAFE) * 8 * DEG * air
      : (fly.yawRate / TURN_RATE) * 22 * DEG * air + (fly.vs / MAX_STRAFE) * 12 * DEG * air;
    const k = 1 - Math.exp(-dt * 3);
    const gaitSpeed = Math.hypot(fly.vf, fly.vs);
    if (fly.walking) {   // upright on foot: a slight forward lean when running, a lurch forward while stumbling
      // the dragon also stands up from its flight attitude (body raised, a little less when running)
      const lw = (Math.max(0, fly.vf) / WK.run) * (fly.character === "dragon" ? 10 : 9) + (fly.stumbleT > 0 ? 16 * Math.sin(Math.min(1, fly.stumbleT / 1.2) * Math.PI) : 0)
        - (fly.character === "dragon" ? DRAGON_WALK_RAISE / DEG : 0);
      fly.lean += (lw * DEG - fly.lean) * (1 - Math.exp(-dt * 6)); fly.bank += (0 - fly.bank) * (1 - Math.exp(-dt * 6));
    } else { fly.lean += (targetLean - fly.lean) * k; fly.bank += (targetBank - fly.bank) * k; }
    updateGait(dt, gaitSpeed, WK);
    // head: looks into the turn (up to 30 deg) and a little up/down with climbs and dives
    const kh = 1 - Math.exp(-dt * 5);
    const turn = Math.max(-1, Math.min(1, fly.yawRate / TURN_RATE + 0.35 * fly.vs / MAX_STRAFE));
    fly.headYaw = (fly.headYaw || 0) + (turn * 30 * DEG - (fly.headYaw || 0)) * kh;
    fly.headPitch = (fly.headPitch || 0) + (Math.max(-1, Math.min(1, fly.vu / MAX_VERT)) * 12 * DEG - (fly.headPitch || 0)) * kh;
    if (PROF) tp = PROF.add("flight:physics", tp);
    if (fly.model) {
      const dragon = fly.character === "dragon";
      const waddle = dragon ? Math.sin(fly.walkPhase) * 3 * DEG * fly.gait : 0;
      if (dragon && fly.dragonLegs) {
        // feet on the ground: place the model so the lowest heel or toe touches the surface (blended in with walking)
        const m0 = modelMatrixFor(fly.lat, fly.lon, fly.h, fly.az, -fly.lean, fly.bank + waddle, CH().center);
        const low = dragonLowestSole(m0, fly.dragonLegs);
        fly.bob = (fly.bob || 0) + (-low * (fly.walkBlend || 0) - (fly.bob || 0)) * (1 - Math.exp(-dt * 20));
      }
      fly.model.modelMatrix = modelMatrixFor(fly.lat, fly.lon, fly.h + fly.bob, fly.az, -fly.lean, fly.bank + waddle, CH().center);
      if (dragon) {
        // wings: slow beats when cruising, faster and deeper on boost, nearly folded when landed; on foot they keep
        // their flight pose and do not beat
        const beat = fly.walking ? 0 : fly.grounded ? 0.35 : input.boost ? 2.2 : 0.9 + 0.6 * Math.min(1, Math.abs(fly.vu) / MAX_VERT);
        fly.wingPhase = ((fly.wingPhase || 0) + dt * beat * 2 * Math.PI) % (2 * Math.PI);
        const amp = (fly.walking ? 0 : fly.grounded ? 4 : input.boost ? 34 : 22) * DEG;
        fly.wingAmp = (fly.wingAmp || amp) + (amp - (fly.wingAmp || amp)) * (1 - Math.exp(-dt * 3));
        // the rider sits on the neck holding the horns, so the head turns a little less than the Gundam's
        const fa = dragonFireAnim();
        const raise = Math.max(0, -fly.lean);   // how far the body is raised from its flight attitude
        const fold = fly.grounded && !fly.walking ? 25 * DEG * (1 - (fly.walkBlend || 0)) : 0;
        // walking: the head nods with each step and the tail sways from side to side
        const nod = Math.sin(fly.walkPhase * 2) * 4 * DEG * fly.gait, sway = Math.sin(fly.walkPhase) * 16 * DEG * fly.gait;
        fly.headTilt = Math.min(raise, DRAGON_WALK_HEAD_TILT);
        poseDragon(fly.model, fly.headYaw * 0.7, fly.headPitch * 0.7 + fa[0] + nod, fly.wingAmp * Math.sin(fly.wingPhase) + fold + fa[1], -fly.headYaw * 0.6 + sway,
          { tilt: fly.headTilt, legs: fly.dragonLegs || [0, 0, 0, 0, 0, 0] });
      } else {
        // while aiming, the head looks along the line of fire
        const aiming = fly.fireT !== undefined && fly.fireT < 1.4;
        poseHead(fly.model, aiming ? fly.headYaw * 0.3 : fly.headYaw, aiming ? Math.max(-25 * DEG, Math.min(25 * DEG, (fly.aimPitch || 0) + fly.lean)) : fly.headPitch);
        poseGundamArm(dt);
      }
    }
    if (PROF) tp = PROF.add("flight:pose", tp);
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
    $("hudMode").textContent = (fly.walking ? (fly.stumbleT > 0 ? "STUMBLE" : gaitSpeed > WK.walk * 1.3 ? "RUN" : "WALK") : fly.grounded ? "LANDED" : fly.boosting ? "BOOST" : settings.difficulty === "hard" && fly.vu < -6 ? "SINK" : "HOVER") + " · " + DIFFICULTIES[settings.difficulty].toUpperCase();
    const hard = settings.difficulty === "hard"; $("hudBoostRow").hidden = !hard;
    if (hard) { $("hudBoost").style.width = (fly.stamina * 100).toFixed(0) + "%"; $("hudBoost").classList.toggle("low", fly.stamina < 0.2); }
    $("impact").classList.toggle("on", fly.impactT > 0);
    $("loadingTiles").classList.toggle("on", tilesets.length > 0 && !allTilesLoaded() && fly.ground === undefined);
    drawCompass();
    if (PROF) PROF.add("flight:hud", tp);
  }

  function updateCamera(dt) {
    const cam = CAMS[fly.cam], ch = CH();
    look.pitch = Math.max(-70 * DEG, Math.min(25 * DEG, look.pitch + input.lookY * (settings.invertY ? -1 : 1) * 0.03));
    if (cam.range === 0) {
      // cockpit (Gundam) / rider's eye view (dragon): eye at head height, looking forward
      camera.lookAtTransform(C.Matrix4.IDENTITY);
      const s = Math.sin(fly.az * DEG), c = Math.cos(fly.az * DEG);
      if (fly.character === "dragon" && fly.walking && fly.model) {   // on foot: the rider's eye moves with the raised body
        const k = DRAGON_SCALE, eyeW = toWorld(fly.model.modelMatrix, [(RIDER_EYE[0] + 0.7) * k, 0, RIDER_EYE[1] * k]);
        camera.setView({ destination: eyeW, orientation: { heading: fly.az * DEG + look.yaw, pitch: look.pitch, roll: 0 } });
        return;
      }
      const eye = offsetLL(fly.lat, fly.lon, s * ch.eyeFwd, c * ch.eyeFwd);
      camera.setView({ destination: C.Cartesian3.fromDegrees(eye.lon, eye.lat, fly.h + ch.eye),
        orientation: { heading: fly.az * DEG + look.yaw, pitch: -fly.lean * 0.5 + look.pitch, roll: fly.bank * 0.5 } });
      return;
    }
    // chase / far / side distances suit the character's size
    // the camera looks just above the character, so the crosshair (screen centre) and the line of fire clear its head
    // on foot the chase camera comes lower and closer (blended over about a second, so it never jumps)
    const wb = fly.cam === 0 ? fly.walkBlend || 0 : 0;
    const lift = ch.center + ch.height * (fly.cam === 2 ? 0.11 : 0.62 - 0.2 * wb);
    const target = C.Cartesian3.fromDegrees(fly.lon, fly.lat, fly.h + lift);
    const baseRange = fly.cam === 0 ? ch.cams[0] * (1 - 0.25 * wb) : fly.cam === 1 ? ch.cams[1] : ch.cams[2];
    let range = baseRange * look.zoom;
    let pitch = (cam.pitch + 4 * wb) * DEG + look.pitch;
    const small = fly.character === "dragon", minRange = small ? 3.5 : 12, floor = small ? 0.8 : 2;
    // keep the camera above the street or roof below the character: when looking up (camera below the focus point), the
    // camera comes closer along the same line instead of tilting the view; tilt only if even the closest distance is too low
    if (fly.ground !== undefined && pitch > 0) {
      const room = fly.h + lift - fly.ground - floor;   // metres the camera may sit below the focus point
      const maxR = room / Math.sin(pitch);
      if (maxR < range) { range = Math.max(minRange, maxR); if (maxR < minRange) pitch = Math.asin(Math.max(0, Math.min(1, room / minRange))); }
    }
    const heading = fly.az * DEG + (cam.yaw || 0) * DEG + look.yaw;
    range = collideRange("fly" + fly.cam + fly.character, target, heading, pitch, range, [fly.model, fly.rider, fly.pendingModel].filter(Boolean),
      small ? 0.8 : 2.0, minRange, dt || 0.016);
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
  const MAX_SHOTS = LOW_GFX ? 3 : 6, MAX_FX = LOW_GFX ? 7 : 12, MAX_CLIPS = LOW_GFX ? 6 : 12, FX_SCALE = LOW_GFX ? 0.5 : 1;   // fewer projectiles/particles on Low
  const ARM_PIVOT = [-6.4, 38.6, -0.9], MUZZLE = [0.01, -36.79, 1.38];             // gundam_rx78_18m*.glb: armR node (model units)
  const BODY_T = [-0.23696897, 0, 0], BODY_S = 0.3889163389802798;                   // body node transform (rotation +90 deg about Y)
  const DRAGON_MOUTH = [12.23, 8.22, 0.22];                                         // dragon.glb flight frame (dragon units)
  const shots = [], effects = [], shotLog = [];   // shotLog: how recent shots ended (for tests)
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
  function dragonMouthWorld() {
    const s = DRAGON_SCALE, m = DRAGON_MOUTH;
    if (!fly.headTilt) return toWorld(fly.model.modelMatrix, [m[0] * s, -m[2] * s, m[1] * s]);
    // walking: the head is tilted down about its joint; flight frame -> native, turn about the head joint, -> model space
    const R = DRAGON_ROOT, d = [m[0] - R[12], m[1] - R[13], m[2] - R[14]];
    const n = [R[0] * d[0] + R[1] * d[1] + R[2] * d[2], R[4] * d[0] + R[5] * d[1] + R[6] * d[2], R[8] * d[0] + R[9] * d[1] + R[10] * d[2]];
    return toWorld(fly.model.modelMatrix, dragonNativeToModel(rotXAbout(n, DRAGON_JOINTS.head.p, fly.headTilt)));
  }
  // at most MAX_FX particle systems at once (flashes do not count); the oldest goes first
  function addEffect(sys, life, isDust) {
    scene.primitives.add(sys); effects.push({ sys, t: 0, life, dust: !!isDust });
    let n = effects.filter((e) => e.sys && !e.dust).length;   // dust puffs have their own small cap (see dust)
    for (let i = 0; i < effects.length && n > MAX_FX; i++) if (effects[i].sys && !effects[i].dust) { scene.primitives.remove(effects[i].sys); effects.splice(i, 1); i--; n--; }
  }
  function burst(pos, o) {
    const gravity = o.gravity || 0, sc = new C.Cartesian3();
    addEffect(new C.ParticleSystem({
      image: sprite(o.inner, o.outer), modelMatrix: C.Transforms.eastNorthUpToFixedFrame(pos), emitter: new C.SphereEmitter(o.radius || 2),
      startColor: C.Color.fromCssColorString(o.c0), endColor: C.Color.fromCssColorString(o.c1), startScale: o.s0 || 1, endScale: o.s1 || 3,
      minimumParticleLife: o.life * 0.6, maximumParticleLife: o.life, minimumSpeed: o.v0, maximumSpeed: o.v1, imageSize: new C.Cartesian2(o.px, o.px),
      emissionRate: 0, bursts: [new C.ParticleBurst({ time: 0, minimum: Math.round(o.n * FX_SCALE), maximum: Math.round(o.n * FX_SCALE) })], lifetime: 60, loop: false, sizeInMeters: true,   // one burst; removed by updateEffects
      updateCallback: gravity ? (p, dt) => { C.Cartesian3.normalize(p.position, sc); C.Cartesian3.multiplyByScalar(sc, -gravity * dt, sc); C.Cartesian3.add(p.velocity, sc, p.velocity); } : undefined
    }), o.life + 0.3, o.dust);
  }
  function flash(pos, color, size, life) { const pt = glowPoints.add({ position: pos, color: C.Color.fromCssColorString(color), pixelSize: size, outlineWidth: 0, disableDepthTestDistance: 0 });
    effects.push({ point: pt, t: 0, life, size }); }
  function explode(pos, big) {
    const k = big ? 1.6 : 1;
    burst(pos, { inner: "rgba(255,255,230,1)", outer: "rgba(255,150,30,1)", c0: "rgba(255,215,130,1)", c1: "rgba(200,60,0,0)", n: 50 * k, v0: 6, v1: 22 * k, life: 1.3, px: 7 * k, s0: 1, s1: 3.5, radius: 2 * k });
    burst(pos, { inner: "rgba(120,120,120,0.9)", outer: "rgba(70,70,70,0.6)", c0: "rgba(110,105,100,0.8)", c1: "rgba(60,60,60,0)", n: 26 * k, v0: 3, v1: 9, life: 2.6, px: 10 * k, s0: 1, s1: 4, radius: 3 * k });
    burst(pos, { inner: "rgba(60,55,50,1)", outer: "rgba(40,35,30,1)", c0: "#4a443d", c1: "rgba(40,35,30,0)", n: 30 * k, v0: 10, v1: 30, life: 2.2, px: 1.2, s0: 1, s1: 1, radius: 1, gravity: 9.8 });
    flash(pos, "rgba(255,240,200,0.95)", 90 * k, 0.18);
    if (settings.camShake) { const d = C.Cartesian3.distance(camera.positionWC, pos); shake = Math.max(shake, Math.min(big ? 0.8 : 0.6, (big ? 60 : 30) / Math.max(30, d))); }   // only with "Camera shake" on (off by default): the view stays still on impacts
  }
  function collapse(pos) { // dust cloud and falling debris where a building came down
    burst(pos, { inner: "rgba(200,190,170,0.9)", outer: "rgba(150,140,125,0.6)", c0: "rgba(190,180,160,0.85)", c1: "rgba(150,140,125,0)", n: 60, v0: 2, v1: 8, life: 4.5, px: 18, s0: 1, s1: 5, radius: 15 });
    burst(pos, { inner: "rgba(90,85,80,1)", outer: "rgba(70,65,60,1)", c0: "#5a544c", c1: "rgba(60,55,50,0)", n: 50, v0: 3, v1: 14, life: 3.0, px: 1.8, s0: 1, s1: 1, radius: 10, gravity: 9.8 });
  }
  function destroyAt(hit) {
    const obj = hit.object, pos = hit.position;
    // PLATEAU buildings are skipped by feature id in the CPU queries; elsewhere (Google holes, OSM) queries near the spot
    // use the GPU pick, which sees what is actually drawn
    if (!(obj instanceof C.Cesium3DTileFeature)) { destroyedSpots.push(C.Cartesian3.clone(pos)); if (destroyedSpots.length > 200) destroyedSpots.shift(); }
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
    hiddenOsm.clear(); clipCount = 0; destroyedSpots.length = 0;
  }
  function requestFire() {
    if (state.mode !== "fly" || !fly.model || fireCooldown > 0) return;
    const W = WEAPONS[fly.character || "gundam"]; fireCooldown = W.cooldown;
    // aim: through the crosshair (screen centre)
    const cv = scene.canvas, ray = camera.getPickRay(new C.Cartesian2(cv.clientWidth / 2, cv.clientHeight / 2));
    // first real hit along the ray, with our own shots, smoke and flashes hidden for the pick (one pick)
    let hit = cpuRay(ray, W.range + 200, true);
    if (hit === null) { try { hit = withOwnFxHidden(() => scene.pickFromRay(ray, [fly.model, fly.pendingModel, fly.rider].filter(Boolean), 1.0)); } catch (e) { hit = undefined; } }
    else if (hit) hit = { position: hit.position, cpu: true };
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
    if (shots.length >= MAX_SHOTS) {   // too many in the air: the oldest bursts where it is
      const o = shots.shift(); removeShot(o); explode(o.pos, false);
      shotLog.push({ kind: "air", dragon: o.dragon, from: o.from, dir: C.Cartesian3.clone(o.dir), travelled: o.travelled });
    }
    // with no target picked at firing time the shot flies its full range and bursts in the air (never just vanishes)
    const s = { dragon, from: C.Cartesian3.clone(from), pos: C.Cartesian3.clone(from), dir, speed: W.speed, travelled: 0, dist: fly.fireHit ? dist : Math.max(dist, W.range), hit: fly.fireHit };
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
    }
    shots.push(s);
  }
  function identifyHit(pos, dir) {
    const from = C.Cartesian3.subtract(pos, C.Cartesian3.multiplyByScalar(dir, 4, new C.Cartesian3()), new C.Cartesian3());
    let h; try { h = withOwnFxHidden(() => scene.pickFromRay(new C.Ray(from, dir), [fly.model, fly.pendingModel, fly.rider].filter(Boolean), 0.5)); } catch (e) { h = undefined; }
    return h && h.position && C.Cartesian3.distance(h.position, pos) < 8 ? h : null;
  }
  function removeShot(s) { if (s.line) beamLines.remove(s.line); if (s.point) glowPoints.remove(s.point); if (s.trail) scene.primitives.remove(s.trail); }
  function updateWeapons(dt) {
    fireCooldown = Math.max(0, fireCooldown - dt);
    if (fly.fireT !== undefined) { fly.fireT += dt; if (fly.character === "dragon" && !fly.fireDone && fly.fireT >= 0.24) launch(); }
    for (let i = shots.length - 1; i >= 0; i--) {
      const s = shots[i]; const step = Math.min(s.speed * dt, s.dist - s.travelled);
      // impact check along the shot's own path (never skipped): the aim ray at firing time can miss what the projectile
      // actually crosses (the fireball leaves the mouth, not the camera; tiles may load after firing). A shot flies
      // straight, so one ray from where it is finds the first surface on all of its remaining path; it is cast in each
      // pick frame (and on the shot's first frame), and between them the shot flies toward that hit.
      const ray = new C.Ray(s.pos, s.dir);
      const cr = cpuRay(ray, Math.max(1, s.dist - s.travelled) + 1, true);
      if (cr !== null) { s.aheadAt = cr ? s.travelled + cr.distance : Infinity; s.aheadHit = cr ? { position: cr.position, cpu: true } : null; }
      else if (s.aheadAt === undefined || pickSlot) {
        let h; try { h = withOwnFxHidden(() => scene.pickFromRay(ray, [fly.model, fly.pendingModel, fly.rider].filter(Boolean), 0.5)); } catch (e) { h = undefined; }
        s.aheadAt = h && h.position ? s.travelled + C.Cartesian3.distance(s.pos, h.position) : Infinity; s.aheadHit = h;
      }
      let impact = null;
      if (step > 0 && s.aheadAt <= s.travelled + step + 0.5) impact = { hit: s.aheadHit, d: Math.max(0, s.aheadAt - s.travelled), kind: "segment" };
      s.travelled += impact ? impact.d : step;
      C.Cartesian3.add(s.pos, C.Cartesian3.multiplyByScalar(s.dir, impact ? impact.d : step, new C.Cartesian3()), s.pos);
      if (!impact && localWorld) {   // below the street surface: hit the ground
        const c = C.Cartographic.fromCartesian(s.pos); const gh = c && localWorld.ground.heightAt(c.longitude / DEG, c.latitude / DEG);
        if (c && c.height <= gh + 0.2) impact = { hit: null, kind: "ground" };
      }
      if (s.line) { const tail = C.Cartesian3.subtract(s.pos, C.Cartesian3.multiplyByScalar(s.dir, Math.min(70, s.travelled), new C.Cartesian3()), new C.Cartesian3()); s.line.positions = [tail, C.Cartesian3.clone(s.pos)]; }
      if (s.point) s.point.position = s.pos;
      if (s.trail) s.trail.modelMatrix = C.Transforms.eastNorthUpToFixedFrame(s.pos);
      if (impact || s.travelled >= s.dist - 1e-3) {
        removeShot(s); shots.splice(i, 1);
        let hit = impact ? impact.hit : s.hit; const kind = impact ? impact.kind : s.hit ? "aimed" : "air";
        explode(s.pos, s.dragon && kind !== "air");
        if (hit && hit.cpu) hit = identifyHit(s.pos, s.dir);   // found on the CPU: one GPU pick to know which building it is
        if (hit) destroyAt(hit);
        shotLog.push({ kind, dragon: s.dragon, from: s.from, dir: C.Cartesian3.clone(s.dir), travelled: s.travelled }); if (shotLog.length > 200) shotLog.shift();
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
    if (shake <= 0.001 || !settings.camShake) { shake = 0; return; }
    // a small jitter in yaw and pitch only (no roll): at most about 0.3 deg, fading in about half a second
    const a = shake * 0.0105; camera.lookRight((Math.random() - 0.5) * a); camera.lookUp((Math.random() - 0.5) * a);
    shake *= Math.exp(-dt * 10);
  }
  // ---- walking gait ------------------------------------------------------------------
  // Gundam legs (gundam_rx78_18m*.glb, split by tools/build_gundam_legs.js): thigh -> shin -> foot under the body node,
  // pivots at hip / knee / ankle (body-node units, +y up, +z forward, +x = its left); a negative turn about x swings forward.
  const LEG_T = 7.6, LEG_S = 13.3, LEG_F = 4.6, LEG_REST = LEG_T + LEG_S + LEG_F;   // hip-knee, knee-ankle, ankle-sole (units)
  const LEG_NODES = { thighL: [3.2, 25.5, 0], shinL: [0, -7.6, -0.1], footL: [0, -13.3, 0.1], thighR: [-3.2, 25.5, 0], shinR: [0, -7.6, -0.1], footR: [0, -13.3, 0.1], armL: [6.4, 38.6, -0.9] };
  // lowest point of the dragon's feet (heel/toe), metres above the character's position, for a candidate model matrix
  const rotXAbout = (p, c, a) => { const y = p[1] - c[1], z = p[2] - c[2], cs = Math.cos(a), sn = Math.sin(a); return [p[0], c[1] + y * cs - z * sn, c[2] + y * sn + z * cs]; };
  function dragonNativeToModel(n) {   // native (dragon units) -> model space (Cesium axes: x forward, y left, z up; metres)
    const M = DRAGON_ROOT, k = DRAGON_SCALE;
    const g0 = M[0] * n[0] + M[4] * n[1] + M[8] * n[2] + M[12], g1 = M[1] * n[0] + M[5] * n[1] + M[9] * n[2] + M[13], g2 = M[2] * n[0] + M[6] * n[1] + M[10] * n[2] + M[14];
    return [g0 * k, -g2 * k, g1 * k];
  }
  const scratchBase = new C.Cartesian3(), scratchUp = new C.Cartesian3();
  function dragonLowestSole(m, a) {
    C.Cartesian3.fromDegrees(fly.lon, fly.lat, fly.h, undefined, scratchBase); C.Cartesian3.normalize(scratchBase, scratchUp);
    let low = Infinity;
    for (const [sx, i] of [[1, 0], [-1, 3]]) {
      const H = [DRAGON_HIP[0] * sx, DRAGON_HIP[1], DRAGON_HIP[2]], K = [DRAGON_KNEE[0] * sx, DRAGON_KNEE[1], DRAGON_KNEE[2]], A = [DRAGON_ANKLE[0] * sx, DRAGON_ANKLE[1], DRAGON_ANKLE[2]];
      for (const s0 of DRAGON_SOLE) {
        let q = rotXAbout([s0[0] * sx, s0[1], s0[2]], A, a[i + 2]); q = rotXAbout(q, K, a[i + 1]); q = rotXAbout(q, H, a[i]);   // ankle, knee, hip (outermost last)
        const w = toWorld(m, dragonNativeToModel(q));
        low = Math.min(low, C.Cartesian3.dot(C.Cartesian3.subtract(w, scratchBase, w), scratchUp));
      }
    }
    return low;
  }
  const scratchLegM3 = new C.Matrix3();
  function legNodes(model) {
    if (!model || !model.ready) return null;
    if (model.__legs === undefined) { const n = {}; try { for (const k in LEG_NODES) n[k] = model.getNode(k); } catch (e) { /* older model */ }
      model.__legs = Object.keys(LEG_NODES).every((k) => n[k]) ? n : null; }
    return model.__legs;
  }
  function setLeg(node, name, ang) { const t = LEG_NODES[name]; node.matrix = C.Matrix4.fromRotationTranslation(C.Matrix3.fromRotationX(ang, scratchLegM3), new C.Cartesian3(t[0], t[1], t[2]), node.matrix ? C.Matrix4.clone(node.matrix) : new C.Matrix4()); }
  function updateGait(dt, speed, WK) {
    // gait: 0 standing .. 1 walking, gaitRun 0 walk .. 1 run; the phase advances with the distance covered
    const moving = fly.walking && fly.stumbleT <= 0 ? Math.min(1, speed / (WK.walk * 0.6)) : 0;
    fly.gait = (fly.gait || 0) + (moving - (fly.gait || 0)) * (1 - Math.exp(-dt * 5));
    const runT = Math.max(0, Math.min(1, (speed - WK.walk) / (WK.run - WK.walk)));
    fly.gaitRun = (fly.gaitRun || 0) + (runT - (fly.gaitRun || 0)) * (1 - Math.exp(-dt * 4));
    const dragon = fly.character === "dragon";
    const cycle = dragon ? 1.6 + 1.4 * fly.gaitRun : 8 + 7 * fly.gaitRun;   // metres per full cycle (two steps)
    const prev = fly.walkPhase || 0;
    if (fly.walking) fly.walkPhase = (prev + (Math.max(speed, fly.gait > 0.05 ? WK.walk * 0.3 : 0) * dt / cycle) * 2 * Math.PI) % (2 * Math.PI);
    const ph = fly.walkPhase || 0, g = fly.gait, r = fly.gaitRun;
    // footfalls (heel strike when a leg is furthest forward): dust puff, and a tiny nudge with "Camera shake" on
    const crossed = (a) => fly.walking && g > 0.4 && (prev <= ph ? prev < a && a <= ph : a > prev || a <= ph);
    if (crossed(Math.PI / 2)) footfall(1, r);
    if (crossed(3 * Math.PI / 2)) footfall(-1, r);
    let bob = 0;
    if (dragon) {
      // legs: the hips first bring the legs under the (forward-leaning) body, then the walk cycle; the feet stay level.
      // The body height (feet on the ground) is set where the model is placed (see dragonLowestSole).
      const lean = Math.max(0, D_PITCH + fly.lean);   // how far the native (standing) frame leans forward now
      const A = (24 + 14 * r) * DEG * g, K = (40 + 30 * r) * DEG * g;
      let st = 0; if (fly.stumbleT > 0) st = Math.sin(Math.min(1, (1.2 - fly.stumbleT) / 0.5) * Math.PI / 2) * Math.min(1, fly.stumbleT / 0.5);
      const wb = fly.walkBlend || 0;
      const leg = (p) => { const swing = -A * Math.sin(p) - 30 * DEG * st, knee = 4 * DEG * g + K * Math.pow(Math.max(0, Math.cos(p)), 1.5) + 60 * DEG * st;
        return [-lean * wb + swing, knee, -(swing + knee) * 0.85]; };
      fly.dragonLegs = leg(ph).concat(leg(ph + Math.PI));
      fly.armSwing = 0;
      fly.bob = fly.bob || 0;   // set where the model is placed
      return;
    } else {
      const legs = legNodes(fly.model);
      // swing angles (radians). Left hip = -A sin(ph) (forward when sin > 0); the right leg is half a cycle later.
      const A = (22 + 16 * r) * DEG * g, K = (35 + 40 * r) * DEG * g;
      let st = 0; if (fly.stumbleT > 0) st = Math.sin(Math.min(1, (1.2 - fly.stumbleT) / 0.5) * Math.PI / 2) * Math.min(1, fly.stumbleT / 0.5);   // stumble: knees give way, then recover
      const leg = (p) => { const hip = -A * Math.sin(p) - 32 * DEG * st, knee = 4 * DEG * g + K * Math.pow(Math.max(0, Math.cos(p)), 1.5) + 64 * DEG * st;
        return { hip, knee, foot: -(hip + knee) * 0.85 }; };
      const L = leg(ph), R = leg(ph + Math.PI);
      if (legs) {
        setLeg(legs.thighL, "thighL", L.hip); setLeg(legs.shinL, "shinL", L.knee); setLeg(legs.footL, "footL", L.foot);
        setLeg(legs.thighR, "thighR", R.hip); setLeg(legs.shinR, "shinR", R.knee); setLeg(legs.footR, "footR", R.foot);
        setLeg(legs.armL, "armL", (14 + 18 * r) * DEG * g * Math.sin(ph) + 10 * DEG * st);   // shield arm swings opposite the left leg
      }
      fly.armSwing = -(14 + 18 * r) * DEG * g * Math.sin(ph);   // rifle arm: forward when the left leg is forward
      // the lower foot stays on the ground: drop the body by how much the legs are shortened
      const ext = (q) => LEG_T * Math.cos(q.hip) + LEG_S * Math.cos(q.hip + q.knee) + LEG_F * Math.cos(q.hip + q.knee + q.foot);
      bob = legs ? -(LEG_REST - Math.max(ext(L), ext(R))) * BODY_S : 0;
    }
    fly.bob = (fly.bob || 0) + (bob - (fly.bob || 0)) * (1 - Math.exp(-dt * 20));
  }
  function footfall(side, run) {
    const dragon = fly.character === "dragon", s = Math.sin(fly.az * DEG), c = Math.cos(fly.az * DEG);
    const fwd = dragon ? 0.8 : 3.2 + 2 * run, lat = (dragon ? 0.7 : 1.25) * side;   // side 1 = its left
    const p = offsetLL(fly.lat, fly.lon, s * fwd - c * lat, c * fwd + s * lat);
    dust(C.Cartesian3.fromDegrees(p.lon, p.lat, fly.ground + (dragon ? 0.1 : 0.3)), dragon ? 0.35 : 1);
    if (!dragon && settings.camShake) shake = Math.max(shake, 0.12 + 0.1 * run);
  }
  function dust(pos, k) {
    // a small dust puff; at most a few at once, and never in place of an explosion
    if (effects.filter((e) => e.dust).length >= (LOW_GFX ? 3 : 6)) return;
    burst(pos, { inner: "rgba(205,195,175,0.75)", outer: "rgba(160,150,130,0.45)", c0: "rgba(200,190,170,0.6)", c1: "rgba(160,150,130,0)", n: 12 * k + 3, v0: 0.4 * k, v1: 3 * k, life: 1.4, px: 4 * k, s0: 1, s1: 3, radius: 1.5 * k, dust: true });
  }
  // fire animations
  function poseGundamArm(dt) {
    const t = fly.fireT === undefined ? 99 : fly.fireT;
    // raise and aim for 1.4 s after a shot, then lower; arm angle about the shoulder (negative = forward/up), -90 deg = level
    const aim = t < 1.4 ? -(90 * DEG + (fly.aimPitch || 0) + fly.lean * 0.6) : 0;
    const recoil = t < 0.25 ? 10 * DEG * Math.exp(-t * 18) : 0;
    fly.armAngle = (fly.armAngle || 0) + (aim - (fly.armAngle || 0)) * (1 - Math.exp(-dt * (aim ? 14 : 4)));
    // walking: the rifle arm swings opposite the right leg, fading out as the arm comes up to aim
    const swing = (fly.armSwing || 0) * Math.max(0, 1 - Math.abs(fly.armAngle) / (30 * DEG));
    const ang = fly.armAngle + recoil + swing;
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
  // GPU picks (ground height, wall probes, camera collision, shots) read pixels back, so the first pick in a frame makes the
  // CPU wait until the GPU has finished drawing: any frame that picks loses the CPU/GPU overlap (measured on an Intel
  // laptop GPU: 22-47 ms for the first pick of a frame, 3-6 ms for each further one). So all picks happen together in
  // "pick frames", at most every PICK_MS, and the frames in between pick nothing and reuse the last results.
  const PICK_MS = isTouch || LOW_GFX ? 100 : 70;
  let pickSlot = true, lastPickT = 0;
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
  let flyFps = 0;   // smoothed frame rate while flying, shown in the pause menu
  if (FRAME_CAP) viewer.targetFrameRate = FRAME_CAP;
  // ---- in-app profiler (?profile=1) ---------------------------------------------------
  // Times each part of the per-frame update and Cesium's render, counts the GPU picks (each pick reads pixels back, so the
  // first one in a frame waits for the GPU to finish) and shows the averages once a second in a small overlay. Off by default.
  if (PROF) {
    for (const f of ["sampleHeight", "pickFromRay", "drillPickFromRay", "pick", "drillPick"]) { const o = scene[f].bind(scene);
      scene[f] = (...a) => { const t = performance.now(); try { return o(...a); } finally { PROF.add("pick:" + f, t); PROF.picks++; } }; }
    scene.preRender.addEventListener(() => { PROF.tr = performance.now(); });
    scene.postRender.addEventListener(() => { const n = performance.now(); PROF.add("render", PROF.tr); PROF.frames++; if (PROF.picks) PROF.pickFrames++; PROF.picks = 0;
      if (PROF.last) PROF.acc.frame = (PROF.acc.frame || 0) + n - PROF.last; PROF.last = n;
      if (n - PROF.shown > 1000 && PROF.frames) { const f = PROF.frames, a = PROF.acc;
        PROF.report = { fps: +(f * 1000 / (n - PROF.shown)).toFixed(1), pickFrames: +(PROF.pickFrames / f).toFixed(2) };
        for (const k in a) PROF.report[k] = +(a[k] / f).toFixed(2);
        PROF.el.textContent = Object.entries(PROF.report).map(([k, v]) => k + " " + v).join("\n");
        PROF.acc = {}; PROF.frames = 0; PROF.pickFrames = 0; PROF.shown = n; } });
  }
  scene.preUpdate.addEventListener(() => {
    const now = performance.now(); const rawDt = (now - last) / 1000; const dt = Math.min(0.1, rawDt); last = now;
    pickSlot = now - lastPickT >= PICK_MS; if (pickSlot) lastPickT = now;
    gridBuildsThisFrame = 0;
    let t0 = PROF ? performance.now() : 0;
    updateWards(); if (PROF) t0 = PROF.add("wards", t0);
    updateAutoRes(rawDt);
    if (state.mode === "fly" && rawDt > 0 && rawDt < 1) flyFps = flyFps ? flyFps * 0.97 + 0.03 / rawDt : 1 / rawDt;
    if (state.mode === "fly") {
      updateFlight(dt); if (PROF) t0 = PROF.add("flight", t0);
      updateWeapons(dt); if (PROF) t0 = PROF.add("weapons+fx", t0);
      updateCamera(dt); applyShake(dt); if (PROF) t0 = PROF.add("camera", t0);
    }
    else if (state.mode === "lobby" && lobby.active) { readInput(); lobbyCamera(dt); if (PROF) t0 = PROF.add("lobby", t0); }
    else if (state.mode === "pause") readInput();
    if (state.mode !== "fly") { updateEffects(dt); if (PROF) t0 = PROF.add("fx", t0); }
    if (settings.showFps) { fpsAcc += dt; fpsN++; if (fpsAcc > 0.5) { $("hudFps").textContent = " · " + (fpsN / fpsAcc).toFixed(0) + " fps"; fpsAcc = 0; fpsN = 0; } }
  });

  function togglePause() {
    if (state.mode === "fly") { state.mode = "pause"; $("pause").hidden = false; $("touch").hidden = true; viewer.clock.shouldAnimate = false; viewer.targetFrameRate = 10;
      $("perfInfoPause").textContent = "Performance: " + (flyFps ? flyFps.toFixed(0) + " FPS while flying" : "measuring…") + " · resolution " + Math.round(viewer.resolutionScale * 100) + " %" + (settings.autoRes ? " (automatic)" : "") + " · graphics " + settings.quality + (FRAME_CAP ? " (" + FRAME_CAP + " FPS cap)" : ""); }
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
    $("invertY").checked = settings.invertY; $("showFps").checked = settings.showFps; $("autoRes").checked = settings.autoRes; $("camShake").checked = settings.camShake; $("settingsDlg").showModal();
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
    store.set("invertY", $("invertY").checked); store.set("showFps", $("showFps").checked); store.set("autoRes", $("autoRes").checked); store.set("impactShake", $("camShake").checked);
    setTimeout(() => location.reload(), 50);
  };
  $("helpBtn").onclick = () => $("helpDlg").showModal(); $("pHelpBtn").onclick = () => $("helpDlg").showModal();
  $("creditsBtn").onclick = () => $("creditsDlg").showModal();

  // service worker (installable app on Windows and Android)
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  // expose for debugging / automated tests
  window.GFS = { viewer, fly, lobby, state, input, keys, settings, startFlight, spawns, get demoMode() { return demoMode; }, get worldMode() { return worldMode; }, get destroyed() { let n = 0; for (const s of hiddenFeatures.values()) n += s.size; return n + hiddenOsm.size + clipCount; }, requestFire, rebuildCity, look, camCol, cpuHeightAt, cpuRay, get prof() { return PROF && PROF.report; }, shots, effects, explode, collapse, beamLines, glowPoints, tilesets, wardSlots, shotLog, get localWorld() { return localWorld; } };

  (async () => {
    $("startBtn").disabled = true; $("startBtn").textContent = "Loading…";
    await initWorld();
    try { await buildLobby(); } catch (e) { console.error(e); showFatal("Could not build the start scene: " + ((e && (e.stack || e.message)) || e)); setStatus("Could not build the start scene: " + (e.message || e), true); }
    $("startBtn").disabled = false; $("startBtn").textContent = "Launch";
    window.GFS.ready = true;
    checkFirstLaunchSpeed();
  })();
  // first launch on Medium: if the start screen runs below 20 FPS, choose Low from the next start and offer to switch now
  function checkFirstLaunchSpeed() {
    if (!settings.qualityAuto || LOW_GFX) return;
    let n = -1, t0 = 0; const start = performance.now();   // skip the first 3 s (shader compiles, tile loads)
    const off = scene.postRender.addEventListener(() => {
      const now = performance.now(); if (now - start < 3000) return;
      if (n < 0) { n = 0; t0 = now; return; }
      n++; const t = now - t0; if (t < 6000) return;
      off(); const fps = n / (t / 1000);
      window.GFS.firstLaunchFps = fps;
      if (fps >= 20 || state.mode !== "lobby") return;
      store.set("quality", "low");
      setStatus("This device runs Medium graphics at " + fps.toFixed(0) + " FPS, so Low is chosen from the next start (change it in Settings). ", true);
      const b = document.createElement("button"); b.textContent = "Switch now"; b.onclick = () => location.reload(); $("status").appendChild(b);
    });
  }
})();
