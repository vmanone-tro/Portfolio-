import { Object3D, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { solvePose, sidesFor, toAvatarSpace, type BoneName } from '../src/tracking/solver';
import { makePose, mockPose, type BodySpec } from '../src/tracking/synthetic';

// A normalised VRM-like rig (T-pose, identity rest rotations), same layout as the placeholder model.
const BONES: Array<[string, string | null, [number, number, number]]> = [
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
  ['rightUpperLeg', 'hips', [-0.1, 0.9, 0]],
  ['rightLowerLeg', 'rightUpperLeg', [-0.1, 0.5, 0]],
  ['rightFoot', 'rightLowerLeg', [-0.1, 0.09, 0]],
];

function rig() {
  const nodes = new Map<string, Object3D>();
  const worldPos = new Map<string, Vector3>();
  for (const [name, parent, pos] of BONES) {
    const o = new Object3D();
    const w = new Vector3(...pos);
    worldPos.set(name, w);
    if (parent) {
      o.position.copy(w.clone().sub(worldPos.get(parent)!));
      nodes.get(parent)!.add(o);
    } else o.position.copy(w);
    nodes.set(name, o);
  }
  return nodes;
}

function pose(spec: BodySpec, mirror = true) {
  const { world, image } = makePose(spec);
  const sol = solvePose(world, image, { mirror, legsVisible: spec.legsVisible ?? true });
  const nodes = rig();
  for (const [name, q] of Object.entries(sol.rotations)) nodes.get(name)!.quaternion.copy(q as Quaternion);
  nodes.get('hips')!.updateMatrixWorld(true);
  const at = (n: string) => nodes.get(n)!.getWorldPosition(new Vector3());
  const P = world.map((p) => toAvatarSpace(p, mirror));
  return { sol, at, P, sides: sidesFor(mirror), nodes };
}

const dir = (a: Vector3, b: Vector3) => b.clone().sub(a).normalize();
const deg = (a: Vector3, b: Vector3) => (a.angleTo(b) * 180) / Math.PI;

const SPECS: Record<string, BodySpec> = {
  tpose: {
    left: { raise: Math.PI / 2, fore: Math.PI / 2 },
    right: { raise: Math.PI / 2, fore: Math.PI / 2 },
  },
  armsDown: { left: { raise: 0.1, fore: 0.1 }, right: { raise: 0.1, fore: 0.1 } },
  wave: { left: { raise: 0.2, fore: 0.3 }, right: { raise: 1.4, fore: 2.8 } },
  reachForward: {
    left: { raise: 1.2, fore: 1.5, forward: 0.7 },
    right: { raise: 0.6, fore: 2.2, forward: 0.4 },
  },
  leanTurn: { left: { raise: 2.5, fore: 2.0 }, right: { raise: 0.8, fore: 1.9 }, yaw: 0.4, lean: 0.15 },
};

describe('solvePose — the character lands where the guest is', () => {
  for (const [name, spec] of Object.entries(SPECS)) {
    for (const mirror of [true, false]) {
      it(`${name} (${mirror ? 'mirrored' : 'not mirrored'}): limb directions match within 3°`, () => {
        const { at, P, sides } = pose(spec, mirror);
        for (const side of ['left', 'right'] as const) {
          const S = side === 'left' ? sides.L : sides.R;
          expect(
            deg(dir(at(`${side}UpperArm`), at(`${side}LowerArm`)), dir(P[S.shoulder], P[S.elbow])),
          ).toBeLessThan(3);
          expect(
            deg(dir(at(`${side}LowerArm`), at(`${side}Hand`)), dir(P[S.elbow], P[S.wrist])),
          ).toBeLessThan(3);
          expect(
            deg(dir(at(`${side}UpperLeg`), at(`${side}LowerLeg`)), dir(P[S.hip], P[S.knee])),
          ).toBeLessThan(3);
          expect(deg(dir(at(`${side}LowerLeg`), at(`${side}Foot`)), dir(P[S.knee], P[S.ankle]))).toBeLessThan(
            3,
          );
        }
      });
    }
  }

  it('mirror: the guest raises their RIGHT hand → the arm on the right of the screen (avatar left, +X) goes up', () => {
    const { at } = pose({ left: { raise: 0.1, fore: 0.1 }, right: { raise: 2.9, fore: 3.0 } }, true);
    expect(at('leftHand').y).toBeGreaterThan(at('leftUpperArm').y + 0.3);
    expect(at('leftHand').x).toBeGreaterThan(0);
    expect(at('rightHand').y).toBeLessThan(at('rightUpperArm').y - 0.3);
  });

  it('no mirror: the guest raises their RIGHT hand → the avatar raises its right hand', () => {
    const { at } = pose({ left: { raise: 0.1, fore: 0.1 }, right: { raise: 2.9, fore: 3.0 } }, false);
    expect(at('rightHand').y).toBeGreaterThan(at('rightUpperArm').y + 0.3);
    expect(at('leftHand').y).toBeLessThan(at('leftUpperArm').y - 0.3);
  });

  it('elbows bend the natural way (no twisted upper arm) when the forearm comes forward', () => {
    const { sol } = pose(
      { left: { raise: 0.1, fore: 0.1 }, right: { raise: 0.1, fore: 1.2, forward: 0.8 } },
      true,
    );
    // Mirrored: guest's right arm = avatar's left arm. Upper arm hangs down, so it should be
    // rotated mostly about Z (swing down from the T-pose), not twisted about its own length.
    const q = sol.rotations.leftUpperArm!;
    const twistAxis = new Vector3(1, 0, 0).applyQuaternion(q); // bone direction after rotation
    expect(twistAxis.y).toBeLessThan(-0.9);
    // The bend axis stays roughly horizontal-sideways, i.e. the elbow faces backwards.
    const hinge = new Vector3(0, -1, 0).applyQuaternion(q);
    expect(Math.abs(hinge.y)).toBeLessThan(0.35);
  });

  it('looks straight ahead when the guest does (head rotation < 15°)', () => {
    const { sol } = pose(SPECS.armsDown);
    const total = sol.rotations.neck!.clone().multiply(sol.rotations.head!);
    expect((2 * Math.acos(Math.min(1, Math.abs(total.w))) * 180) / Math.PI).toBeLessThan(15);
  });

  it('turns the head the same way as the guest, mirrored', () => {
    // Guest turns to their own left; in a mirror their face turns towards the screen's left (−X).
    const { nodes } = pose({ ...SPECS.armsDown, yaw: 0.5 }, true);
    const face = new Vector3(0, 0, 1).applyQuaternion(
      nodes.get('head')!.getWorldQuaternion(new Quaternion()),
    );
    expect(face.x).toBeLessThan(-0.2);
  });

  it('upper-body only: legs are left alone and the hips stay upright', () => {
    const { sol } = pose({ ...SPECS.wave, legsVisible: false });
    expect(sol.rotations.leftUpperLeg).toBeUndefined();
    expect(sol.rotations.rightLowerLeg).toBeUndefined();
    const up = new Vector3(0, 1, 0).applyQuaternion(sol.rotations.hips!);
    expect(up.y).toBeGreaterThan(0.99);
  });

  it('reports the guest position on screen, mirrored', () => {
    const left = makePose({ ...SPECS.armsDown, imageX: 0.2 });
    expect(solvePose(left.world, left.image, { mirror: true, legsVisible: true }).screenX).toBeGreaterThan(
      0.4,
    );
    expect(solvePose(left.world, left.image, { mirror: false, legsVisible: true }).screenX).toBeLessThan(
      -0.4,
    );
  });

  it('never produces NaN, even for degenerate input', () => {
    const flat = makePose(SPECS.armsDown);
    const squashed = flat.world.map(() => ({ x: 0, y: 0, z: 0, visibility: 1 }));
    const sol = solvePose(squashed, flat.image, { mirror: true, legsVisible: true });
    for (const q of Object.values(sol.rotations) as Quaternion[]) {
      expect([q.x, q.y, q.z, q.w].every(Number.isFinite)).toBe(true);
    }
    for (let t = 0; t < 10; t += 0.37) {
      const m = mockPose('dance', t);
      const s = solvePose(m.world, m.image, { mirror: true, legsVisible: true });
      for (const [k, q] of Object.entries(s.rotations) as Array<[BoneName, Quaternion]>) {
        expect([q.x, q.y, q.z, q.w].every(Number.isFinite), k).toBe(true);
      }
    }
  });
});
