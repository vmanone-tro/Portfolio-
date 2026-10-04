// Phase 1 debug view: stick figure over the (mirrored) camera feed.
import { POSE_CONNECTIONS, type PosePerson } from '../tracking/pose';
import { toScreen, type View } from './view';

const COLORS = ['#00e5ff', '#ff3dcf'];

export function drawSkeletons(
  ctx: CanvasRenderingContext2D,
  people: PosePerson[],
  view: View,
  minVis: number,
): void {
  const unit = Math.min(view.W, view.H) / 1080;
  people.forEach((person, n) => {
    const color = COLORS[n % COLORS.length];
    const pts = person.landmarks.map((l) => ({ ...toScreen(view, l.x, l.y), v: l.visibility ?? 0 }));
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    ctx.lineWidth = 6 * unit;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12 * unit;
    for (const { start, end } of POSE_CONNECTIONS) {
      const a = pts[start];
      const b = pts[end];
      if (!a || !b) continue;
      ctx.globalAlpha = a.v < minVis || b.v < minVis ? 0.2 : 1;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    for (const p of pts) {
      ctx.globalAlpha = p.v < minVis ? 0.25 : 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5 * unit, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  });
}
