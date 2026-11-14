// Regression check for character selection on the start screen: clicks (desktop) or taps (Pixel 7 emulation) the dragon
// and the Gundam, uses the Character dropdown, then starts a flight and checks which character flies. Prints "pass".
// usage: node tools/check_character_pick.js <path to playwright> <site url> <low|medium|high> <desktop|mobile>
const { chromium, devices } = require(process.argv[2]);
const [, , , URL, quality, kind] = process.argv;
(async () => {
  const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const ctx = await b.newContext(Object.assign(kind === "mobile" ? { ...devices["Pixel 7"] } : { viewport: { width: 800, height: 500 } }, { serviceWorkers: "block" }));
  await ctx.addInitScript((q) => { localStorage.setItem("gfs.quality", JSON.stringify(q)); localStorage.setItem("gfs.character", '"gundam"'); localStorage.setItem("gfs.lobbyCollapsed", "true"); }, quality);
  const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(URL + "?t=" + Date.now()); await p.waitForFunction(() => window.GFS && GFS.ready, null, { timeout: 180000 });
  await p.waitForTimeout(kind === "mobile" ? 9000 : 7000);   // let automatic resolution settle
  // screen position (CSS px) of a model's centre, from its bounding sphere
  const where = (which) => p.evaluate((w) => { const L = GFS.lobby; const m = w === "gundam" ? L.models[0] : L.dragon;
    const c = Cesium.Matrix4.getTranslation(m.modelMatrix, new Cesium.Cartesian3()); const up = Cesium.Cartesian3.normalize(c, new Cesium.Cartesian3());
    const pos = Cesium.Cartesian3.add(c, Cesium.Cartesian3.multiplyByScalar(up, w === "gundam" ? 12 : 1.5, up), new Cesium.Cartesian3());
    const s = Cesium.SceneTransforms.worldToWindowCoordinates(GFS.viewer.scene, pos); const r = GFS.viewer.scene.canvas.getBoundingClientRect(); return s && { x: s.x + r.left, y: s.y + r.top }; }, which);
  const click = async (pt) => { if (kind === "mobile") await p.touchscreen.tap(pt.x, pt.y); else await p.mouse.click(pt.x, pt.y); await p.waitForTimeout(400); };
  const out = { quality, kind, resolutionScale: await p.evaluate(() => GFS.viewer.resolutionScale) };
  const d = await where("dragon"); await click(d); out.afterDragonClick = await p.evaluate(() => [GFS.settings.character, document.getElementById("characterSelect").value]);
  const g = await where("gundam"); await click(g); out.afterGundamClick = await p.evaluate(() => [GFS.settings.character, document.getElementById("characterSelect").value]);
  await p.evaluate(() => { const s = document.getElementById("characterSelect"); s.value = "dragon"; s.dispatchEvent(new Event("change")); }); out.afterDropdown = await p.evaluate(() => GFS.settings.character);
  await p.evaluate(() => GFS.startFlight(GFS.spawns[0])); await p.waitForTimeout(1500); out.flying = await p.evaluate(() => GFS.fly.character);
  out.pass = out.afterDragonClick[0] === "dragon" && out.afterDragonClick[1] === "dragon" && out.afterGundamClick[0] === "gundam" && out.afterGundamClick[1] === "gundam" && out.afterDropdown === "dragon" && out.flying === "dragon";
  console.log(JSON.stringify(out), "errors:", JSON.stringify(errs)); await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
