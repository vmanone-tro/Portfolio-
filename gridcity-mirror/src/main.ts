// Grid City Mirror — app bootstrap.
// Phase 1: mirrored camera + live skeleton, debug panel, camera self-healing.
import './style.css';
import { Camera, CAMERA_MESSAGES } from './camera/camera';
import { loadSettings, type Settings } from './config/settings';
import { drawSkeletons } from './render/skeleton';
import { coverView, drawVideo } from './render/view';
import { PoseTracker, type PosePerson } from './tracking/pose';
import { DebugPanel, FpsMeter, captureGlobalErrors } from './ui/debug';
import { Overlay } from './ui/overlay';
import { fitStage } from './ui/stage';

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function boot(): Promise<void> {
  const app = document.getElementById('app')!;
  const stage = document.createElement('div');
  stage.className = 'stage';
  app.append(stage);
  const canvas = document.createElement('canvas');
  stage.append(canvas);
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const overlay = new Overlay(stage);
  const debug = new DebugPanel(stage);
  captureGlobalErrors(debug);
  overlay.setStatus('Getting ready…');

  const { settings, warnings } = await loadSettings();
  warnings.forEach((w) => debug.add('warn', w));
  if (settings.debug) debug.toggle(true);

  // ---- layout -------------------------------------------------------------
  const resize = () => {
    const { width, height } = fitStage(stage, settings.orientation);
    const scale = Math.min(window.devicePixelRatio || 1, 2) * settings.renderScale;
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
  };
  window.addEventListener('resize', resize);
  resize();

  // ---- camera ---------------------------------------------------------------
  const camera = new Camera({
    preferredLabel: settings.cameraDeviceLabel,
    resolution: settings.cameraResolution,
  });
  camera.video.className = 'camera-video';
  document.body.append(camera.video);
  let lastCameraStatus = '';
  camera.onChange = () => {
    if (camera.status === lastCameraStatus) return;
    lastCameraStatus = camera.status;
    const level = camera.status === 'live' || camera.status === 'starting' ? 'info' : 'warn';
    debug.add(
      level,
      `camera: ${camera.status}${camera.status === 'live' ? ` — ${camera.label} ${camera.width}×${camera.height}` : camera.lastError ? ` — ${camera.lastError}` : ''}`,
    );
  };
  void camera.start();

  // ---- pose tracker (retries until it loads) -------------------------------------
  let tracker: PoseTracker | null = null;
  let trackerState: 'loading' | 'ready' | 'failed' = 'loading';
  const initTracker = async () => {
    trackerState = 'loading';
    try {
      tracker = await PoseTracker.create({
        model: settings.poseModel,
        numPoses: settings.maxPeople,
        minConfidence: settings.minPoseConfidence,
      });
      trackerState = 'ready';
      debug.add('info', `body tracking ready: ${tracker.model} model on ${tracker.delegate}`);
    } catch (err) {
      trackerState = 'failed';
      debug.add('error', `body tracking failed to load: ${errMsg(err)} — retrying in 5 s`);
      setTimeout(() => void initTracker(), 5000);
    }
  };
  void initTracker();

  // ---- operator hotkeys -------------------------------------------------------------
  let showFeed = true;
  window.addEventListener('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    switch (e.key.toLowerCase()) {
      case 'd':
        debug.toggle();
        break;
      case 'c':
        overlay.toast('Switching camera…');
        void camera.cycle().then(() => overlay.toast(`Camera: ${camera.label}`));
        break;
      case 'f':
        toggleFullscreen();
        break;
      case 's':
        showFeed = !showFeed;
        overlay.toast(showFeed ? 'Camera feed on' : 'Camera feed off');
        break;
    }
  });

  // ---- render loop (never allowed to die) ---------------------------------------------
  const fps = new FpsMeter();
  const trackFps = new FpsMeter();
  let people: PosePerson[] = [];
  let inferenceMs = 0;

  const step = (now: number) => {
    fps.tick(now);
    const newFrame = camera.hasNewFrame(now);
    if (camera.status !== 'live') people = [];
    if (newFrame && tracker) {
      try {
        const result = tracker.detect(camera.video, now);
        people = result.people;
        inferenceMs = inferenceMs * 0.9 + result.inferenceMs * 0.1;
        trackFps.tick(now);
      } catch (err) {
        debug.add('error', `tracking error: ${errMsg(err)} — reloading tracker`);
        tracker.close();
        tracker = null;
        void initTracker();
      }
    }

    const W = canvas.width;
    const H = canvas.height;
    ctx.fillStyle = '#05060d';
    ctx.fillRect(0, 0, W, H);
    const view = coverView(camera.video.videoWidth, camera.video.videoHeight, W, H, settings.mirror);
    if (camera.status === 'live' && showFeed && camera.video.readyState >= 2) {
      ctx.globalAlpha = 0.85;
      drawVideo(ctx, camera.video, view);
      ctx.globalAlpha = 1;
    }
    drawSkeletons(ctx, people, view, settings.minPoseConfidence);

    updateText(settings, camera, trackerState, people, overlay);

    const best = people.reduce((m, p) => Math.max(m, p.confidence), 0);
    debug.set('screen fps', fps.fps.toFixed(1));
    debug.set('tracking fps', trackFps.fps.toFixed(1));
    debug.set('pose inference', `${inferenceMs.toFixed(1)} ms`);
    debug.set('pose model', tracker ? `${tracker.model} (${tracker.delegate})` : trackerState);
    debug.set('camera', camera.status === 'live' ? `${camera.label}` : camera.status);
    debug.set('camera resolution', `${camera.width}×${camera.height}`);
    debug.set('people', people.length);
    debug.set('confidence', best.toFixed(2));
    debug.set('canvas', `${W}×${H} (${settings.orientation}, quality ${settings.quality})`);
    debug.set('errors', debug.errorCount);
    debug.tick(now);
  };

  const frame = (now: number) => {
    requestAnimationFrame(frame);
    try {
      step(now);
    } catch (err) {
      debug.add('error', `frame error: ${errMsg(err)}`);
    }
  };
  requestAnimationFrame(frame);
}

function updateText(
  settings: Settings,
  camera: Camera,
  trackerState: string,
  people: PosePerson[],
  overlay: Overlay,
): void {
  if (camera.status !== 'live') {
    const m = CAMERA_MESSAGES[camera.status];
    overlay.setStatus(m.title, m.detail);
    overlay.setPrompt('');
    return;
  }
  if (trackerState !== 'ready') {
    overlay.setStatus('Getting ready…', 'Loading body tracking');
    overlay.setPrompt('');
    return;
  }
  overlay.setStatus('');
  const best = people.reduce((m, p) => Math.max(m, p.confidence), 0);
  if (people.length === 0) overlay.setPrompt(settings.attractPrompt);
  else if (best < settings.minPoseConfidence)
    overlay.setPrompt('Step into the light — or step back so we can see you');
  else overlay.setPrompt('');
}

function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen().catch(() => undefined);
}

boot().catch((err) => {
  // Last-resort: something failed before the loop started. Show a calm message and reload.
  console.error(err);
  document.body.insertAdjacentHTML(
    'beforeend',
    '<div class="fatal">Getting ready… <small>restarting in 5 seconds</small></div>',
  );
  setTimeout(() => location.reload(), 5000);
});
