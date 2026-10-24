import { describe, it, expect } from 'vitest';
import { cellAt, drawOrder, hitTest, isoCell, isoPoint, newObjectId, objectBox, regions, snapStep, type Scene } from '../src/mockup/model';
import { createHistory } from '../src/mockup/history';

const base = (view: Scene['view'], extra: Partial<Scene> = {}): Scene => ({
  name: 's', view, created: '', updated: '', background: { label: '天空 sky', color: '#cddeeb' }, ground: null,
  objects: [], style: { text: '', refs: [], genre: '' }, candidates: [], nextCandidate: 1, ...extra,
});

describe('座標換算', () => {
  it('斜角格點與反算互逆', () => {
    expect(isoPoint(0, 0)).toEqual([640, 120]);
    expect(isoPoint(1, 0, 30)).toEqual([688, 114]);
    const [i, j] = isoCell(...isoPoint(3, 4));
    expect(i).toBeCloseTo(3);
    expect(j).toBeCloseTo(4);
  });

  it('俯瞰點到格索引, 畫布外為 null', () => {
    const s = base('topdown', { ground: { cols: 20, rows: 12, cells: Array(240).fill(null), custom: [] } });
    expect(cellAt(s, 130, 70)).toBe(22);
    expect(cellAt(s, -5, 70)).toBeNull();
    expect(cellAt(base('side'), 10, 10)).toBeNull();
  });

  it('斜角點到格索引', () => {
    const s = base('iso', { ground: { cols: 10, rows: 10, cells: Array(100).fill(null), custom: [] } });
    const [x, y] = isoPoint(2.5, 3.5);
    expect(cellAt(s, x, y)).toBe(3 * 10 + 2);
    expect(cellAt(s, 5, 5)).toBeNull();
  });

  it('對齊間距: 俯瞰 64, 其他 8', () => {
    expect(snapStep(base('topdown'))).toBe(64);
    expect(snapStep(base('side'))).toBe(8);
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
    const a = { id: 'o1', kind: 'box' as const, label: 'a', color: '#9a9a9a', type: null, x: 0, y: 0, w: 100, h: 100 };
    const b = { ...a, id: 'o2', x: 50 };
    const s = base('side', { objects: [a, b] });
    expect(hitTest(s, 60, 10)?.id).toBe('o2');
    expect(hitTest(s, 10, 10)?.id).toBe('o1');
    expect(hitTest(s, 500, 500)).toBeNull();
    expect(objectBox('side', a)).toEqual([0, 0, 100, 100]);
  });

  it('新物件編號接在最大的後面', () => {
    const a = { id: 'o7', kind: 'box' as const, label: 'a', color: '#9a9a9a', type: null, x: 0, y: 0, w: 1, h: 1 };
    expect(newObjectId(base('side', { objects: [a] }))).toBe('o8');
    expect(newObjectId(base('side'))).toBe('o1');
  });
});

describe('地面區域標籤', () => {
  it('相連同地形 2 格以上才標, 不相連的各標一次', () => {
    const W = '水 water';
    const cells: (string | null)[] = Array(20 * 12).fill('草地 grass');
    cells[0] = W; cells[1] = W; // 左上兩格
    cells[30] = W; cells[50] = W; // 第 1、2 列第 10 行
    cells[239] = W; // 單格
    const s = base('topdown', { ground: { cols: 20, rows: 12, cells, custom: [] } });
    const water = regions(s).filter((r) => r.label === W);
    expect(water).toHaveLength(2);
    expect(water[0]).toEqual({ label: W, x: 64, y: 32 });
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
