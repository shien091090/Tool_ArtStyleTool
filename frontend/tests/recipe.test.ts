import { describe, it, expect } from 'vitest';
import { normalizeRecipe, DEFAULT_RECIPE } from '../src/recipe';

describe('normalizeRecipe', () => {
  it('完整預設值原樣通過', () => {
    const { recipe, fixed } = normalizeRecipe(structuredClone(DEFAULT_RECIPE));
    expect(recipe).toEqual(DEFAULT_RECIPE);
    expect(fixed).toEqual([]);
  });
  it('缺欄位安靜補預設, 不列入提示', () => {
    const { recipe, fixed } = normalizeRecipe({ version: 1, lighting: { bands: 5 } });
    expect(recipe.lighting.bands).toBe(5);
    expect(recipe.lines).toEqual({ ...DEFAULT_RECIPE.lines, enabled: true }); // 第 1 版基準: 線條開啟
    expect(fixed).toEqual([]);
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
  it('舊配方沒有細部立體感時安靜補預設 1', () => {
    const { recipe, fixed } = normalizeRecipe({ lighting: { bands: 3 } });
    expect(recipe.lighting.detailStrength).toBe(1);
    expect(fixed).toEqual([]);
  });
  it('夾在 0~3', () => {
    expect(normalizeRecipe({ lighting: { detailStrength: 9 } }).recipe.lighting.detailStrength).toBe(3);
  });
});

describe('風格效果新欄位', () => {
  const v1 = () => {
    const r: Record<string, any> = structuredClone(DEFAULT_RECIPE);
    delete r.grade;
    for (const k of ['shadowColor', 'litColor', 'litStrength', 'softness', 'edgeJitter', 'specular', 'fill', 'ao']) delete r.lighting[k];
    for (const k of ['outerThickness', 'innerLines', 'pressure', 'breaks', 'doubleLine']) delete r.lines[k];
    for (const k of ['hatch', 'stipple', 'wcEdge', 'brush', 'riso']) delete r.effects[k];
    for (const k of ['outlineWidth', 'bloom', 'chroma', 'scan']) delete r.filter[k];
    return r;
  };
  it('v1 時期的配方: 新欄位全為預設且沒有提示', () => {
    const { recipe, fixed } = normalizeRecipe(v1());
    expect(fixed).toEqual([]);
    expect(recipe).toEqual(DEFAULT_RECIPE);
  });
  it('新效果預設全部關閉', () => {
    const r = DEFAULT_RECIPE;
    expect([r.lighting.specular, r.lighting.fill, r.lines.doubleLine, r.effects.hatch, r.effects.stipple, r.grade.gradientMap]).toEqual([false, false, false, false, false, false]);
    expect([r.lighting.ao, r.lighting.litStrength, r.lines.pressure, r.lines.breaks, r.effects.wcEdge, r.effects.brush, r.effects.riso, r.filter.outlineWidth, r.filter.bloom, r.filter.chroma, r.filter.scan]).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(r.grade.preset).toBe('none');
  });
  it('指定陰影色是合法選項', () => {
    expect(normalizeRecipe({ lighting: { shadowMode: 'custom' } }).recipe.lighting.shadowMode).toBe('custom');
  });
  it('漸層色帶: 過濾非法色碼、最多 6 色、少於 2 色改回預設', () => {
    const many = normalizeRecipe({ grade: { gradientStops: ['#000000', 'x', '#111111', '#222222', '#333333', '#444444', '#555555', '#666666'] } });
    expect(many.recipe.grade.gradientStops).toHaveLength(6);
    expect(many.fixed).toContain('grade.gradientStops');
    const one = normalizeRecipe({ grade: { gradientStops: ['#000000'] } });
    expect(one.recipe.grade.gradientStops).toEqual(DEFAULT_RECIPE.grade.gradientStops);
    expect(one.fixed).toContain('grade.gradientStops');
  });
  it('調色預設只接受已知名稱', () => {
    expect(normalizeRecipe({ grade: { preset: 'film' } }).recipe.grade.preset).toBe('film');
    expect(normalizeRecipe({ grade: { preset: 'zzz' } }).fixed).toContain('grade.preset');
  });
  it('色票名稱不接受物件原型上的鍵', () => {
    const { recipe, fixed } = normalizeRecipe({ color: { preset: 'constructor' } });
    expect(recipe.color.preset).toBe('pico8');
    expect(fixed).toContain('color.preset');
  });
});

describe('配方第 2 版: 保留原圖', () => {
  it('新預設: 保留光影與紋理都是 1、線條關閉', () => {
    expect(DEFAULT_RECIPE.version).toBe(2);
    expect(DEFAULT_RECIPE.keep).toEqual({ enabled: true, shade: 1, texture: 1 });
    expect(DEFAULT_RECIPE.lines.enabled).toBe(false);
  });
  it('第 1 版配方: 不保留原圖、線條照舊, 不提示', () => {
    const { recipe, fixed } = normalizeRecipe({ version: 1, lines: { enabled: true, thickness: 2 } });
    expect(recipe.keep).toEqual({ enabled: true, shade: 0, texture: 0 });
    expect(recipe.lines.enabled).toBe(true);
    expect(recipe.version).toBe(2);
    expect(fixed).toEqual([]);
  });
  it('第 1 版配方缺線條開關時視為開啟', () => {
    expect(normalizeRecipe({ version: 1, lines: { thickness: 2 } }).recipe.lines.enabled).toBe(true);
  });
  it('沒有版本號視為第 1 版', () => {
    expect(normalizeRecipe({ lighting: { bands: 3 } }).recipe.keep.shade).toBe(0);
  });
  it('第 2 版缺 keep 時用新預設', () => {
    expect(normalizeRecipe({ version: 2 }).recipe.keep.texture).toBe(1);
  });
  it('保留值夾在 0~1', () => {
    expect(normalizeRecipe({ version: 2, keep: { shade: 3 } }).recipe.keep.shade).toBe(1);
  });
});
