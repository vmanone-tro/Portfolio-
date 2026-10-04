# Character Packs — how characters are added

Characters are **data, not code**. To add one, drop a folder in `public/characters/` and add an entry to `characters.json`. No code changes, no rebuild needed in Mode B (Mode A: redeploy so the offline cache picks it up).

## Folder per character
```
public/characters/<id>/
  model.vrm          required — humanoid VRM 0.x or 1.0
  thumb.png          required — 512×512, for the touch strip + attract screen
  background.png     optional — or background.mp4 (looping, muted, ≤10 MB)
  idle.vrma          optional — idle animation for attract mode
```

## characters.json
```json
[
  {
    "id": "placeholder-pilot",
    "name": "The Pilot",
    "game": "Example VR Title",
    "tagline": "Play this at Grid City VR",
    "model": "characters/placeholder-pilot/model.vrm",
    "thumb": "characters/placeholder-pilot/thumb.png",
    "background": "characters/placeholder-pilot/background.png",
    "scale": 1.0,
    "yOffset": 0.0,
    "enabled": true,
    "license": "original / CC0 / licensed-from-<publisher> — note source here"
  }
]
```
The developer must validate this file at startup and skip (not crash on) any broken entry, showing it in the debug panel.

## Getting character models
- **VRM is the format.** Most game characters don't ship as VRM, so each one needs converting/rigging into a VRM humanoid (Blender + the VRM add-on, or Unity + UniVRM). A 3D artist can do this; budget per character.
- **Free placeholders for development:** VRoid Studio (make originals for free), VRoid Hub models whose license allows commercial use.
- **Performance budget per model (important for Mode A on the TV):** ≤ 40k triangles, ≤ 4 textures at ≤ 2048px, ≤ 1 material per body part where possible. The developer should log a warning in debug mode when a model is over budget.

## ⚠️ Rights to the characters
Showing a game's characters at a public booth to promote your business is a use the game's publisher controls. Having a commercial/arcade license to *run* a VR game usually doesn't by itself include using its characters' 3D models in your own marketing software. Before an event, for each character:
- Check the publisher's commercial/location-based (LBE) license or brand guidelines, or ask the publisher directly — many are happy to approve promo use for venues that run their games.
- Record what you got in the `license` field above.
- Until a character is cleared, use original Grid City characters (e.g. VRoid-made mascots themed on each game's genre: "the space ranger", "the zombie hunter", "the racer"). These are yours outright and can still be labeled "Play [Game] at Grid City VR" in text.

This is the same kind of check you did for X-Plane's commercial licensing. Not legal advice — when in doubt, ask the publisher.

## Props (guns, swords, items) — added by the developer
A character can hold items. Add a `props` list to its entry in `characters.json`:
```json
"props": [
  {
    "model": "characters/grid-runner/blaster.glb",
    "hand": "right",
    "grip": "pistol",
    "position": [0, 0, 0],
    "rotation": [0, 0, 0],
    "scale": 1.0
  }
]
```
- `model` — a `.glb` file in the character's folder. **Build it so the handle (where the palm holds it) is at the origin, the front (barrel/blade) points along +Z, and the top points along +Y**, in metres. Then it sits correctly in any character's hand with no tuning.
- `hand` — which of the **guest's** hands holds it (`"right"` or `"left"`). The app handles mirroring.
- `grip` — finger pose while holding: `"pistol"` (trigger finger out), `"fist"` (swords, handles, torches), `"open"`.
- `position` (metres), `rotation` (degrees, X/Y/Z), `scale` — optional fine-tuning if an item sits slightly off.
- Budget: keep each prop small (≤ 5k triangles, one 1024px texture) — it is drawn every frame.
- Props can also be built straight into the VRM by the 3D artist (parented to the hand bone); the `props` list is just quicker to change.
