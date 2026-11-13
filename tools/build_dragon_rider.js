// Build models/dragon.glb with the rider merged in and skinned to the dragon's joints.
// Dragon: as build_dragon.js (flight attitude, 5 joints: body, head, wingL, wingR, tail).
// Rider (Pokemon Trainer T-pose): leans forward, sits astride the dragon's lower neck with thighs spread and calves hugging it,
// both hands on the horns (2-bone arm IK). Torso and legs are bound to the body joint; the arms blend to the head joint
// toward the hands, so the hands stay on the horns when the head turns. No extra joints.
// Rider size is fixed at 1.75 m for a dragon of DRAGON_HEIGHT_M (default 4.0): k = rider native -> dragon native units.
// usage: node build_dragon_rider.js <dragonDir> <riderDir> <out.glb> [DRAGON_HEIGHT_M]
const fs = require("fs"), path = require("path");
const L = require("./dragonlib");
const [dDir, rDir, out, dhS] = process.argv.slice(2);
const DRAGON_HEIGHT_M = +(dhS || 4.0), DRAGON_NATIVE_H = 18.16, RIDER_NATIVE_H = 17.62, RIDER_M = 1.75;
const k = (RIDER_M / DRAGON_HEIGHT_M * DRAGON_NATIVE_H) / RIDER_NATIVE_H;   // rider native unit -> dragon native unit
const DEG = Math.PI / 180;
// rider pose parameters (rider native: x fwd, y left, z up)
const P = { lean: 38 * DEG, headUp: -22 * DEG, thigh: -62 * DEG, splay: 34 * DEG, knee: 72 * DEG, kneeIn: 14 * DEG,
  seat: [12.9, 6.05, 0], seatLift: 0.25, gripBack: 0.35 }; // seat on the lower neck (flight frame), lift above the neck top
const HIP_Z = 8.4, HIP_Y = 0.95, KNEE_Z = 4.4, SH_Z = 13.1, SH_Y = 2.15, EL_Y = 5.0, PALM_Y = 7.9, NECK_Z = 14.7;
const ss = L.ss;
const add = (a, b) => a.map((x, i) => x + b[i]), sub = (a, b) => a.map((x, i) => x - b[i]), mul = (a, s) => a.map((x) => x * s);
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0), len = (a) => Math.hypot(...a), nrm = (a) => mul(a, 1 / len(a));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function rot(p, c, ax, a) { const v = sub(p, c); const cs = Math.cos(a), sn = Math.sin(a), d = dot(ax, v); const cr = cross(ax, v); return [0, 1, 2].map((i) => c[i] + v[i] * cs + cr[i] * sn + ax[i] * d * (1 - cs)); }
// rotation matrix (3x3 rows) taking unit a onto unit b
function rotFromTo(a, b) { const v = cross(a, b), c = dot(a, b); if (len(v) < 1e-9) return c > 0 ? [[1, 0, 0], [0, 1, 0], [0, 0, 1]] : null;
  const s = len(v), ax = mul(v, 1 / s), t = 1 - c; const [x, y, z] = ax;
  return [[t * x * x + c, t * x * y - s * z, t * x * z + s * y], [t * x * y + s * z, t * y * y + c, t * y * z - s * x], [t * x * z - s * y, t * y * z + s * x, t * z * z + c]]; }
const mv = (M, v) => M.map((r) => dot(r, v));
const lerp = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);

// ---------------- dragon geometry (as build_dragon.js) ----------------
const D = L.loadGltf(dDir);
const prims = [];
D.j.meshes.forEach((m, mi) => m.primitives.forEach((p) => {
  const Pp = D.read(p.attributes.POSITION), N = D.read(p.attributes.NORMAL), T = p.attributes.TEXCOORD_0 !== undefined ? D.read(p.attributes.TEXCOORD_0) : null;
  const I = p.indices !== undefined ? D.read(p.indices) : Pp.map((_, i) => i);
  const W5 = Pp.map((v) => L.weights(v, mi));
  prims.push({ P: Pp, N, T, I, W5, material: p.material, src: "dragon", mi });
}));
const flightOf = (p, w) => L.toGl(L.pitchP(w ? L.deform(p, w) : p));
const allF = prims.flatMap((q) => q.P.map((p, i) => flightOf(p, q.W5[i])));
const torso = L.toGl(L.pitchP([0, -1, 9])); const minY = Math.min(...allF.map((p) => p[1]));
const origin = [torso[0], minY, torso[2]];

