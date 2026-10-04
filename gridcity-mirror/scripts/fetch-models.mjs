// Copies the MediaPipe WASM runtime and downloads the pose models into
// public/mediapipe/ so the app never touches the internet at runtime.
//
//   npm run fetch-models            (re)fetch everything
//   node scripts/fetch-models.mjs --if-missing   only fetch what's missing (runs after npm install)
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'mediapipe');
const wasmSrc = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const wasmOut = join(outDir, 'wasm');
const ifMissing = process.argv.includes('--if-missing');

const WASM_FILES = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
];

const MODELS = {
  'pose_landmarker_lite.task':
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  'pose_landmarker_full.task':
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
};

const present = (p) => existsSync(p) && statSync(p).size > 0;

async function download(url, dest) {
  const tmp = `${dest}.part`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
  } catch (err) {
    // Node's fetch ignores HTTP(S)_PROXY; curl respects it.
    console.log(`  fetch failed (${err.message}), trying curl…`);
    execFileSync('curl', ['-fsSL', '--retry', '3', '-o', tmp, url], { stdio: 'inherit' });
  }
  renameSync(tmp, dest);
}

async function main() {
  mkdirSync(wasmOut, { recursive: true });

  if (!existsSync(wasmSrc)) {
    console.error('MediaPipe is not installed yet — run `npm install` first.');
    process.exit(1);
  }
  for (const f of WASM_FILES) {
    const dest = join(wasmOut, f);
    if (ifMissing && present(dest)) continue;
    copyFileSync(join(wasmSrc, f), dest);
    console.log(`copied  mediapipe/wasm/${f}`);
  }

  for (const [name, url] of Object.entries(MODELS)) {
    const dest = join(outDir, name);
    if (ifMissing && present(dest)) continue;
    console.log(`download mediapipe/${name}`);
    try {
      await download(url, dest);
    } catch (err) {
      console.error(
        `\n  Could not download ${name}. Connect to the internet and run: npm run fetch-models\n`,
      );
      if (!ifMissing) throw err;
    }
  }
  console.log('MediaPipe files ready in public/mediapipe/');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
