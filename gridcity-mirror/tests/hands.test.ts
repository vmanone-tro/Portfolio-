import { describe, expect, it } from 'vitest';
import { handCrop } from '../src/tracking/hands';

const pose = (wrist: [number, number], elbow: [number, number], knuckles?: [number, number]) => {
  const pts = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5 }));
  pts[16] = { x: wrist[0], y: wrist[1] };
  pts[14] = { x: elbow[0], y: elbow[1] };
  const k = knuckles ?? wrist;
  pts[18] = pts[20] = { x: k[0], y: k[1] };
  return pts;
};

describe('handCrop', () => {
  it('centres just past the wrist towards the knuckles and scales with the forearm', () => {
    const c = handCrop(pose([0.5, 0.5], [0.5, 0.7], [0.5, 0.45]), 'right', 1280, 720);
    expect(c.size).toBeCloseTo(0.2 * 720 * 1.5);
    expect(c.y + c.size / 2).toBeLessThan(0.5 * 720); // centre above the wrist (towards the fingers)
    expect(c.x + c.size / 2).toBeCloseTo(640);
  });

  it('uses the forearm direction when the knuckles are not separated from the wrist', () => {
    const c = handCrop(pose([0.5, 0.5], [0.6, 0.5]), 'right', 1000, 1000);
    expect(c.x + c.size / 2).toBeLessThan(500); // extends away from the elbow
  });

  it('keeps a minimum size for a tiny, far-away guest and never exceeds the frame', () => {
    expect(handCrop(pose([0.5, 0.5], [0.5, 0.51]), 'right', 1280, 720).size).toBe(72);
    expect(handCrop(pose([0.5, 0.1], [0.5, 0.9]), 'right', 1280, 720).size).toBe(720);
  });
});
