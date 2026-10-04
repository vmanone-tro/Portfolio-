# Grid City Mirror

## How to start it at an event (current: Phase 2 — you drive one character, fingers + props; double-click launcher arrives in Phase 4)
1. TV in portrait, camera on top, camera USB + HDMI into the laptop.
2. Open Terminal in this folder and run: `npm run build && npm run preview` (first time ever: `npm install` while online).
3. In Chrome open **http://localhost:4173**, allow the camera, press **F** for fullscreen.
4. Press **D** any time to show/hide the debug panel (fps, camera, errors).
5. Nothing is recorded and nothing goes on the internet — the app runs fully offline.

---

Event-booth kiosk for Grid City VR: guests stand in front of a TV and see themselves, live and
mirrored, as a 3D character from the Grid City lineup. Planning docs: [`CLAUDE.md`](CLAUDE.md) and
[`docs/`](docs/). Status: [`docs/PROGRESS.md`](docs/PROGRESS.md).

## Pages

| URL                   | What                                                               |
| --------------------- | ------------------------------------------------------------------ |
| `/`                   | The mirror app (Phase 2: the guest drives a 3D character)          |
| `/?mock=wave`         | Preview with a fake guest, no camera (`wave`, `dance`, `tpose`, `arms-up`, `upper-body`) |
| `/bench/`             | Device benchmark — can the TV run the app by itself?               |
| `/?debug=1`           | Start with the debug panel open                                    |
| `/?quality=low`       | Any `config.json` setting can be overridden in the URL             |

Hosted test build (HTTPS, for the TV): `https://vmanone-tro.github.io/Portfolio-/` — published by
GitHub Actions once Pages is enabled (see `docs/PROGRESS.md`).

## Operator keys (so far)

| Key | Action                                    |
| --- | ----------------------------------------- |
| D   | Debug panel                               |
| C   | Next camera                               |
| F   | Fullscreen                                |
| S   | Show / hide the small real-camera view    |

## Developer commands

```sh
npm install            # installs + copies MediaPipe WASM + downloads pose models into public/mediapipe/
npm run dev            # dev server on http://localhost:5173
npm run build          # type-check + production build into dist/
npm run preview        # serve dist/ on http://localhost:4173
npm test               # unit tests (Vitest)
npm run lint           # ESLint + Prettier
npm run fetch-models   # re-download MediaPipe files
npm run make-placeholders  # regenerate the original placeholder VRM characters
```

Settings live in [`public/config.json`](public/config.json) (editable without rebuilding; bad values
fall back to defaults and show up in the debug panel).

## Privacy & offline guarantees

- Camera frames stay in memory in the browser; nothing is saved or uploaded.
- The production build carries a Content-Security-Policy that only allows the page's own origin, so
  the browser blocks any outside connection.
- MediaPipe's built-in usage telemetry (it phones Google every 60 s) is stripped at build time; the
  build fails if it ever reappears.
