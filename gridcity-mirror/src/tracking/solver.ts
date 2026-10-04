// Landmarks → VRM bone rotations.
//
// kalidokit was tried first and replaced (see docs/PROGRESS.md). This is a direct solver
// that aims each bone at the tracked joint positions. Limbs are solved as hinges — the upper bone is
// oriented so the elbow/knee bend axis lines up with the real one, and the lower bone only bends
// around that axis — so real skinned characters don't get twisted elbows.
//
// Coordinates: MediaPipe world landmarks are metres, origin between the hips, x → image right,
// y ↓, z → away from the camera. Avatar space is VRM 1.0 normalised: x → avatar's left,
// y ↑, z → avatar's front (towards the viewer). Mirror mode reflects the guest so their right hand
// drives the arm on the right side of the screen (the avatar's left arm), like a mirror.
import { Matrix4, Quaternion, Vector3 } from 'three';

export type BoneName =
  | 'hips'
  | 'spine'
  | 'chest'
  | 'neck'
  | 'head'
  | 'leftUpperArm'
  | 'leftLowerArm'
  | 'leftHand'
  | 'rightUpperArm'
  | 'rightLowerArm'
  | 'rightHand'
  | 'leftUpperLeg'
  | 'leftLowerLeg'
  | 'leftFoot'
  | 'rightUpperLeg'
  | 'rightLowerLeg'
  | 'rightFoot';

export interface LandmarkLike {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export interface SolveOptions {
  mirror: boolean;
  /** Legs are only driven when this is true (decided with hysteresis by the caller). */
  legsVisible: boolean;
  /** Minimum visibility for a joint to count as seen. */
  minVisibility?: number;
}

export interface PoseSolution {
  /** Local rotations for normalised VRM bones. Bones not listed should ease back to neutral. */
  rotations: Partial<Record<BoneName, Quaternion>>;
  /** Guest's horizontal position on screen, -1 (left edge) … 1 (right edge). */
  screenX: number;
}

/** MediaPipe landmark indices for one body side. */
interface Side {
  shoulder: number;
  elbow: number;
  wrist: number;
  pinky: number;
  index: number;
  hip: number;
  knee: number;
  ankle: number;
  heel: number;
  foot: number;
  ear: number;
}

const PERSON_LEFT: Side = {
  shoulder: 11,
  elbow: 13,
  wrist: 15,
  pinky: 17,
  index: 19,
  hip: 23,
  knee: 25,
  ankle: 27,
  heel: 29,
  foot: 31,
  ear: 7,
};
const PERSON_RIGHT: Side = {
  shoulder: 12,
  elbow: 14,
  wrist: 16,
  pinky: 18,
  index: 20,
  hip: 24,
  knee: 26,
  ankle: 28,
  heel: 30,
  foot: 32,
  ear: 8,
};
const NOSE = 0;

const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);

/** The nose sits below the ear line; this pitches a neutral head back to level. */
export const HEAD_PITCH_OFFSET = 0.32;

/** Which landmarks drive the avatar's left / right side. */
export function sidesFor(mirror: boolean): { L: Side; R: Side } {
  return mirror ? { L: PERSON_RIGHT, R: PERSON_LEFT } : { L: PERSON_LEFT, R: PERSON_RIGHT };
}

/** MediaPipe world landmark → avatar space. */
export function toAvatarSpace(p: LandmarkLike, mirror: boolean): Vector3 {
  return new Vector3(mirror ? -p.x : p.x, -p.y, -p.z);
}

/** Rotation whose X axis is `x` and whose Y axis is as close as possible to `yHint`. */
export function frameQuat(x: Vector3, yHint: Vector3): Quaternion {
  const xa = x.clone().normalize();
  const z = new Vector3().crossVectors(xa, yHint).normalize();
  const y = new Vector3().crossVectors(z, xa);
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(xa, y, z));
}

/**
 * Rotation that maps rest axis `a` → target `u` and rest axis `b` (⟂ a) → `h` (⟂ u).
 * Used so a limb points along `u` with its hinge axis on `h`.
 */
