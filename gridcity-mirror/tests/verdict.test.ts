import { describe, expect, it } from 'vitest';
import { caveats, passes, verdict, type BenchResult } from '../src/bench/verdict';

const r = (
  model: 'lite' | 'full',
  w: number,
  screenFps: number,
  extra: Partial<BenchResult> = {},
): BenchResult => ({
  model,
  requested: [w, (w * 9) / 16],
  actual: [w, (w * 9) / 16],
  screenFps,
  trackingFps: Math.min(screenFps, 30),
  cameraFps: 30,
  inferenceMs: 10,
  renderMs: 2,
  personSeen: 1,
  ...extra,
});

describe('benchmark verdict', () => {
  it('says YES when the full model keeps up', () => {
    const v = verdict([r('lite', 640, 50), r('full', 640, 30), r('full', 1280, 26)]);
    expect(v.verdict).toBe('YES');
    expect(v.best?.actual[0]).toBe(1280);
  });

  it('says MAYBE when only the lite model keeps up', () => {
    expect(verdict([r('lite', 640, 28), r('full', 640, 18)]).verdict).toBe('MAYBE');
  });

  it('says NO when nothing keeps up, or nothing ran', () => {
    expect(verdict([r('lite', 640, 12)]).verdict).toBe('NO');
    expect(verdict([]).verdict).toBe('NO');
  });

  it('does not fail a setting just because the camera is capped below 24 fps', () => {
    expect(passes(r('full', 640, 40, { trackingFps: 19.5, cameraFps: 20 }))).toBe(true);
    expect(passes(r('full', 640, 40, { trackingFps: 12, cameraFps: 20 }))).toBe(false);
  });

  it('warns when nobody stood in front of the camera or the camera was slow', () => {
    expect(caveats([r('full', 640, 30, { personSeen: 0.1 })])[0]).toMatch(/Nobody/);
    expect(caveats([r('full', 640, 30, { cameraFps: 12 })])[0]).toMatch(/light/);
    expect(caveats([r('full', 640, 30)])).toEqual([]);
  });

  it('does not blame the light when only the low-resolution mode is slow (seen on the Apolosign camera)', () => {
    expect(
      caveats([r('lite', 640, 13, { cameraFps: 15.1 }), r('lite', 1280, 11, { cameraFps: 29.8 })]),
    ).toEqual([]);
  });
});
