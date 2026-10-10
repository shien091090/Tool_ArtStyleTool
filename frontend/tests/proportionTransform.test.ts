import { describe, it, expect } from 'vitest';
import type { Part, PartTransform } from '../src/proportion/model';
import {
  applyMat,
  autoPad,
  invert,
  isChanged,
  isDrawn,
  multiply,
  partMatrix,
  placeForeign,
  transformedBBox,
} from '../src/proportion/transform';

const T = (o: Partial<PartTransform> = {}): PartTransform => ({
  scaleX: 1, scaleY: 1, rotation: 0, anchor: 'bottom', dx: 0, dy: 0, z: 1, hidden: false, ...o,
});

// 外框 x 10~29、y 20~39 → 邊緣 x0=10 x1=30 y0=20 y1=40, 寬高 20
const part = (o: Partial<Part> = {}): Part => ({
  id: 'p1', name: '頭', image: 'main', color: '#fff', points: [], box: null,
  placed: true, place: null, transform: T(), bbox: [10, 20, 29, 39], ...o,
});

const close = (a: [number, number], b: [number, number]) => {
  expect(a[0]).toBeCloseTo(b[0], 6);
  expect(a[1]).toBeCloseTo(b[1], 6);
};

describe('partMatrix', () => {
  it('單位變形不動', () => {
    close(applyMat(partMatrix(part()), 12, 34), [12, 34]);
  });
  it('錨點在下: 放大時底邊中點不動、頂邊往上', () => {
    const m = partMatrix(part({ transform: T({ scaleX: 2, scaleY: 2 }) }));
    close(applyMat(m, 20, 40), [20, 40]);
    close(applyMat(m, 20, 20), [20, 0]);
  });
  it('錨點在上: 頂邊中點不動', () => {
    const m = partMatrix(part({ transform: T({ scaleY: 3, anchor: 'top' }) }));
    close(applyMat(m, 20, 20), [20, 20]);
    close(applyMat(m, 20, 40), [20, 80]);
  });
  it('只調高: 寬不變', () => {
    const m = partMatrix(part({ transform: T({ scaleX: 1, scaleY: 2, anchor: 'center' }) }));
    close(applyMat(m, 10, 30), [10, 30]);
    close(applyMat(m, 20, 20), [20, 10]);
  });
  it('旋轉 90 度繞錨點(中心)', () => {
    const m = partMatrix(part({ transform: T({ rotation: 90, anchor: 'center' }) }));
    close(applyMat(m, 30, 30), [20, 40]); // 中心 (20,30) 右邊 10 → 轉到下方 10(畫布 y 向下)
  });
  it('位移以外框比例計', () => {
    const m = partMatrix(part({ transform: T({ dx: 0.5, dy: -0.1 }) }));
    close(applyMat(m, 10, 20), [20, 18]);
  });
  it('外來部位先套放置變形', () => {
    const m = partMatrix(part({ image: 's1', place: { scale: 0.5, tx: 100, ty: 50 } }));
    close(applyMat(m, 10, 20), [105, 60]);
  });
  it('反矩陣', () => {
    const m = partMatrix(part({ transform: T({ scaleX: 1.7, rotation: 33, dx: 0.2 }) }));
    const id = multiply(invert(m), m);
    close(applyMat(id, 7, 9), [7, 9]);
  });
});

describe('placeForeign', () => {
  it('有同名部位: 底邊中點對齊、依高度等比', () => {
    const place = placeForeign([0, 0, 9, 9], [10, 20, 29, 39], 100, 100); // 10x10 → 高 20
    expect(place.scale).toBeCloseTo(2);
    const m = partMatrix(part({ image: 's1', bbox: [0, 0, 9, 9], place }));
    close(applyMat(m, 5, 10), [20, 40]);
    close(applyMat(m, 0, 0), [10, 20]);
  });
  it('沒有同名: 原尺寸置中', () => {
    const place = placeForeign([0, 0, 9, 9], null, 100, 60);
    expect(place.scale).toBe(1);
    close(applyMat([1, 0, 0, 1, place.tx, place.ty], 5, 5), [50, 30]);
  });
});

describe('isChanged / isDrawn', () => {
  it('主圖部位', () => {
    expect(isChanged(part())).toBe(false);
    expect(isChanged(part({ transform: T({ scaleX: 1.2 }) }))).toBe(true);
    const hidden = part({ transform: T({ hidden: true }) });
    expect(isChanged(hidden)).toBe(true);
    expect(isDrawn(hidden)).toBe(false);
  });
  it('外來部位放上去才算', () => {
    expect(isChanged(part({ image: 's1', placed: false }))).toBe(false);
    expect(isDrawn(part({ image: 's1', placed: true, place: { scale: 1, tx: 0, ty: 0 } }))).toBe(true);
  });
});

describe('autoPad', () => {
  it('沒超出為 0', () => {
    expect(autoPad([part({ transform: T({ scaleX: 1.1 }) })], 100, 100)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });
  it('放大超出上緣: 只補上方, 多 2%', () => {
    const p = part({ transform: T({ scaleX: 2, scaleY: 2 }) }); // 頂到 y=0
    const big = part({ transform: T({ scaleX: 3, scaleY: 3 }) }); // 頂到 y=-20, 左到 -10
    expect(transformedBBox(p)[1]).toBeCloseTo(0);
    expect(autoPad([p], 100, 100).top).toBe(0);
    const pad = autoPad([big], 100, 100);
    expect(pad.top).toBe(22);
    expect(pad.left).toBe(12);
    expect(pad.right).toBe(0);
  });
  it('隱藏與沒動的部位不算', () => {
    expect(autoPad([part({ transform: T({ scaleX: 9, scaleY: 9, hidden: true }) })], 100, 100).top).toBe(0);
  });
});
