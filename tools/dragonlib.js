// Shared dragon geometry helpers (same parameters as build_dragon.js): read the source, skin weights,
// rest deformation (head/tail rest angles), native <-> flight-frame mapping.
const fs = require("fs"), path = require("path");
const PITCH = 55 * Math.PI / 180;
const HEAD_P = [0, -3.0, 12.8], WING_L = [2.6, 0.5, 11.0], WING_R = [-2.6, 0.5, 11.0], TAIL_P = [0, 2.6, 4.5];
const HEAD_REST = -45 * Math.PI / 180, TAIL_REST = -52 * Math.PI / 180;
const JP = [[0, 0, 0], HEAD_P, WING_L, WING_R, TAIL_P], JR = [0, HEAD_REST, 0, 0, TAIL_REST];
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }, CS = { 5126: 4, 5125: 4, 5123: 2, 5121: 1 };
function loadGltf(dir) {
  const j = JSON.parse(fs.readFileSync(path.join(dir, "scene.gltf"), "utf8")); const bin = fs.readFileSync(path.join(dir, j.buffers[0].uri));
  const read = (ai) => { const a = j.accessors[ai], bv = j.bufferViews[a.bufferView], n = NC[a.type], cs = CS[a.componentType], b = (bv.byteOffset || 0) + (a.byteOffset || 0), st = bv.byteStride || n * cs;
    const o = []; for (let i = 0; i < a.count; i++) { const v = []; for (let k = 0; k < n; k++) { const off = b + i * st + k * cs; v.push(a.componentType === 5126 ? bin.readFloatLE(off) : cs === 4 ? bin.readUInt32LE(off) : cs === 2 ? bin.readUInt16LE(off) : bin.readUInt8(off)); } o.push(n === 1 ? v[0] : v); } return o; };
  return { j, read, dir };
}
const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
function weights(p, meshIdx) {
  const [x, y, z] = p; const ax = Math.abs(x);
  let head = ss(-2.4, -4.6, y) * ss(10.5, 12.2, z) * (1 - ss(2.8, 3.6, ax));
  if (meshIdx === 1 || meshIdx === 2 || meshIdx === 4) head = 1;
  if (meshIdx === 6) head = 0;
  const wingBase = ss(2.3, 3.8, ax) * ss(-1.6, -0.8, y) * ss(7.0, 8.6, z);
  const tail = ss(2.2, 5.0, y) * (1 - ss(8.0, 9.5, z)) * (1 - ss(2.6, 3.6, ax)) * (1 - head);
  const w = [Math.max(0, 1 - head - wingBase - tail), head, x > 0 ? wingBase : 0, x < 0 ? wingBase : 0, tail];
  const s = w.reduce((a, b) => a + b, 0); return w.map((v) => v / s);
}
const rx = (p, c0, a) => { const y = p[1] - c0[1], z = p[2] - c0[2], cc = Math.cos(a), sn = Math.sin(a); return [p[0], c0[1] + y * cc - z * sn, c0[2] + y * sn + z * cc]; };
// rest pose of a native point with 5 weights
const deform = (p, w) => { const o = [0, 0, 0]; w.forEach((wt, k) => { if (!wt) return; const q = JR[k] ? rx(p, JP[k], JR[k]) : p; for (let i = 0; i < 3; i++) o[i] += wt * q[i]; }); return o; };
// joint rest transform as 4x4 (column-major) and blended inverse, for binding extra geometry
function jointMat(k) { const a = JR[k], c = Math.cos(a), s = Math.sin(a), p = JP[k]; // T(p) * Rx(a) * T(-p)
  const R = [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]; const t = [0, p[1] - (c * p[1] - s * p[2]), p[2] - (s * p[1] + c * p[2])]; R[12] = t[0]; R[13] = t[1]; R[14] = t[2]; return R; }
const c = Math.cos(PITCH), s = Math.sin(PITCH);
const pitchP = ([x, y, z]) => [x, y * c - z * s, y * s + z * c];
const unpitch = ([x, y, z]) => [x, y * c + z * s, -y * s + z * c];
const toGl = ([x, y, z]) => [-y, z, -x];
const fromGl = ([X, Y, Z]) => [-Z, -X, Y];
module.exports = { PITCH, HEAD_P, WING_L, WING_R, TAIL_P, HEAD_REST, TAIL_REST, JP, JR, NC, CS, loadGltf, ss, weights, deform, jointMat, pitchP, unpitch, toGl, fromGl };
