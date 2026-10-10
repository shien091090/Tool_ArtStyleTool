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
  it('色階數 1 時陰影相關隱藏, 開邊緣光後光源方向與立體感回來', () => {
    const flat = make((r) => { r.lighting.bands = 1; });
    for (const k of ['shadowMode', 'shadowStrength', 'ambient', 'normalStrength', 'azimuth', 'elevation'])
      expect(isVisible(`lighting.${k}`, flat)).toBe(false);
    expect(isVisible('lighting.bands', flat)).toBe(true);
    const rim = make((r) => { r.lighting.bands = 1; r.lighting.rim = true; });
    expect(isVisible('lighting.normalStrength', rim)).toBe(true);
    expect(isVisible('lighting.azimuth', rim)).toBe(true);
    expect(isVisible('lighting.shadowStrength', rim)).toBe(false);
  });
  it('邊緣光參數跟著勾選', () => {
    expect(isVisible('lighting.rimStrength', DEFAULT_RECIPE)).toBe(false);
    expect(isVisible('lighting.rimColor', make((r) => { r.lighting.rim = true; }))).toBe(true);
  });
  it('背光側加粗需要有陰影', () => {
    const r = make((r) => { r.lines.variation = 'shadow'; });
    expect(isVisible('lines.variationAmount', r)).toBe(true);
    expect(isVisible('lines.variationAmount', make((r) => { r.lines.variation = 'shadow'; r.lighting.enabled = false; }))).toBe(false);
    expect(isVisible('lines.variationAmount', DEFAULT_RECIPE)).toBe(false);
  });
  it('色線加深跟著色線', () => {
    expect(isVisible('lines.colorDarken', DEFAULT_RECIPE)).toBe(false);
    expect(isVisible('lines.colorDarken', make((r) => { r.lines.colorMode = 'region'; }))).toBe(true);
  });
  it('網點參數跟著網點, 只在陰影區還需要有陰影', () => {
    expect(isVisible('effects.halftoneSize', DEFAULT_RECIPE)).toBe(false);
    const ht = make((r) => { r.effects.halftone = true; });
    expect(isVisible('effects.halftoneSize', ht)).toBe(true);
    expect(isVisible('effects.halftoneShadowOnly', ht)).toBe(true);
    const htFlat = make((r) => { r.effects.halftone = true; r.lighting.bands = 1; });
    expect(isVisible('effects.halftoneShadowOnly', htFlat)).toBe(false);
    expect(isVisible('effects.halftoneStrength', htFlat)).toBe(true);
  });
  it('抖色階數跟著抖色', () => {
    expect(isVisible('filter.ditherLevels', DEFAULT_RECIPE)).toBe(false);
    expect(isVisible('filter.ditherLevels', make((r) => { r.filter.dither = true; }))).toBe(true);
  });
});

describe('細部立體感', () => {
  it('跟大形立體感同一條規則', () => {
    expect(isVisible('lighting.detailStrength', DEFAULT_RECIPE)).toBe(true);
    expect(isVisible('lighting.detailStrength', make((r) => { r.lighting.bands = 1; }))).toBe(false);
  });
});

describe('新效果的顯示規則', () => {
  it('指定陰影色只在 custom 且有陰影時', () => {
    const synth = (r: Recipe) => { r.keep.shade = 0; };
    expect(isVisible('lighting.shadowColor', make(synth))).toBe(false);
    expect(isVisible('lighting.shadowColor', make((r) => { synth(r); r.lighting.shadowMode = 'custom'; }))).toBe(true);
    expect(isVisible('lighting.shadowColor', make((r) => { synth(r); r.lighting.shadowMode = 'custom'; r.lighting.bands = 1; }))).toBe(false);
  });
  it('陰影相關的新參數需要有陰影', () => {
    for (const k of ['litColor', 'litStrength', 'softness', 'edgeJitter', 'ao']) {
      expect(isVisible('lighting.' + k, make((r) => { r.keep.shade = 0; }))).toBe(true);
      expect(isVisible('lighting.' + k, make((r) => { r.keep.shade = 0; r.lighting.bands = 1; }))).toBe(false);
    }
  });
  it('完全保留原圖光影時, 陰影上色相關參數沒有效果而隱藏', () => {
    for (const k of ['shadowMode', 'shadowStrength', 'litColor', 'litStrength']) {
      expect(isVisible('lighting.' + k, DEFAULT_RECIPE)).toBe(false);
      expect(isVisible('lighting.' + k, make((r) => { r.keep.shade = 0.5; }))).toBe(true);
      expect(isVisible('lighting.' + k, make((r) => { r.keep.enabled = false; }))).toBe(true);
    }
    expect(isVisible('lighting.softness', DEFAULT_RECIPE)).toBe(true);
  });
  it('開關型效果的子參數', () => {
    const cases: [string, (r: Recipe) => void][] = [
      ['lighting.specSize', (r) => { r.lighting.specular = true; }],
      ['lighting.fillColor', (r) => { r.lighting.fill = true; }],
      ['lines.doubleOffset', (r) => { r.lines.doubleLine = true; }],
      ['effects.hatchSpacing', (r) => { r.effects.hatch = true; }],
      ['effects.crossHatch', (r) => { r.effects.hatch = true; }],
      ['effects.stippleSize', (r) => { r.effects.stipple = true; }],
      ['grade.gradientStops', (r) => { r.grade.gradientMap = true; }],
    ];
    for (const [key, on] of cases) {
      expect(isVisible(key, DEFAULT_RECIPE)).toBe(false);
      expect(isVisible(key, make(on))).toBe(true);
    }
  });
  it('強度型效果的子參數', () => {
    const cases: [string, (r: Recipe) => void][] = [
      ['lines.pressureScale', (r) => { r.lines.pressure = 0.5; }],
      ['effects.brushScale', (r) => { r.effects.brush = 0.5; }],
      ['effects.risoAngle', (r) => { r.effects.riso = 3; }],
      ['filter.outlineColor', (r) => { r.filter.outlineWidth = 2; }],
      ['filter.bloomThreshold', (r) => { r.filter.bloom = 0.5; }],
      ['filter.scanSpacing', (r) => { r.filter.scan = 0.5; }],
      ['grade.presetStrength', (r) => { r.grade.preset = 'film'; }],
    ];
    for (const [key, on] of cases) {
      expect(isVisible(key, DEFAULT_RECIPE)).toBe(false);
      expect(isVisible(key, make(on))).toBe(true);
    }
  });
  it('調色層停用時只剩啟用', () => {
    expect(isVisible('grade.satShadow', make((r) => { r.grade.enabled = false; }))).toBe(false);
  });
});
