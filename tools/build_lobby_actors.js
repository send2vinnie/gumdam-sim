// Build the start-screen actors:
//   models/dragon_stand.glb  - the dragon standing upright (no rider), joints: body, wingL, wingR (wings flap on each jump)
//   models/trainer_stand.glb - the trainer standing, arms down, joints: body, armR (pointing gesture)
// Both: glTF Y up, facing +X, origin between the feet, native units (the app scales: dragon to DRAGON_HEIGHT_M, trainer to 1.75 m).
// usage: node tools/build_lobby_actors.js <dragon folder> <trainer folder> <out folder>
const fs = require("fs"), path = require("path");
const L = require("./dragonlib");
const [dDir, rDir, outDir] = process.argv.slice(2);
const DEG = Math.PI / 180, ss = L.ss;
const sub = (a, b) => a.map((x, i) => x - b[i]), dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0), len = (a) => Math.hypot(...a), nrm = (a) => a.map((x) => x / len(a));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function rot(p, c, ax, a) { const v = sub(p, c); const cs = Math.cos(a), sn = Math.sin(a), d = dot(ax, v); const cr = cross(ax, v); return [0, 1, 2].map((i) => c[i] + v[i] * cs + cr[i] * sn + ax[i] * d * (1 - cs)); }
const lerp = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);

function writeGlb(file, { prims, materials, textures, samplers, imageFiles, joints, extensionsUsed, copyright }) {
  const NC = L.NC, CS = L.CS; const chunks = []; let off = 0; const bufferViews = [], accessors = [];
  const pad = () => { const p = (4 - (off % 4)) % 4; if (p) { chunks.push(Buffer.alloc(p)); off += p; } };
  const addAcc = (rows, type, ct, target, minmax) => { pad(); const n = NC[type], cs = CS[ct]; const b = Buffer.alloc(rows.length * n * cs);
    rows.forEach((r, i) => (n === 1 ? [r] : r).forEach((v, k) => { const o = (i * n + k) * cs; if (ct === 5126) b.writeFloatLE(v, o); else if (cs === 4) b.writeUInt32LE(v, o); else if (cs === 2) b.writeUInt16LE(v, o); else b.writeUInt8(v, o); }));
    chunks.push(b); bufferViews.push(Object.assign({ buffer: 0, byteOffset: off, byteLength: b.length }, target ? { target } : {})); off += b.length;
    const a = { bufferView: bufferViews.length - 1, componentType: ct, count: rows.length, type }; if (minmax) { a.min = [0, 1, 2].map((k) => Math.min(...rows.map((r) => r[k]))); a.max = [0, 1, 2].map((k) => Math.max(...rows.map((r) => r[k]))); }
    accessors.push(a); return accessors.length - 1; };
  const images = imageFiles.map((f) => { pad(); const d = fs.readFileSync(f); chunks.push(d); bufferViews.push({ buffer: 0, byteOffset: off, byteLength: d.length }); off += d.length; return { bufferView: bufferViews.length - 1, mimeType: /\.png$/i.test(f) ? "image/png" : "image/jpeg" }; });
  const meshPrims = prims.map((q) => { const attrs = { POSITION: addAcc(q.P, "VEC3", 5126, 34962, true), NORMAL: addAcc(q.N, "VEC3", 5126, 34962) };
    if (q.T) attrs.TEXCOORD_0 = addAcc(q.T, "VEC2", 5126, 34962);
    attrs.JOINTS_0 = addAcc(q.W.map((w) => [0, 1, 2, 3].map((k) => Math.min(k, joints.length - 1))), "VEC4", 5121, 34962);
    attrs.WEIGHTS_0 = addAcc(q.W.map((w) => [0, 1, 2, 3].map((k) => (k < joints.length ? w[k] : 0))), "VEC4", 5126, 34962);
    const pr = { attributes: attrs, indices: addAcc(q.I, "SCALAR", q.P.length > 65535 ? 5125 : 5123, 34963) }; if (q.material !== undefined) pr.material = q.material; return pr; });
  pad(); const ib = Buffer.alloc(joints.length * 64); joints.forEach((j, k) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -j.p[0], -j.p[1], -j.p[2], 1].forEach((v, i) => ib.writeFloatLE(v, k * 64 + i * 4)));
  chunks.push(ib); bufferViews.push({ buffer: 0, byteOffset: off, byteLength: ib.length }); off += ib.length; accessors.push({ bufferView: bufferViews.length - 1, componentType: 5126, count: joints.length, type: "MAT4" }); const ibmAcc = accessors.length - 1;
  pad();
  const nodes = [{ name: "root", children: joints.map((_, k) => k + 1) }, ...joints.map((j) => ({ name: j.name, translation: j.p })), { name: "mesh", mesh: 0, skin: 0 }];
  const gl = { asset: { version: "2.0", generator: "gundam-sim build_lobby_actors.js", copyright }, scene: 0, scenes: [{ nodes: [0, nodes.length - 1] }], nodes,
    meshes: [{ primitives: meshPrims }], skins: [{ joints: joints.map((_, k) => k + 1), inverseBindMatrices: ibmAcc, skeleton: 0 }], materials, textures, samplers, images, accessors, bufferViews, buffers: [{ byteLength: off }] };
  if (extensionsUsed && extensionsUsed.length) gl.extensionsUsed = extensionsUsed;
  const bin = Buffer.concat(chunks); let jb = Buffer.from(JSON.stringify(gl), "utf8"); if (jb.length % 4) jb = Buffer.concat([jb, Buffer.alloc(4 - (jb.length % 4), 0x20)]);
  const total = 28 + jb.length + bin.length; const h = Buffer.alloc(12); h.writeUInt32LE(0x46546c67, 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(total, 8);
  const c1 = Buffer.alloc(8); c1.writeUInt32LE(jb.length, 0); c1.writeUInt32LE(0x4e4f534a, 4); const c2 = Buffer.alloc(8); c2.writeUInt32LE(bin.length, 0); c2.writeUInt32LE(0x004e4942, 4);
  fs.writeFileSync(file, Buffer.concat([h, c1, jb, c2, bin])); return total;
}

