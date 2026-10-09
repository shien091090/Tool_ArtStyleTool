import { describe, it, expect } from 'vitest';
import { normalizeRecipe, DEFAULT_RECIPE } from '../src/recipe';

describe('normalizeRecipe', () => {
  it('完整預設值原樣通過', () => {
    const { recipe, fixed } = normalizeRecipe(structuredClone(DEFAULT_RECIPE));
    expect(recipe).toEqual(DEFAULT_RECIPE);
    expect(fixed).toEqual([]);
  });
  it('缺欄位補預設並回報', () => {
    const { recipe, fixed } = normalizeRecipe({ version: 1, lighting: { bands: 5 } });
    expect(recipe.lighting.bands).toBe(5);
    expect(recipe.lines).toEqual(DEFAULT_RECIPE.lines);
    expect(fixed).toContain('lines');
    expect(fixed).toContain('lighting.azimuth');
  });
  it('越界數值夾回範圍並取整', () => {
    const { recipe, fixed } = normalizeRecipe({ version: 1, lighting: { bands: 0 }, filter: { pixelSize: 3.7 } });
    expect(recipe.lighting.bands).toBe(1);
    expect(recipe.filter.pixelSize).toBe(4);
    expect(fixed).toContain('lighting.bands');
  });
  it('未知列舉值與錯誤型別改回預設', () => {
    const { recipe, fixed } = normalizeRecipe({ color: { paletteMode: 'zzz', custom: 'red' }, lines: { enabled: 'yes' } });
    expect(recipe.color.paletteMode).toBe('source');
    expect(recipe.color.custom).toEqual([]);
    expect(recipe.lines.enabled).toBe(true);
    expect(fixed).toContain('color.paletteMode');
  });
  it('非物件輸入回傳整份預設', () => {
    expect(normalizeRecipe(null).recipe).toEqual(DEFAULT_RECIPE);
    expect(normalizeRecipe([1, 2]).recipe).toEqual(DEFAULT_RECIPE);
  });
  it('custom 只保留合法 #rrggbb 並轉小寫', () => {
    expect(normalizeRecipe({ color: { custom: ['#ff0000', 'oops', '#00FF00'] } }).recipe.color.custom)
      .toEqual(['#ff0000', '#00ff00']);
  });
  it('不合法的顏色字串改回預設', () => {
    const { recipe } = normalizeRecipe({ lighting: { rimColor: 'blue' } });
    expect(recipe.lighting.rimColor).toBe(DEFAULT_RECIPE.lighting.rimColor);
  });
  it('未知色票名改回預設', () => {
    const { recipe, fixed } = normalizeRecipe({ color: { preset: 'nope' } });
    expect(recipe.color.preset).toBe('pico8');
    expect(fixed).toContain('color.preset');
  });
  it('不會改到傳入物件, 也不共用預設值的參考', () => {
    const { recipe } = normalizeRecipe({});
    recipe.color.custom.push('#123456');
    expect(DEFAULT_RECIPE.color.custom).toEqual([]);
  });
});

describe('detailStrength', () => {
  it('舊配方沒有細部立體感時補預設 1 並回報', () => {
    const { recipe, fixed } = normalizeRecipe({ lighting: { bands: 3 } });
    expect(recipe.lighting.detailStrength).toBe(1);
    expect(fixed).toContain('lighting.detailStrength');
  });
  it('夾在 0~3', () => {
    expect(normalizeRecipe({ lighting: { detailStrength: 9 } }).recipe.lighting.detailStrength).toBe(3);
  });
});
