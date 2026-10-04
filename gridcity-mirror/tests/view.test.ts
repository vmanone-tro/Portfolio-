import { describe, expect, it } from 'vitest';
import { coverView, toScreen } from '../src/render/view';

describe('coverView / toScreen', () => {
  it('fills a portrait screen from a landscape camera, cropping the sides', () => {
    const v = coverView(1280, 720, 1080, 1920, false);
    expect(v.scale).toBeCloseTo(1920 / 720);
    expect(toScreen(v, 0.5, 0.5)).toEqual({ x: 540, y: 960 });
    expect(toScreen(v, 0.5, 0).y).toBeCloseTo(0);
  });

  it('mirrors: a point on the camera image left appears on the screen right', () => {
    const v = coverView(1280, 720, 1920, 1080, true);
    expect(toScreen(v, 0, 0.5).x).toBeCloseTo(1920);
    expect(toScreen(v, 1, 0.5).x).toBeCloseTo(0);
  });

  it('does not divide by zero before the camera has a size', () => {
    const v = coverView(0, 0, 1080, 1920, true);
    expect(Number.isFinite(v.scale)).toBe(true);
  });
});
