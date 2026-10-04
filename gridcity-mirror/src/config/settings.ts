// Reads public/config.json (event-tunable, no rebuild needed) and merges it over defaults.
// Bad values never crash the app: they fall back to the default and are reported as warnings
// in the debug panel.

export type Orientation = 'portrait' | 'landscape';
export type Quality = 'auto' | 'low' | 'medium' | 'high';
export type PoseModel = 'lite' | 'full';

export interface Settings {
  orientation: Orientation;
  quality: Quality;
  poseModel: PoseModel;
  renderScale: number;
  touchEnabled: boolean;
  cameraDeviceLabel: string;
  cameraResolution: [number, number];
  mirror: boolean;
  maxPeople: number;
  autoRotateSeconds: number;
  switchHoldSeconds: number;
  leaveTimeoutSeconds: number;
  minPoseConfidence: number;
  /** Track 21 points per hand (fingers + precise wrist aim). Costs extra processing. */
  handTracking: boolean;
  smoothing: number;
  showCameraPiP: boolean;
  photoEnabled: boolean;
  attractPrompt: string;
  ctaText: string;
  ctaUrl: string;
  /** Not in config.json by default; `?debug=1` opens the debug panel at startup. */
  debug: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  orientation: 'portrait',
  quality: 'auto',
  poseModel: 'full',
  renderScale: 1.0,
  touchEnabled: true,
  cameraDeviceLabel: '',
  cameraResolution: [1280, 720],
  mirror: true,
  maxPeople: 1,
  autoRotateSeconds: 20,
  switchHoldSeconds: 1.0,
  leaveTimeoutSeconds: 3,
  minPoseConfidence: 0.5,
  handTracking: true,
  smoothing: 0.6,
  showCameraPiP: false,
  photoEnabled: false,
  attractPrompt: 'STEP IN — BECOME A CHARACTER',
  ctaText: 'Play this at Grid City VR',
  ctaUrl: '',
  debug: false,
};

/** Fixed presets; `auto` uses poseModel / cameraResolution / renderScale exactly as written. */
export const QUALITY_PRESETS: Record<
  Exclude<Quality, 'auto'>,
  Pick<Settings, 'poseModel' | 'cameraResolution' | 'renderScale'>
> = {
  low: { poseModel: 'lite', cameraResolution: [640, 480], renderScale: 0.75 },
  medium: { poseModel: 'full', cameraResolution: [960, 540], renderScale: 0.85 },
  high: { poseModel: 'full', cameraResolution: [1280, 720], renderScale: 1.0 },
};

type Validator = (v: unknown) => boolean;

const isNum =
  (min: number, max: number): Validator =>
  (v) =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const isInt =
  (min: number, max: number): Validator =>
  (v) =>
    isNum(min, max)(v) && Number.isInteger(v);
const isBool: Validator = (v) => typeof v === 'boolean';
const isStr: Validator = (v) => typeof v === 'string';
const oneOf =
  (...opts: string[]): Validator =>
  (v) =>
    typeof v === 'string' && opts.includes(v);

const VALIDATORS: Record<keyof Settings, Validator> = {
  orientation: oneOf('portrait', 'landscape'),
  quality: oneOf('auto', 'low', 'medium', 'high'),
  poseModel: oneOf('lite', 'full'),
  renderScale: isNum(0.25, 2),
  touchEnabled: isBool,
  cameraDeviceLabel: isStr,
  cameraResolution: (v) =>
    Array.isArray(v) && v.length === 2 && isInt(160, 4096)(v[0]) && isInt(120, 4096)(v[1]),
  mirror: isBool,
  maxPeople: isInt(1, 2),
  autoRotateSeconds: isNum(0, 3600),
  switchHoldSeconds: isNum(0.2, 10),
  leaveTimeoutSeconds: isNum(0.5, 60),
  minPoseConfidence: isNum(0, 1),
  handTracking: isBool,
  smoothing: isNum(0, 1),
  showCameraPiP: isBool,
  photoEnabled: isBool,
  attractPrompt: isStr,
  ctaText: isStr,
  ctaUrl: isStr,
  debug: isBool,
};

export interface ParsedSettings {
  settings: Settings;
  warnings: string[];
}

/** Merge raw JSON over defaults, keeping only valid values. Pure — unit tested. */
export function parseSettings(raw: unknown, base: Settings = DEFAULT_SETTINGS): ParsedSettings {
  const settings: Settings = { ...base, cameraResolution: [...base.cameraResolution] };
  const warnings: string[] = [];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    if (raw !== undefined) warnings.push('config.json is not a JSON object — using defaults');
    return { settings: applyQuality(settings), warnings };
  }
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!(key in VALIDATORS)) {
      warnings.push(`config: unknown setting "${key}" ignored`);
      continue;
    }
    const k = key as keyof Settings;
    if (VALIDATORS[k](value)) {
      (settings as unknown as Record<string, unknown>)[k] = Array.isArray(value) ? [...value] : value;
    } else {
      warnings.push(
        `config: bad value for "${key}" (${JSON.stringify(value)}) — using ${JSON.stringify(base[k])}`,
      );
    }
  }
  return { settings: applyQuality(settings), warnings };
}

export function applyQuality(s: Settings): Settings {
  if (s.quality === 'auto') return s;
  const p = QUALITY_PRESETS[s.quality];
  return { ...s, ...p, cameraResolution: [...p.cameraResolution] };
}

/** Turns `?maxPeople=2&debug=1&cameraResolution=640x480` into typed values. */
export function parseQuery(search: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of new URLSearchParams(search)) {
    const def: unknown = DEFAULT_SETTINGS[key as keyof Settings];
    if (typeof def === 'boolean') out[key] = ['', '1', 'true', 'yes', 'on'].includes(value.toLowerCase());
    else if (typeof def === 'number') out[key] = value.trim() === '' ? NaN : Number(value);
    else if (Array.isArray(def)) out[key] = value.split(/[x,]/).map(Number);
    else out[key] = value;
  }
  return out;
}

/** URL of a file in public/, correct whether hosted at / or under a sub-folder. */
export function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`;
}

export async function loadSettings(): Promise<ParsedSettings> {
  let raw: unknown;
  const warnings: string[] = [];
  try {
    const res = await fetch(assetUrl('config.json'), { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    raw = await res.json();
  } catch (err) {
    warnings.push(`config.json could not be read (${(err as Error).message}) — using defaults`);
  }
  const fromFile = parseSettings(raw);
  const fromUrl = parseSettings(parseQuery(location.search), fromFile.settings);
  return { settings: fromUrl.settings, warnings: [...warnings, ...fromFile.warnings, ...fromUrl.warnings] };
}
