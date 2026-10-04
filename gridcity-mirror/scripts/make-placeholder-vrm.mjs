// Generates original, Grid City-owned placeholder characters as VRM 1.0 files.
// They are simple "armored suit" humanoids built from primitives — good enough to
// develop and demo with until real, licensed character models arrive.
//
//   npm run make-placeholders
//
// Output: public/characters/<id>/model.vrm (committed to the repo).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// GLTFExporter relies on FileReader, which Node doesn't have.
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buf) => {
      this.result = buf;
      this.onload?.({ target: this });
      this.onloadend?.({ target: this });
    });
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((buf) => {
      this.result = `data:${blob.type};base64,${Buffer.from(buf).toString('base64')}`;
      this.onload?.({ target: this });
      this.onloadend?.({ target: this });
    });
  }
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Character recipes. Colors are hex; `helmet` picks the head style. */
export const RECIPES = [
  {
    id: 'grid-runner',
    name: 'Grid Runner',
    suit: 0x141a2e,
    armor: 0x2b3553,
    accent: 0x00e5ff,
    visor: 0x00e5ff,
    helmet: 'visor',
    bulk: 1.0,
  },
];

// ---------------------------------------------------------------------------
// Skeleton (VRM 1.0: Y up, facing +Z, meters, T-pose; character's left = +X)
// ---------------------------------------------------------------------------
const BONES = [
  // name, parent, world position
  ['hips', null, [0, 0.95, 0]],
  ['spine', 'hips', [0, 1.05, 0]],
  ['chest', 'spine', [0, 1.2, 0]],
  ['neck', 'chest', [0, 1.45, 0]],
  ['head', 'neck', [0, 1.54, 0]],
  ['leftShoulder', 'chest', [0.06, 1.41, 0]],
  ['leftUpperArm', 'leftShoulder', [0.19, 1.41, 0]],
  ['leftLowerArm', 'leftUpperArm', [0.45, 1.41, 0]],
  ['leftHand', 'leftLowerArm', [0.69, 1.41, 0]],
  ['rightShoulder', 'chest', [-0.06, 1.41, 0]],
  ['rightUpperArm', 'rightShoulder', [-0.19, 1.41, 0]],
  ['rightLowerArm', 'rightUpperArm', [-0.45, 1.41, 0]],
  ['rightHand', 'rightLowerArm', [-0.69, 1.41, 0]],
  ['leftUpperLeg', 'hips', [0.1, 0.9, 0]],
  ['leftLowerLeg', 'leftUpperLeg', [0.1, 0.5, 0]],
  ['leftFoot', 'leftLowerLeg', [0.1, 0.09, 0]],
  ['leftToes', 'leftFoot', [0.1, 0.03, 0.12]],
  ['rightUpperLeg', 'hips', [-0.1, 0.9, 0]],
  ['rightLowerLeg', 'rightUpperLeg', [-0.1, 0.5, 0]],
  ['rightFoot', 'rightLowerLeg', [-0.1, 0.09, 0]],
  ['rightToes', 'rightFoot', [-0.1, 0.03, 0.12]],
];

function buildBones() {
  const byName = new Map();
  const list = [];
  for (const [name, parent, pos] of BONES) {
    const bone = new THREE.Bone();
    bone.name = name;
    const world = new THREE.Vector3(...pos);
    bone.userData.world = world;
    if (parent) {
      const p = byName.get(parent);
      bone.position.copy(world).sub(p.userData.world);
      p.add(bone);
    } else {
      bone.position.copy(world);
    }
    byName.set(name, bone);
    list.push(bone);
  }
  return { byName, list };
}

// ---------------------------------------------------------------------------
// Geometry helpers — every piece is rigidly bound to one bone.
// ---------------------------------------------------------------------------
const v3 = (a) => new THREE.Vector3(...a);

/** Capsule between two world points. */
function capsule(a, b, r) {
  const A = v3(a);
  const B = v3(b);
  const len = Math.max(0.001, A.distanceTo(B));
  const g = new THREE.CapsuleGeometry(r, len, 6, 12);
  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    B.clone().sub(A).normalize(),
  );
  g.applyQuaternion(q);
  const mid = A.add(B).multiplyScalar(0.5);
  g.translate(mid.x, mid.y, mid.z);
  return g;
}

function sphere(c, r, sx = 1, sy = 1, sz = 1) {
  const g = new THREE.SphereGeometry(r, 16, 12);
  g.scale(sx, sy, sz);
  g.translate(...c);
  return g;
}

