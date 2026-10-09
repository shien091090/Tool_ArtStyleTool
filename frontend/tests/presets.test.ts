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
