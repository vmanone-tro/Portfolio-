// Device benchmark (/bench/): can the Apolosign TV run the mirror on its own?
// Runs pose tracking (lite & full model, 640×480 & 1280×720) while rendering a test VRM,
// then shows a plain table and a YES / MAYBE / NO verdict.
import * as THREE from 'three';
import '../style.css';
import './bench.css';
import { Camera, CAMERA_MESSAGES } from '../camera/camera';
import { assetUrl, type PoseModel } from '../config/settings';
import { animateWave, loadVrm, type VRM } from '../render/avatar';
import { PoseTracker } from '../tracking/pose';
import { caveats, passes, verdict, type BenchResult } from './verdict';

const TESTS: Array<{ model: PoseModel; res: [number, number] }> = [
  { model: 'lite', res: [640, 480] },
  { model: 'lite', res: [1280, 720] },
  { model: 'full', res: [640, 480] },
  { model: 'full', res: [1280, 720] },
];

const params = new URLSearchParams(location.search);
const SECONDS = Number(params.get('seconds')) || 20;
const WARMUP_MS = 2000;

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

document.body.insertAdjacentHTML(
  'beforeend',
  `<canvas class="bench-3d"></canvas>
  <main class="bench">
    <h1>Grid City Mirror — device test</h1>
    <p class="lead">Stand about 2 metres in front of the camera so your whole upper body is visible, then tap the button.
    Keep standing there (wave a little) until the test finishes — about 2 minutes.</p>
    <button class="run" type="button">▶ Run benchmark</button>
    <div class="progress" hidden></div>
    <div class="verdict" hidden></div>
    <ul class="caveats"></ul>
    <table hidden>
      <thead><tr><th>Setting</th><th>Camera gave</th><th>Screen fps</th><th>Tracking fps</th><th>Camera fps</th><th>Pose ms</th><th>Person seen</th><th></th></tr></thead>
      <tbody></tbody>
    </table>
    <dl class="device"></dl>
  </main>
  <video class="bench-preview" muted playsinline></video>`,
);

const canvas = $<HTMLCanvasElement>('.bench-3d');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05060d);
const cam3d = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
cam3d.position.set(0, 1.1, 4.2);
cam3d.lookAt(0, 0.95, 0);
scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x1a1030, 1.4));
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(1.5, 3, 2.5);
scene.add(key);
const grid = new THREE.GridHelper(10, 20, 0x00e5ff, 0x1c2a4a);
scene.add(grid);

const resize = () => {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  cam3d.aspect = window.innerWidth / window.innerHeight;
  cam3d.updateProjectionMatrix();
};
window.addEventListener('resize', resize);
resize();

let vrm: VRM | null = null;
let renderMs = 0;
const renderFrame = (t: number) => {
  if (vrm) animateWave(vrm, t / 1000);
  const t0 = performance.now();
  renderer.render(scene, cam3d);
  renderMs = renderMs * 0.9 + (performance.now() - t0) * 0.1;
};

// Idle preview until the test starts.
let running = false;
const idle = (t: number) => {
  if (running) return;
  renderFrame(t);
  requestAnimationFrame(idle);
};
requestAnimationFrame(idle);

loadVrm(assetUrl('characters/grid-runner/model.vrm'))
  .then((v) => {
    vrm = v;
    scene.add(v.scene);
  })
  .catch((err) => showDevice('Test character', `failed to load: ${(err as Error).message}`));

const camera = new Camera({ resolution: [640, 480], retryMs: 2000 });
const preview = $<HTMLVideoElement>('.bench-preview');

function showDevice(k: string, v: string): void {
  $('.device').insertAdjacentHTML('beforeend', `<dt>${k}</dt><dd>${v}</dd>`);
}

function deviceInfo(): void {
  const gl = renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  const nav = navigator as Navigator & { deviceMemory?: number };
  showDevice('Screen', `${screen.width}×${screen.height} @${window.devicePixelRatio}x`);
  showDevice('CPU cores', String(navigator.hardwareConcurrency ?? '?'));
  showDevice('Memory', nav.deviceMemory ? `${nav.deviceMemory} GB+` : 'unknown');
  showDevice('GPU', gpu);
  showDevice('Browser', navigator.userAgent);
}
deviceInfo();

function setProgress(text: string): void {
  const el = $('.progress');
  el.hidden = false;
  el.textContent = text;
}

async function waitForCamera(timeoutMs: number): Promise<boolean> {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    if (camera.status === 'live') return true;
    if (camera.status !== 'starting')
      setProgress(`${CAMERA_MESSAGES[camera.status].title} — ${CAMERA_MESSAGES[camera.status].detail}`);
    await new Promise((r) => setTimeout(r, 250));
  }
  return camera.status === 'live';
}

/** Measures the frame rate the camera actually delivers (independent of how fast we consume frames). */
function cameraFrameCounter(video: HTMLVideoElement): () => number {
  type Meta = { presentedFrames: number };
  const v = video as HTMLVideoElement & {
    requestVideoFrameCallback?: (cb: (now: number, meta: Meta) => void) => number;
  };
  if (!v.requestVideoFrameCallback) return () => NaN;
  let first: { t: number; n: number } | null = null;
  let last: { t: number; n: number } | null = null;
  let stopped = false;
  const cb = (now: number, meta: Meta) => {
    last = { t: now, n: meta.presentedFrames };
    first ??= last;
    if (!stopped) v.requestVideoFrameCallback!(cb);
  };
  v.requestVideoFrameCallback(cb);
  return () => {
    stopped = true;
    if (!first || !last || last.t <= first.t) return NaN;
    return ((last.n - first.n) * 1000) / (last.t - first.t);
  };
}