function box(c, size, rot = [0, 0, 0]) {
  const g = new THREE.BoxGeometry(...size);
  g.rotateX(rot[0]);
  g.rotateY(rot[1]);
  g.rotateZ(rot[2]);
  g.translate(...c);
  return g;
}

function bind(geo, boneIndex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.attributes.position.count;
  const idx = new Uint16Array(n * 4);
  const w = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    idx[i * 4] = boneIndex;
    w[i * 4] = 1;
  }
  g.setAttribute('skinIndex', new THREE.BufferAttribute(idx, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(w, 4));
  return g;
}

function buildCharacter(r) {
  const { byName, list } = buildBones();
  const bi = (name) => list.indexOf(byName.get(name));
  const k = r.bulk;
  const parts = { suit: [], armor: [], accent: [], visor: [] };
  const add = (mat, bone, geo) => parts[mat].push(bind(geo, bi(bone)));

  // Torso
  add('suit', 'hips', box([0, 0.95, 0], [0.3 * k, 0.16, 0.19]));
  add('armor', 'hips', box([0, 0.9, 0.0], [0.33 * k, 0.07, 0.21]));
  add('suit', 'spine', capsule([0, 1.0, 0], [0, 1.18, 0], 0.125 * k));
  add('armor', 'chest', sphere([0, 1.3, 0.0], 0.2, 1.15 * k, 0.85, 0.65));
  add('accent', 'chest', box([0, 1.29, 0.125], [0.12, 0.035, 0.02]));
  add('accent', 'chest', box([0, 1.235, 0.12], [0.07, 0.025, 0.02]));
  add('accent', 'hips', box([0, 0.9, 0.108], [0.07, 0.04, 0.012]));

  // Neck + head
  add('suit', 'neck', capsule([0, 1.44, 0], [0, 1.54, 0], 0.05));
  if (r.helmet === 'visor') {
    add('armor', 'head', sphere([0, 1.635, 0], 0.125, 1, 1.05, 1.05));
    add('visor', 'head', sphere([0, 1.635, 0.03], 0.11, 1.08, 0.42, 1.0));
    add('accent', 'head', box([0, 1.765, -0.01], [0.03, 0.03, 0.2]));
  }

  // Arms (left = +X, right = -X)
  for (const s of [1, -1]) {
    const L = s > 0 ? 'left' : 'right';
    add('armor', `${L}UpperArm`, sphere([0.19 * s, 1.425, 0], 0.085 * k, 1.1, 0.9, 1));
    add('suit', `${L}UpperArm`, capsule([0.21 * s, 1.41, 0], [0.43 * s, 1.41, 0], 0.052 * k));
    add('armor', `${L}UpperArm`, sphere([0.45 * s, 1.41, 0], 0.056 * k));
    add('suit', `${L}LowerArm`, capsule([0.47 * s, 1.41, 0], [0.66 * s, 1.41, 0], 0.046 * k));
    add('armor', `${L}LowerArm`, capsule([0.53 * s, 1.41, 0], [0.64 * s, 1.41, 0], 0.056 * k));
    add('accent', `${L}LowerArm`, box([0.585 * s, 1.41, 0.056 * k], [0.08, 0.012, 0.01]));
    add('armor', `${L}Hand`, box([0.75 * s, 1.405, 0.005], [0.11, 0.045, 0.085]));
    add('armor', `${L}Hand`, box([0.715 * s, 1.405, 0.055], [0.04, 0.035, 0.035], [0, 0.6 * s, 0]));
    add('accent', `${L}UpperArm`, box([0.32 * s, 1.41, 0.053 * k], [0.14, 0.012, 0.01]));

    // Legs
    add('suit', `${L}UpperLeg`, capsule([0.1 * s, 0.88, 0], [0.1 * s, 0.53, 0], 0.075 * k));
    add('armor', `${L}UpperLeg`, capsule([0.1 * s, 0.82, 0.02], [0.1 * s, 0.62, 0.02], 0.08 * k));
    add('armor', `${L}UpperLeg`, sphere([0.1 * s, 0.5, 0.01], 0.072 * k));
    add('suit', `${L}LowerLeg`, capsule([0.1 * s, 0.47, 0], [0.1 * s, 0.12, 0], 0.06 * k));
    add('armor', `${L}LowerLeg`, capsule([0.1 * s, 0.42, 0.015], [0.1 * s, 0.2, 0.015], 0.066 * k));
    add('accent', `${L}LowerLeg`, box([0.1 * s, 0.31, 0.083 * k], [0.012, 0.16, 0.01]));
    add('armor', `${L}Foot`, box([0.1 * s, 0.045, 0.04], [0.1, 0.09, 0.25]));
    add('accent', `${L}Foot`, box([0.1 * s, 0.03, 0.166], [0.08, 0.02, 0.01]));
  }

  const order = ['suit', 'armor', 'accent', 'visor'].filter((m) => parts[m].length);
  const merged = order.map((m) => mergeGeometries(parts[m], false));
  const geometry = mergeGeometries(merged, true);

  const mats = {
    suit: new THREE.MeshStandardMaterial({ name: 'suit', color: r.suit, roughness: 0.7, metalness: 0.2 }),
    armor: new THREE.MeshStandardMaterial({ name: 'armor', color: r.armor, roughness: 0.35, metalness: 0.5 }),
    accent: new THREE.MeshStandardMaterial({
      name: 'accent',
      color: r.accent,
      emissive: r.accent,
      emissiveIntensity: 1,
      roughness: 0.4,
    }),
    visor: new THREE.MeshStandardMaterial({
      name: 'visor',
      color: 0x050510,
      emissive: r.visor,
      emissiveIntensity: 0.6,
      roughness: 0.1,
      metalness: 0.8,
    }),
  };

  const mesh = new THREE.SkinnedMesh(
    geometry,
    order.map((m) => mats[m]),
  );
  mesh.name = 'Body';
  const skeleton = new THREE.Skeleton(list);
  const rootBone = byName.get('hips');
  const scene = new THREE.Scene();
  const armature = new THREE.Group();
  armature.name = 'Armature';
  armature.add(rootBone);
  armature.add(mesh);
  scene.add(armature);
  scene.updateMatrixWorld(true);
  mesh.bind(skeleton);
  return { scene, mesh };
}