// ---------------- rider: pose in its own frame, then place on the neck ----------------
const R = L.loadGltf(rDir);
// flight frame (unshifted) <-> rider native
const seatF = [P.seat[0], P.seat[1] + P.seatLift, P.seat[2]];
let seatZr = 0; // rider native z of the seat (bottom of pelvis after posing), set below
const riderToFlight = (p) => [seatF[0] + k * p[0], seatF[1] + k * (p[2] - seatZr), seatF[2] - k * p[1]];
const flightToRider = (f) => [(f[0] - seatF[0]) / k, -(f[2] - seatF[2]) / k, (f[1] - seatF[1]) / k + seatZr];
// horn grip targets (flight frame, from the dragon mesh): a bit down the horn from the tip, toward the skull
const hornTipF = { L: [14.98, 9.84, -1.39], R: [14.98, 9.84, 1.39] }, hornBaseF = { L: [15.82, 8.12, -0.48], R: [15.82, 8.12, 0.48] };
// torso lean / neck tilt transforms (rider native)
const lean = (p) => rot(p, [0, 0, HIP_Z], [0, 1, 0], P.lean);
// first pass: pose legs + torso to find the seat height (pelvis bottom)
function legPose(p) {
  const side = p[1] >= 0 ? 1 : -1; let q = p;
  const wl = ss(9.3, 7.6, p[2]) * ss(0.05, 0.45, Math.abs(p[1]) + 0.3);
  if (wl <= 0) return p;
  q = lerp(q, rot(q, [0, side * HIP_Y, KNEE_Z], [0, 1, 0], P.knee), ss(5.0, 3.8, p[2]));
  q = lerp(q, rot(q, [0, side * HIP_Y, KNEE_Z], [1, 0, 0], side * P.kneeIn), ss(5.0, 3.8, p[2]));      // calves turn in to hug the neck
  q = lerp(q, rot(q, [0, side * HIP_Y, HIP_Z], [0, 1, 0], P.thigh), wl);
  q = lerp(q, rot(q, [0, side * HIP_Y, HIP_Z], [1, 0, 0], -side * P.splay), wl);
  return q;
}
const RP = [];
R.j.meshes.forEach((m) => m.primitives.forEach((p) => {
  const Pp = R.read(p.attributes.POSITION), N = R.read(p.attributes.NORMAL), T = p.attributes.TEXCOORD_0 !== undefined ? R.read(p.attributes.TEXCOORD_0) : null;
  const I = p.indices !== undefined ? R.read(p.indices) : Pp.map((_, i) => i);
  RP.push({ P0: Pp, N0: N, T, I, material: p.material });
}));
const pelvis = RP.flatMap((q) => q.P0.filter((p) => Math.abs(p[1]) < 1.2 && Math.abs(p[0]) < 1.6 && p[2] > 5 && p[2] < 10).map(legPose));
seatZr = Math.min(...pelvis.map((p) => p[2]));
// arm IK (rider native, after lean): shoulder S, palm target H; elbow out-and-down
const ik = {};
for (const [side, hs] of [[1, "L"], [-1, "R"]]) {
  const S0 = [0, side * SH_Y, SH_Z], E0 = [0, side * EL_Y, SH_Z], H0 = [0, side * PALM_Y, SH_Z];
  const S = lean(S0);
  const tip = flightToRider(hornTipF[hs]), base = flightToRider(hornBaseF[hs]);
  const H = lerp(tip, base, P.gripBack);
  const a = len(sub(E0, S0)), b = len(sub(H0, E0)); const dv = sub(H, S); const d = Math.min(len(dv), a + b - 1e-3);
  const u = nrm(dv); const xC = (a * a - b * b + d * d) / (2 * d), r = Math.sqrt(Math.max(0, a * a - xC * xC));
  const C = add(S, mul(u, xC)); let want = [S[0] - 1, S[1] + side * 3, S[2] - 2]; let v = sub(want, C); v = sub(v, mul(u, dot(v, u)));
  const E = len(v) > 1e-6 ? add(C, mul(nrm(v), r)) : add(S, mul(u, a));
  const Hreach = add(E, mul(nrm(sub(H, E)), b));
  ik[side] = { S0, E0, H0, S, E, H: Hreach, target: H, R1: rotFromTo(nrm(sub(E0, S0)), nrm(sub(E, S))), R2: rotFromTo(nrm(sub(H0, E0)), nrm(sub(Hreach, E))), miss: len(sub(Hreach, H)) };
}
// full rider pose for a T-pose point (and normal)
function poseRider(p, n) {
  const side = p[1] >= 0 ? 1 : -1, ay = Math.abs(p[1]);
  const armW = ss(1.9, 2.9, ay) * ss(10.5, 11.5, p[2]);
  // body: legs, then lean (above the hips), head tilts up to look ahead
  let q = legPose(p), m = n;
  const wLean = ss(8.2, 9.0, p[2]) * (1 - armW);
  const headW = ss(14.4, 15.0, p[2]) * (1 - armW);
  if (headW > 0) { q = lerp(q, rot(q, [0, 0, NECK_Z], [0, 1, 0], P.headUp), headW); m = lerp(m, rot(m, [0, 0, 0], [0, 1, 0], P.headUp), headW); }
  if (wLean > 0) { q = lerp(q, lean(q), wLean); m = lerp(m, rot(m, [0, 0, 0], [0, 1, 0], P.lean), wLean); }
  if (armW > 0) {
    const A = ik[side];
    const up = add(A.S, mv(A.R1, sub(p, A.S0))), fo = add(A.E, mv(A.R2, sub(p, A.E0)));
    const upN = mv(A.R1, n), foN = mv(A.R2, n);
    const t = ss(EL_Y - 0.5, EL_Y + 0.5, ay);
    const armP = lerp(up, fo, t), armN = lerp(upN, foN, t);
    q = lerp(q, armP, armW); m = lerp(m, armN, armW);
  }
  return [q, nrm(m)];
}
// head weight of rider vertices: arms blend to the dragon's head joint toward the hands
const riderHeadW = (p) => ss(1.9, 2.9, Math.abs(p[1])) * ss(10.5, 11.5, p[2]) * ss(3.5, 6.8, Math.abs(p[1]));
// bind: v_bind = inverse(blend of joint rest matrices) * target (dragon native)
const JM = [0, 1].map((j) => L.jointMat(j));
function inv4(a) { const det = a[0] * (a[5] * a[10] - a[9] * a[6]) - a[4] * (a[1] * a[10] - a[9] * a[2]) + a[8] * (a[1] * a[6] - a[5] * a[2]);
  const r = [(a[5] * a[10] - a[9] * a[6]) / det, -(a[1] * a[10] - a[9] * a[2]) / det, (a[1] * a[6] - a[5] * a[2]) / det, 0, -(a[4] * a[10] - a[8] * a[6]) / det, (a[0] * a[10] - a[8] * a[2]) / det, -(a[0] * a[6] - a[4] * a[2]) / det, 0, (a[4] * a[9] - a[8] * a[5]) / det, -(a[0] * a[9] - a[8] * a[1]) / det, (a[0] * a[5] - a[4] * a[1]) / det, 0, 0, 0, 0, 1];
  r[12] = -(r[0] * a[12] + r[4] * a[13] + r[8] * a[14]); r[13] = -(r[1] * a[12] + r[5] * a[13] + r[9] * a[14]); r[14] = -(r[2] * a[12] + r[6] * a[13] + r[10] * a[14]); return r; }
