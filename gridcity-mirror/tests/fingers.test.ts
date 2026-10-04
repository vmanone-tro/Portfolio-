import { Object3D, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { fingerRotations, FINGER_CHAINS, gripRotations, solvePose } from '../src/tracking/solver';
import { makeHand, makePose } from '../src/tracking/synthetic';

// Left arm + hand of a normalised T-pose rig, same layout as the placeholder character.
type Def = [string, string | null, [number, number, number]];
const BASE: Def[] = [
  ['hips', null, [0, 0.95, 0]],
  ['spine', 'hips', [0, 1.05, 0]],
  ['chest', 'spine', [0, 1.2, 0]],
  ['leftUpperArm', 'chest', [0.19, 1.41, 0]],
  ['leftLowerArm', 'leftUpperArm', [0.45, 1.41, 0]],
  ['leftHand', 'leftLowerArm', [0.69, 1.41, 0]],
];
const FINGERS: Array<[string, number, number[]]> = [
  ['Index', 0.03, [0.038, 0.026, 0.022]],
  ['Middle', 0.01, [0.042, 0.028, 0.024]],
  ['Ring', -0.011, [0.038, 0.026, 0.022]],
  ['Little', -0.03, [0.03, 0.02, 0.018]],
];
const DEFS: Def[] = [...BASE];
for (const [f, z, lens] of FINGERS) {
  let x = 0.785;
  ['Proximal', 'Intermediate', 'Distal', 'Tip'].forEach((j, i) => {
    DEFS.push([
      `left${f}${j}`,
      i === 0 ? 'leftHand' : `left${f}${['Proximal', 'Intermediate', 'Distal'][i - 1]}`,
      [x, 1.405, z],
    ]);
    x += lens[i] ?? 0;
  });
}
const thumb: Array<[string, [number, number, number]]> = [
  ['ThumbMetacarpal', [0.705, 1.398, 0.035]],
  ['ThumbProximal', [0.733, 1.396, 0.062]],
  ['ThumbDistal', [0.755, 1.394, 0.08]],
  ['ThumbTip', [0.775, 1.392, 0.095]],
];
thumb.forEach(([n, p], i) => DEFS.push([`left${n}`, i === 0 ? 'leftHand' : `left${thumb[i - 1][0]}`, p]));

function rig() {
  const nodes = new Map<string, Object3D>();
  const wp = new Map<string, Vector3>();
  for (const [name, parent, pos] of DEFS) {
    const o = new Object3D();
    const w = new Vector3(...pos);
    wp.set(name, w);
    if (parent) {
      o.position.copy(w.clone().sub(wp.get(parent)!));
      nodes.get(parent)!.add(o);
    } else o.position.copy(w);
    nodes.set(name, o);
  }
  // Rest directions the way the avatar computes them: towards the child bone.
  const rest: Record<string, Vector3> = {};
  for (const chain of FINGER_CHAINS) {
    chain.forEach((name, i) => {
      const next = i < chain.length - 1 ? chain[i + 1] : name.replace('Distal', 'Tip');
      rest[name] = nodes.get(`left${next}`)!.position.clone().normalize();
    });
  }
  return { nodes, rest };
}

const GUEST_ARM = { raise: Math.PI / 2, fore: Math.PI / 2 }; // the guest's right arm straight out

describe('finger tracking', () => {
  for (const [label, curl] of [
    ['open hand', [0.05, 0.05, 0.05, 0.05, 0.05]],
    ['fist', [0.6, 1.3, 1.3, 1.3, 1.3]],
    ['pointing', [0.4, 0.05, 1.3, 1.3, 1.3]],
  ] as const) {
    it(`${label}: every finger segment points where the guest's finger points (within 4°)`, () => {
      const { world, image } = makePose({ left: { raise: 0.1, fore: 0.1 }, right: GUEST_ARM });
      // Guest's right hand, palm down, thumb towards the camera.
      const hand = makeHand({ dir: [-1, 0, 0], across: [0, 0, -1], palm: [0, 1, 0], curl: [...curl] });
      const sol = solvePose(world, image, {
        mirror: true,
        legsVisible: true,
        hands: { right: { world: hand } },
      });
      const h = sol.hands.left; // mirrored: guest's right hand → avatar's left
      expect(h).toBeDefined();
      const { nodes, rest } = rig();
      for (const [name, q] of Object.entries(sol.rotations))
        nodes.get(name)?.quaternion.copy(q as Quaternion);
      for (const [name, q] of Object.entries(fingerRotations(h!, rest)))
        nodes.get(`left${name}`)!.quaternion.copy(q);
      nodes.get('hips')!.updateMatrixWorld(true);
      for (const chain of FINGER_CHAINS) {
        chain.forEach((name, i) => {
          const next = i < chain.length - 1 ? chain[i + 1] : name.replace('Distal', 'Tip');
          const a = nodes.get(`left${name}`)!.getWorldPosition(new Vector3());
          const b = nodes.get(`left${next}`)!.getWorldPosition(new Vector3());
          const got = b.sub(a).normalize();
          expect((got.angleTo(h!.fingers[name]) * 180) / Math.PI, name).toBeLessThan(4);
        });
      }
    });
  }

  it('a fist grip curls the fingertips under the palm', () => {
    const { nodes, rest } = rig();
    for (const [name, q] of Object.entries(gripRotations('fist', rest)))
      nodes.get(`left${name}`)!.quaternion.copy(q);
    nodes.get('hips')!.updateMatrixWorld(true);
    const hand = nodes.get('leftHand')!.getWorldPosition(new Vector3());
    const tip = nodes.get('leftMiddleTip')!.getWorldPosition(new Vector3());
    expect(tip.y).toBeLessThan(hand.y - 0.02);
  });

  it('the pistol grip keeps the trigger finger out', () => {
    const { nodes, rest } = rig();
    for (const [name, q] of Object.entries(gripRotations('pistol', rest)))
      nodes.get(`left${name}`)!.quaternion.copy(q);
    nodes.get('hips')!.updateMatrixWorld(true);
    const at = (n: string) => nodes.get(n)!.getWorldPosition(new Vector3());
    expect(at('leftIndexTip').x).toBeGreaterThan(at('leftMiddleTip').x + 0.02);
  });

  it('falls back gracefully with no hand data', () => {
    const { world, image } = makePose({ left: GUEST_ARM, right: GUEST_ARM });
    expect(solvePose(world, image, { mirror: true, legsVisible: true }).hands).toEqual({});
  });
});
