import { describe, expect, it } from 'vitest';
import { parseCatalog } from '../src/characters/catalog';
import shipped from '../public/characters/characters.json';

describe('parseCatalog', () => {
  it('accepts the shipped characters.json', () => {
    const { characters } = parseCatalog(shipped);
    expect(characters.length).toBeGreaterThan(0);
    expect(characters[0].props[0]).toMatchObject({ hand: 'right', grip: 'pistol' });
  });

  it('skips broken entries instead of failing', () => {
    const { characters, warnings } = parseCatalog([
      { id: 'ok', model: 'a.vrm', thumb: 't.png' },
      { id: 'ok', model: 'dup.vrm' },
      { name: 'no id', model: 'b.vrm' },
      { id: 'no-model' },
      'nonsense',
      { id: 'off', model: 'c.vrm', enabled: false },
    ]);
    expect(characters.map((c) => c.id)).toEqual(['ok']);
    expect(warnings).toHaveLength(4);
  });

  it('fills defaults and validates props', () => {
    const { characters, warnings } = parseCatalog([
      {
        id: 'x',
        model: 'x.vrm',
        thumb: 't',
        props: [{ model: 'gun.glb', hand: 'middle', position: [1] }, { hand: 'left' }],
      },
    ]);
    expect(characters[0].props).toEqual([
      { model: 'gun.glb', hand: 'right', grip: 'pistol', position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
    ]);
    expect(characters[0].name).toBe('x');
    expect(warnings.length).toBe(2);
  });

  it('survives a file that is not a list', () => {
    expect(parseCatalog({}).characters).toEqual([]);
  });
});
