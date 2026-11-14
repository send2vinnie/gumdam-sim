// Add walking leg joints to models/dragon.glb: hipL -> kneeL -> ankleL and hipR -> kneeR -> ankleR, children of the
// "body" joint, pivoted at the hip, knee and ankle (dragon native frame: +x = its left, -y forward, +z up; the flight
// pitch lives in the root node). The leg vertices of the dragon mesh get these joints' weights (smoothly blended into the
// body at the hip); the rider, the wings, the head and the tail keep their weights. Joint rest rotations are identity, so
// the model looks exactly as before until the app turns the joints. Running it again on a model that has them does nothing.
// usage: node tools/build_dragon_legs.js models/dragon.glb
const fs = require("fs");
const HIP = [3.2, -0.6, 5.6], KNEE = [3.4, -1.0, 3.0], ANKLE = [3.4, -1.2, 1.0];   // left side (native units); right mirrors x
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }, CS = { 5126: 4, 5125: 4, 5123: 2, 5121: 1 };
const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const file = process.argv[2];
const g = fs.readFileSync(file); const jl = g.readUInt32LE(12); const j = JSON.parse(g.toString("utf8", 20, 20 + jl));
if (j.nodes.some((n) => n.name === "hipL")) { console.log(file + ": already has leg joints"); process.exit(0); }
let bin = Buffer.from(g.slice(28 + jl, 28 + jl + g.readUInt32LE(20 + jl)));
const acc = (ai) => { const a = j.accessors[ai], bv = j.bufferViews[a.bufferView]; return { a, n: NC[a.type], cs: CS[a.componentType], base: (bv.byteOffset || 0) + (a.byteOffset || 0), st: bv.byteStride || NC[a.type] * CS[a.componentType] }; };
const get = (A, i, k) => { const off = A.base + i * A.st + k * A.cs; return A.a.componentType === 5126 ? bin.readFloatLE(off) : A.cs === 1 ? bin.readUInt8(off) : A.cs === 2 ? bin.readUInt16LE(off) : bin.readUInt32LE(off); };
const set = (A, i, k, v) => { const off = A.base + i * A.st + k * A.cs; if (A.a.componentType === 5126) bin.writeFloatLE(v, off); else if (A.cs === 1) bin.writeUInt8(v, off); else if (A.cs === 2) bin.writeUInt16LE(v, off); else bin.writeUInt32LE(v, off); };

// new joint nodes (skin joint indices 5..10)
const skin = j.skins[0], bodyNode = j.nodes.findIndex((n) => n.name === "body");
const side = (p, s) => [p[0] * s, p[1], p[2]];
const newJoints = [];
for (const [s, k] of [[1, "L"], [-1, "R"]]) {
  const hp = side(HIP, s), kp = side(KNEE, s), ap = side(ANKLE, s);
  j.nodes.push({ name: "ankle" + k, translation: [ap[0] - kp[0], ap[1] - kp[1], ap[2] - kp[2]] }); const an = j.nodes.length - 1;
  j.nodes.push({ name: "knee" + k, translation: [kp[0] - hp[0], kp[1] - hp[1], kp[2] - hp[2]], children: [an] }); const kn = j.nodes.length - 1;
  j.nodes.push({ name: "hip" + k, translation: hp, children: [kn] }); const hn = j.nodes.length - 1;
  j.nodes[bodyNode].children = (j.nodes[bodyNode].children || []).concat([hn]);
  newJoints.push({ node: hn, p: hp }, { node: kn, p: kp }, { node: an, p: ap });
}
const base = skin.joints.length;   // 5
const order = [0, 1, 2, 3, 4, 5].map((i) => newJoints[i]);   // hipL kneeL ankleL hipR kneeR ankleR
skin.joints = skin.joints.concat(order.map((o) => o.node));
// inverse bind matrices: the old ones, then translation(-p) for each new joint
{ const A = acc(skin.inverseBindMatrices); const b = Buffer.alloc((base + order.length) * 64);
  for (let i = 0; i < base; i++) for (let k = 0; k < 16; k++) b.writeFloatLE(get(A, i, k), (i * 16 + k) * 4);
  order.forEach((o, n) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -o.p[0], -o.p[1], -o.p[2], 1].forEach((v, k) => b.writeFloatLE(v, ((base + n) * 16 + k) * 4)));
  if (bin.length % 4) bin = Buffer.concat([bin, Buffer.alloc(4 - (bin.length % 4))]);
  j.bufferViews.push({ buffer: 0, byteOffset: bin.length, byteLength: b.length }); bin = Buffer.concat([bin, b]);
  j.accessors.push({ bufferView: j.bufferViews.length - 1, componentType: 5126, count: base + order.length, type: "MAT4" }); skin.inverseBindMatrices = j.accessors.length - 1; }

// leg weights: dragon primitives only (materials whose name starts with "dracaufeu"); rider untouched
let changed = 0, prims = 0;
for (const p of j.meshes[0].primitives) {
  if (!/^dracaufeu/.test(j.materials[p.material].name)) continue; prims++;
  const P = acc(p.attributes.POSITION), J = acc(p.attributes.JOINTS_0), W = acc(p.attributes.WEIGHTS_0);
  for (let i = 0; i < P.a.count; i++) {
    const x = get(P, i, 0), y = get(P, i, 1), z = get(P, i, 2), ax = Math.abs(x);
    // leg region: away from the centre line, below the hip, not the tail behind; blended into the body at the hip
    const leg = ss(0.9, 1.7, ax) * ss(6.6, 5.2, z) * ss(2.6, 1.4, y);
    if (leg <= 0.001) continue;
    const ws = new Array(base + 6).fill(0); for (let k = 0; k < 4; k++) ws[get(J, i, k)] += get(W, i, k);
    const move = ws[0] * leg; if (move <= 0.001) continue;   // only the body joint's share moves to the leg
    ws[0] -= move;
    const kneeT = ss(3.5, 2.5, z), ankleT = ss(1.5, 0.7, z), o = x >= 0 ? 0 : 3;
    ws[base + o] += move * (1 - kneeT); ws[base + o + 1] += move * kneeT * (1 - ankleT); ws[base + o + 2] += move * kneeT * ankleT;
    const top = ws.map((w, k) => [k, w]).filter((e) => e[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 4); const t = top.reduce((s, e) => s + e[1], 0);
    for (let k = 0; k < 4; k++) { set(J, i, k, top[k] ? top[k][0] : 0); set(W, i, k, top[k] ? top[k][1] / t : 0); }
    changed++;
  }
}
j.buffers[0].byteLength = bin.length;
let jb = Buffer.from(JSON.stringify(j), "utf8"); if (jb.length % 4) jb = Buffer.concat([jb, Buffer.alloc(4 - (jb.length % 4), 0x20)]);
const total = 28 + jb.length + bin.length; const h = Buffer.alloc(12); h.writeUInt32LE(0x46546c67, 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(total, 8);
const c1 = Buffer.alloc(8); c1.writeUInt32LE(jb.length, 0); c1.writeUInt32LE(0x4e4f534a, 4); const c2 = Buffer.alloc(8); c2.writeUInt32LE(bin.length, 0); c2.writeUInt32LE(0x004e4942, 4);
fs.writeFileSync(file, Buffer.concat([h, c1, jb, c2, bin]));
console.log(`${file}: ${skin.joints.length} joints, ${changed} leg vertices reweighted in ${prims} dragon primitives, ${(total / 1024).toFixed(0)} KB`);
