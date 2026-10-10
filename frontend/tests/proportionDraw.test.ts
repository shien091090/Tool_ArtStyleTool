import { describe, expect, it } from 'vitest';
import { cutRadius, dilate } from '../src/proportion/draw';

describe('dilate', () => {
  it('外擴 r 像素並把畫布四邊各加 r', () => {
    const src = new Uint8Array(9);
    src[4] = 255; // 3×3 中心一點
    const out = dilate(src, 3, 3, 1);
    // 5×5, 中心 (2,2) 周圍 3×3 為 255
    const on = [...out].map((v, i) => (v ? `${i % 5},${Math.floor(i / 5)}` : '')).filter(Boolean);
    expect(on).toEqual(['1,1', '2,1', '3,1', '1,2', '2,2', '3,2', '1,3', '2,3', '3,3']);
  });

  it('半徑隨圖大小, 至少 2', () => {
    expect(cutRadius(100, 80)).toBe(2);
    expect(cutRadius(350, 374)).toBe(4);
    expect(cutRadius(2000, 1000)).toBe(24);
  });
});