// ---------------------------------------------------------------------------
// GLB packing + VRMC_vrm extension
// ---------------------------------------------------------------------------
function parseGlb(buf) {
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen;
  const binLen = buf.readUInt32LE(binStart);
  const bin = buf.subarray(binStart + 8, binStart + 8 + binLen);
  return { json, bin };
}

function packGlb(json, bin) {
  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);
  const binPad = (4 - (bin.length % 4)) % 4;
  const binBuf = Buffer.concat([bin, Buffer.alloc(binPad, 0)]);
  const total = 12 + 8 + jsonBuf.length + 8 + binBuf.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(jsonBuf.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(binBuf.length, 0);
  bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jh, jsonBuf, bh, binBuf]);
}

function addVrmExtension(json, recipe) {
  const humanBones = {};
  json.nodes.forEach((node, i) => {
    if (BONES.some(([name]) => name === node.name)) humanBones[node.name] = { node: i };
  });
  json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), 'VRMC_vrm'])];
  json.extensions = {
    ...(json.extensions ?? {}),
    VRMC_vrm: {
      specVersion: '1.0',
      meta: {
        name: recipe.name,
        version: '1',
        authors: ['Grid City VR'],
        copyrightInformation: 'Original placeholder character generated for Grid City VR.',
        licenseUrl: 'https://vrm.dev/licenses/1.0/',
        avatarPermission: 'everyone',
        allowExcessivelyViolentUsage: false,
        allowExcessivelySexualUsage: false,
        commercialUsage: 'corporation',
        allowPoliticalOrReligiousUsage: false,
        allowAntisocialOrHateUsage: false,
        creditNotation: 'unnecessary',
        allowRedistribution: true,
        modification: 'allowModificationRedistribution',
      },
      humanoid: { humanBones },
    },
  };
  json.asset.generator = 'gridcity-mirror make-placeholder-vrm';
}

async function exportGlb(scene) {
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(scene, { binary: true, onlyVisible: false });
  return Buffer.from(result);
}

for (const recipe of RECIPES) {
  const { scene } = buildCharacter(recipe);
  const glb = await exportGlb(scene);
  const { json, bin } = parseGlb(glb);
  addVrmExtension(json, recipe);
  const out = join(root, 'public', 'characters', recipe.id, 'model.vrm');
  mkdirSync(dirname(out), { recursive: true });
  const vrm = packGlb(json, bin);
  writeFileSync(out, vrm);
  const tris = json.meshes.reduce(
    (n, m) =>
      n + m.primitives.reduce((a, p) => a + json.accessors[p.indices ?? p.attributes.POSITION].count / 3, 0),
    0,
  );
  console.log(`wrote ${out} (${(vrm.length / 1024).toFixed(0)} KB, ~${Math.round(tris)} triangles)`);
}
