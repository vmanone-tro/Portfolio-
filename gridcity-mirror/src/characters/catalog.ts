// The character lineup: public/characters/characters.json. Characters are data, not code —
// broken entries are skipped (and reported in the debug panel) instead of crashing the booth.
import { assetUrl } from '../config/settings';

export type Hand = 'left' | 'right';
/** Finger pose while holding a prop. `pistol` keeps the index finger out on the trigger. */
export type GripStyle = 'pistol' | 'fist' | 'open';

export interface PropSpec {
  /** glTF/GLB file. Convention: grip at the origin, forward (barrel/blade) along +Z, top along +Y. */
  model: string;
  /** Which of the GUEST's hands holds it (mirroring is handled for you). */
  hand: Hand;
  grip: GripStyle;
  /** Fine-tuning in the hand's frame: metres, degrees, uniform scale. */
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
}

export interface CharacterSpec {
  id: string;
  name: string;
  game: string;
  tagline: string;
  model: string;
  thumb: string;
  background: string;
  scale: number;
  yOffset: number;
  enabled: boolean;
  license: string;
  props: PropSpec[];
}

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isVec3 = (v: unknown): v is [number, number, number] =>
  Array.isArray(v) && v.length === 3 && v.every(isNum);

function parseProp(raw: unknown, where: string, warnings: string[]): PropSpec | null {
  if (!raw || typeof raw !== 'object') {
    warnings.push(`${where}: prop is not an object — skipped`);
    return null;
  }
  const r = raw as Record<string, unknown>;
  if (!isStr(r.model) || !r.model) {
    warnings.push(`${where}: prop has no "model" — skipped`);
    return null;
  }
  const hand: Hand = r.hand === 'left' ? 'left' : 'right';
  if (r.hand !== undefined && r.hand !== 'left' && r.hand !== 'right')
    warnings.push(`${where}: prop "hand" must be "left" or "right" — using right`);
  const grip: GripStyle = r.grip === 'fist' || r.grip === 'open' ? r.grip : 'pistol';
  return {
    model: r.model,
    hand,
    grip,
    position: isVec3(r.position) ? r.position : [0, 0, 0],
    rotation: isVec3(r.rotation) ? r.rotation : [0, 0, 0],
    scale: isNum(r.scale) && r.scale > 0 ? r.scale : 1,
  };
}

/** Pure — unit tested. */
export function parseCatalog(raw: unknown): { characters: CharacterSpec[]; warnings: string[] } {
  const warnings: string[] = [];
  if (!Array.isArray(raw)) return { characters: [], warnings: ['characters.json must be a list [ … ]'] };
  const seen = new Set<string>();
  const characters: CharacterSpec[] = [];
  raw.forEach((entry, i) => {
    const where = `characters.json #${i + 1}`;
    if (!entry || typeof entry !== 'object') {
      warnings.push(`${where}: not an object — skipped`);
      return;
    }
    const e = entry as Record<string, unknown>;
    const id = isStr(e.id) && e.id.trim() ? e.id.trim() : '';
    if (!id) return void warnings.push(`${where}: missing "id" — skipped`);
    if (seen.has(id)) return void warnings.push(`${where}: duplicate id "${id}" — skipped`);
    if (!isStr(e.model) || !e.model) return void warnings.push(`${where} (${id}): missing "model" — skipped`);
    if (e.enabled === false) return;
    if (!isStr(e.thumb) || !e.thumb) warnings.push(`${where} (${id}): no "thumb" picture yet`);
    seen.add(id);
    characters.push({
      id,
      name: isStr(e.name) && e.name ? e.name : id,
      game: isStr(e.game) ? e.game : '',
      tagline: isStr(e.tagline) ? e.tagline : '',
      model: e.model,
      thumb: isStr(e.thumb) ? e.thumb : '',
      background: isStr(e.background) ? e.background : '',
      scale: isNum(e.scale) && e.scale > 0 ? e.scale : 1,
      yOffset: isNum(e.yOffset) ? e.yOffset : 0,
      enabled: true,
      license: isStr(e.license) ? e.license : '',
      props: Array.isArray(e.props)
        ? e.props
            .map((p, j) => parseProp(p, `${where} (${id}) prop ${j + 1}`, warnings))
            .filter((p): p is PropSpec => p !== null)
        : [],
    });
  });
  if (!characters.length) warnings.push('characters.json has no usable characters');
  return { characters, warnings };
}

export async function loadCatalog(): Promise<{ characters: CharacterSpec[]; warnings: string[] }> {
  try {
    const res = await fetch(assetUrl('characters/characters.json'), { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseCatalog(await res.json());
  } catch (err) {
    return { characters: [], warnings: [`characters.json could not be read: ${(err as Error).message}`] };
  }
}