// ---- standing dragon: native upright (faces -y, z up) -> glTF (X fwd, Y up, Z right); origin between the feet ----
{
  const D = L.loadGltf(dDir); const prims = [];
  const toGl = ([x, y, z]) => [-(y - (-1)), z, -x];               // centre the feet at native y = -1
  const toGlN = ([x, y, z]) => [-y, z, -x];
  D.j.meshes.forEach((m, mi) => m.primitives.forEach((p) => {
    const P = D.read(p.attributes.POSITION), N = D.read(p.attributes.NORMAL), T = p.attributes.TEXCOORD_0 !== undefined ? D.read(p.attributes.TEXCOORD_0) : null;
    const I = p.indices !== undefined ? D.read(p.indices) : P.map((_, i) => i);
    const W = P.map((v) => { const w5 = L.weights(v, mi); const wl = w5[2], wr = w5[3]; return [1 - wl - wr, wl, wr]; });
    prims.push({ P: P.map(toGl), N: N.map(toGlN), T, I, W, material: p.material });
  }));
  const joints = [{ name: "body", p: [0, 0, 0] }, { name: "wingL", p: toGl(L.WING_L) }, { name: "wingR", p: toGl(L.WING_R) }];
  const bytes = writeGlb(path.join(outDir, "dragon_stand.glb"), { prims, materials: D.j.materials, textures: D.j.textures, samplers: D.j.samplers,
    imageFiles: (D.j.images || []).map((im) => path.join(dDir, decodeURIComponent(im.uri))), joints, extensionsUsed: D.j.extensionsUsed,
    copyright: "\"charizard\" by My Crea Pro (https://sketchfab.com/Beany-Boy), CC-BY-4.0; modified (rigged wings)" });
  console.log(`dragon_stand.glb ${(bytes / 1024).toFixed(0)} KB, wing joints at ${joints.slice(1).map((j) => j.p.map((v) => v.toFixed(2)).join(",")).join(" | ")}`);
}
// ---- standing trainer: arms lowered from the T-pose, right arm on its own joint ----
{
  const R = L.loadGltf(rDir); const prims = [];
  const SH_Z = 13.1, SH_Y = 2.15, DOWN = 76 * DEG;
  const pose = (p, n) => { const side = p[1] >= 0 ? 1 : -1; const wa = ss(1.9, 2.9, Math.abs(p[1])) * ss(10.5, 11.5, p[2]);
    if (wa <= 0) return [p, n]; const c = [0, side * SH_Y, SH_Z]; return [lerp(p, rot(p, c, [1, 0, 0], side * DOWN), wa), nrm(lerp(n, rot(n, [0, 0, 0], [1, 0, 0], side * DOWN), wa))]; };
  const toGl = ([x, y, z]) => [x, z, -y], toGlN = toGl;
  R.j.meshes.forEach((m) => m.primitives.forEach((p) => {
    const P = R.read(p.attributes.POSITION), N = R.read(p.attributes.NORMAL), T = p.attributes.TEXCOORD_0 !== undefined ? R.read(p.attributes.TEXCOORD_0) : null;
    const I = p.indices !== undefined ? R.read(p.indices) : P.map((_, i) => i);
    const posed = P.map((v, i) => pose(v, N[i]));
    const W = P.map((v) => { const a = v[1] < 0 ? ss(1.9, 2.9, -v[1]) * ss(10.5, 11.5, v[2]) : 0; return [1 - a, a]; }); // right arm = native -y
    prims.push({ P: posed.map((x) => toGl(x[0])), N: posed.map((x) => toGlN(x[1])), T, I, W, material: p.material });
  }));
  const joints = [{ name: "body", p: [0, 0, 0] }, { name: "armR", p: toGl([0, -SH_Y, SH_Z]) }];
  const bytes = writeGlb(path.join(outDir, "trainer_stand.glb"), { prims, materials: R.j.materials, textures: R.j.textures, samplers: R.j.samplers,
    imageFiles: (R.j.images || []).map((im) => path.join(rDir, decodeURIComponent(im.uri))), joints, extensionsUsed: R.j.extensionsUsed,
    copyright: "\"Wii - Super Smash Bros Brawl - Pokemon Trainer\" by Waffles (https://sketchfab.com/jkimmel694), CC-BY-4.0 as stated by the uploader; modified (standing pose, rigged right arm)" });
  console.log(`trainer_stand.glb ${(bytes / 1024).toFixed(0)} KB, right shoulder joint at ${joints[1].p.map((v) => v.toFixed(2)).join(",")}`);
}