export function pairQuat(a: Vector3, b: Vector3, u: Vector3, h: Vector3): Quaternion {
  const rest = new Matrix4().makeBasis(a, b, new Vector3().crossVectors(a, b));
  const tgt = new Matrix4().makeBasis(u, h, new Vector3().crossVectors(u, h));
  return new Quaternion().setFromRotationMatrix(tgt.multiply(rest.transpose()));
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Limits a rotation to `max` radians (protects against tracking glitches flipping a joint). */
export function clampAngle(q: Quaternion, max: number): Quaternion {
  const angle = 2 * Math.acos(Math.min(1, Math.abs(q.w)));
  if (angle <= max) return q;
  return new Quaternion().slerp(q, max / angle);
}

interface Hinge {
  upperWorld: Quaternion;
  upperLocal: Quaternion;
  lowerLocal: Quaternion;
  lowerWorld: Quaternion;
}

/**
 * Solves a two-bone limb (shoulder→elbow→wrist or hip→knee→ankle).
 * @param restAxis   bone direction in the T-pose (e.g. +X for the left arm)
 * @param restHinge  bend axis in the T-pose such that bending moves the limb the natural way
 * @param naturalBend direction the lower bone swings toward when bending (in avatar space)
 */
function solveHinge(
  a: Vector3,
  b: Vector3,
  c: Vector3 | null,
  parentWorld: Quaternion,
  restAxis: Vector3,
  restHinge: Vector3,
  naturalBend: Vector3,
): Hinge {
  const u = b.clone().sub(a).normalize();
  const f = c ? c.clone().sub(b).normalize() : u.clone();

  // Default hinge: the one that would bend the limb the natural way (forearm forward, shin back).
  let hDefault = new Vector3().crossVectors(u, naturalBend);
  if (hDefault.lengthSq() < 1e-4) hDefault = restHinge.clone().applyQuaternion(parentWorld);
  hDefault.normalize();
  const hData = new Vector3().crossVectors(u, f);
  const bend = hData.length(); // sin of the bend angle
  if (bend > 1e-6) hData.divideScalar(bend);
  // Use the measured hinge once the limb is clearly bent; keep the natural one when it's straight.
  const w = smoothstep(0.15, 0.45, bend);
  const h = hDefault.multiplyScalar(1 - w).add(hData.multiplyScalar(w));
  h.sub(u.clone().multiplyScalar(h.dot(u)));
  if (h.lengthSq() < 1e-8) h.copy(new Vector3().crossVectors(u, Math.abs(u.y) < 0.9 ? Y : Z));
  h.normalize();

  const upperWorld = pairQuat(restAxis, restHinge, u, h);
  const upperLocal = parentWorld.clone().invert().multiply(upperWorld);
  const theta = Math.atan2(new Vector3().crossVectors(u, f).dot(h), u.dot(f));
  const hingeWorld = upperWorld.clone().multiply(new Quaternion().setFromAxisAngle(restHinge, theta));
  // When the limb is nearly straight the natural hinge can be slightly off the measured bend;
  // a small residual swing puts the lower bone exactly on target.
  const reached = restAxis.clone().applyQuaternion(hingeWorld);
  const lowerWorld = new Quaternion().setFromUnitVectors(reached, f).multiply(hingeWorld);
  const lowerLocal = upperWorld.clone().invert().multiply(lowerWorld);
  return { upperWorld, upperLocal, lowerLocal, lowerWorld };
}

export function solvePose(
  world: readonly LandmarkLike[],
  image: readonly LandmarkLike[],
  opts: SolveOptions,
): PoseSolution {
  const minVis = opts.minVisibility ?? 0.5;
  const P = world.map((p) => toAvatarSpace(p, opts.mirror));
  const vis = (i: number) => image[i]?.visibility ?? world[i]?.visibility ?? 1;
  const { L, R } = sidesFor(opts.mirror);
  const rot: Partial<Record<BoneName, Quaternion>> = {};

  // ---- torso ------------------------------------------------------------------
  const shoulderMid = P[L.shoulder].clone().add(P[R.shoulder]).multiplyScalar(0.5);
  const hipMid = P[L.hip].clone().add(P[R.hip]).multiplyScalar(0.5);
  const spineUp = shoulderMid.clone().sub(hipMid).normalize();
  const shoulderAxis = P[L.shoulder].clone().sub(P[R.shoulder]);
  // Without visible hips the estimated hip points are guesses: keep the spine mostly upright.
  const up = opts.legsVisible ? spineUp : spineUp.clone().lerp(Y, 0.6).normalize();
  const chestWorld = frameQuat(shoulderAxis, up);

  let hipsWorld: Quaternion;
  if (opts.legsVisible) {
    hipsWorld = frameQuat(P[L.hip].clone().sub(P[R.hip]), up.clone().lerp(Y, 0.5).normalize());
  } else {
    // Follow only half of the chest's turn so the standing character stays planted.
    const fwd = Z.clone().applyQuaternion(chestWorld);
    const yaw = Math.atan2(fwd.x, fwd.z);
    hipsWorld = new Quaternion().setFromAxisAngle(Y, yaw * 0.5);
  }
  rot.hips = hipsWorld;
  const torso = hipsWorld.clone().invert().multiply(chestWorld);
  const spine = new Quaternion().slerp(torso, 0.5);
  rot.spine = spine;
  rot.chest = spine.clone().invert().multiply(torso);

  // ---- head -----------------------------------------------------------------
  const earMid = P[L.ear].clone().add(P[R.ear]).multiplyScalar(0.5);
  const fwd = P[NOSE].clone().sub(earMid);
  const earAxis = P[L.ear].clone().sub(P[R.ear]).normalize();
  fwd.sub(earAxis.clone().multiplyScalar(fwd.dot(earAxis))).normalize();
  const headY = new Vector3().crossVectors(fwd, earAxis);
  const headRaw = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(earAxis, headY, fwd));
  const headWorld = headRaw.multiply(new Quaternion().setFromAxisAngle(X, -HEAD_PITCH_OFFSET));
  const headRel = clampAngle(chestWorld.clone().invert().multiply(headWorld), 1.2);
  rot.neck = new Quaternion().slerp(headRel, 0.4);
  rot.head = rot.neck.clone().invert().multiply(headRel);

  // ---- arms -----------------------------------------------------------------
  const front = Z.clone().applyQuaternion(chestWorld);
  for (const [side, S, restAxis, restHinge] of [
    ['left', L, X, new Vector3(0, -1, 0)],
    ['right', R, new Vector3(-1, 0, 0), Y],
  ] as const) {
    if (vis(S.shoulder) < minVis || vis(S.elbow) < minVis) continue;
    const wristSeen = vis(S.wrist) >= minVis * 0.8;
    const arm = solveHinge(
      P[S.shoulder],
      P[S.elbow],
      wristSeen ? P[S.wrist] : null,
      chestWorld,
      restAxis,
      restHinge,
      front,
    );
    rot[`${side}UpperArm`] = arm.upperLocal;
    if (!wristSeen) continue;
    rot[`${side}LowerArm`] = arm.lowerLocal;

    // Hand: points from wrist to the knuckles; index→pinky sets the palm roll.
    if (vis(S.index) >= minVis * 0.6 && vis(S.pinky) >= minVis * 0.6) {
      const knuckles = P[S.index].clone().add(P[S.pinky]).multiplyScalar(0.5);
      const dir = knuckles.sub(P[S.wrist]).normalize();
      const across = P[S.index].clone().sub(P[S.pinky]);
      across.sub(dir.clone().multiplyScalar(across.dot(dir)));
      if (across.lengthSq() > 1e-8) {
        const handWorld = pairQuat(restAxis, Z, dir, across.normalize());
        rot[`${side}Hand`] = clampAngle(arm.lowerWorld.clone().invert().multiply(handWorld), 1.3);
      }
    }
  }

  // ---- legs (only when we can really see them) ------------------------------------
  if (opts.legsVisible) {
    const back = Z.clone().applyQuaternion(hipsWorld).negate();
    for (const [side, S] of [
      ['left', L],
      ['right', R],
    ] as const) {
      const ankleSeen = vis(S.ankle) >= minVis;
      const leg = solveHinge(
        P[S.hip],
        P[S.knee],
        ankleSeen ? P[S.ankle] : null,
        hipsWorld,
        new Vector3(0, -1, 0),
        X,
        back,
      );
      rot[`${side}UpperLeg`] = leg.upperLocal;
      if (!ankleSeen) continue;
      rot[`${side}LowerLeg`] = leg.lowerLocal;
      if (vis(S.heel) >= minVis * 0.6 && vis(S.foot) >= minVis * 0.6) {
        const toes = P[S.foot].clone().sub(P[S.heel]).normalize();
        const local = toes.applyQuaternion(leg.lowerWorld.clone().invert());
        // Feet are noisy: apply half of the measured turn.
        rot[`${side}Foot`] = new Quaternion().slerp(new Quaternion().setFromUnitVectors(Z, local), 0.5);
      }
    }
  }

  // ---- position on screen -------------------------------------------------------------
  const sx = ((image[11]?.x ?? 0.5) + (image[12]?.x ?? 0.5)) / 2;
  const screenX = Math.max(-1, Math.min(1, ((opts.mirror ? 1 - sx : sx) - 0.5) * 2));

  return { rotations: rot, screenX };
}

/** Hysteresis for "are the legs in view?" so the character doesn't flicker between modes. */
export class LegVisibility {
  visible = false;
  private since = 0;

  update(lms: readonly LandmarkLike[], nowMs: number): boolean {
    const v = Math.min(...[23, 24, 25, 26].map((i) => lms[i]?.visibility ?? 0));
    const want = this.visible ? v > 0.35 : v > 0.65;
    if (want === this.visible) this.since = nowMs;
    else if (nowMs - this.since > 300) {
      this.visible = want;
      this.since = nowMs;
    }
    return this.visible;
  }
}
