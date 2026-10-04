// VRM loading and driving a character's bones from the pose solver.
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GripStyle, PropSpec } from '../characters/catalog';
import {
  FINGER_CHAINS,
  fingerRotations,
  gripRotations,
  pairQuat,
  type BoneName,
  type PoseSolution,
} from '../tracking/solver';
import { makeSpotlightDisc } from './scene';

export type { VRM };

const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));

export async function loadVrm(url: string): Promise<VRM> {
  const gltf = await loader.loadAsync(url);
  const vrm = gltf.userData.vrm as VRM | undefined;
  if (!vrm) throw new Error(`${url} is not a VRM file`);
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.combineSkeletons(gltf.scene);
  VRMUtils.rotateVRM0(vrm); // no-op for VRM 1.0; turns VRM 0.x models to face the camera
  vrm.scene.traverse((o) => {
    o.frustumCulled = false;
  });
  return vrm;
}

/** Rough size check against the per-model budget in docs/CHARACTER_PACKS.md. */
export function modelStats(vrm: VRM): { triangles: number; textures: number; maxTextureSize: number } {
  let triangles = 0;
  const textures = new Set<THREE.Texture>();
  vrm.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const g = mesh.geometry;
    triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      for (const v of Object.values(m)) if ((v as THREE.Texture)?.isTexture) textures.add(v as THREE.Texture);
    }
  });
  let maxTextureSize = 0;
  for (const t of textures) {
    const img = t.image as { width?: number; height?: number } | undefined;
    maxTextureSize = Math.max(maxTextureSize, img?.width ?? 0, img?.height ?? 0);
  }
  return { triangles: Math.round(triangles), textures: textures.size, maxTextureSize };
}

/** A simple code-driven wave + breathing so the GPU does real skinning work (benchmark / idle). */
export function animateWave(vrm: VRM, t: number): void {
  const h = vrm.humanoid;
  const set = (name: Parameters<typeof h.getNormalizedBoneNode>[0], x: number, y: number, z: number) => {
    h.getNormalizedBoneNode(name)?.rotation.set(x, y, z);
  };
  set('spine', 0, Math.sin(t * 0.8) * 0.08, Math.sin(t * 1.1) * 0.03);
  set('chest', Math.sin(t * 1.6) * 0.02, 0, 0);
  set('head', Math.sin(t * 0.7) * 0.08, Math.sin(t * 0.5) * 0.25, 0);
  set('leftUpperArm', 0, 0, -1.1 + Math.sin(t * 1.3) * 0.05);
  set('leftLowerArm', 0, -0.3, 0);
  set('rightUpperArm', 0, 0, 1.0 + Math.sin(t * 2) * 0.25);
  set('rightLowerArm', 0, 0, 1.2 + Math.sin(t * 6) * 0.5);
  set('leftUpperLeg', 0, 0, 0.04);
  set('rightUpperLeg', 0, 0, -0.04);
  vrm.update(1 / 60);
}

// ---------------------------------------------------------------------------------------------
// Driving a character from the solver
// ---------------------------------------------------------------------------------------------
const DRIVEN: BoneName[] = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'leftUpperArm',
  'leftLowerArm',
  'leftHand',
  'rightUpperArm',
  'rightLowerArm',
  'rightHand',
  'leftUpperLeg',
  'leftLowerLeg',
  'leftFoot',
  'rightUpperLeg',
  'rightLowerLeg',
  'rightFoot',
];

const q = (axis: THREE.Vector3, angle: number) => new THREE.Quaternion().setFromAxisAngle(axis, angle);
const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);

/** Relaxed standing pose (arms down, slight elbow bend) used when a body part isn't tracked. */
const NEUTRAL: Partial<Record<BoneName, THREE.Quaternion>> = {
  leftUpperArm: q(AZ, -1.25),
  rightUpperArm: q(AZ, 1.25),
  leftLowerArm: q(AY, -0.2),
  rightLowerArm: q(AY, 0.2),
};

/** Target height (metres) every character is scaled to, so swaps don't jump in size. */
const TARGET_HEIGHT = 1.72;

