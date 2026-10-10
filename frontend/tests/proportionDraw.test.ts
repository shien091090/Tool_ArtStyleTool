import { describe, expect, it } from 'vitest';
import { cutRadius, dilate, ringMask } from '../src/proportion/draw';
import { canonicalPath } from '../src/routes';

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

describe('ringMask', () => {
  it('邊緣一圈: 內部與遠處都不在環上', () => {
    const w = 9, h = 9, r = 1;
    const src = new Uint8Array(w * h);
    for (let y = 2; y < 7; y++) for (let x = 2; x < 7; x++) src[y * w + x] = 255; // 5×5 方塊
    const out = ringMask(src, w, h, r);
    const W = w + 2 * r;
    const at = (x: number, y: number) => out[(y + r) * W + x + r];
    expect(at(4, 4)).toBe(0); // 中心(內縮後仍是部位)
    expect(at(2, 4)).toBe(255); // 邊上
    expect(at(1, 4)).toBe(255); // 外擴一格
    expect(at(0, 4)).toBe(0); // 更遠
  });

  it('貼著裁切邊的部位邊緣也算環', () => {
    const src = new Uint8Array(9).fill(255);
    const out = ringMask(src, 3, 3, 1);
    expect(out[2 * 5 + 2]).toBe(0); // 中心
    expect(out[1 * 5 + 1]).toBe(255); // 角落(原本是部位, 但在邊上)
  });
});

describe('canonicalPath', () => {
  it('舊頁籤路徑轉到新的', () => {
    expect(canonicalPath('proportion')).toBe('workshop');
    expect(canonicalPath('render')).toBe('render');
  });
});
