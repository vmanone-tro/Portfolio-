// Finger tracking (21 points per hand).
//
// At booth distance (2–3 m) a hand is only ~40 px tall in the camera picture — too small for
// MediaPipe's hand detector, which looks at a shrunken copy of the whole frame. So for every wrist
// the body tracker finds, we cut out a zoomed-in square around that hand and track the hand inside
// it. Each hand has its own tracker instance so its frame-to-frame tracking stays stable.
import { HandLandmarker, type Landmark, type NormalizedLandmark } from '@mediapipe/tasks-vision';
import { assetUrl } from '../config/settings';
import { visionFileset, type PosePerson } from './pose';

export const HAND_CONNECTIONS: ReadonlyArray<{ start: number; end: number }> =
  HandLandmarker.HAND_CONNECTIONS;

export interface HandObservation {
  /** 21 points normalised to the full camera image (same space as pose landmarks). */
  image: NormalizedLandmark[];
  /** 21 points in metres around the hand's centre, camera axes (x → image right, y ↓). */
  world: Landmark[];
  score: number;
}

/** Keyed by the PERSON's side (not the avatar's). */
export type HandPair = { left?: HandObservation; right?: HandObservation };

const CROP_PX = 256;

/** Pose landmark indices per person side: wrist, elbow, pinky, index. */
const SIDES = {
  left: { wrist: 15, elbow: 13, pinky: 17, index: 19 },
  right: { wrist: 16, elbow: 14, pinky: 18, index: 20 },
} as const;

export interface CropRect {
  /** Top-left corner and side length, in video pixels. */
  x: number;
  y: number;
  size: number;
}

/** Square around the hand, sized from the forearm so it scales with distance. Pure — unit tested. */
export function handCrop(
  pose: readonly { x: number; y: number }[],
  side: 'left' | 'right',
  vw: number,
  vh: number,
): CropRect {
  const s = SIDES[side];
  const px = (i: number) => ({ x: pose[i].x * vw, y: pose[i].y * vh });
  const w = px(s.wrist);
  const e = px(s.elbow);
  const knuckles = { x: (px(s.index).x + px(s.pinky).x) / 2, y: (px(s.index).y + px(s.pinky).y) / 2 };
  const forearm = Math.hypot(w.x - e.x, w.y - e.y);
  // Centre a little past the wrist, towards the fingers.
  let dx = knuckles.x - w.x;
  let dy = knuckles.y - w.y;
  if (Math.hypot(dx, dy) < forearm * 0.1) {
    dx = (w.x - e.x) * 0.35;
    dy = (w.y - e.y) * 0.35;
  }
  const cx = w.x + dx * 0.7;
  const cy = w.y + dy * 0.7;
  const size = Math.min(Math.max(forearm * 1.5, 72), Math.min(vw, vh));
  return { x: cx - size / 2, y: cy - size / 2, size };
}

export class HandTracker {
  private landmarkers = new Map<string, HandLandmarker>();
  private lastTs = new Map<string, number>();
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  inferenceMs = 0;

  private constructor(private create: () => Promise<HandLandmarker>) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = CROP_PX;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: false })!;
  }

  static async create(): Promise<HandTracker> {
    const fileset = await visionFileset();
    const make = (delegate: 'GPU' | 'CPU') =>
      HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: assetUrl('mediapipe/hand_landmarker.task'), delegate },
        runningMode: 'VIDEO',
        numHands: 1,
        minHandDetectionConfidence: 0.4,
        minHandPresenceConfidence: 0.4,
        minTrackingConfidence: 0.4,
      });
    const factory = () => make('GPU').catch(() => make('CPU'));
    const t = new HandTracker(factory);
    // Load the first one now so model problems surface at startup, not mid-event.
    t.landmarkers.set('0-left', await factory());
    return t;
  }

  private async get(key: string): Promise<HandLandmarker> {
    let lm = this.landmarkers.get(key);
    if (!lm) {
      lm = await this.create();
      this.landmarkers.set(key, lm);
    }
    return lm;
  }

  /** Instances are created lazily; until one is ready that hand is simply skipped. */
  private pending = new Set<string>();

  /** @param only track just this side this frame (used to halve the cost when the machine is busy) */
  detect(
    video: HTMLVideoElement,
    person: PosePerson,
    slot: number,
    nowMs: number,
    only?: 'left' | 'right',
  ): HandPair {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const out: HandPair = {};
    if (!vw || !vh) return out;
    const t0 = performance.now();
    for (const side of ['left', 'right'] as const) {
      if (only && side !== only) continue;
      const s = SIDES[side];
      if ((person.landmarks[s.wrist]?.visibility ?? 0) < 0.5) continue;
      const key = `${slot}-${side}`;
      const lm = this.landmarkers.get(key);
      if (!lm) {
        if (!this.pending.has(key)) {
          this.pending.add(key);
          void this.get(key).finally(() => this.pending.delete(key));
        }
        continue;
      }
      const crop = handCrop(person.landmarks, side, vw, vh);
      this.ctx.fillStyle = '#000';
      this.ctx.fillRect(0, 0, CROP_PX, CROP_PX);
      this.ctx.drawImage(video, crop.x, crop.y, crop.size, crop.size, 0, 0, CROP_PX, CROP_PX);
      const ts = Math.max(Math.round(nowMs), (this.lastTs.get(key) ?? 0) + 1);
      this.lastTs.set(key, ts);
      const result = lm.detectForVideo(this.canvas, ts);
      const hand = result.landmarks[0];
      if (!hand) continue;
      const image = hand.map((p) => ({
        ...p,
        x: (crop.x + p.x * crop.size) / vw,
        y: (crop.y + p.y * crop.size) / vh,
        visibility: 1,
      }));
      // Reject a hand that isn't attached to this wrist (e.g. the other hand crossing in front).
      const wrist = person.landmarks[s.wrist];
      const off = Math.hypot((image[0].x - wrist.x) * vw, (image[0].y - wrist.y) * vh);
      if (off > crop.size * 0.45) continue;
      out[side] = {
        image,
        world: result.worldLandmarks[0] ?? [],
        score: result.handedness[0]?.[0]?.score ?? 1,
      };
    }
    this.inferenceMs = this.inferenceMs * 0.9 + (performance.now() - t0) * 0.1;
    return out;
  }

  close(): void {
    for (const lm of this.landmarkers.values()) {
      try {
        lm.close();
      } catch {
        /* already closed */
      }
    }
    this.landmarkers.clear();
  }
}
