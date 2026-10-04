# CLAUDE.md — Grid City VR "Avatar Mirror"

You are the software developer on this project. V (owner of Grid City VR) is the product owner and is **not** a developer. A separate planning session wrote these docs; follow them.

## What we're building
A kiosk app for event booths. A person stands in front of a TV with a webcam on top. The app tracks their body and shows them, live and mirrored, as a 3D character from Grid City VR's lineup. It's a crowd-magnet: walk up, see yourself as a character, wave to switch characters, (later) grab a photo.

Read these before writing code, in this order:
1. `docs/PRODUCT_SPEC.md` — what it must do and the booth experience
2. `docs/BUILD_PLAN.md` — phased milestones; build one phase at a time
3. `docs/CHARACTER_PACKS.md` — how characters are added (data-driven, no code changes)
4. `docs/EVENT_SETUP.md` — the hardware it runs on (useful for perf targets)

## Stack (decided — don't swap without asking V)
- **Vite + TypeScript**, plain DOM UI (no React needed for v1)
- **@mediapipe/tasks-vision** — `PoseLandmarker` (full model) for body tracking, runs in the browser on GPU
- **three.js** + **@pixiv/three-vrm** — renders rigged VRM avatars
- **kalidokit** — converts pose landmarks into bone rotations for VRM (if it misbehaves, write our own solver in `src/tracking/solver.ts`; keep the same interface)
- Runs in **Chrome**, fully **offline** — all models, WASM, and assets bundled locally. No CDN calls at runtime.

## Target hardware (important — read docs/EVENT_SETUP.md)
The booth screen is an **Apolosign 32" Smart Portable TV**: Android 16 touchscreen (unnamed octa-core chip, 16GB RAM), Google Play + Chrome, HDMI in, 6-hr battery, rotates landscape↔portrait, and an **8MP USB-A camera** that mounts on the top edge (portrait). The same web app must support two run modes:
- **Mode A — "TV only":** runs in Chrome on the TV itself as an installable **PWA** (service worker caches everything for offline). Camera plugged into the TV. Cordless, cleanest booth. *Performance unknown* — Phase 1 includes a benchmark to decide if this is viable.
- **Mode B — "Laptop + TV" (guaranteed fallback):** V's MacBook Pro runs the app on `localhost`, outputs to the TV via HDMI, camera plugged into the laptop (USB-C→USB-A adapter).
- **Default orientation is PORTRAIT (1080×1920)** — a person standing in front fills a tall screen like a mirror. Landscape must still work (config switch).
- The screen is a **touchscreen** — add tap/swipe as a second way to switch characters alongside the hand-raise gesture.
- Camera access in Chrome requires a secure origin: `localhost` in Mode B; in Mode A, host the built PWA on HTTPS (Vercel/Netlify/Supabase static hosting are fine) and let the service worker make it work offline after the first load.

## Hard rules
- **Offline-first.** Event Wi-Fi is unreliable. The app must start and run with the network unplugged. Bundle MediaPipe WASM + `.task` model files in `public/`.
- **No video or images leave the machine or get saved to disk** unless the Photo feature (Phase 5) is on *and* the guest pressed/gestured to take a photo. Never log camera frames.
- **Characters are data, not code.** Adding a character = drop files in `public/characters/<id>/` + an entry in `characters.json`. No code edits.
- **Never crash in front of a crowd.** Any error (camera unplugged, model fails to load, tracking lost) falls back to the attract screen and retries. Wrap the render loop; log errors to an on-screen debug panel hidden behind a hotkey.
- **Mirror the image** (selfie view) — guests raise their right hand, the character on their right side moves.
- Target **30+ fps** in Mode B; in Mode A, **24+ fps** is acceptable. Show an fps counter in debug mode. Add a "quality" setting (pose model lite/full, camera resolution, render scale) so the TV can trade detail for speed.

## Working style
- V prefers plain language and step-by-step instructions. When you need V to do something (plug in, test, approve), give numbered steps that assume no technical background.
- Verify things yourself (run the build, run tests, check the console) instead of asking V to read error output.
- At the end of each phase: run `npm run build`, confirm it works offline (`npm run preview` with network off where possible), update `docs/PROGRESS.md` with what's done / what's next / anything V must decide, then stop and summarize for V.
- Keep `README.md` with a 5-line "how to start it at an event" section at the top.

## Repo layout (target)
```
src/
  main.ts              app bootstrap + state machine
  app/state.ts         ATTRACT → DETECTED → PLAYING → (PHOTO) → ATTRACT
  camera/camera.ts     webcam selection, resolution, reconnect
  tracking/pose.ts     PoseLandmarker wrapper, smoothing
  tracking/solver.ts   landmarks → bone rotations (kalidokit wrapper)
  tracking/gestures.ts hand-raise / wave detection
  render/scene.ts      three.js scene, lights, background
  render/avatar.ts     load VRM, apply rotations, swap characters
  ui/overlay.ts        branding, character name card, prompts
  ui/debug.ts          hotkey debug panel
  config/settings.ts   reads public/config.json
public/
  config.json          event-tunable settings (see PRODUCT_SPEC)
  characters/characters.json
  characters/<id>/model.vrm, thumb.png, background.(png|mp4)
  mediapipe/           bundled wasm + pose_landmarker_full.task
  branding/            logo, fonts
docs/
```
