// The "stage" is the area the app draws into: 9:16 in portrait, 16:9 in landscape,
// centred in the window. On the rotated TV it fills the whole screen; on a laptop
// it shows a letterboxed preview of what the TV will look like.
import type { Orientation } from '../config/settings';

export function fitStage(el: HTMLElement, orientation: Orientation): { width: number; height: number } {
  const aspect = orientation === 'portrait' ? 9 / 16 : 16 / 9;
  const ww = window.innerWidth;
  const wh = window.innerHeight;
  // Fill the window if it's already within 6% of the target shape (e.g. a rotated TV).
  const winAspect = ww / wh;
  let width: number;
  let height: number;
  if (Math.abs(winAspect - aspect) / aspect < 0.06) {
    width = ww;
    height = wh;
  } else if (winAspect > aspect) {
    height = wh;
    width = Math.round(wh * aspect);
  } else {
    width = ww;
    height = Math.round(ww / aspect);
  }
  el.style.width = `${width}px`;
  el.style.height = `${height}px`;
  return { width, height };
}
