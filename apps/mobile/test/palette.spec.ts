import { describe, expect, it } from 'vitest';
import { contrast, DARK, LIGHT, NAVY, paletteFor, schemeOf, statusBarStyle, TEXT_ON, type Palette } from '../src/palette';

describe('palette', () => {
  it('follows the phone, light when it says nothing', () => {
    expect(schemeOf('dark')).toBe('dark');
    expect(schemeOf('light')).toBe('light');
    expect(schemeOf(null)).toBe('light');
    expect(schemeOf(undefined)).toBe('light');
    expect(schemeOf('unspecified')).toBe('light');
    expect(paletteFor('dark')).toBe(DARK);
    expect(paletteFor('light')).toBe(LIGHT);
  });

  it('uses light status bar icons on the dark page', () => {
    expect(statusBarStyle('dark')).toBe('light');
    expect(statusBarStyle('light')).toBe('dark');
  });

  it('works out contrast like WCAG', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(contrast(NAVY, '#ffffff')).toBeGreaterThan(15);
    expect(() => contrast('navy', '#fff')).toThrow();
  });

  it('has the same colours in both modes', () => {
    expect(Object.keys(DARK).sort()).toEqual(Object.keys(LIGHT).sort());
  });

  for (const [name, p] of [['light', LIGHT], ['dark', DARK]] as [string, Palette][]) {
    it(`keeps every text readable in ${name} mode (4.5:1)`, () => {
      const low = TEXT_ON.flatMap(([fg, bgs]) => bgs.map(bg => ({ fg, bg, ratio: contrast(p[fg], p[bg]) }))).filter(x => x.ratio < 4.5);
      expect(low).toEqual([]);
    });
  }

  it("keeps the web's dark page and orange buttons", () => {
    expect(DARK.bg).toBe('#0b1426');
    expect(DARK.button).toBe('#f26b1d');
    expect(DARK.onButton).toBe(NAVY);
    expect(LIGHT.button).toBe(NAVY);
  });
});