const m4v = (m, v) => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]];
const m4n = (m, v) => nrm([m[0] * v[0] + m[4] * v[1] + m[8] * v[2], m[1] * v[0] + m[5] * v[1] + m[9] * v[2], m[2] * v[0] + m[6] * v[1] + m[10] * v[2]]);
const toNative = (f) => L.unpitch(L.fromGl(f)), toNativeN = (f) => L.unpitch(L.fromGl(f));
const riderFlightPts = [];
for (const q of RP) {
  const P2 = [], N2 = [], W5 = [];
  q.P0.forEach((p, i) => {
    const [pp, nn] = poseRider(p, q.N0[i]);
    const f = riderToFlight(pp), fn = [nn[0], nn[2], -nn[1]];
    riderFlightPts.push(f);
    const h = riderHeadW(p); const w = [1 - h, h, 0, 0, 0];
    const B = JM[0].map((x, idx) => (1 - h) * x + h * JM[1][idx]); const Bi = inv4(B);
    P2.push(m4v(Bi, toNative(f))); N2.push(m4n(Bi, toNativeN(fn))); W5.push(w);
  });
  prims.push({ P: P2, N: N2, T: q.T, I: q.I, W5, material: q.material, src: "rider" });
}

// ---------------- write GLB ----------------
const M = (() => { const ex = L.toGl(L.pitchP([1, 0, 0])), ey = L.toGl(L.pitchP([0, 1, 0])), ez = L.toGl(L.pitchP([0, 0, 1])); return [...ex, 0, ...ey, 0, ...ez, 0, -origin[0], -origin[1], -origin[2], 1]; })();
const NC = L.NC, CS = L.CS;
const chunks = []; let off = 0; const bufferViews = [], accessors = [];
const pad = () => { const p = (4 - (off % 4)) % 4; if (p) { chunks.push(Buffer.alloc(p)); off += p; } };
function addAcc(rows, type, ct, target, minmax) { pad(); const n = NC[type], cs = CS[ct]; const b = Buffer.alloc(rows.length * n * cs);
  rows.forEach((r, i) => (n === 1 ? [r] : r).forEach((v, kk) => { const o = (i * n + kk) * cs; if (ct === 5126) b.writeFloatLE(v, o); else if (cs === 4) b.writeUInt32LE(v, o); else if (cs === 2) b.writeUInt16LE(v, o); else b.writeUInt8(v, o); }));
  chunks.push(b); bufferViews.push(Object.assign({ buffer: 0, byteOffset: off, byteLength: b.length }, target ? { target } : {})); off += b.length;
  const a = { bufferView: bufferViews.length - 1, componentType: ct, count: rows.length, type }; if (minmax) { a.min = [0, 1, 2].map((q) => Math.min(...rows.map((r) => r[q]))); a.max = [0, 1, 2].map((q) => Math.max(...rows.map((r) => r[q]))); }
  accessors.push(a); return accessors.length - 1; }