async function runOne(model: PoseModel, res: [number, number], index: number): Promise<BenchResult | string> {
  const label = `${model} @ ${res.join('×')}`;
  setProgress(`Test ${index + 1} of ${TESTS.length}: ${label} — starting camera…`);
  await camera.setResolution(res[0], res[1]);
  if (!(await waitForCamera(15000)))
    return `${label}: camera did not start (${camera.lastError || camera.status})`;
  preview.srcObject = camera.video.srcObject;
  void preview.play().catch(() => undefined);

  setProgress(`Test ${index + 1} of ${TESTS.length}: ${label} — loading body tracking…`);
  let tracker: PoseTracker;
  try {
    tracker = await PoseTracker.create({ model, numPoses: 1, minConfidence: 0.5 });
  } catch (err) {
    return `${label}: body tracking failed to load (${(err as Error).message})`;
  }

  return new Promise((resolve) => {
    const start = performance.now();
    let measureStart = 0;
    let frames = 0;
    let tracked = 0;
    let seen = 0;
    let inferSum = 0;
    let renderSum = 0;
    let readCameraFps: () => number = () => NaN;

    const loop = (now: number) => {
      const elapsed = now - start;
      const measuring = elapsed >= WARMUP_MS;
      if (measuring && !measureStart) {
        measureStart = now;
        readCameraFps = cameraFrameCounter(camera.video);
      }
      if (camera.hasNewFrame(now)) {
        try {
          const r = tracker.detect(camera.video, now);
          if (measuring) {
            tracked++;
            inferSum += r.inferenceMs;
            if (r.people.length) seen++;
          }
        } catch (err) {
          tracker.close();
          resolve(`${label}: tracking crashed (${(err as Error).message})`);
          return;
        }
      }
      renderFrame(now);
      if (measuring) {
        frames++;
        renderSum += renderMs;
      }
      const left = Math.ceil(
        measureStart ? SECONDS - (now - measureStart) / 1000 : SECONDS + (WARMUP_MS - elapsed) / 1000,
      );
      setProgress(
        `Test ${index + 1} of ${TESTS.length}: ${label} — ${left}s left${measuring ? '' : ' (warming up)'}`,
      );

      // Measure for a full SECONDS even if frames are slow, so fps can never be overstated.
      if (!measureStart || now - measureStart < SECONDS * 1000) {
        requestAnimationFrame(loop);
        return;
      }
      const secs = (now - measureStart) / 1000;
      const cameraFps = readCameraFps();
      tracker.close();
      resolve({
        model,
        requested: res,
        actual: [camera.width, camera.height],
        screenFps: frames / secs,
        trackingFps: tracked / secs,
        cameraFps: Number.isNaN(cameraFps) ? tracked / secs : cameraFps,
        inferenceMs: tracked ? inferSum / tracked : 0,
        renderMs: frames ? renderSum / frames : 0,
        personSeen: tracked ? seen / tracked : 0,
      });
    };
    requestAnimationFrame(loop);
  });
}

function addRow(r: BenchResult): void {
  const row = document.createElement('tr');
  const cells = [
    `${r.model} @ ${r.requested.join('×')}`,
    r.actual.join('×'),
    r.screenFps.toFixed(1),
    r.trackingFps.toFixed(1),
    r.cameraFps.toFixed(1),
    r.inferenceMs.toFixed(1),
    `${Math.round(r.personSeen * 100)}%`,
    passes(r) ? '✅' : '❌',
  ];
  for (const c of cells) {
    const td = document.createElement('td');
    td.textContent = c;
    row.append(td);
  }
  $('tbody').append(row);
  $('table').hidden = false;
}

async function run(): Promise<void> {
  running = true;
  $<HTMLButtonElement>('.run').disabled = true;
  $('tbody').replaceChildren();
  $('.caveats').replaceChildren();
  $('.verdict').hidden = true;
  const results: BenchResult[] = [];
  for (const [i, t] of TESTS.entries()) {
    const r = await runOne(t.model, t.res, i);
    if (typeof r === 'string') {
      $('.caveats').insertAdjacentHTML('beforeend', `<li>${r}</li>`);
      continue;
    }
    results.push(r);
    addRow(r);
  }
  camera.stop();
  preview.srcObject = null;
  $('.progress').hidden = true;

  const v = verdict(results);
  const box = $('.verdict');
  box.hidden = false;
  box.className = `verdict ${v.verdict.toLowerCase()}`;
  box.innerHTML = `<strong>TV can run this on its own: ${v.verdict}</strong><span>${v.summary}</span>`;
  for (const c of caveats(results)) $('.caveats').insertAdjacentHTML('beforeend', `<li>${c}</li>`);
  (window as unknown as { benchResults: unknown }).benchResults = { results, verdict: v };

  $<HTMLButtonElement>('.run').disabled = false;
  $<HTMLButtonElement>('.run').textContent = '↻ Run again';
  running = false;
  requestAnimationFrame(idle);
}

$('.run').addEventListener('click', () => void run());
if (params.has('auto')) void run();
