// Maps normalised camera coordinates onto the screen ("cover" fit, optionally mirrored).

export interface View {
  W: number;
  H: number;
  vw: number;
  vh: number;
  scale: number;
  ox: number;
  oy: number;
  mirror: boolean;
}

export function coverView(vw: number, vh: number, W: number, H: number, mirror: boolean): View {
  const scale = vw > 0 && vh > 0 ? Math.max(W / vw, H / vh) : 1;
  return { W, H, vw, vh, scale, ox: (W - vw * scale) / 2, oy: (H - vh * scale) / 2, mirror };
}

export function toScreen(v: View, x: number, y: number): { x: number; y: number } {
  const sx = v.ox + x * v.vw * v.scale;
  return { x: v.mirror ? v.W - sx : sx, y: v.oy + y * v.vh * v.scale };
}

/** Draws the camera frame exactly where toScreen() maps landmarks. */
export function drawVideo(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, v: View): void {
  ctx.save();
  if (v.mirror) {
    ctx.translate(v.W, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, v.ox, v.oy, v.vw * v.scale, v.vh * v.scale);
  ctx.restore();
}
