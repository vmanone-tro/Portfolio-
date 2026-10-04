// Operator debug panel (hotkey D): fps, tracking, camera, settings warnings and errors.
// Hidden by default so guests never see technical text.

export type LogLevel = 'info' | 'warn' | 'error';

interface LogEntry {
  time: string;
  level: LogLevel;
  msg: string;
  count: number;
}

export class DebugPanel {
  readonly el: HTMLElement;
  visible = false;
  private statsEl: HTMLElement;
  private logEl: HTMLElement;
  private log: LogEntry[] = [];
  private stats: Record<string, string | number> = {};
  private lastPaint = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'debug-panel';
    this.el.hidden = true;
    this.el.innerHTML = '<h2>Debug <small>(press D to hide)</small></h2><dl></dl><h3>Log</h3><ol></ol>';
    this.statsEl = this.el.querySelector('dl')!;
    this.logEl = this.el.querySelector('ol')!;
    parent.appendChild(this.el);
  }

  toggle(force?: boolean): void {
    this.visible = force ?? !this.visible;
    this.el.hidden = !this.visible;
    if (this.visible) this.paint();
  }

  set(key: string, value: string | number): void {
    this.stats[key] = value;
  }

  /** Repeated identical messages are collapsed (×N) so a recurring error can't flood memory. */
  add(level: LogLevel, msg: string): void {
    const last = this.log[this.log.length - 1];
    if (last && last.msg === msg && last.level === level) {
      last.count++;
      last.time = new Date().toLocaleTimeString();
    } else {
      this.log.push({ time: new Date().toLocaleTimeString(), level, msg, count: 1 });
      if (this.log.length > 30) this.log.shift();
    }
    if (level === 'error') console.error(msg);
    else if (level === 'warn') console.warn(msg);
    if (this.visible) this.paintLog();
  }

  get errorCount(): number {
    return this.log.filter((e) => e.level === 'error').reduce((n, e) => n + e.count, 0);
  }

  /** Call every frame; repaints at most 4×/s. */
  tick(now: number): void {
    if (!this.visible || now - this.lastPaint < 250) return;
    this.lastPaint = now;
    this.paint();
  }

  private paint(): void {
    const frag = document.createDocumentFragment();
    for (const [k, v] of Object.entries(this.stats)) {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = String(v);
      frag.append(dt, dd);
    }
    this.statsEl.replaceChildren(frag);
    this.paintLog();
  }

  private paintLog(): void {
    this.logEl.replaceChildren(
      ...this.log
        .slice()
        .reverse()
        .map((e) => {
          const li = document.createElement('li');
          li.className = e.level;
          li.textContent = `${e.time} ${e.msg}${e.count > 1 ? ` ×${e.count}` : ''}`;
          return li;
        }),
    );
  }
}

/** Routes uncaught errors into the panel instead of letting them surface to guests. */
export function captureGlobalErrors(panel: DebugPanel): void {
  window.addEventListener('error', (e) => panel.add('error', `${e.message} (${e.filename}:${e.lineno})`));
  window.addEventListener('unhandledrejection', (e) =>
    panel.add('error', `Unhandled: ${(e.reason as Error)?.message ?? String(e.reason)}`),
  );
}

export class FpsMeter {
  fps = 0;
  private frames = 0;
  private since = performance.now();

  tick(now: number): void {
    this.frames++;
    const dt = now - this.since;
    if (dt >= 1000) {
      this.fps = (this.frames * 1000) / dt;
      this.frames = 0;
      this.since = now;
    }
  }
}
