// MediaPipe PoseLandmarker wrapper. Everything loads from public/mediapipe/ — no CDN.
import {
  FilesetResolver,
  PoseLandmarker,
  type Landmark,
  type NormalizedLandmark,
} from '@mediapipe/tasks-vision';
import { assetUrl, type PoseModel } from '../config/settings';

export type { Landmark, NormalizedLandmark };

export interface PosePerson {
  /** 33 landmarks, x/y normalised to the camera image (0..1), NOT mirrored. */
  landmarks: NormalizedLandmark[];
  /** 33 landmarks in metres, origin between the hips. */
  worldLandmarks: Landmark[];
  /** 0..1 — how clearly we see the upper body. */
  confidence: number;
}

export interface PoseFrame {
  people: PosePerson[];
  inferenceMs: number;
}

export const POSE_CONNECTIONS: ReadonlyArray<{ start: number; end: number }> =
  PoseLandmarker.POSE_CONNECTIONS;

/** Landmarks that matter for "is a person really standing there": nose, shoulders, elbows, wrists. */
const UPPER_BODY = [0, 11, 12, 13, 14, 15, 16];

export function upperBodyConfidence(lms: ReadonlyArray<{ visibility?: number }>): number {
  if (lms.length < 17) return 0;
  let sum = 0;
  for (const i of UPPER_BODY) sum += lms[i].visibility ?? 0;
  return sum / UPPER_BODY.length;
}

let filesetPromise: ReturnType<typeof FilesetResolver.forVisionTasks> | null = null;

export class PoseTracker {
  delegate: 'GPU' | 'CPU' = 'GPU';
  private lastTs = 0;

  private constructor(
    private landmarker: PoseLandmarker,
    readonly model: PoseModel,
  ) {}

  static async create(opts: {
    model: PoseModel;
    numPoses: number;
    minConfidence: number;
  }): Promise<PoseTracker> {
    filesetPromise ??= FilesetResolver.forVisionTasks(assetUrl('mediapipe/wasm'));
    const fileset = await filesetPromise.catch((err) => {
      filesetPromise = null;
      throw err;
    });
    const make = (delegate: 'GPU' | 'CPU') =>
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: assetUrl(`mediapipe/pose_landmarker_${opts.model}.task`), delegate },
        runningMode: 'VIDEO',
        numPoses: opts.numPoses,
        minPoseDetectionConfidence: opts.minConfidence,
        minPosePresenceConfidence: opts.minConfidence,
        minTrackingConfidence: opts.minConfidence,
        outputSegmentationMasks: false,
      });
    try {
      return new PoseTracker(await make('GPU'), opts.model);
    } catch (err) {
      console.warn('GPU pose tracking unavailable, falling back to CPU', err);
      const t = new PoseTracker(await make('CPU'), opts.model);
      t.delegate = 'CPU';
      return t;
    }
  }

  detect(source: HTMLVideoElement, nowMs: number): PoseFrame {
    // MediaPipe requires strictly increasing timestamps.
    const ts = Math.max(Math.round(nowMs), this.lastTs + 1);
    this.lastTs = ts;
    const t0 = performance.now();
    const result = this.landmarker.detectForVideo(source, ts);
    const inferenceMs = performance.now() - t0;
    const people = result.landmarks.map((landmarks, i) => ({
      landmarks,
      worldLandmarks: result.worldLandmarks[i] ?? [],
      confidence: upperBodyConfidence(landmarks),
    }));
    return { people, inferenceMs };
  }

  close(): void {
    try {
      this.landmarker.close();
    } catch {
      /* already closed */
    }
  }
}
