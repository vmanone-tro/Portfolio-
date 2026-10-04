import { describe, expect, it } from 'vitest';
import { CAMERA_MESSAGES, classifyCameraError } from '../src/camera/camera';

describe('classifyCameraError', () => {
  it.each([
    ['NotAllowedError', 'denied'],
    ['SecurityError', 'denied'],
    ['NotFoundError', 'no-camera'],
    ['OverconstrainedError', 'no-camera'],
    ['NotReadableError', 'busy'],
    ['TypeError', 'error'],
  ])('%s → %s', (name, status) => {
    expect(classifyCameraError({ name })).toBe(status);
  });

  it('handles non-error values', () => {
    expect(classifyCameraError(undefined)).toBe('error');
  });

  it('has a plain-language message for every problem state', () => {
    for (const s of ['denied', 'no-camera', 'busy', 'lost', 'error'] as const) {
      expect(CAMERA_MESSAGES[s].title.length).toBeGreaterThan(0);
      expect(CAMERA_MESSAGES[s].detail.length).toBeGreaterThan(0);
    }
  });
});
