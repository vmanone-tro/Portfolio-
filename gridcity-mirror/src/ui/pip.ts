// Small "real you" camera window in the corner (hotkey S / config showCameraPiP).
// With the debug panel open it also shows the tracking skeleton.
import { drawHands, drawSkeletons } from '../render/skeleton';
import { coverView, drawVideo } from '../render/view';
import type { HandObservation } from '../tracking/hands';
import type { PosePerson } from '../tracking/pose';

export class CameraPiP {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'pip';
    this.canvas.hidden = true;
    parent.append(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
  }

  get visible(): boolean {
    return !this.canvas.hidden;
  }

  set visible(v: boolean) {
    this.canvas.hidden = !v;
  }

  draw(
    video: HTMLVideoElement,
    people: PosePerson[],
    hands: HandObservation[],
    mirror: boolean,
    skeleton: boolean,
  ): void {
    if (!this.visible) return;
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * (window.devicePixelRatio || 1)));
    const h = Math.max(1, Math.round(rect.height * (window.devicePixelRatio || 1)));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const ctx = this.ctx;
    ctx.fillStyle = '#05060d';
    ctx.fillRect(0, 0, w, h);
    if (video.readyState < 2) return;
    const view = coverView(video.videoWidth, video.videoHeight, w, h, mirror);
    drawVideo(ctx, video, view);
    if (skeleton) {
      drawSkeletons(ctx, people, view, 0.5);
      drawHands(ctx, hands, view);
    }
  }
}
