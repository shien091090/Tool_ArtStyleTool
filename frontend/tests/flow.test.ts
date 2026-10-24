import { describe, it, expect } from 'vitest';
import {
  chainStale, connect, materialNames, materialsOf, newNodeId, nodeStatus, upstreamOf, wouldCycle, type FlowMeta, type FlowNode,
} from '../src/flow/model';
import { applyOps, growMask, selectRegion, type EraseOp, type Img, type WandOp } from '../src/flow/magicWand';

const node = (id: string, type: FlowNode['type'], rev = 0, inputRev: number | null = null): FlowNode =>
  ({ id, type, x: 0, y: 0, params: {}, rev, inputRev, error: null });

describe('流程狀態', () => {
  it('未執行、完成、過期、失敗', () => {
    const flow: FlowMeta = {
      name: 'f',
      nodes: [node('n1', 'input', 2), node('n2', 'cutout', 1, 2), node('n3', 'pixel', 1, 0), node('n4', 'cutout'),
        node('n5', 'cutout', 1, 1)],
      links: [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3' }],
    };
    expect(nodeStatus(flow, flow.nodes[0])).toBe('done');
    expect(nodeStatus(flow, flow.nodes[1])).toBe('done');
    expect(nodeStatus(flow, flow.nodes[2])).toBe('stale');
    expect(nodeStatus(flow, flow.nodes[3])).toBe('idle');
    expect(nodeStatus(flow, flow.nodes[4])).toBe('stale'); // 沒接上游
    expect(nodeStatus(flow, { ...flow.nodes[1], error: '壞了' })).toBe('error');
  });

  it('迴圈判斷與接線取代', () => {
    const links = [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3' }];
    expect(wouldCycle(links, 'n3', 'n1')).toBe(true);
    expect(wouldCycle(links, 'n2', 'n2')).toBe(true);
    expect(wouldCycle(links, 'n1', 'n3')).toBe(false);
    expect(connect(links, 'n1', 'n3')).toEqual([{ from: 'n1', to: 'n2' }, { from: 'n1', to: 'n3' }]);
  });

  it('素材線: 不算主圖上游、可接多條、同一對節點只留一條', () => {
    let links = connect([{ from: 'n1', to: 'n3' }], 'n2', 'n3', 'material');
    links = connect(links, 'n4', 'n3', 'material');
    expect(links).toEqual([{ from: 'n1', to: 'n3' }, { from: 'n2', to: 'n3', port: 'material' }, { from: 'n4', to: 'n3', port: 'material' }]);
    // 接主圖只取代主圖線
    expect(connect(links, 'n5', 'n3')).toEqual([links[1], links[2], { from: 'n5', to: 'n3' }]);
    // 同一對節點改接另一個接點
    expect(connect(links, 'n2', 'n3')).toEqual([links[2], { from: 'n2', to: 'n3' }]);
    const flow: FlowMeta = {
      name: 'f',
      nodes: [node('n1', 'input', 1), node('n2', 'input', 2), node('n3', 'workshop', 1, 1), node('n4', 'cutout', 1, 1)],
      links,
    };
    expect(upstreamOf(flow, 'n3')?.id).toBe('n1');
    expect(materialsOf(flow, 'n3').map((n) => n.id)).toEqual(['n2', 'n4']);
    expect(materialNames(flow, 'n3')).toEqual({ n2: '圖片輸入', n4: '去除區塊' });
    expect(materialNames({ ...flow, nodes: flow.nodes.map((n) => (n.id === 'n4' ? node('n4', 'input', 1) : n)) }, 'n3'))
      .toEqual({ n2: '圖片輸入 1', n4: '圖片輸入 2' });
  });

  it('素材版本變了 → 過期', () => {
    const ws = { ...node('n3', 'workshop', 1, 1), params: { materials: { n2: 2 } } };
    const flow: FlowMeta = {
      name: 'f',
      nodes: [node('n1', 'input', 1), node('n2', 'input', 2), ws],
      links: [{ from: 'n1', to: 'n3' }, { from: 'n2', to: 'n3', port: 'material' }],
    };
    expect(nodeStatus(flow, ws)).toBe('done');
    expect(nodeStatus({ ...flow, nodes: [flow.nodes[0], node('n2', 'input', 3), ws] }, ws)).toBe('stale');
    expect(nodeStatus(flow, { ...ws, params: {} })).toBe('stale'); // 輸出時還沒接這張素材
  });

  it('新節點編號', () => {
    expect(newNodeId([])).toBe('n1');
    expect(newNodeId([node('n2', 'input'), node('n10', 'input')])).toBe('n11');
  });
});

/** 由字元畫建圖: W 白、R 紅、r 淡紅、B 藍、. 透明 */
function img(rows: string[]): Img {
  const colors: Record<string, number[]> = {
    W: [255, 255, 255, 255], R: [200, 0, 0, 255], r: [220, 20, 20, 255], B: [0, 0, 200, 255], '.': [0, 0, 0, 0],
  };
  const h = rows.length;
  const w = rows[0].length;
  const data = new Uint8ClampedArray(w * h * 4);
  rows.forEach((row, y) => [...row].forEach((ch, x) => data.set(colors[ch], (y * w + x) * 4)));
  return { data, width: w, height: h };
}

/** 回傳字元畫: 透明 '.', 其他 '#' */
function alphaMap(im: Img): string[] {
  const out: string[] = [];
  for (let y = 0; y < im.height; y++) {
    let s = '';
    for (let x = 0; x < im.width; x++) s += im.data[(y * im.width + x) * 4 + 3] ? '#' : '.';
    out.push(s);
  }
  return out;
}

const op = (o: Partial<WandOp>): WandOp =>
  ({ mode: 'remove', how: 'color', x: 0, y: 0, tol: 40, contiguous: true, grow: false, ...o });

describe('魔術棒', () => {
  const pic = img([
    'WWWWW',
    'WRRBW',
    'WRrBW',
    'WWWWW',
    'RWWWW',
  ]);

  it('相連: 只去掉跟點擊處相連的白, 右下角孤立的紅不算', () => {
    expect(alphaMap(applyOps(pic, [op({ x: 0, y: 0 })]))).toEqual(['.....', '.###.', '.###.', '.....', '#....']);
  });

  it('不相連: 整張相近色都選', () => {
    const out = applyOps(pic, [op({ x: 0.3, y: 0.3, contiguous: false })]);
    expect(alphaMap(out)).toEqual(['#####', '#..##', '#..##', '#####', '.####']);
  });

  it('容許差異邊界: 淡紅距離約 34.6, 容許 34 不選、35 選', () => {
    expect(alphaMap(applyOps(pic, [op({ x: 0.3, y: 0.3, tol: 34 })]))[2]).toBe('#.###');
    expect(alphaMap(applyOps(pic, [op({ x: 0.3, y: 0.3, tol: 35 })]))[2]).toBe('#..##');
  });

  it('保留模式: 只留點到的區塊', () => {
    expect(alphaMap(applyOps(pic, [op({ mode: 'keep', x: 0.7, y: 0.3 })]))).toEqual(
      ['.....', '...#.', '...#.', '.....', '.....']);
  });

  it('整塊物件: 去背後再移除一整塊', () => {
    const out = applyOps(pic, [op({ x: 0, y: 0 }), op({ how: 'object', x: 0.3, y: 0.3 })]);
    expect(alphaMap(out)).toEqual(['.....', '.....', '.....', '.....', '#....']);
  });

  it('外擴只用在移除', () => {
    const grown = applyOps(pic, [op({ x: 0, y: 0.9, grow: true })]); // 點左下角的紅
    expect(alphaMap(grown).slice(3)).toEqual(['..###', '..###']);
    const keep = applyOps(pic, [op({ mode: 'keep', x: 0, y: 0.9, grow: true })]);
    expect(alphaMap(keep).slice(3)).toEqual(['.....', '#....']);
    expect(growMask(new Uint8Array([0, 0, 0, 0, 1, 0, 0, 0, 0]), 3, 3).every((v) => v === 1)).toBe(true);
  });

  it('點在透明處不動作', () => {
    const once = applyOps(pic, [op({ x: 0, y: 0 })]);
    expect(applyOps(once, [op({ x: 0, y: 0 })]).data).toEqual(once.data);
    expect(selectRegion(once, 0, 0, 'color', 40, true)).toBeNull();
  });

  it('相對座標: 換成兩倍大的圖照樣套', () => {
    const big = img(['WWWWWWWWWW', 'WWWWWWWWWW', 'WWRRRRBBWW', 'WWRRRRBBWW', 'WWRRrrBBWW', 'WWRRrrBBWW', 'WWWWWWWWWW',
      'WWWWWWWWWW', 'RRWWWWWWWW', 'RRWWWWWWWW']);
    const out = alphaMap(applyOps(big, [op({ mode: 'keep', x: 0.7, y: 0.3 })]));
    expect(out[2]).toBe('......##..');
  });
});

describe('橡皮擦', () => {
  const blank = (w: number, h: number) => img(Array.from({ length: h }, () => 'W'.repeat(w)));
  const erase = (points: [number, number][], r: number): EraseOp => ({ tool: 'erase', points, r });

  it('單點: 半徑很小也至少擦掉游標那一格', () => {
    expect(alphaMap(applyOps(blank(5, 5), [erase([[0.5, 0.5]], 0)]))).toEqual(
      ['#####', '#####', '##.##', '#####', '#####']);
  });

  it('一筆橫線: 沿路徑擦成一條', () => {
    // 半徑 = 0.2 × 5 = 1 格
    expect(alphaMap(applyOps(blank(5, 5), [erase([[0.1, 0.5], [0.9, 0.5]], 0.2)]))).toEqual(
      ['#####', '.....', '.....', '.....', '#####']);
  });

  it('相對座標: 換成兩倍大的圖, 擦的範圍跟著放大', () => {
    const out = alphaMap(applyOps(blank(10, 10), [erase([[0.1, 0.5], [0.9, 0.5]], 0.2)]));
    expect(out.filter((row) => row === '..........').length).toBe(4);
  });

  it('跟魔術棒混用: 依序套用', () => {
    const pic = img(['WWWWW', 'WRRBW', 'WRrBW', 'WWWWW', 'RWWWW']);
    const out = applyOps(pic, [op({ x: 0, y: 0 }), erase([[0.1, 0.9]], 0)]);
    expect(alphaMap(out)).toEqual(['.....', '.###.', '.###.', '.....', '.....']);
  });
});

describe('節點種類', () => {
  it('改部位: 有輸入、有素材接點、要花錢(上游換圖只亮過期)', async () => {
    const { NODE_INFO } = await import('../src/flow/model');
    expect(NODE_INFO.workshop).toEqual({ label: '改部位', hasInput: true, free: false, materials: true });
    expect(NODE_INFO.style).toEqual({ label: '改風格', hasInput: true, free: false });
  });
});

describe('存到素材庫的過期檢查', () => {
  const links = [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3' }];
  it('鏈中間用的是舊版上游 → 過期', () => {
    const flow: FlowMeta = { name: 'f', nodes: [node('n1', 'input', 2), node('n2', 'cutout', 1, 1), node('n3', 'pixel', 1, 1)], links };
    expect(chainStale(flow, 'n3')).toBe(true);
  });
  it('整條都是新的 → 不過期; 沒輸出 → 過期', () => {
    const flow: FlowMeta = { name: 'f', nodes: [node('n1', 'input', 2), node('n2', 'cutout', 1, 2), node('n3', 'pixel', 1, 1)], links };
    expect(chainStale(flow, 'n3')).toBe(false);
    expect(chainStale({ ...flow, nodes: [...flow.nodes.slice(0, 2), node('n3', 'pixel')] }, 'n3')).toBe(true);
  });
  it('改接到別的上游或沒接上游 → 過期', () => {
    const n2 = { ...node('n2', 'cutout', 1, 1), inputFrom: 'n1' };
    const rewired: FlowMeta = { name: 'f', nodes: [node('n1', 'input', 1), node('n5', 'input', 1), n2], links: [{ from: 'n5', to: 'n2' }] };
    expect(chainStale(rewired, 'n2')).toBe(true);
    expect(chainStale({ ...rewired, links: [] }, 'n2')).toBe(true);
    expect(chainStale({ ...rewired, links: [{ from: 'n1', to: 'n2' }] }, 'n2')).toBe(false);
  });
});