function addRaw(buf) { pad(); chunks.push(buf); bufferViews.push({ buffer: 0, byteOffset: off, byteLength: buf.length }); off += buf.length; return bufferViews.length - 1; }
// materials/textures/images: dragon's then rider's (rider indices offset)
const dMat = D.j.materials.length, dTex = (D.j.textures || []).length, dImg = (D.j.images || []).length, dSmp = (D.j.samplers || []).length;
const images = [...(D.j.images || []).map((im) => ({ dir: dDir, im })), ...(R.j.images || []).map((im) => ({ dir: rDir, im }))]
  .map(({ dir, im }) => ({ bufferView: addRaw(fs.readFileSync(path.join(dir, decodeURIComponent(im.uri)))), mimeType: /\.png$/i.test(im.uri) ? "image/png" : "image/jpeg" }));
const samplers = [...(D.j.samplers || []), ...(R.j.samplers || [])];
const textures = [...(D.j.textures || []), ...(R.j.textures || []).map((t) => Object.assign({}, t, { source: t.source + dImg, sampler: t.sampler !== undefined ? t.sampler + dSmp : undefined }))];
const shiftTex = (o) => { if (!o || typeof o !== "object") return o; const c = Array.isArray(o) ? o.map(shiftTex) : {}; if (!Array.isArray(o)) for (const [kk, v] of Object.entries(o)) c[kk] = kk === "index" && typeof v === "number" ? v + dTex : shiftTex(v); return c; };
const materials = [...D.j.materials, ...R.j.materials.map(shiftTex)];
const meshPrims = prims.map((q) => {
  const J = q.W5.map((w) => w.map((v, kk) => [kk, v]).sort((a, b) => b[1] - a[1]).slice(0, 4));
  const W = J.map((e) => { const t = e.reduce((s, x) => s + x[1], 0) || 1; return e.map((x) => x[1] / t); });
  const attrs = { POSITION: addAcc(q.P, "VEC3", 5126, 34962, true), NORMAL: addAcc(q.N, "VEC3", 5126, 34962) };
  if (q.T) attrs.TEXCOORD_0 = addAcc(q.T, "VEC2", 5126, 34962);
  attrs.JOINTS_0 = addAcc(J.map((e) => e.map((x) => x[0])), "VEC4", 5121, 34962); attrs.WEIGHTS_0 = addAcc(W, "VEC4", 5126, 34962);
  const pr = { attributes: attrs, indices: addAcc(q.I, "SCALAR", q.P.length > 65535 ? 5125 : 5123, 34963) };
  if (q.material !== undefined) pr.material = q.src === "rider" ? q.material + dMat : q.material; return pr; });
