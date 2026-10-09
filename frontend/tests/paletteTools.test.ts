import { describe, it, expect } from 'vitest';
import { isLospecUrl, paletteFromPixels, parseHexList } from '../src/paletteTools';

describe('parseHexList', () => {
  it('接受有無 # 、各種分隔、大小寫, 去重保留順序', () => {
    expect(parseHexList('be4a2f\nD77643, #ead4aa  #be4a2f')).toEqual(['#be4a2f', '#d77643', '#ead4aa']);
  });
  it('略過不是 6 碼的片段', () => {
    expect(parseHexList('#fff red 12345 1234567 #00ff00')).toEqual(['#00ff00']);
  });
  it('空字串回空陣列', () => {
    expect(parseHexList('  ')).toEqual([]);
  });
});

describe('isLospecUrl', () => {
  it('辨識 Lospec 色票網址', () => {
    expect(isLospecUrl('https://lospec.com/palette-list/endesga-32')).toBe(true);
    expect(isLospecUrl('lospec.com/palette-list/endesga-32')).toBe(true);
    expect(isLospecUrl('#be4a2f #d77643')).toBe(false);
  });
});

describe('paletteFromPixels', () => {
  it('從兩色圖片抽出兩色, 忽略透明像素', () => {
    const px: number[] = [];
    for (let i = 0; i < 30; i++) px.push(250, 10, 10, 255);
    for (let i = 0; i < 10; i++) px.push(10, 10, 250, 255);
    for (let i = 0; i < 50; i++) px.push(0, 255, 0, 0);
    const pal = paletteFromPixels(new Uint8ClampedArray(px), 4);
    expect(pal).toHaveLength(2);
    expect(pal[0]).toBe('#fc0c0c');                 // 數量多的排前面(每通道量化成 32 階, 取格子中心)
    expect(pal.every((c) => /^#[0-9a-f]{6}$/.test(c))).toBe(true);
  });
  it('k 小於顏色數時合併相近色', () => {
    const px: number[] = [];
    for (const c of [[250, 0, 0], [240, 0, 0], [0, 0, 250], [0, 0, 240]]) for (let i = 0; i < 5; i++) px.push(...c, 255);
    expect(paletteFromPixels(new Uint8ClampedArray(px), 2)).toHaveLength(2);
  });
});
