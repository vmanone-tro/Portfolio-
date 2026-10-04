// Grid City Mirror — app bootstrap.
// Phase 2: the guest drives a 3D character (mirrored), camera feed hidden (S shows a corner view).
import './style.css';
import { Camera, CAMERA_MESSAGES } from './camera/camera';
import { assetUrl, loadSettings, type Settings } from './config/settings';
import { Avatar } from './render/avatar';
import { Stage3D } from './render/scene';
import { LandmarkSmoother } from './tracking/filters';
import { PoseTracker, upperBodyConfidence, type PosePerson } from './tracking/pose';
import { LegVisibility, solvePose } from './tracking/solver';
import { mockPose } from './tracking/synthetic';
import { DebugPanel, FpsMeter, captureGlobalErrors } from './ui/debug';
import { Overlay } from './ui/overlay';
import { CameraPiP } from './ui/pip';
import { fitStage } from './ui/stage';

/** Phase 3 replaces this with the character lineup from characters/characters.json. */
const DEFAULT_CHARACTER = 'characters/grid-runner/model.vrm';
/** How long tracking may drop out before the character relaxes (brief misses are bridged). */
const LOST_GRACE_MS = 400;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function boot(): Promise<void> {
  const app = document.getElementById('app')!;
  const stage = document.createElement('div');
  stage.className = 'stage';
  app.append(stage);
  const canvas = document.createElement('canvas');
  stage.append(canvas);
  const overlay = new Overlay(stage);
  const pip = new CameraPiP(stage);
  const debug = new DebugPanel(stage);
  captureGlobalErrors(debug);
  overlay.setStatus('Getting ready…');

  const { settings, warnings } = await loadSettings();
  warnings.forEach((w) => debug.add('warn', w));
  if (settings.debug) debug.toggle(true);
  pip.visible = settings.showCameraPiP;
  /** `?mock=wave|dance|tpose|arms-up|upper-body` — preview with a fake guest, no camera needed. */
  const mock = new URLSearchParams(location.search).get('mock');

  // ---- 3D stage -------------------------------------------------------------
  const stage3d = new Stage3D(canvas);
  const resize = () => {
    const { width, height } = fitStage(stage, settings.orientation);
    stage3d.resize(width, height, Math.min(window.devicePixelRatio || 1, 2) * settings.renderScale);
  };
  window.addEventListener('resize', resize);
  resize();

  let avatar: Avatar | null = null;
  const loadAvatar = async () => {
    try {
      const a = await Avatar.load(assetUrl(DEFAULT_CHARACTER));
      stage3d.stageRoot.add(a.root);
      avatar = a;
      debug.add('info', `character loaded: ${DEFAULT_CHARACTER}`);
    } catch (err) {
      debug.add('error', `character failed to load: ${errMsg(err)} — retrying in 5 s`);
      setTimeout(() => void loadAvatar(), 5000);
    }
  };
  void loadAvatar();

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
    const detail =
      camera.status === 'live'
        ? ` — ${camera.label} ${camera.width}×${camera.height}`
        : camera.lastError
          ? ` — ${camera.lastError}`
          : '';
    debug.add(level, `camera: ${camera.status}${detail}`);
  };
  if (!mock) void camera.start();

  // ---- pose tracker (retries until it loads) -------------------------------------
  let tracker: PoseTracker | null = null;
  let trackerState: 'loading' | 'ready' | 'failed' = mock ? 'ready' : 'loading';
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
  if (!mock) void initTracker();

  // ---- operator hotkeys -------------------------------------------------------------
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
        pip.visible = !pip.visible;
        overlay.toast(pip.visible ? 'Camera view on' : 'Camera view off');
        break;
    }
  });

  // ---- render loop (never allowed to die) ---------------------------------------------
  const fps = new FpsMeter();
  const trackFps = new FpsMeter();
  const worldSmoother = new LandmarkSmoother(settings.smoothing);
  const imageSmoother = new LandmarkSmoother(settings.smoothing);
  const legs = new LegVisibility();
  let people: PosePerson[] = [];
  let lastSeen = -Infinity;
  let inferenceMs = 0;
  let last = performance.now();

  const step = (now: number) => {
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    const t = now / 1000;
    fps.tick(now);

    // 1. Track
    let fresh = false;
    if (mock) {
      const m = mockPose(mock, t);
      people = [
        {
          landmarks: m.image as PosePerson['landmarks'],
          worldLandmarks: m.world as PosePerson['worldLandmarks'],
          confidence: upperBodyConfidence(m.image),
        },
      ];
      fresh = true;
    } else {
      const newFrame = camera.hasNewFrame(now);
      if (camera.status !== 'live') people = [];
      if (newFrame && tracker) {
        try {
          const result = tracker.detect(camera.video, now);
          people = result.people;
          inferenceMs = inferenceMs * 0.9 + result.inferenceMs * 0.1;
          trackFps.tick(now);
          fresh = true;
        } catch (err) {
          debug.add('error', `tracking error: ${errMsg(err)} — reloading tracker`);
          tracker.close();
          tracker = null;
          void initTracker();
        }
      }
    }

    // 2. Solve the most confident guest (two-person mode arrives in Phase 4)
    const guest = people
      .filter((p) => p.confidence >= settings.minPoseConfidence * 0.6)
      .sort((a, b) => b.confidence - a.confidence)[0];
    if (guest && fresh) {
      lastSeen = now;
      const world = worldSmoother.apply(guest.worldLandmarks, t);
      const image = imageSmoother.apply(guest.landmarks, t);
      const sol = solvePose(world, image, {
        mirror: settings.mirror,
        legsVisible: legs.update(image, now),
        minVisibility: settings.minPoseConfidence,
      });
      avatar?.setTarget(sol);
    } else if (now - lastSeen > LOST_GRACE_MS) {
      avatar?.setTarget(null);
      worldSmoother.reset();
      imageSmoother.reset();
    }

    // 3. Draw
    avatar?.update(dt, t, settings.smoothing, stage3d.visibleHalfWidth());
    stage3d.render(t);
    if (!mock) pip.draw(camera.video, people, settings.mirror, debug.visible);

    updateText(settings, mock ? 'live' : camera.status, trackerState, avatar !== null, people, overlay);

    const best = people.reduce((m, p) => Math.max(m, p.confidence), 0);
    debug.set('screen fps', fps.fps.toFixed(1));
    debug.set('tracking fps', mock ? 'mock' : trackFps.fps.toFixed(1));
    debug.set('pose inference', `${inferenceMs.toFixed(1)} ms`);
    debug.set(
      'pose model',
      mock ? `mock: ${mock}` : tracker ? `${tracker.model} (${tracker.delegate})` : trackerState,
    );
    debug.set('camera', camera.status === 'live' ? camera.label : camera.status);
    debug.set('camera resolution', `${camera.width}×${camera.height}`);
    debug.set('people', people.length);
    debug.set('confidence', best.toFixed(2));
    debug.set('legs tracked', legs.visible ? 'yes' : 'no (upper-body mode)');
    debug.set(
      'render',
      `${canvas.width}×${canvas.height} (${settings.orientation}, quality ${settings.quality})`,
    );
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
  cameraStatus: Camera['status'],
  trackerState: string,
  avatarReady: boolean,
  people: PosePerson[],
  overlay: Overlay,
): void {
  if (cameraStatus !== 'live') {
    const m = CAMERA_MESSAGES[cameraStatus];
    overlay.setStatus(m.title, m.detail);
    overlay.setPrompt('');
    return;
  }
  if (trackerState !== 'ready' || !avatarReady) {
    overlay.setStatus(
      'Getting ready…',
      trackerState !== 'ready' ? 'Loading body tracking' : 'Loading character',
    );
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
  // Last resort: something failed before the loop started. Show a calm message and reload.
  console.error(err);
  document.body.insertAdjacentHTML(
    'beforeend',
    '<div class="fatal">Getting ready… <small>restarting in 5 seconds</small></div>',
  );
  setTimeout(() => location.reload(), 5000);
});