type Side = 'left' | 'right';
const SIDES: Side[] = ['left', 'right'];

const gltfLoader = new GLTFLoader();

export class Avatar {
  /** Moves sideways with the guest. Contains the VRM and its floor glow. */
  readonly root = new THREE.Group();
  private current = new Map<BoneName, THREE.Quaternion>();
  private target: PoseSolution | null = null;
  private x = 0;
  /** Each finger bone's rest direction (towards its child), per avatar side. */
  private fingerRest: Record<Side, Record<string, THREE.Vector3>> = { left: {}, right: {} };
  private fingerCurrent: Record<Side, Map<string, THREE.Quaternion>> = { left: new Map(), right: new Map() };
  /** Grip held by each avatar hand (when it carries a prop). */
  private grips: Partial<Record<Side, GripStyle>> = {};
  readonly props: THREE.Object3D[] = [];

  private constructor(readonly vrm: VRM) {
    this.root.add(vrm.scene);
    this.root.add(makeSpotlightDisc());
    for (const b of DRIVEN) this.current.set(b, (NEUTRAL[b] ?? new THREE.Quaternion()).clone());
    // Normalise size from the rest pose: head height ≈ 0.91 × body height.
    vrm.scene.updateMatrixWorld(true);
    const head = vrm.humanoid.getNormalizedBoneNode('head');
    const headY = head ? head.getWorldPosition(new THREE.Vector3()).y : TARGET_HEIGHT * 0.91;
    const scale = headY > 0.1 ? (TARGET_HEIGHT * 0.91) / headY : 1;
    vrm.scene.scale.setScalar(scale);

    for (const side of SIDES) {
      for (const chain of FINGER_CHAINS) {
        chain.forEach((name, i) => {
          const node = this.boneNode(`${side}${name}`);
          if (!node) return;
          // Direction to the next joint; the last segment continues its parent's direction.
          const next = i < chain.length - 1 ? this.boneNode(`${side}${chain[i + 1]}`) : null;
          const dir = (next ? next.position : node.position).clone();
          if (dir.lengthSq() > 1e-10) this.fingerRest[side][name] = dir.normalize();
        });
      }
    }
  }

  private boneNode(name: string): THREE.Object3D | null {
    return this.vrm.humanoid.getNormalizedBoneNode(
      name as Parameters<VRM['humanoid']['getNormalizedBoneNode']>[0],
    );
  }

  /**
   * Puts props in the character's hands. `spec.hand` is the GUEST's hand; with mirroring that is the
   * avatar's opposite hand (the one on the same side of the screen as the guest's hand).
   */
  async addProps(specs: PropSpec[], mirror: boolean, resolveUrl: (p: string) => string): Promise<string[]> {
    const errors: string[] = [];
    for (const spec of specs) {
      const side: Side = mirror ? (spec.hand === 'left' ? 'right' : 'left') : spec.hand;
      const hand = this.boneNode(`${side}Hand`);
      if (!hand) {
        errors.push(`prop ${spec.model}: character has no ${side} hand bone`);
        continue;
      }
      try {
        const gltf = await gltfLoader.loadAsync(resolveUrl(spec.model));
        const prop = gltf.scene;
        prop.name = `prop:${spec.model}`;
        prop.traverse((o) => (o.frustumCulled = false));
        this.placeInHand(prop, side, spec);
        hand.add(prop);
        this.props.push(prop);
        this.grips[side] = spec.grip;
      } catch (err) {
        errors.push(`prop ${spec.model} failed to load: ${(err as Error).message}`);
      }
    }
    return errors;
  }

