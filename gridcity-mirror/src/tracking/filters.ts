// Jitter removal for tracked landmarks.
// One-Euro filter (Casiez et al. 2012): heavy smoothing when still, light smoothing when moving fast,
// so the character is steady without lagging behind quick waves.

export class OneEuro {
  private x: number | null = null;
  private dx = 0;
  private t = 0;

  constructor(
    public minCutoff = 1.0,
    public beta = 0.02,
    public dCutoff = 1.0,
  ) {}

  private static alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  /** @param t seconds */
  filter(value: number, t: number): number {
    if (this.x === null) {
      this.x = value;
      this.t = t;
      return value;
    }
    const dt = Math.max(1e-3, t - this.t);
    this.t = t;
    const dx = (value - this.x) / dt;
    this.dx += (dx - this.dx) * OneEuro.alpha(this.dCutoff, dt);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += (value - this.x) * OneEuro.alpha(cutoff, dt);
    return this.x;
  }

  reset(): void {
    this.x = null;
    this.dx = 0;
  }
}

/** Maps config `smoothing` (0 = raw, 1 = very smooth) to One-Euro parameters for metre-scale data. */
export function oneEuroParams(smoothing: number): { minCutoff: number; beta: number } {
  const s = Math.min(1, Math.max(0, smoothing));
  return { minCutoff: 6 * (1 - s) + 0.4 * s, beta: 4 * (1 - s) + 0.6 * s };
}

export interface Point3 {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

/** Smooths a whole 33-point landmark set (x, y, z each filtered; visibility eased). */
export class LandmarkSmoother {
  private filters: OneEuro[][] = [];
  private vis: number[] = [];

  constructor(private smoothing: number) {}

  apply<T extends Point3>(points: readonly T[], tSeconds: number): T[] {
    const { minCutoff, beta } = oneEuroParams(this.smoothing);
    return points.map((p, i) => {
      const f = (this.filters[i] ??= [0, 1, 2].map(() => new OneEuro(minCutoff, beta)));
      const v = p.visibility ?? 1;
      this.vis[i] = this.vis[i] === undefined ? v : this.vis[i] + (v - this.vis[i]) * 0.35;
      return {
        ...p,
        x: f[0].filter(p.x, tSeconds),
        y: f[1].filter(p.y, tSeconds),
        z: f[2].filter(p.z, tSeconds),
        visibility: this.vis[i],
      };
    });
  }

  reset(): void {
    this.filters = [];
    this.vis = [];
  }
}
