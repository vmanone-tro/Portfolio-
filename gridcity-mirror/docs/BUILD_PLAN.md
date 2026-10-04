# Build Plan — phased

Build one phase at a time. Each phase ends with a working, runnable app and a "V test" — a short checklist V can do in front of the camera with no technical knowledge. Stop after each phase and report to V.

---

## Phase 0 — Project setup (½ day)
- Vite + TypeScript scaffold, ESLint/Prettier, `npm run dev | build | preview`.
- Install `three`, `@pixiv/three-vrm`, `@mediapipe/tasks-vision`, `kalidokit`.
- Copy MediaPipe WASM files and `pose_landmarker_full.task` into `public/mediapipe/` (script: `npm run fetch-models`, run once while online). Point the library at local paths.
- `public/config.json` loader with defaults.
- Create `docs/PROGRESS.md`.

**Done when:** `npm run build && npm run preview` serves a blank page with no network requests outside localhost (check DevTools Network tab).

---

## Phase 1 — See the skeleton (1 day)
- Camera picker (`camera.ts`): enumerate devices, prefer `config.cameraDeviceLabel`, 1280×720, handle permission denied / unplugged with a friendly on-screen message + auto-retry every 3s.
- `PoseLandmarker` in VIDEO mode, GPU delegate, `numPoses = config.maxPeople`.
- Draw mirrored camera feed + skeleton lines over it (debug view).
- fps + confidence in debug panel (`D`).

- **Deploy a test build to HTTPS** (Vercel/Netlify) so it can be opened in Chrome on the Apolosign TV.
- **Device benchmark page** (`/bench`): runs pose tracking with lite vs full model at 640×480 and 1280×720 for 20s each and shows a plain results table (fps per setting + a big green/yellow/red verdict "TV can run this on its own: YES / MAYBE / NO"). Also renders a test VRM so GPU rendering cost is included.

**V test:**
1. On the laptop: open the app, stand in front of the camera, see stick-figure lines follow your arms. Unplug the camera → friendly message. Plug back in → it recovers by itself.
2. On the TV: open the link the developer gives you in Chrome, allow the camera, tap "Run benchmark," wait ~2 minutes, take a photo of the result screen and send it back.

**Decision point after Phase 1:** benchmark green → build for Mode A first (PWA on the TV). Yellow → Mode A with "lite" quality, 1 person only. Red → Mode B (laptop + HDMI) is the event setup; the TV is just the screen + camera.

---

## Phase 2 — Become a character (2–3 days) ← the core
- three.js scene: perspective camera framed for a standing person, soft 3-point lighting, simple floor/background.
- Load one VRM (placeholder). Use `pose.worldLandmarks` → kalidokit `Pose.solve` → apply to VRM humanoid bones (hips, spine, chest, neck, head, upper/lower arms, hands, upper/lower legs).
- Mirror correctly (left/right swapped so it acts like a mirror).
- **Smoothing:** One-Euro filter or lerp/slerp on landmarks and rotations; tune with `config.smoothing`.
- **Upper-body-only mode:** if hip/knee/ankle visibility < threshold, lock legs to a neutral idle pose and keep the character standing (no sinking/folding).
- Body position: move the character left/right on screen as the person moves (gentle, clamped).
- Hide the camera feed (optional PiP via `S`).

**V test:** Wave, raise arms, turn your head, lean, step side to side. Character copies you, mirrored, without shaking. Step back so only your top half shows → character still stands normally.

**Risks:** kalidokit rotations can look odd on some models (arm twist, shoulder). If so, write a direct solver from world landmarks in `solver.ts`. Budget extra day.

---

## Phase 3 — The booth loop (1–2 days)
- `characters.json` loader; preload all characters at startup with a loading screen (so swaps are instant).
- State machine: `ATTRACT → DETECTED → PLAYING → ATTRACT` (see PRODUCT_SPEC).
- Attract mode: characters cycle with idle animation (VRMA/animation clip if provided in the pack, else a code-driven breathing/sway idle), big prompt text.
- Touch: thumbnail strip along the bottom; tap = pick that character, swipe left/right = next/prev. Large tap targets (it's a 32" screen viewed standing).
- Portrait layout first (1080×1920): character framed head-to-toe, name card at top, thumbnails at bottom. Landscape layout via `config.orientation`.
- Gestures (`gestures.ts`): one hand above head for `switchHoldSeconds` → next character; show a filling ring at the hand. Debounce so it can't double-fire.
- Auto-rotate timer; swap transition (quick flash/dissolve).
- Character name card + CTA text.

**V test:** Walk up from off-screen → character appears. Hold a hand up → ring fills → new character. Stand still 20s → character changes on its own. Walk away → back to the lineup screen in ~3s.

---

## Phase 4 — Event polish (2 days)
- Grid City branding: logo, colors, fonts from `public/branding/`. Per-character background image/video.
- Two-person mode (`maxPeople: 2`): two characters side by side, each assigned by left/right position; stable assignment so characters don't swap between people.
- Low-confidence hint ("Step into the light / step back so we can see you").
- Operator hotkeys (full list in spec).
- Hardening: global error boundary on the render loop, WebGL context-lost recovery, memory check (run 2+ hours, watch for leaks).
- **Mode A packaging:** PWA manifest (fullscreen, portrait, Grid City icon), service worker precaches every asset incl. MediaPipe wasm/model and all characters; "Ready for offline ✓" indicator in debug panel. Keep screen awake (Wake Lock API). Write plain steps for V to "Install app" from Chrome on the TV and to pin it so it launches fullscreen.
- **Mode B launcher:** a double-click script for the event machine that starts the local server and opens Chrome in kiosk mode (`--kiosk --use-fake-ui-for-media-stream` *only* if needed for auto-allowing the camera on localhost; prefer granting permission once). Provide both macOS (`.command`) and Windows (`.bat`) versions.
- README "how to start at an event" in plain steps.

**V test:** Double-click the launcher → fullscreen app, no clicks. Two people step in → two characters. Leave it running for an afternoon → still smooth.

---

## Phase 5 — Photo + QR (optional, 1–2 days, ship OFF by default)
- Trigger: both hands up for 1s (or staff hotkey). 3-2-1 countdown, flash, freeze-frame.
- Render a branded photo (character + Grid City frame + CTA). Optional small inset of the real person only if V wants it.
- Upload to a Supabase Storage bucket (V already uses Supabase) with a random unguessable filename, short expiry (e.g. 7 days auto-delete), show QR to the signed URL.
- If offline: save locally to `photos/` and show "Ask staff for your photo."
- Add a visible notice before capture: "Taking a photo — it'll be deleted after 7 days."

**V test:** Both hands up → countdown → photo → scan QR with phone → photo downloads.

---

## Testing approach
- Unit tests (Vitest) for pure logic: state machine, gesture detection, smoothing, config parsing. Feed recorded landmark sequences (JSON fixtures) — record a few with a debug "record landmarks" hotkey.
- Manual "V tests" per phase (above).
- Perf check each phase on the actual event laptop if available.

## Definition of done (v1 = Phases 0–4)
Runs offline from a double-click, tracks 1–2 people at 30 fps, swaps characters by gesture and timer, recovers from camera/GPU hiccups, runs 8 hours, and adding a new character needs zero code changes.
