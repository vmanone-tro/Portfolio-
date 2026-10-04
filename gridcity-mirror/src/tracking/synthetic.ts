// Fake guests: MediaPipe-shaped landmarks for known poses. Used by unit tests and by `?mock=<pose>`
// (preview the character with no camera). Coordinates follow MediaPipe: world in metres, origin
// between the hips, x → image right (the person's LEFT side), y ↓, z → away from the camera.
import type { LandmarkLike } from './solver';

export interface SyntheticPose {
  world: LandmarkLike[];
  image: LandmarkLike[];
}

export interface ArmSpec {
  /** Upper-arm angle in the frontal plane: 0 = hanging down, π/2 = straight out sideways, π = up. */
  raise: number;
  /** Forearm angle in the frontal plane, same convention. */
  fore: number;
  /** How much the forearm points towards the camera (0..1). */
  forward?: number;
}

export interface BodySpec {
  left: ArmSpec;
  right: ArmSpec;
  /** Head turn, radians (positive = the person turns to their left). */
  yaw?: number;
  /** Sideways lean of the upper body, radians (positive = towards the person's left). */
  lean?: number;
  /** Where the person stands, 0..1 across the camera image. */
  imageX?: number;
  legsVisible?: boolean;
}

type V = [number, number, number];

const add = (a: V, b: V, s = 1): V => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const norm = (a: V): V => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

export function makePose(spec: BodySpec): SyntheticPose {
  const pts: V[] = Array.from({ length: 33 }, () => [0, 0, 0] as V);
  const lean = spec.lean ?? 0;
  // Rotate upper body points about the hip centre for leaning.
  const leanPt = (p: V): V => [
    p[0] * Math.cos(lean) - p[1] * Math.sin(lean),
    p[0] * Math.sin(lean) + p[1] * Math.cos(lean),
    p[2],
  ];

  const yaw = spec.yaw ?? 0;
  const headC: V = [0, -0.66, 0];
  const headPt = (dx: number, dy: number, dz: number): V =>
    leanPt([
      headC[0] + dx * Math.cos(yaw) - dz * Math.sin(yaw),
      headC[1] + dy,
      headC[2] + dx * Math.sin(yaw) + dz * Math.cos(yaw),
    ]);
  pts[0] = headPt(0, 0.02, -0.1); // nose
  for (const [i, dx] of [
    [1, 0.02],
    [2, 0.035],
    [3, 0.05],
    [4, -0.02],
    [5, -0.035],
    [6, -0.05],
  ] as const)
    pts[i] = headPt(dx, -0.01, -0.08);
  pts[7] = headPt(0.075, 0, 0); // left ear
  pts[8] = headPt(-0.075, 0, 0); // right ear
  pts[9] = headPt(0.025, 0.05, -0.08);
  pts[10] = headPt(-0.025, 0.05, -0.08);

  for (const [s, arm, sh, el, wr, pi, ix, th] of [
    [1, spec.left, 11, 13, 15, 17, 19, 21],
    [-1, spec.right, 12, 14, 16, 18, 20, 22],
  ] as const) {
    const S: V = [0.18 * s, -0.48, 0];
    const up: V = norm([s * Math.sin(arm.raise), Math.cos(arm.raise), 0]);
    const E = add(S, up, 0.27);
    const fwd = arm.forward ?? 0;
    const fd: V = norm([s * Math.sin(arm.fore) * (1 - fwd), Math.cos(arm.fore) * (1 - fwd), -fwd]);
    const W = add(E, fd, 0.25);
    // Palm faces the camera; index on the thumb side (towards the body midline when hanging).
    const across: V = norm([-s * Math.cos(arm.fore), Math.sin(arm.fore), 0]);
    pts[sh] = leanPt(S);
    pts[el] = leanPt(E);
    pts[wr] = leanPt(W);
    pts[ix] = leanPt(add(add(W, fd, 0.08), across, 0.025));
    pts[pi] = leanPt(add(add(W, fd, 0.07), across, -0.025));
    pts[th] = leanPt(add(add(W, fd, 0.04), across, 0.04));
  }

  for (const [s, hip, knee, ankle, heel, foot] of [
    [1, 23, 25, 27, 29, 31],
    [-1, 24, 26, 28, 30, 32],
  ] as const) {
    pts[hip] = [0.1 * s, 0, 0];
    pts[knee] = [0.1 * s, 0.42, -0.01];
    pts[ankle] = [0.1 * s, 0.84, 0];
    pts[heel] = [0.1 * s, 0.88, 0.04];
    pts[foot] = [0.1 * s, 0.9, -0.14];
  }

  const legsVis = spec.legsVisible ?? true;
  const cx = spec.imageX ?? 0.5;
  const world = pts.map(([x, y, z], i) => ({
    x,
    y,
    z,
    visibility: i >= 23 && !legsVis ? 0.1 : 0.99,
  }));
  const image = world.map((p) => ({
    x: cx + p.x / 2.2,
    y: 0.42 + p.y / 2.4,
    z: p.z,
    visibility: p.visibility,
  }));
  return { world, image };
}

const ARMS_DOWN: ArmSpec = { raise: 0.15, fore: 0.1 };

/** Animated poses for `?mock=<name>` previews. */
export function mockPose(name: string, t: number): SyntheticPose {
  switch (name) {
    case 'tpose':
      return makePose({
        left: { raise: Math.PI / 2, fore: Math.PI / 2 },
        right: { raise: Math.PI / 2, fore: Math.PI / 2 },
      });
    case 'arms-up':
      return makePose({ left: { raise: 2.7, fore: 2.9 }, right: { raise: 2.7, fore: 2.9 } });
    case 'upper-body':
      return makePose({
        left: ARMS_DOWN,
        right: { raise: 1.4, fore: 2.6 + Math.sin(t * 6) * 0.4 },
        legsVisible: false,
      });
    case 'dance':
      return makePose({
        left: { raise: 1.6 + Math.sin(t * 3) * 0.8, fore: 2 + Math.sin(t * 3 + 1) * 0.9, forward: 0.2 },
        right: { raise: 1.6 + Math.cos(t * 3) * 0.8, fore: 2 + Math.cos(t * 3 + 1) * 0.9, forward: 0.2 },
        yaw: Math.sin(t * 1.5) * 0.4,
        lean: Math.sin(t * 1.5) * 0.12,
        imageX: 0.5 + Math.sin(t * 0.7) * 0.15,
      });
    case 'wave':
    default:
      // The guest waves with their RIGHT hand.
      return makePose({
        left: ARMS_DOWN,
        right: { raise: 1.4, fore: 2.6 + Math.sin(t * 6) * 0.4 },
        yaw: Math.sin(t * 0.8) * 0.25,
      });
  }
}
