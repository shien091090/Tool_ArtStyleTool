import { describe, it, expect } from 'vitest';
import {
  rgbToOklab, oklabToRgb, adjust, kmeansPalette, nearest, buildRegionTable, hexToRgb, rgbToHex, type RGB,
} from '../src/colorMath';
import { DEFAULT_RECIPE } from '../src/recipe';

describe('colorMath', () => {
  it('hex 互轉', () => {
    expect(hexToRgb('#0f380f')).toEqual([15, 56, 15]);
    expect(rgbToHex([15, 56, 15])).toBe('#0f380f');
  });
  it('OKLab 往返', () => {
    for (const c of [[0, 0, 0], [255, 255, 255], [200, 30, 90]] as RGB[])
      oklabToRgb(rgbToOklab(c)).forEach((v, i) => expect(Math.abs(v - c[i])).toBeLessThanOrEqual(1));
  });
  it('adjust 不動時原樣', () => {
    expect(adjust([120, 60, 30], 0, 1, 0)).toEqual([120, 60, 30]);
  });
  it('飽和 0 變灰、色溫正值變暖、負值變冷', () => {
    const g = adjust([200, 50, 50], 0, 0, 0);
    expect(Math.abs(g[0] - g[2])).toBeLessThanOrEqual(2);
    const w = adjust([128, 128, 128], 0, 1, 1);
    expect(w[0]).toBeGreaterThan(w[2]);
    const c = adjust([128, 128, 128], 0, 1, -1);
    expect(c[2]).toBeGreaterThan(c[0]);
  });
  it('色相轉 180 度讓紅偏青', () => {
    const r = adjust([220, 40, 40], 180, 1, 0);
    expect(r[1]).toBeGreaterThan(r[0]);
  });
  it('kmeans 分出兩群, 結果穩定', () => {
    const cols: RGB[] = [[250, 0, 0], [240, 10, 10], [0, 0, 250], [10, 10, 240]];
    const p = kmeansPalette(cols, [1, 1, 1, 1], 2);
    expect(p).toHaveLength(2);
    expect(nearest([255, 0, 0], p)[0]).toBeGreaterThan(200);
    expect(nearest([0, 0, 255], p)[2]).toBeGreaterThan(200);
    expect(kmeansPalette(cols, [1, 1, 1, 1], 2)).toEqual(p);
  });
  it('kmeans 顏色數少於 k 時直接回傳去重後的輸入', () => {
    expect(kmeansPalette([[1, 2, 3], [1, 2, 3]], [5, 5], 8)).toEqual([[1, 2, 3]]);
    expect(kmeansPalette([], [], 4)).toEqual([]);
  });
  it('色表依 id 放置, preset 模式對應到色票', () => {
    const color = { ...DEFAULT_RECIPE.color, paletteMode: 'preset' as const, preset: 'gameboy' };
    const t = buildRegionTable({ '1': [0, 0, 0], '300': [255, 255, 255] }, { '1': 1, '300': 1 }, color);
    expect(t.length).toBe(256 * 256 * 4);
    expect(Array.from(t.slice(4, 8))).toEqual([...hexToRgb('#0f380f'), 255]);
    expect(Array.from(t.slice(300 * 4, 300 * 4 + 3))).toEqual(hexToRgb('#9bbc0f'));
  });
  it('色表 source 模式保留原色, 停用時忽略調整', () => {
    const base = { '2': [10, 200, 30] as RGB };
    const t = buildRegionTable(base, { '2': 1 }, { ...DEFAULT_RECIPE.color });
    expect(Array.from(t.slice(8, 11))).toEqual([10, 200, 30]);
    const off = buildRegionTable(base, { '2': 1 }, { ...DEFAULT_RECIPE.color, enabled: false, saturation: 0 });
    expect(Array.from(off.slice(8, 11))).toEqual([10, 200, 30]);
  });
  it('custom 模式色票為空時退回原色', () => {
    const t = buildRegionTable({ '1': [5, 6, 7] }, { '1': 1 }, { ...DEFAULT_RECIPE.color, paletteMode: 'custom', custom: [] });
    expect(Array.from(t.slice(4, 7))).toEqual([5, 6, 7]);
  });
});
