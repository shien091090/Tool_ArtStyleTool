import { describe, it, expect } from 'vitest';
import type { Part, PartTransform } from '../src/proportion/model';
import { applyRecipe, parseProportionRecipe, recipeFromParts } from '../src/proportion/recipe';

const T = (o: Partial<PartTransform> = {}): PartTransform => ({
  scaleX: 1, scaleY: 1, rotation: 0, anchor: 'bottom', dx: 0, dy: 0, z: 1, hidden: false, ...o,
});
const part = (id: string, name: string, o: Partial<Part> = {}): Part => ({
  id, name, image: 'main', color: '#fff', points: [], box: null,
  placed: true, place: null, transform: T(), bbox: [0, 0, 9, 9], ...o,
});

describe('比例配方', () => {
  it('只收主圖上動過且沒隱藏的部位, 往返不變', () => {
    const parts = [
      part('p1', '頭', { transform: T({ scaleX: 1.5, scaleY: 1.5, dy: -0.1, z: 3 }) }),
      part('p2', '身體'),
      part('p3', '尾巴', { transform: T({ hidden: true }) }),
      part('p4', '頭', { image: 's1', placed: true, place: { scale: 1, tx: 0, ty: 0 } }),
    ];
    const recipe = recipeFromParts(parts);
    expect(recipe.parts.map((p) => p.name)).toEqual(['頭']);
    expect(parseProportionRecipe(JSON.parse(JSON.stringify(recipe)))).toEqual(recipe);
  });
  it('沒有可存的部位時報錯', () => {
    expect(() => recipeFromParts([part('p1', '頭')])).toThrow('沒有調整過');
  });
  it('套用: 依名稱找主圖部位, 找不到的列出', () => {
    const recipe = parseProportionRecipe({
      version: 1,
      parts: [
        { name: '頭', scaleX: 2, scaleY: 2, rotation: 0, anchor: 'bottom', dx: 0, dy: 0, z: 5 },
        { name: '帽子', scaleX: 1, scaleY: 1.2, rotation: 0, anchor: 'top', dx: 0, dy: 0, z: 6 },
      ],
    });
    const { transforms, missing } = applyRecipe([part('p1', '頭'), part('p2', '頭', { image: 's1', placed: false })], recipe);
    expect(transforms.get('p1')).toEqual({ scaleX: 2, scaleY: 2, rotation: 0, anchor: 'bottom', dx: 0, dy: 0, z: 5, hidden: false });
    expect(transforms.has('p2')).toBe(false);
    expect(missing).toEqual(['帽子']);
  });
  it('版本錯誤明確報錯, 不當舊版處理', () => {
    expect(() => parseProportionRecipe({ version: '1', parts: [] })).toThrow('版本不支援');
    expect(() => parseProportionRecipe({ version: 2, parts: [] })).toThrow('版本不支援');
  });
  it('欄位錯誤指出部位與欄位', () => {
    const base = { name: '頭', scaleX: 1, scaleY: 1, rotation: 0, anchor: 'bottom', dx: 0, dy: 0, z: 1 };
    expect(() => parseProportionRecipe({ version: 1, parts: [{ ...base, scaleX: 0 }] })).toThrow('部位「頭」 的 scaleX');
    expect(() => parseProportionRecipe({ version: 1, parts: [{ ...base, anchor: 'left' }] })).toThrow('anchor');
    expect(() => parseProportionRecipe({ version: 1, parts: [{ ...base, z: 1.5 }] })).toThrow('z');
    expect(() => parseProportionRecipe({ version: 1, parts: [{ ...base, name: '' }] })).toThrow('缺少名稱');
    expect(() => parseProportionRecipe(null)).toThrow('JSON 物件');
  });
});
