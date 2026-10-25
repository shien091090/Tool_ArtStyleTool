import { describe, it, expect } from 'vitest';
import {
  cellAt, clampToWorld, drawOrder, frameRect, hitTest, isoCell, isoPoint, nativeRes, newObjectId, objectBox, regions,
  editRect, maxViewZoom, roundPixel, snapStep, visible, viewRectAt, worldRect, type BlockObj, type BoxObj, type Rect, type Scene,
} from '../src/mockup/model';
import { createHistory } from '../src/mockup/history';
import { toWorld } from '../src/mockup/editor';

const base = (view: Scene['view'], extra: Partial<Scene> = {}): Scene => ({
  name: 's', view, pixel: false, camera: 'std', created: '', updated: '', background: { label: '天空 sky', color: '#cddeeb' },
  ground: null, objects: [], style: { text: '', refs: [], genre: '', colors: 32 }, candidates: [], nextCandidate: 1, ...extra,
});
const box = (extra: Partial<BoxObj> = {}): BoxObj =>
  ({ id: 'o1', kind: 'box', label: 'a', color: '#9a9a9a', type: null, x: 0, y: 0, w: 100, h: 100, ...extra });

describe('鏡頭與世界', () => {
  it('輸出框: 一般標準 = 舊畫布, 超遠 = 世界; 像素依解析度', () => {
    expect(frameRect(base('side'))).toEqual([0, 0, 1280, 720]);
    expect(frameRect(base('side', { camera: 'xfar' }))).toEqual(worldRect(base('side')));
    expect(worldRect(base('vertical'))).toEqual([-360, -640, 1080, 1920]);
    expect(worldRect(base('flat'))).toEqual([0, 0, 1280, 720]);
    expect(frameRect(base('side', { pixel: true, camera: 'far' }))).toEqual([160, 90, 480, 270]);
    expect(frameRect(base('vertical', { pixel: true, camera: 'xnear' }))).toEqual([144, 256, 216, 384]);
    const near = frameRect(base('side'), 'near');
    expect(near[2] - near[0]).toBeCloseTo(1280 / 1.4);
    expect((near[0] + near[2]) / 2).toBeCloseTo(640);
  });

  it('像素原生解析度', () => {
    expect(nativeRes(base('side', { pixel: true }), 'far')).toEqual([320, 180]);
    expect(nativeRes(base('vertical', { pixel: true }), 'std')).toEqual([144, 256]);
  });

  it('只有和輸出框相交的物件算看得到', () => {
    const far = box({ x: 1700, y: 400 });
    expect(visible(base('side'), far)).toBe(false);
    expect(visible(base('side', { camera: 'xfar' }), far)).toBe(true);
    expect(visible(base('side'), far, 'xfar')).toBe(true);
  });

  it('物件夾在世界內; 像素場景取整', () => {
    const s = base('side');
    const o = box({ x: 5000, y: -9000 });
    clampToWorld(s, o);
    expect([o.x, o.y]).toEqual([1820, -360]);
    const p = base('side', { pixel: true });
    const q = box({ x: 3.4, y: 2.6, w: 15.5, h: 0.2 });
    roundPixel(p, q);
    expect([q.x, q.y, q.w, q.h]).toEqual([3, 3, 16, 1]);
    const b: BlockObj = { id: 'o2', kind: 'block', label: 'b', color: '#9a9a9a', type: null, i: 0.3, j: 1.8, w: 0.1, l: 1.2, h: 10.6 };
    roundPixel(base('iso', { pixel: true }), b);
    expect([b.i, b.j, b.w, b.l, b.h]).toEqual([0.5, 2, 0.5, 1, 11]);
    const n = box({ x: 3.4 });
    roundPixel(s, n);
    expect(n.x).toBe(3.4);
  });

  it('斜角方塊夾在格子內', () => {
    const b: BlockObj = { id: 'o2', kind: 'block', label: 'b', color: '#9a9a9a', type: null, i: 30, j: -20, w: 2, l: 2, h: 10 };
    clampToWorld(base('iso'), b);
    expect([b.i, b.j]).toEqual([16, -8]);
  });
});

describe('座標換算', () => {
  it('斜角格點與反算互逆', () => {
    expect(isoPoint(false, 0, 0)).toEqual([640, 120]);
    expect(isoPoint(false, 1, 0, 30)).toEqual([688, 114]);
    expect(isoPoint(true, 0, 0)).toEqual([320, 20]);
    expect(isoPoint(true, 1, 0)).toEqual([336, 28]);
    const [i, j] = isoCell(true, ...isoPoint(true, 3, 4));
    expect(i).toBeCloseTo(3);
    expect(j).toBeCloseTo(4);
  });

  it('俯瞰點到格索引: 舊 (0,0) 格在第 10 行第 6 列, 世界外為 null', () => {
    const s = base('topdown', { ground: { cols: 40, rows: 24, cells: Array(960).fill(null), custom: [] } });
    expect(cellAt(s, 1, 1)).toBe(6 * 40 + 10);
    expect(cellAt(s, -700, 1)).toBeNull();
    expect(cellAt(base('side'), 10, 10)).toBeNull();
    const p = base('topdown', { pixel: true, ground: { cols: 40, rows: 23, cells: Array(920).fill(null), custom: [] } });
    expect(cellAt(p, 17, 1)).toBe(1);
  });

  it('斜角點到格索引(一般場景偏移 8)', () => {
    const s = base('iso', { ground: { cols: 26, rows: 26, cells: Array(676).fill(null), custom: [] } });
    expect(cellAt(s, ...isoPoint(false, 0.5, 0.5))).toBe(8 * 26 + 8);
    expect(cellAt(s, ...isoPoint(false, -7.5, 2.5))).toBe(10 * 26 + 0);
    expect(cellAt(s, -2000, 5)).toBeNull();
    const p = base('iso', { pixel: true, ground: { cols: 20, rows: 20, cells: Array(400).fill(null), custom: [] } });
    expect(cellAt(p, ...isoPoint(true, 2.5, 3.5))).toBe(3 * 20 + 2);
  });

  it('對齊間距: 一般俯瞰 64、其他 8; 像素俯瞰 16、其他 1', () => {
    expect(snapStep(base('topdown'))).toBe(64);
    expect(snapStep(base('side'))).toBe(8);
    expect(snapStep(base('topdown', { pixel: true }))).toBe(16);
    expect(snapStep(base('side', { pixel: true }))).toBe(1);
  });
});

