// Webcam selection, resolution, and self-healing reconnect.
// The camera is never recorded: frames only go into a <video> element that is read by
// the pose tracker in memory.

export type CameraStatus =
  'starting' | 'live' | 'denied' | 'no-camera' | 'busy' | 'lost' | 'error' | 'stopped';

export interface CameraOptions {
  preferredLabel?: string;
  resolution: [number, number];
  retryMs?: number;
}

/** Plain-language messages shown on screen (V and guests can read these). */
export const CAMERA_MESSAGES: Record<CameraStatus, { title: string; detail: string }> = {
  starting: { title: 'Starting camera…', detail: '' },
  live: { title: '', detail: '' },
  denied: {
    title: 'Camera is blocked',
    detail:
      'Allow camera access for this page (camera icon in the address bar → Allow). Retrying automatically.',
  },
  'no-camera': {
    title: 'Camera not found',
    detail: 'Plug in the camera — we keep checking every few seconds.',
  },
  busy: { title: 'Camera is busy', detail: 'Close any other app using the camera. Retrying automatically.' },
  lost: { title: 'Camera disconnected', detail: 'Plug it back in — it will reconnect by itself.' },
  error: { title: 'Camera problem', detail: 'Retrying automatically…' },
  stopped: { title: 'Camera off', detail: '' },
};

export function classifyCameraError(err: unknown): CameraStatus {
  const name = (err as { name?: string })?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError')
    return 'no-camera';
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'busy';
  return 'error';
}

export class Camera {
  readonly video: HTMLVideoElement;
  status: CameraStatus = 'stopped';
  lastError = '';
  label = '';
  width = 0;
  height = 0;
  devices: MediaDeviceInfo[] = [];
  onChange: (() => void) | null = null;

  private stream: MediaStream | null = null;
  private deviceId: string | null = null;
  private retryTimer: number | null = null;
  private starting: Promise<void> | null = null;
  private lastVideoTime = -1;
  private lastAdvance = 0;
  private readonly retryMs: number;

  constructor(private opts: CameraOptions) {
    this.retryMs = opts.retryMs ?? 3000;
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.autoplay = true;
    navigator.mediaDevices?.addEventListener?.('devicechange', () => {
      if (this.status !== 'live') void this.start();
    });
  }

  /** Starts (or restarts) the camera. Safe to call repeatedly. */
  start(): Promise<void> {
    this.starting ??= this.doStart().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  setResolution(w: number, h: number): Promise<void> {
    this.opts.resolution = [w, h];
    return this.restart();
  }

  async restart(): Promise<void> {
    if (this.starting) await this.starting;
    this.release();
    return this.start();
  }

  /** Switch to the next camera (operator hotkey `C`). */
  async cycle(): Promise<void> {
    await this.refreshDevices();
    if (this.devices.length < 2) return;
    const i = this.devices.findIndex((d) => d.label === this.label || d.deviceId === this.deviceId);
    this.deviceId = this.devices[(i + 1) % this.devices.length].deviceId;
    await this.restart();
  }

  /** True when the camera produced a new frame since the last call. */
  hasNewFrame(now: number): boolean {
    if (this.status !== 'live' || this.video.readyState < 2) return false;
    const t = this.video.currentTime;
    if (t !== this.lastVideoTime) {
      this.lastVideoTime = t;
      this.lastAdvance = now;
      return true;
    }
    // A camera that stops delivering frames for 5 s (some USB hubs do this) is treated as unplugged.
    if (now - this.lastAdvance > 5000) this.fail('lost', new Error('camera stopped sending frames'));
    return false;
  }

  stop(): void {
    this.clearRetry();
    this.release();
    this.setStatus('stopped');
  }

  private async doStart(): Promise<void> {
    this.clearRetry();
    if (!navigator.mediaDevices?.getUserMedia) {
      this.fail('error', new Error('This browser has no camera support (needs https or localhost)'));
      return;
    }
    this.setStatus('starting');
    try {
      const [w, h] = this.opts.resolution;
      const video: MediaTrackConstraints = {
        width: { ideal: w },
        height: { ideal: h },
        frameRate: { ideal: 30 },
      };
      if (this.deviceId) video.deviceId = { exact: this.deviceId };
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
      } catch (err) {
        // A remembered camera that was unplugged → fall back to any camera.
        if (!this.deviceId) throw err;
        this.deviceId = null;
        delete video.deviceId;
        stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
      }

      // Labels are only readable after permission was granted, so pick the preferred camera now.
      await this.refreshDevices();
      const want = this.opts.preferredLabel?.trim().toLowerCase();
      const track = stream.getVideoTracks()[0];
      if (want && !this.deviceId && !track.label.toLowerCase().includes(want)) {
        const match = this.devices.find((d) => d.label.toLowerCase().includes(want));
        if (match) {
          stream.getTracks().forEach((t) => t.stop());
          this.deviceId = match.deviceId;
          video.deviceId = { exact: match.deviceId };
          stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
        }
      }

      this.attach(stream);
      await this.video.play().catch(() => undefined);
      await this.waitForFrames();
      this.lastAdvance = performance.now();
      this.setStatus('live');
    } catch (err) {
      this.fail(classifyCameraError(err), err);
    }
  }

  private attach(stream: MediaStream): void {
    this.stream = stream;
    const track = stream.getVideoTracks()[0];
    const s = track.getSettings();
    this.label = track.label || 'Camera';
    this.deviceId = s.deviceId ?? this.deviceId;
    this.width = s.width ?? 0;
    this.height = s.height ?? 0;
    track.addEventListener('ended', () => {
      if (this.stream === stream) this.fail('lost', new Error('camera unplugged'));
    });
    this.video.srcObject = stream;
  }

  private waitForFrames(): Promise<void> {
    if (this.video.readyState >= 2) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('camera gave no picture within 8 s')), 8000);
      this.video.addEventListener(
        'loadeddata',
        () => {
          clearTimeout(timer);
          this.width = this.video.videoWidth || this.width;
          this.height = this.video.videoHeight || this.height;
          resolve();
        },
        { once: true },
      );
    });
  }

  private async refreshDevices(): Promise<void> {
    try {
      this.devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    } catch {
      this.devices = [];
    }
  }

  private fail(status: CameraStatus, err: unknown): void {
    this.lastError = `${(err as Error)?.name ?? 'Error'}: ${(err as Error)?.message ?? String(err)}`;
    this.release();
    this.setStatus(status);
    this.scheduleRetry();
  }

  private release(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.lastVideoTime = -1;
  }

  private scheduleRetry(): void {
    this.clearRetry();
    this.retryTimer = window.setTimeout(() => void this.start(), this.retryMs);
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private setStatus(s: CameraStatus): void {
    this.status = s;
    this.onChange?.();
  }
}
