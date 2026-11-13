// Split the flight Gundam's legs into jointed nodes for the walking animation:
//   thighL -> shinL -> footL and thighR -> shinR -> footR, children of the "body" node,
//   pivoted at the hip, knee and ankle, and the left arm with its shield as "armL" (pivot at the shoulder, mirroring armR),
// (body-node units: +y up, +z forward, +x = the Gundam's left).
// The legs are separate armour pieces (mesh islands) in models/gundam_rx78_18m{,_med,_low}.glb, so each island is
// assigned whole by its bounding box. Vertices are stored relative to their own joint, so a node with an identity
// rotation shows the leg exactly as before. Running it again on a split model does nothing.
// usage: node tools/build_gundam_legs.js models/gundam_rx78_18m.glb [more.glb ...]
const fs = require("fs");
const SHOULDER_L = [6.4, 38.6, -0.9];   // mirror of armR's pivot
const HIP = [3.2, 25.5, 0], KNEE = [3.2, 17.9, -0.1], ANKLE = [3.2, 4.6, 0];
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }, CS = { 5126: 4, 5125: 4, 5123: 2, 5121: 1 };

function split(file) {
  const g = fs.readFileSync(file); const jl = g.readUInt32LE(12); const j = JSON.parse(g.toString("utf8", 20, 20 + jl));
  if (j.nodes.some((n) => n.name === "thighL")) { console.log(file + ": already split"); return; }
  let bin = Buffer.from(g.slice(28 + jl, 28 + jl + g.readUInt32LE(20 + jl)));
  const read = (ai) => { const a = j.accessors[ai], bv = j.bufferViews[a.bufferView], n = NC[a.type], cs = CS[a.componentType], b = (bv.byteOffset || 0) + (a.byteOffset || 0), st = bv.byteStride || n * cs;
    const o = []; for (let i = 0; i < a.count; i++) { const v = []; for (let k = 0; k < n; k++) { const off = b + i * st + k * cs; v.push(a.componentType === 5126 ? bin.readFloatLE(off) : cs === 4 ? bin.readUInt32LE(off) : cs === 2 ? bin.readUInt16LE(off) : bin.readUInt8(off)); } o.push(v); } return o; };
  const pad4 = (b) => (b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4))]) : b);
  const addAccessor = (rows, type, componentType, target, minmax) => {
    const n = NC[type], cs = CS[componentType]; const b = Buffer.alloc(rows.length * n * cs);
    rows.forEach((r, i) => (n === 1 ? [r] : r).forEach((x, k) => { const off = (i * n + k) * cs; if (componentType === 5126) b.writeFloatLE(x, off); else if (cs === 4) b.writeUInt32LE(x, off); else b.writeUInt16LE(x, off); }));
    bin = pad4(bin); const bv = { buffer: 0, byteOffset: bin.length, byteLength: b.length }; if (target) bv.target = target; j.bufferViews.push(bv); bin = Buffer.concat([bin, b]);
    const acc = { bufferView: j.bufferViews.length - 1, componentType, count: rows.length, type };
    if (minmax) { acc.min = [0, 1, 2].map((k) => Math.min(...rows.map((r) => r[k]))); acc.max = [0, 1, 2].map((k) => Math.max(...rows.map((r) => r[k]))); }
    j.accessors.push(acc); return j.accessors.length - 1;
  };
  // which leg part an island belongs to (null = stays with the body)
  const classify = (c) => {
    const cx = (c.mn[0] + c.mx[0]) / 2, ax = Math.max(Math.abs(c.mn[0]), Math.abs(c.mx[0]));
    if (ax <= 6.5 && Math.abs(cx) >= 0.3) {   // legs (not the crotch at the centre, not the arms further out)
      const side = cx > 0 ? "L" : "R";
      if (c.mx[1] <= 6.7) return "foot" + side;
      if (c.mn[1] >= 4.0 && c.mx[1] <= 20.2) return "shin" + side;
      if (c.mn[1] >= 17.9 && c.mx[1] <= 28.0 && Math.abs(cx) >= 1.0 && ax <= 5.6) return "thigh" + side;
    }
    if (c.mn[0] > 4.0 && c.mn[1] > 1.5 && c.mx[1] < 43) return "armL";   // the same rule that split armR, mirrored
    return null;
  };
  const pivotOf = (part) => { if (part === "armL") return SHOULDER_L; const p = part.startsWith("thigh") ? HIP : part.startsWith("shin") ? KNEE : ANKLE; return [part.endsWith("L") ? p[0] : -p[0], p[1], p[2]]; };
  const bodyNode = j.nodes.findIndex((n) => n.name === "body");
  const partPrims = {}; const tris = {};
  // the body mesh, and the right-arm mesh (an older arm split took the right ankle's outer plate along with the arm)
  const sources = [{ mesh: j.meshes[j.nodes[bodyNode].mesh], off: [0, 0, 0], only: null }];
  const armNode = j.nodes.find((n) => n.name === "armR"); if (armNode) sources.push({ mesh: j.meshes[armNode.mesh], off: armNode.translation, only: "footR" });
  for (const src of sources) for (const p of src.mesh.primitives) {
    const P = read(p.attributes.POSITION).map((v) => [v[0] + src.off[0], v[1] + src.off[1], v[2] + src.off[2]]), I = read(p.indices).map((x) => x[0]);
    const par = P.map((_, i) => i); const f = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; }; const u = (a, b) => { a = f(a); b = f(b); if (a !== b) par[a] = b; };
    for (let t = 0; t < I.length; t += 3) { u(I[t], I[t + 1]); u(I[t], I[t + 2]); }
    const key = new Map(); P.forEach((v, i) => { const k = v.map((x) => x.toFixed(4)).join(","); if (key.has(k)) u(i, key.get(k)); else key.set(k, i); });
    const box = new Map(); for (let t = 0; t < I.length; t += 3) { const r = f(I[t]); const c = box.get(r) || { mn: [1e9, 1e9, 1e9], mx: [-1e9, -1e9, -1e9] }; for (const vi of [I[t], I[t + 1], I[t + 2]]) for (let k = 0; k < 3; k++) { c.mn[k] = Math.min(c.mn[k], P[vi][k]); c.mx[k] = Math.max(c.mx[k], P[vi][k]); } box.set(r, c); }
    const cls = new Map([...box].map(([r, c]) => { const k = classify(c); return [r, src.only && k !== src.only ? null : k]; }));
    const byPart = { body: [] };
    for (let t = 0; t < I.length; t += 3) { const k = cls.get(f(I[t])) || "body"; (byPart[k] = byPart[k] || []).push(I[t], I[t + 1], I[t + 2]); }
    for (const [part, idx] of Object.entries(byPart)) {
      tris[part] = (tris[part] || 0) + idx.length / 3;
      if (part === "body") continue;
      const piv = pivotOf(part); const used = [...new Set(idx)]; const remap = new Map(used.map((v, k) => [v, k])); const attrs = {};
      for (const [name, ai] of Object.entries(p.attributes)) {
        const a = j.accessors[ai]; let rows = read(ai); rows = used.map((v) => rows[v]);
        if (name === "POSITION") rows = rows.map((r) => [r[0] + src.off[0] - piv[0], r[1] + src.off[1] - piv[1], r[2] + src.off[2] - piv[2]]);
        attrs[name] = addAccessor(rows.map((r) => (r.length === 1 ? r[0] : r)), a.type, a.componentType, 34962, name === "POSITION");
      }
      const prim = { attributes: attrs, indices: addAccessor(idx.map((v) => remap.get(v)), "SCALAR", used.length > 65535 ? 5125 : 5123, 34963) };
      if (p.material !== undefined) prim.material = p.material; if (p.mode !== undefined) prim.mode = p.mode;
      (partPrims[part] = partPrims[part] || []).push(prim);
    }
    p.indices = addAccessor(byPart.body, "SCALAR", P.length > 65535 ? 5125 : 5123, 34963);
  }
  if (!partPrims.armL) throw new Error(file + ": left arm not found");
  j.meshes.push({ name: "armL", primitives: partPrims.armL }); j.nodes.push({ name: "armL", translation: SHOULDER_L, mesh: j.meshes.length - 1 });
  j.nodes[bodyNode].children = (j.nodes[bodyNode].children || []).concat([j.nodes.length - 1]);
  for (const s of ["L", "R"]) {
    if (!partPrims["thigh" + s] || !partPrims["shin" + s] || !partPrims["foot" + s]) throw new Error(file + ": leg " + s + " not found " + JSON.stringify(tris));
    const node = (part, parentPivot) => { j.meshes.push({ name: part, primitives: partPrims[part] }); const pv = pivotOf(part);
      j.nodes.push({ name: part, translation: [pv[0] - parentPivot[0], pv[1] - parentPivot[1], pv[2] - parentPivot[2]], mesh: j.meshes.length - 1 }); return j.nodes.length - 1; };
    const foot = node("foot" + s, pivotOf("shin" + s));
    const shin = node("shin" + s, pivotOf("thigh" + s)); j.nodes[shin].children = [foot];
    const thigh = node("thigh" + s, [0, 0, 0]); j.nodes[thigh].children = [shin];
    j.nodes[bodyNode].children = (j.nodes[bodyNode].children || []).concat([thigh]);
  }
  // drop accessors/bufferViews no longer referenced (the old index buffers)
  const used = new Set(); for (const m of j.meshes) for (const p of m.primitives) { Object.values(p.attributes).forEach((x) => used.add(x)); if (p.indices !== undefined) used.add(p.indices); }
  const map = new Map(); const acc = []; j.accessors.forEach((a, i) => { if (used.has(i)) { map.set(i, acc.length); acc.push(a); } });
  for (const m of j.meshes) for (const p of m.primitives) { for (const k in p.attributes) p.attributes[k] = map.get(p.attributes[k]); if (p.indices !== undefined) p.indices = map.get(p.indices); }
  j.accessors = acc;
  const usedBV = new Set(acc.map((a) => a.bufferView)); (j.images || []).forEach((im) => im.bufferView !== undefined && usedBV.add(im.bufferView));
  const bvMap = new Map(); const nb = []; const parts = []; let off = 0;
  j.bufferViews.forEach((bv, i) => { if (!usedBV.has(i)) return; const d = bin.slice(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength); const st = (off + 3) & ~3; if (st > off) parts.push(Buffer.alloc(st - off)); parts.push(d); bvMap.set(i, nb.length); nb.push(Object.assign({}, bv, { byteOffset: st })); off = st + d.length; });
  bin = pad4(Buffer.concat(parts)); for (const a of j.accessors) a.bufferView = bvMap.get(a.bufferView); for (const im of j.images || []) if (im.bufferView !== undefined) im.bufferView = bvMap.get(im.bufferView); j.bufferViews = nb;
  j.buffers[0].byteLength = bin.length;
  let jb = Buffer.from(JSON.stringify(j), "utf8"); if (jb.length % 4) jb = Buffer.concat([jb, Buffer.alloc(4 - (jb.length % 4), 0x20)]);
  const total = 28 + jb.length + bin.length;
  const h = Buffer.alloc(12); h.writeUInt32LE(0x46546c67, 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(total, 8);
  const c1 = Buffer.alloc(8); c1.writeUInt32LE(jb.length, 0); c1.writeUInt32LE(0x4e4f534a, 4);
  const c2 = Buffer.alloc(8); c2.writeUInt32LE(bin.length, 0); c2.writeUInt32LE(0x004e4942, 4);
  fs.writeFileSync(file, Buffer.concat([h, c1, jb, c2, bin]));
  console.log(file + ": triangles " + JSON.stringify(tris) + ", bytes " + total);
}
for (const f of process.argv.slice(2)) split(f);