  /** Prop files have the grip at the origin, forward along +Z, top along +Y (see catalog.ts). */
  private placeInHand(prop: THREE.Object3D, side: Side, spec: PropSpec): void {
    const middle = this.boneNode(`${side}MiddleProximal`);
    const index = this.boneNode(`${side}IndexProximal`);
    const little = this.boneNode(`${side}LittleProximal`);
    // Forward = wrist → knuckles; thumb side = little → index knuckle (+Z in the VRM T-pose).
    const forward = middle
      ? middle.position.clone()
      : new THREE.Vector3(side === 'left' ? 0.09 : -0.09, 0, 0);
    const palmLength = forward.length();
    forward.normalize();
    const thumbSide =
      index && little ? index.position.clone().sub(little.position) : new THREE.Vector3(0, 0, 1);
    thumbSide.sub(forward.clone().multiplyScalar(thumbSide.dot(forward)));
    if (thumbSide.lengthSq() < 1e-10) thumbSide.set(0, 0, 1);
    thumbSide.normalize();
    const palm = new THREE.Vector3(0, -1, 0);

    const align = pairQuat(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), forward, thumbSide);
    const deg = THREE.MathUtils.degToRad;
    const tweak = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(deg(spec.rotation[0]), deg(spec.rotation[1]), deg(spec.rotation[2])),
    );
    prop.quaternion.copy(align.multiply(tweak));
    // Sit the grip in the middle of the palm, just below it.
    prop.position
      .copy(forward.multiplyScalar(palmLength * 0.55))
      .add(palm.multiplyScalar(palmLength * 0.3))
      .add(new THREE.Vector3(...spec.position));
    prop.scale.setScalar(spec.scale);
  }

  static async load(url: string): Promise<Avatar> {
    return new Avatar(await loadVrm(url));
  }

  /** Latest tracking result, or null when nobody is there (character relaxes to idle). */
  setTarget(sol: PoseSolution | null): void {
    this.target = sol;
  }

  /**
   * @param dt seconds since last frame
   * @param smoothing config.smoothing (0..1) — higher is calmer but laggier
   * @param halfWidth how far (metres) the character may walk sideways
   */
  update(dt: number, t: number, smoothing: number, halfWidth: number): void {
    const h = this.vrm.humanoid;
    const tracked = this.target !== null;
    // Exponential approach: frame-rate independent. Tracked bones follow fast; untracked ones relax.
    const followRate = 26 - 16 * smoothing;
    const relaxRate = 4;
    const breathe = Math.sin(t * 1.6) * 0.015;

    for (const b of DRIVEN) {
      let goal = this.target?.rotations[b];
      let rate = followRate;
      if (!goal) {
        goal = NEUTRAL[b] ?? new THREE.Quaternion();
        rate = relaxRate;
        if (!tracked && (b === 'spine' || b === 'chest')) goal = goal.clone().multiply(q(AX, breathe));
        if (!tracked && b === 'head') goal = q(AY, Math.sin(t * 0.5) * 0.12);
      }
      const cur = this.current.get(b)!;
      cur.slerp(goal, 1 - Math.exp(-rate * dt));
      h.getNormalizedBoneNode(b)?.quaternion.copy(cur);
    }

    // Fingers: hold the grip for props, follow tracked fingers otherwise, relax when unknown.
    for (const side of SIDES) {
      const rest = this.fingerRest[side];
      const grip = this.grips[side];
      const hand = this.target?.hands[side];
      const goals = grip
        ? gripRotations(grip, rest)
        : hand
          ? fingerRotations(hand, rest)
          : gripRotations('relaxed', rest);
      const rate = hand && !grip ? followRate : relaxRate * 2;
      for (const [name, goal] of Object.entries(goals)) {
        let cur = this.fingerCurrent[side].get(name);
        if (!cur) this.fingerCurrent[side].set(name, (cur = goal.clone()));
        cur.slerp(goal, 1 - Math.exp(-rate * dt));
        this.boneNode(`${side}${name}`)?.quaternion.copy(cur);
      }
    }

    const maxX = Math.max(0, halfWidth - 0.3);
    const goalX = tracked ? this.target!.screenX * maxX : 0;
    this.x += (goalX - this.x) * (1 - Math.exp(-(tracked ? 6 : 2) * dt));
    this.root.position.x = this.x;
    this.vrm.update(dt);
  }

  dispose(): void {
    this.root.removeFromParent();
    VRMUtils.deepDispose(this.vrm.scene);
  }
}
