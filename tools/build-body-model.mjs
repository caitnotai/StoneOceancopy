// Builds public/models/body.glb from the BodyParts3D atlas.
//
//   node tools/build-body-model.mjs <lists dir> <obj dir> <output.glb>
//
// For every element mesh: classify it into a body system, move it into the app's frame
// (metres, feet at y = 0, facing +z, body's left = +x, height 1.76), reduce its triangle
// count, and merge it into one mesh per (system, part). Normals are recomputed in the
// browser, so the file only carries positions and indices.
//
// Source: BodyParts3D, (c) The Database Center for Life Science, CC BY 4.0.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { Vector3 } from 'three';
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js';
import { classify, loadElements, lungSide } from './bodyparts/classify.mjs';

const [listsDir, objDir, outFile] = process.argv.slice(2);
if (!listsDir || !objDir || !outFile) {
  console.error('Usage: node tools/build-body-model.mjs <lists dir> <obj dir> <output.glb>');
  process.exit(1);
}

const TARGET_HEIGHT = 1.76;

/**
 * Triangle budget and geometric tolerance (metres) per part. Budgets keep the whole body
 * near 700k triangles, which integrated laptop graphics still render smoothly.
 */
const PARTS = {
  'radiation/skin': { budget: 45_000, error: 0.003 },
  'skeletal/bones': { budget: 190_000, error: 0.0012 },
  'muscular/muscles': { budget: 190_000, error: 0.004 },
  'cardiovascular/heart': { budget: 30_000, error: 0.001 },
  'cardiovascular/vessels': { budget: 120_000, error: 0.0014 },
  'respiratory/airways': { budget: 40_000, error: 0.001 },
  'neuro/brain': { budget: 55_000, error: 0.0012 },
  'sensory/eyes': { budget: 10_000, error: 0.001 },
  'immune/lymphoid': { budget: 6_000, error: 0.0015 },
  'metabolic/organs': { budget: 70_000, error: 0.0015 },
};