const ibmAcc = (() => { pad(); const b = Buffer.alloc(5 * 64); L.JP.forEach((p, kk) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -p[0], -p[1], -p[2], 1].forEach((v, i) => b.writeFloatLE(v, kk * 64 + i * 4))); chunks.push(b); bufferViews.push({ buffer: 0, byteOffset: off, byteLength: b.length }); off += b.length; accessors.push({ bufferView: bufferViews.length - 1, componentType: 5126, count: 5, type: "MAT4" }); return accessors.length - 1; })();
pad();
const q = (a) => [Math.sin(a / 2), 0, 0, Math.cos(a / 2)];
const gl = {
  asset: { version: "2.0", generator: "gundam-sim build_dragon_rider.js", copyright: "Dragon: \"charizard\" by My Crea Pro (https://sketchfab.com/Beany-Boy), CC-BY-4.0. Rider: \"Wii - Super Smash Bros Brawl - Pokemon Trainer\" by Waffles (https://sketchfab.com/jkimmel694), CC-BY-4.0 as stated by the uploader. Both modified (posed, rigged, rescaled, merged)." },
  extensionsUsed: [...new Set([...(D.j.extensionsUsed || []), ...(R.j.extensionsUsed || [])])],
  scene: 0, scenes: [{ nodes: [0, 6] }],
  nodes: [{ name: "dragon", matrix: M, children: [1, 2, 3, 4, 5] }, { name: "body", translation: [0, 0, 0] }, { name: "head", translation: L.HEAD_P, rotation: q(L.HEAD_REST) },
    { name: "wingL", translation: L.WING_L }, { name: "wingR", translation: L.WING_R }, { name: "tail", translation: L.TAIL_P, rotation: q(L.TAIL_REST) }, { name: "dragonMesh", mesh: 0, skin: 0 }],
  meshes: [{ name: "dragonAndRider", primitives: meshPrims }], skins: [{ joints: [1, 2, 3, 4, 5], inverseBindMatrices: ibmAcc, skeleton: 0 }],
  materials, textures, samplers, images, accessors, bufferViews, buffers: [{ byteLength: off }]
};
if (!gl.extensionsUsed.length) delete gl.extensionsUsed;
for (const t of gl.textures) if (t.sampler === undefined) delete t.sampler;
const bin = Buffer.concat(chunks); let jb = Buffer.from(JSON.stringify(gl), "utf8"); if (jb.length % 4) jb = Buffer.concat([jb, Buffer.alloc(4 - (jb.length % 4), 0x20)]);
const total = 28 + jb.length + bin.length; const h = Buffer.alloc(12); h.writeUInt32LE(0x46546c67, 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(total, 8);
const c1 = Buffer.alloc(8); c1.writeUInt32LE(jb.length, 0); c1.writeUInt32LE(0x4e4f534a, 4); const c2 = Buffer.alloc(8); c2.writeUInt32LE(bin.length, 0); c2.writeUInt32LE(0x004e4942, 4);
fs.writeFileSync(out, Buffer.concat([h, c1, jb, c2, bin]));
// report: rider eye position (flight frame, shifted, native units), IK miss, clearance of rider legs from the neck
const eyeR = poseRider([0.9, 0, 16.0], [1, 0, 0])[0]; const eyeF = sub(riderToFlight(eyeR), origin);
const neckPts = allF.filter((p, i) => true);
let minClear = Infinity; const legF = []; RP.forEach((qq) => qq.P0.forEach((p) => { if (p[2] < 8.0) legF.push(riderToFlight(poseRider(p, [0, 0, 1])[0])); }));
// dragon points near the seat
const near = allF.filter((p) => Math.abs(p[0] - seatF[0]) < 3 && Math.abs(p[1] - seatF[1]) < 4);
let inside = 0; for (const lp of legF) { let dmin = Infinity; for (const np of near) dmin = Math.min(dmin, Math.hypot(lp[0] - np[0], lp[1] - np[1], lp[2] - np[2])); minClear = Math.min(minClear, dmin); }
console.log(`${out}: ${(total / 1024).toFixed(0)} KB, k=${k.toFixed(3)} (rider ${RIDER_M} m on a ${DRAGON_HEIGHT_M} m dragon)`);
console.log(`arm IK miss L ${ik[1].miss.toFixed(2)} R ${ik[-1].miss.toFixed(2)} (rider units), seatZr ${seatZr.toFixed(2)}`);
console.log(`rider eye (flight frame, shifted, dragon units): ${eyeF.map((v) => v.toFixed(2)).join(",")}  -> metres ${eyeF.map((v) => (v * DRAGON_HEIGHT_M / DRAGON_NATIVE_H).toFixed(2)).join(",")}`);
console.log(`closest leg vertex to a dragon vertex near the seat: ${minClear.toFixed(2)} dragon units`);