describe('物件前後與點選', () => {
  const block = { id: 'o1', kind: 'block' as const, label: '房', color: '#9a9a9a', type: null, i: 0, j: 0, w: 1, l: 1, h: 40 };
  const asset = { id: 'o2', kind: 'asset' as const, asset: 'a1', name: '樹', x: 600, y: 400, w: 50, h: 100, flip: false };

  it('斜角依腳底排序, 清單順序不算', () => {
    const s = base('iso', { objects: [asset, block] });
    expect(drawOrder(s).map((o) => o.id)).toEqual(['o1', 'o2']);
  });

  it('其他架構照清單順序', () => {
    const a = { ...asset, id: 'o3', kind: 'asset' as const };
    const b = { id: 'o4', kind: 'box' as const, label: '主角', color: '#9a9a9a', type: null, x: 0, y: 0, w: 10, h: 10 };
    expect(drawOrder(base('side', { objects: [a, b] })).map((o) => o.id)).toEqual(['o3', 'o4']);
  });

  it('點選取最前面那個', () => {
    const a = box();
    const b = { ...a, id: 'o2', x: 50 };
    const s = base('side', { objects: [a, b] });
    expect(hitTest(s, 60, 10)?.id).toBe('o2');
    expect(hitTest(s, 10, 10)?.id).toBe('o1');
    expect(hitTest(s, 500, 500)).toBeNull();
    expect(objectBox(s, a)).toEqual([0, 0, 100, 100]);
  });

  it('新物件編號接在最大的後面', () => {
    const a = box({ id: 'o7', w: 1, h: 1 });
    expect(newObjectId(base('side', { objects: [a] }))).toBe('o8');
    expect(newObjectId(base('side'))).toBe('o1');
  });
});

describe('地面區域標籤', () => {
  it('相連同地形 2 格以上才標, 不相連的各標一次', () => {
    const W = '水 water';
    const cells: (string | null)[] = Array(40 * 24).fill('草地 grass');
    cells[0] = W; cells[1] = W; // 左上兩格
    cells[50] = W; cells[90] = W; // 第 1、2 列第 10 行
    cells[959] = W; // 單格
    const s = base('topdown', { ground: { cols: 40, rows: 24, cells, custom: [] } });
    const water = regions(s).filter((r) => r.label === W);
    expect(water).toHaveLength(2);
    expect(water[0]).toEqual({ label: W, x: -576, y: -352 });
  });
});

describe('復原堆疊', () => {
  it('復原、重做, 新動作清掉重做', () => {
    const h = createHistory<string>();
    h.push('a');
    h.push('b');
    expect(h.undo('c')).toBe('b');
    expect(h.undo('b')).toBe('a');
    expect(h.undo('a')).toBeNull();
    expect(h.redo('a')).toBe('b');
    h.push('x');
    expect(h.redo('x')).toBeNull();
  });
});

describe('編輯區範圍與滑鼠換算', () => {
  it('編輯區 = 輸出框四邊外擴 15%', () => {
    expect(editRect(base('side'))).toEqual([-192, -108, 1472, 828]);
    const p = editRect(base('side', { pixel: true, camera: 'far' }));
    expect(p).toEqual([112, 63, 528, 297]);
  });

  it('滾輪縮放編輯範圍: 1 = 預設, 最多看到整個世界外擴 5%', () => {
    const s = base('side');
    expect(viewRectAt(s, 1)).toEqual(editRect(s));
    expect(maxViewZoom(s)).toBeCloseTo(2816 / 1664);
    expect(viewRectAt(s, 99).map(Math.round)).toEqual([-768, -432, 2048, 1152]);
    expect(viewRectAt(s, 0.5)).toEqual(editRect(s));
    const p = base('side', { pixel: true, camera: 'far' });
    expect(viewRectAt(p, 99).map(Math.round)).toEqual([-32, -18, 672, 378]);
    expect(maxViewZoom(base('side', { camera: 'xfar' }))).toBe(1);
  });

  it('滑鼠位置換成世界座標', () => {
    const canvas = { getBoundingClientRect: () => ({ left: 10, top: 20, width: 200, height: 100 }) } as unknown as HTMLCanvasElement;
    const rect: Rect = [-100, -50, 300, 150];
    expect(toWorld(canvas, rect, { clientX: 10, clientY: 20 })).toEqual([-100, -50]);
    expect(toWorld(canvas, rect, { clientX: 210, clientY: 120 })).toEqual([300, 150]);
    expect(toWorld(canvas, rect, { clientX: 110, clientY: 70 })).toEqual([100, 50]);
  });
});
