# Product Spec — Grid City VR Avatar Mirror

## Goal
Pull people into the Grid City VR booth. In under 3 seconds of standing in front of the screen, a passerby should see "that's me — as a character from Grid City." Then they ask about bookings.

## The booth experience (guest's view)
1. **Attract mode** (nobody in front): screen loops the character lineup — characters idling/posing, Grid City logo, big prompt: **"STEP IN — BECOME A CHARACTER"**.
2. **Someone steps in** (full upper body visible for ~0.5s): quick flash/transition, a character appears and starts copying their moves immediately.
3. **Playing:** character mirrors them live. On-screen card shows the character name + "Play this at Grid City VR". Small hint: **"Raise your hand to switch characters."**
4. **Switch:** guest holds a hand above their head for ~1 second → a ring fills up around the hand indicator → next character swaps in with a transition. **Or** taps/swipes the touchscreen (character thumbnails shown along the bottom edge).
5. **Auto-rotate:** if they don't switch, character changes every 20s (configurable) so they see the range.
6. **Leave:** if no person is detected for 3s → back to attract mode.
7. **(Phase 5) Photo:** "Both hands up for a photo" → 3-2-1 countdown → snapshot of the character view (+ optional small picture-in-picture of the real person) → QR code on screen to download it.

## Functional requirements
| # | Requirement | Phase |
|---|---|---|
| F1 | Live webcam body tracking (head, torso, arms, hands-as-wrists, hips, legs if visible) | 1 |
| F2 | Rigged 3D character copies the person's pose, mirrored | 2 |
| F3 | Works with upper body only (legs stay in a neutral stance if not visible) | 2 |
| F4 | Smooth motion — no jitter or snapping (filtering on landmarks) | 2 |
| F5 | Character lineup loaded from `characters.json` | 3 |
| F6 | Hand-raise gesture to switch; auto-rotate timer | 3 |
| F7 | Attract / detected / playing / leave state machine | 3 |
| F8 | Grid City branding overlay, per-character background | 4 |
| F9 | Two people at once (two characters side by side) | 4 |
| F10 | Operator hotkeys + settings file | 4 |
| F11 | Photo capture + QR download (optional, opt-in) | 5 |

## Operator controls (keyboard, for V/staff)
- `D` debug panel (fps, tracking confidence, camera, errors, skeleton overlay)
- `→ / ←` next / previous character
- `A` force attract mode
- `S` toggle show real camera feed in a corner (off by default)
- `C` cycle cameras
- `F` fullscreen
- `P` toggle photo feature on/off

## Settings (`public/config.json`) — editable without rebuilding
```json
{
  "orientation": "portrait",
  "quality": "auto",
  "poseModel": "full",
  "renderScale": 1.0,
  "touchEnabled": true,
  "cameraDeviceLabel": "",
  "cameraResolution": [1280, 720],
  "mirror": true,
  "maxPeople": 1,
  "autoRotateSeconds": 20,
  "switchHoldSeconds": 1.0,
  "leaveTimeoutSeconds": 3,
  "minPoseConfidence": 0.5,
  "smoothing": 0.6,
  "showCameraPiP": false,
  "photoEnabled": false,
  "attractPrompt": "STEP IN — BECOME A CHARACTER",
  "ctaText": "Play this at Grid City VR",
  "ctaUrl": ""
}
```

## Non-functional requirements
- **Offline:** runs with no internet. (Photo QR in Phase 5 is the only thing that may need a connection; it must fail gracefully to "Photo saved at the booth — ask staff".)
- **Hardware:** Apolosign 32" portable TV, portrait by default. Must run in Mode A (on the TV) or Mode B (laptop → HDMI) — see EVENT_SETUP.md.
- **Performance:** Mode B ≥30 fps with 1 person, ≥24 with 2. Mode A ≥24 fps with 1 person (auto-drops quality to hit it; 2-person mode only if the benchmark allows).
- **Battery (Mode A):** whole app should comfortably last a 4–6 hr event on the TV battery; show a small battery warning below 20% (Battery Status API where available).
- **Latency:** movement → character response feels instant (<100 ms target).
- **Startup:** double-click a launcher → fullscreen app running in <15s, no clicks needed.
- **Reliability:** runs 8+ hours unattended. Camera unplug/replug recovers on its own.
- **Lighting:** must still track in typical convention-hall lighting; show a "move closer / step into the light" hint when confidence is low.
- **Privacy:** no recording, no storage, no network by default. A small on-screen note: "Camera is used live only — nothing is recorded."

## Out of scope for v1
Finger tracking, facial expressions, full-body physics/clothing simulation, cloud accounts, analytics dashboards. (Possible later: simple local counter of "sessions per hour" for V's booth ROI — ask V.)

## Open questions for V (developer: don't block on these — use the defaults noted)
1. **Which characters?** Default: build with 2–3 free placeholder VRM avatars until V supplies the real lineup.
2. **Do you have the rights to use each game's characters at a public promo booth?** See CHARACTER_PACKS.md. Default: placeholders/originals only.
3. **Photo feature wanted?** Default: built in Phase 5, shipped turned off.
4. **TV orientation:** portrait (default — fits a standing person, and it's how the camera mounts) or landscape for 2-person mode?
5. **Does the 8MP camera show up when plugged into the TV itself** (test: open the TV's Camera app or a Google Meet test call)? Needed for Mode A.
