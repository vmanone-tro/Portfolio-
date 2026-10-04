import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseQuery, parseSettings } from '../src/config/settings';
import shipped from '../public/config.json';

describe('parseSettings', () => {
  it('accepts the shipped public/config.json without warnings', () => {
    const { settings, warnings } = parseSettings(shipped);
    expect(warnings).toEqual([]);
    expect(settings.orientation).toBe('portrait');
    expect(settings.poseModel).toBe('full');
  });

  it('falls back to defaults for bad values and reports them', () => {
    const { settings, warnings } = parseSettings({ maxPeople: 7, mirror: 'yes', cameraResolution: [10] });
    expect(settings.maxPeople).toBe(DEFAULT_SETTINGS.maxPeople);
    expect(settings.mirror).toBe(true);
    expect(settings.cameraResolution).toEqual([1280, 720]);
    expect(warnings).toHaveLength(3);
  });

  it('ignores unknown keys with a warning', () => {
    const { warnings } = parseSettings({ colour: 'red' });
    expect(warnings[0]).toMatch(/unknown setting "colour"/);
  });

  it('survives a non-object file', () => {
    expect(parseSettings([1, 2]).settings).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('oops').warnings).toHaveLength(1);
    expect(parseSettings(undefined).warnings).toHaveLength(0);
  });

  it('applies quality presets over the individual fields', () => {
    const low = parseSettings({ quality: 'low', poseModel: 'full' }).settings;
    expect(low.poseModel).toBe('lite');
    expect(low.cameraResolution).toEqual([640, 480]);
    const auto = parseSettings({ quality: 'auto', poseModel: 'lite', renderScale: 0.5 }).settings;
    expect(auto.poseModel).toBe('lite');
    expect(auto.renderScale).toBe(0.5);
  });

  it('does not share the default resolution array between results', () => {
    const a = parseSettings({}).settings;
    a.cameraResolution[0] = 1;
    expect(DEFAULT_SETTINGS.cameraResolution[0]).toBe(1280);
  });
});

describe('parseQuery', () => {
  it('types URL overrides by the default value type', () => {
    expect(parseQuery('?debug&maxPeople=2&cameraResolution=640x480&mirror=0&poseModel=lite')).toEqual({
      debug: true,
      maxPeople: 2,
      cameraResolution: [640, 480],
      mirror: false,
      poseModel: 'lite',
    });
  });

  it('lets URL values flow through validation', () => {
    const base = parseSettings({}).settings;
    const { settings, warnings } = parseSettings(parseQuery('?maxPeople=abc'), base);
    expect(settings.maxPeople).toBe(1);
    expect(warnings).toHaveLength(1);
  });
});
