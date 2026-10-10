import { describe, it, expect } from 'vitest';
import { DEFAULT_RECIPE, type Recipe } from '../src/recipe';
import { isVisible } from '../src/visibility';

const make = (patch: (r: Recipe) => void): Recipe => {
  const r = structuredClone(DEFAULT_RECIPE);
  r.lines.enabled = true; // 新預設線條關閉, 測線條參數時先打開
  patch(r);
  return r;
};

describe('isVisible', () => {
  it('層停用時只剩「啟用」', () => {
    const r = make((r) => { r.filter.enabled = false; });
    expect(isVisible('filter.enabled', r)).toBe(true);
    expect(isVisible('filter.contrast', r)).toBe(false);
    expect(isVisible('lines.thickness', r)).toBe(true);
    expect(isVisible('grade.satShadow', make((r) => { r.grade.enabled = false; }))).toBe(false);
  });

  it('色票子欄位跟著模式', () => {
    const auto = make((r) => { r.color.paletteMode = 'auto'; });
    expect(isVisible('color.autoCount', auto)).toBe(true);
    expect(isVisible('color.preset', auto)).toBe(false);
    expect(isVisible('color.custom', auto)).toBe(false);
    const custom = make((r) => { r.color.paletteMode = 'custom'; });
    expect(isVisible('color.custom', custom)).toBe(true);
    expect(isVisible('color.autoCount', custom)).toBe(false);
  });

  it('拉桿的值不影響其他參數顯示', () => {
    const extremes = make((r) => {
      r.lighting.bands = 1;
      r.keep.shade = 1;
      r.lines.pressure = 0;
      r.effects.brush = 0;
      r.effects.riso = 0;
      r.filter.outlineWidth = 0;
      r.filter.bloom = 0;
      r.filter.scan = 0;
    });
    const keys = [
      'lighting.azimuth', 'lighting.elevation', 'lighting.normalStrength', 'lighting.detailStrength',
      'lighting.shadowMode', 'lighting.shadowStrength', 'lighting.litColor', 'lighting.litStrength',
      'lighting.softness', 'lighting.edgeJitter', 'lighting.ambient', 'lighting.ao',
      'lines.pressureScale', 'effects.brushScale', 'effects.risoAngle', 'filter.outlineColor',
      'filter.bloomThreshold', 'filter.bloomRadius', 'filter.scanSpacing',
    ];
    for (const k of keys) expect(isVisible(k, extremes), k).toBe(true);
  });

  it('下拉選單選的模式決定子參數', () => {
    expect(isVisible('lighting.shadowColor', DEFAULT_RECIPE)).toBe(false);
    expect(isVisible('lighting.shadowColor', make((r) => { r.lighting.shadowMode = 'custom'; }))).toBe(true);
    expect(isVisible('lines.variationAmount', DEFAULT_RECIPE)).toBe(false);
    expect(isVisible('lines.variationAmount', make((r) => { r.lines.variation = 'shadow'; }))).toBe(true);
    expect(isVisible('lines.colorDarken', make((r) => { r.lines.colorMode = 'region'; }))).toBe(true);
    expect(isVisible('grade.presetStrength', DEFAULT_RECIPE)).toBe(false);
    expect(isVisible('grade.presetStrength', make((r) => { r.grade.preset = 'film'; }))).toBe(true);
  });

  it('核取方塊打開才顯示子參數', () => {
    const cases: [string, (r: Recipe) => void][] = [
      ['lighting.rimStrength', (r) => { r.lighting.rim = true; }],
      ['lighting.specSize', (r) => { r.lighting.specular = true; }],
      ['lighting.fillColor', (r) => { r.lighting.fill = true; }],
      ['lines.doubleOffset', (r) => { r.lines.doubleLine = true; }],
      ['effects.halftoneSize', (r) => { r.effects.halftone = true; }],
      ['effects.halftoneShadowOnly', (r) => { r.effects.halftone = true; }],
      ['effects.hatchSpacing', (r) => { r.effects.hatch = true; }],
      ['effects.crossHatch', (r) => { r.effects.hatch = true; }],
      ['effects.stippleSize', (r) => { r.effects.stipple = true; }],
      ['filter.ditherLevels', (r) => { r.filter.dither = true; }],
      ['grade.gradientStops', (r) => { r.grade.gradientMap = true; }],
    ];
    for (const [key, on] of cases) {
      expect(isVisible(key, DEFAULT_RECIPE), key).toBe(false);
      expect(isVisible(key, make(on)), key).toBe(true);
    }
  });
});
