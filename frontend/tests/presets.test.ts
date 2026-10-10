import { describe, it, expect } from 'vitest';
import { STARTER_RECIPES } from '../src/presets';
import { normalizeRecipe } from '../src/recipe';

describe('起始配方', () => {
  it('六份, 名稱不重複', () => {
    expect(STARTER_RECIPES).toHaveLength(6);
    expect(new Set(STARTER_RECIPES.map((p) => p.name)).size).toBe(6);
  });
  it('每份正規化後不需要任何修正', () => {
    for (const p of STARTER_RECIPES) expect(normalizeRecipe(p.recipe).fixed, p.name).toEqual([]);
  });
});

describe('起始配方與保留原圖', () => {
  it('都開線條; 漫畫網點/像素/木刻/復古印刷不保留原圖', () => {
    for (const p of STARTER_RECIPES) expect(p.recipe.lines.enabled, p.name).toBe(true);
    for (const n of ['漫畫網點', '像素', '木刻版畫', '復古印刷']) {
      const r = STARTER_RECIPES.find((p) => p.name === n)!.recipe;
      expect(r.keep.shade + r.keep.texture, n).toBe(0);
    }
  });
});
