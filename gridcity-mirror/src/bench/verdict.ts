// Pure scoring logic for the device benchmark (unit tested).
import type { PoseModel } from '../config/settings';

export interface BenchResult {
  model: PoseModel;
  requested: [number, number];
  actual: [number, number];
  /** Frames drawn per second (tracking + 3D render combined). */
  screenFps: number;
  /** Pose results per second (capped by the camera's own frame rate). */
  trackingFps: number;
  /** Frames per second the camera delivered. */
  cameraFps: number;
  inferenceMs: number;
  renderMs: number;
  /** Share of tracked frames where a person was detected (0..1). */
  personSeen: number;
}

export type Verdict = 'YES' | 'MAYBE' | 'NO';

export const TARGET_FPS = 24;

/** A setting passes if both the screen and tracking keep up (tracking can't beat the camera). */
export function passes(r: BenchResult): boolean {
  const trackingTarget = Math.min(TARGET_FPS, r.cameraFps * 0.95);
  return r.screenFps >= TARGET_FPS && r.trackingFps >= trackingTarget;
}

export function verdict(results: BenchResult[]): { verdict: Verdict; summary: string; best?: BenchResult } {
  const ok = results.filter(passes);
  const full = ok.filter((r) => r.model === 'full').sort((a, b) => b.actual[0] - a.actual[0]);
  if (full.length) {
    return {
      verdict: 'YES',
      best: full[0],
      summary: `The TV can run the app on its own (full model at ${full[0].actual.join('×')}).`,
    };
  }
  const lite = ok.filter((r) => r.model === 'lite').sort((a, b) => b.actual[0] - a.actual[0]);
  if (lite.length) {
    return {
      verdict: 'MAYBE',
      best: lite[0],
      summary: `The TV can run it in "low" quality, 1 person at a time (lite model at ${lite[0].actual.join('×')}).`,
    };
  }
  return { verdict: 'NO', summary: 'Too slow on this device — use the laptop + TV setup (Mode B).' };
}

/** Warnings that make a result untrustworthy. */
export function caveats(results: BenchResult[]): string[] {
  const out: string[] = [];
  const seen = results.reduce((s, r) => s + r.personSeen, 0) / Math.max(1, results.length);
  if (seen < 0.6) {
    out.push(
      'Nobody was in front of the camera for much of the test, so results may look better than reality. Run it again while standing in view.',
    );
  }
  if (results.some((r) => r.cameraFps > 0 && r.cameraFps < 20)) {
    out.push(
      'The camera itself delivered fewer than 20 frames per second — usually too little light. Brighten the room and re-run.',
    );
  }
  return out;
}