// ---------- OBJ ----------
function parseObj(file) {
  const text = readFileSync(file, 'utf8');
  const positions = [];
  const indices = [];
  let start = 0;
  while (start < text.length) {
    let end = text.indexOf('\n', start);
    if (end < 0) end = text.length;
    const c0 = text.charCodeAt(start);
    const c1 = text.charCodeAt(start + 1);
    if (c0 === 118 /* v */ && c1 === 32) {
      const p = text.slice(start + 2, end).trim().split(/\s+/);
      positions.push(+p[0], +p[1], +p[2]);
    } else if (c0 === 102 /* f */ && c1 === 32) {
      const f = text.slice(start + 2, end).trim().split(/\s+/).map((token) => parseInt(token, 10) - 1);
      for (let i = 1; i + 1 < f.length; i++) indices.push(f[0], f[i], f[i + 1]);
    }
    start = end + 1;
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

function bounds(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = positions[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  return { min, max, center: min.map((v, a) => (v + max[a]) / 2) };
}

const centroid = (positions) => {
  const c = [0, 0, 0];
  for (let i = 0; i < positions.length; i += 3) for (let a = 0; a < 3; a++) c[a] += positions[i + a];
  return c.map((v) => v / (positions.length / 3));
};

// ---------- 1. classify ----------
const elements = loadElements(listsDir);
const jobs = [];
for (const [id, element] of elements) {
  const file = join(objDir, `${id}.obj`);
  if (!existsSync(file)) continue;
  const target = classify(element);
  const lung = lungSide(element);
  if (target || lung) jobs.push({ id, element, file, key: target ? `${target.system}/${target.part}` : null, lung, bytes: statSync(file).size });
}
console.log(`${jobs.length} element meshes to process (of ${elements.size} listed)`);

// ---------- 2. find the app frame from anatomy, not from assumptions ----------
const byName = (name) => jobs.find((j) => j.element.name === name);
const rawCentroid = (name) => {
  const job = byName(name);
  if (!job) throw new Error(`Landmark part not found: ${name}`);
  return new Vector3(...centroid(parseObj(job.file).positions));
};
const skinJob = byName('skin');
const skin = bounds(parseObj(skinJob.file).positions);
const extent = skin.max.map((v, a) => v - skin.min[a]);
const upAxis = extent.indexOf(Math.max(...extent));
const up = new Vector3().setComponent(upAxis, 1);
if (rawCentroid('frontal bone').dot(up) < rawCentroid('left calcaneus').dot(up)) up.negate();
// The atlas is axis-aligned, so each direction snaps to the nearest coordinate axis.
const snap = (v) => {
  const a = [Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)];
  const axis = a.indexOf(Math.max(...a));
  return new Vector3().setComponent(axis, Math.sign(v.getComponent(axis)));
};
const front = snap(rawCentroid('body of sternum').sub(rawCentroid('eighth thoracic vertebra')));
const left = snap(rawCentroid('spleen').sub(rawCentroid('gallbladder')));
// App frame is right-handed with x = left, y = up, z = front, so left x up must equal front.
const handedness = new Vector3().crossVectors(left, up).dot(front);
if (handedness < 0.9) throw new Error(`Atlas axes are not a pure rotation of the app frame (handedness ${handedness.toFixed(2)})`);
const scale = TARGET_HEIGHT / extent[upAxis];
const origin = new Vector3(...skin.center);
origin.addScaledVector(up, -origin.dot(up) + (up.getComponent(upAxis) > 0 ? skin.min[upAxis] : -skin.max[upAxis]));
console.log(`up axis ${'xyz'[upAxis]}${up.getComponent(upAxis) > 0 ? '+' : '-'}, source height ${extent[upAxis].toFixed(1)}, scale ${scale.toExponential(3)}`);

function toAppFrame(positions) {
  const out = new Float32Array(positions.length);
  const p = new Vector3();
  for (let i = 0; i < positions.length; i += 3) {
    p.set(positions[i], positions[i + 1], positions[i + 2]).sub(origin);
    out[i] = p.dot(left) * scale;
    out[i + 1] = p.dot(up) * scale;
    out[i + 2] = p.dot(front) * scale;
  }
  return out;
}

// ---------- 3. load, measure ----------
console.log('Reading meshes...');
const meshes = [];
const lungPoints = { left: [], right: [] };
const boneBounds = new Map();
for (const job of jobs) {
  const raw = parseObj(job.file);
  if (raw.indices.length === 0) continue;
  const positions = toAppFrame(raw.positions);
  if (job.lung) {
    const step = Math.max(3, Math.floor(positions.length / 3 / 60) * 3);
    for (let i = 0; i < positions.length; i += step) lungPoints[job.lung].push(new Vector3(positions[i], positions[i + 1], positions[i + 2]));
  }
  if (!job.key) continue;
  if (job.key === 'skeletal/bones') boneBounds.set(job.element.name, bounds(positions));
  meshes.push({ key: job.key, name: job.element.name, positions, indices: raw.indices });
}
const sourceTriangles = {};
for (const m of meshes) sourceTriangles[m.key] = (sourceTriangles[m.key] ?? 0) + m.indices.length / 3;

// ---------- 4. simplify and merge ----------
await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;

/**
 * Merges vertices that share a position. The atlas meshes carry duplicated vertices along
 * seams; left as they are, every seam is a border the simplifier refuses to touch.
 */
function weld(mesh) {
  const lookup = new Map();
  const remap = new Uint32Array(mesh.positions.length / 3);
  const positions = [];
  for (let i = 0; i < remap.length; i++) {
    const x = mesh.positions[i * 3];
    const y = mesh.positions[i * 3 + 1];
    const z = mesh.positions[i * 3 + 2];
    const key = `${Math.round(x * 2e4)},${Math.round(y * 2e4)},${Math.round(z * 2e4)}`; // 0.05 mm grid
    let index = lookup.get(key);
    if (index === undefined) {
      index = positions.length / 3;
      lookup.set(key, index);
      positions.push(x, y, z);
    }
    remap[i] = index;
  }
  const indices = [];
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = remap[mesh.indices[i]];
    const b = remap[mesh.indices[i + 1]];
    const c = remap[mesh.indices[i + 2]];
    if (a !== b && b !== c && a !== c) indices.push(a, b, c);
  }
  mesh.positions = new Float32Array(positions);
  mesh.indices = new Uint32Array(indices);
}

function surfaceArea({ positions: p, indices }) {
  let area = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3;
    const b = indices[i + 1] * 3;
    const c = indices[i + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    area += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  }
  return area;
}

// Each part's triangle budget is shared out by surface area, not by source triangle count:
// a large muscle keeps its shape, and a tiny over-tessellated vessel does not eat the budget.
const weightTotal = {};
for (const mesh of meshes) {
  weld(mesh);
  mesh.weight = surfaceArea(mesh) ** 0.8;
  weightTotal[mesh.key] = (weightTotal[mesh.key] ?? 0) + mesh.weight;
}

function simplify(mesh, budget, error) {
  const share = Math.round((budget * mesh.weight) / weightTotal[mesh.key]);
  const target = Math.max(24, share) * 3;
  if (target >= mesh.indices.length) return mesh.indices;
  const [indices] = MeshoptSimplifier.simplify(mesh.indices, mesh.positions, 3, target, error, ['ErrorAbsolute']);
  return indices;
}

const merged = new Map();
for (const mesh of meshes) {
  const part = PARTS[mesh.key];
  const indices = simplify(mesh, part.budget, part.error);
  if (!merged.has(mesh.key)) merged.set(mesh.key, { positions: [], indices: [], vertexCount: 0 });
  const out = merged.get(mesh.key);
  // Keep only the vertices the simplified mesh still uses.
  const remap = new Map();
  for (const index of indices) {
    let next = remap.get(index);
    if (next === undefined) {
      next = out.vertexCount++;
      remap.set(index, next);
      out.positions.push(mesh.positions[index * 3], mesh.positions[index * 3 + 1], mesh.positions[index * 3 + 2]);
    }
    out.indices.push(next);
  }
}

// ---------- 5. lung envelopes ----------
// The atlas has the bronchial tree and pulmonary vessels but no lung surface, so each lung
// is drawn as the convex hull of everything inside it, slightly inflated.
function lungHull(points) {
  const hull = new ConvexHull().setFromPoints(points);
  const center = points.reduce((sum, p) => sum.add(p), new Vector3()).multiplyScalar(1 / points.length);
  const positions = [];
  const indices = [];
  const seen = new Map();
  for (const face of hull.faces) {
    let edge = face.edge;
    do {
      const p = edge.head().point;
      const key = `${p.x.toFixed(5)},${p.y.toFixed(5)},${p.z.toFixed(5)}`;
      if (!seen.has(key)) {
        seen.set(key, positions.length / 3);
        const q = p.clone().sub(center).multiplyScalar(1.07).add(center);
        positions.push(q.x, q.y, q.z);
      }
      indices.push(seen.get(key));
      edge = edge.next;
    } while (edge !== face.edge);
  }
  return { positions, indices };
}
const lungs = { positions: [], indices: [], vertexCount: 0 };
for (const side of ['left', 'right']) {
  if (lungPoints[side].length < 10) continue;
  const hull = lungHull(lungPoints[side]);
  for (const i of hull.indices) lungs.indices.push(i + lungs.vertexCount);
  lungs.positions.push(...hull.positions);
  lungs.vertexCount += hull.positions.length / 3;
}
if (lungs.vertexCount > 0) merged.set('respiratory/lungs', lungs);

// ---------- 6. landmarks for the few parts the atlas does not model ----------
const landmarks = {};
const bone = (name) => boneBounds.get(name);
const put = (key, name, pick) => {
  const b = bone(name);
  if (b) landmarks[key] = pick(b).map((v) => +v.toFixed(4));
  else console.warn(`  landmark ${key}: bone "${name}" not found`);
};
for (const [side, sign] of [['left', 1], ['right', -1]]) {
  const s = side === 'left' ? 'L' : 'R';
  put(`ear${s}`, `${side} temporal bone`, (b) => [b.center[0] * 0.62, b.center[1] - 0.004, b.center[2]]);
  put(`axilla${s}`, `${side} humerus`, (b) => [b.center[0] - sign * 0.04, b.max[1] - 0.05, b.center[2]]);
  put(`elbow${s}`, `${side} humerus`, (b) => [b.center[0], b.min[1] + 0.02, b.center[2] + 0.015]);
  put(`wrist${s}`, `${side} radius`, (b) => [b.center[0], b.min[1], b.center[2]]);
  put(`groin${s}`, `${side} femur`, (b) => [b.center[0] - sign * 0.03, b.max[1] - 0.02, b.center[2] + 0.035]);
  put(`knee${s}`, `${side} femur`, (b) => [b.center[0], b.min[1] + 0.02, b.center[2] - 0.03]);
  put(`ankle${s}`, `${side} tibia`, (b) => [b.center[0], b.min[1] + 0.02, b.center[2]]);
  put(`neck${s}`, 'fourth cervical vertebra', (b) => [sign * 0.04, b.center[1], b.center[2] + 0.03]);
}
put('ductTop', 'first thoracic vertebra', (b) => [0.012, b.center[1], b.max[2] + 0.01]);
put('ductBottom', 'second lumbar vertebra', (b) => [0.006, b.center[1], b.max[2] + 0.01]);

// ---------- 7. write ----------
const document = new Document();
document.getRoot().getAsset().copyright = 'BodyParts3D, (c) The Database Center for Life Science, licensed under CC Attribution 4.0 International';
const buffer = document.createBuffer();
const scene = document.createScene('body').setExtras({ landmarks, heightMetres: TARGET_HEIGHT });
let total = 0;
for (const [key, data] of [...merged].sort()) {
  const [system, part] = key.split('/');
  const primitive = document
    .createPrimitive()
    .setAttribute('POSITION', document.createAccessor().setType('VEC3').setArray(new Float32Array(data.positions)).setBuffer(buffer))
    .setIndices(document.createAccessor().setType('SCALAR').setArray(new Uint32Array(data.indices)).setBuffer(buffer));
  scene.addChild(document.createNode(key).setMesh(document.createMesh(key).addPrimitive(primitive)).setExtras({ system, part }));
  const triangles = data.indices.length / 3;
  total += triangles;
  console.log(`  ${key.padEnd(24)} ${String(Math.round(sourceTriangles[key] ?? triangles)).padStart(9)} -> ${String(triangles).padStart(7)} triangles`);
}
await document.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
await io.write(outFile, document);
console.log(`${total} triangles, ${(statSync(outFile).size / 1e6).toFixed(2)} MB -> ${outFile}`);
