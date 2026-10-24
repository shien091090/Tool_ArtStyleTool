/** 遊戲示意: 場景型別與純函式(座標換算、前後順序、點選、地面格)。與後端 mockup/geometry.py 同規則。 */
import type { ViewKey } from '../library/model';

export interface Terrain {
  label: string;
  color: string;
}

export interface Ground {
  cols: number;
  rows: number;
  /** 索引 = 列 × cols + 行; 斜角俯瞰的行是 i、列是 j */
  cells: (string | null)[];
  custom: Terrain[];
}

export interface BoxObj {
  id: string;
  kind: 'box';
  label: string;
  color: string;
  type: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 斜角俯瞰的立體方塊: 位置與佔地以格為單位, 高度為像素 */
export interface BlockObj {
  id: string;
  kind: 'block';
  label: string;
  color: string;
  type: string | null;
  i: number;
  j: number;
  w: number;
  l: number;
  h: number;
}

export interface AssetObj {
  id: string;
  kind: 'asset';
  asset: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  flip: boolean;
}

export type MockObject = BoxObj | BlockObj | AssetObj;

export interface MockStyle {
  text: string;
  /** 參考圖的素材編號(圖已複製進場景) */
  refs: string[];
  genre: string;
}

export interface Candidate {
  id: string;
  created: string;
  prompt: string;
  style: MockStyle;
  objects: MockObject[];
}

export interface Scene {
  name: string;
  view: ViewKey;
  created: string;
  updated: string;
  background: { label: string; color: string };
  ground: Ground | null;
  objects: MockObject[];
  style: MockStyle;
  candidates: Candidate[];
  nextCandidate: number;
}

/** 存檔時送出的部分 */
export type SceneBody = Pick<Scene, 'background' | 'ground' | 'objects' | 'style'>;

export const CANVAS: Record<ViewKey, [number, number]> = {
  side: [1280, 720],
  vertical: [720, 1280],
  topdown: [1280, 720],
  iso: [1280, 720],
  flat: [1280, 720],
};

export const TERRAINS: Terrain[] = [
  { label: '草地 grass', color: '#96b978' },
  { label: '水 water', color: '#78a5cd' },
  { label: '道路 road', color: '#b9aa8c' },
  { label: '沙地 sand', color: '#e0cc95' },
  { label: '石地 stone', color: '#9b9b9b' },
  { label: '牆 wall', color: '#6e6258' },
];

export const DEFAULT_BOX_COLOR = '#9a9a9a';
export const TILE = 64;
export const ISO = { tw: 96, th: 48, n: 10 };

export function bodyOf(s: Scene): SceneBody {
  return { background: s.background, ground: s.ground, objects: s.objects, style: s.style };
}

export function isoPoint(i: number, j: number, z = 0, w = 1280, h = 720): [number, number] {
  const ox = w / 2;
  const oy = (h - ISO.n * ISO.th) / 2;
  return [ox + ((i - j) * ISO.tw) / 2, oy + ((i + j) * ISO.th) / 2 - z];
}

/** 畫布像素 → 斜角格座標(小數) */
export function isoCell(x: number, y: number, w = 1280, h = 720): [number, number] {
  const a = (x - w / 2) / (ISO.tw / 2);
  const b = (y - (h - ISO.n * ISO.th) / 2) / (ISO.th / 2);
  return [(a + b) / 2, (b - a) / 2];
}

export type GroundGeom =
  | { kind: 'square'; tile: number; cols: number; rows: number; ox: number; oy: number }
  | { kind: 'iso'; cols: number; rows: number };

export function groundGeom(s: Scene): GroundGeom | null {
  const g = s.ground;
  if (!g) return null;
  if (s.view === 'iso') return { kind: 'iso', cols: g.cols, rows: g.rows };
  const [w, h] = CANVAS[s.view];
  if (s.view === 'topdown') return { kind: 'square', tile: TILE, cols: g.cols, rows: g.rows, ox: 0, oy: 0 };
  return { kind: 'square', tile: TILE, cols: g.cols, rows: g.rows, ox: (w - g.cols * TILE) / 2, oy: (h - g.rows * TILE) / 2 };
}

/** 畫布像素落在哪一格(索引); 沒有地面格或在格外回 null */
export function cellAt(s: Scene, x: number, y: number): number | null {
  const g = groundGeom(s);
  if (!g) return null;
  let c: number, r: number;
  if (g.kind === 'iso') [c, r] = isoCell(x, y).map(Math.floor) as [number, number];
  else [c, r] = [Math.floor((x - g.ox) / g.tile), Math.floor((y - g.oy) / g.tile)];
  return c >= 0 && r >= 0 && c < g.cols && r < g.rows ? r * g.cols + c : null;
}

/** 格中心的畫布像素 */
export function cellCenter(s: Scene, idx: number): [number, number] {
  const g = groundGeom(s)!;
  const c = idx % g.cols;
  const r = Math.floor(idx / g.cols);
  if (g.kind === 'iso') return isoPoint(c + 0.5, r + 0.5);
  return [g.ox + (c + 0.5) * g.tile, g.oy + (r + 0.5) * g.tile];
}

export function objectBox(view: ViewKey, o: MockObject): [number, number, number, number] {
  if (o.kind === 'block') {
    const pts = [[o.i, o.j], [o.i + o.w, o.j], [o.i + o.w, o.j + o.l], [o.i, o.j + o.l]]
      .flatMap(([a, b]) => [isoPoint(a, b), isoPoint(a, b, o.h)]);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }
  void view;
  return [o.x, o.y, o.x + o.w, o.y + o.h];
}

/** 斜角俯瞰的前後: 腳底越下面越前面 */
export function isoDepth(o: MockObject): number {
  if (o.kind === 'block') return isoPoint(o.i + o.w, o.j + o.l)[1];
  return o.y + o.h;
}

/** 由後往前的繪製順序: 斜角依腳底, 其他照清單 */
export function drawOrder(s: Scene): MockObject[] {
  if (s.view !== 'iso') return s.objects;
  return s.objects.map((o, n) => ({ o, n })).sort((a, b) => isoDepth(a.o) - isoDepth(b.o) || a.n - b.n).map((x) => x.o);
}

export function hitTest(s: Scene, x: number, y: number): MockObject | null {
  const order = drawOrder(s);
  for (let n = order.length - 1; n >= 0; n--) {
    const [x0, y0, x1, y1] = objectBox(s.view, order[n]);
    if (x >= x0 && x <= x1 && y >= y0 && y <= y1) return order[n];
  }
  return null;
}

export function snapStep(s: Scene): number {
  return s.view === 'topdown' ? TILE : 8;
}

export function snap(v: number, step: number): number {
  return Math.round(v / step) * step;
}

export function newObjectId(s: Scene): string {
  const max = s.objects.reduce((m, o) => Math.max(m, Number(o.id.slice(1)) || 0), 0);
  return `o${max + 1}`;
}

export function terrains(s: Scene): Terrain[] {
  return [...TERRAINS, ...(s.ground?.custom ?? [])];
}

export function terrainColor(s: Scene, label: string): string {
  return terrains(s).find((t) => t.label === label)?.color ?? '#808080';
}

/** 相連(四鄰)同地形 2 格以上的區域中心, 地面格上的標籤寫在這裡 */
export function regions(s: Scene): { label: string; x: number; y: number }[] {
  const g = s.ground;
  if (!g) return [];
  const seen = new Uint8Array(g.cells.length);
  const out: { label: string; x: number; y: number }[] = [];
  for (let start = 0; start < g.cells.length; start++) {
    const label = g.cells[start];
    if (!label || seen[start]) continue;
    const stack = [start];
    const members: number[] = [];
    seen[start] = 1;
    while (stack.length) {
      const k = stack.pop()!;
      members.push(k);
      const c: number = k % g.cols;
      const r: number = Math.floor(k / g.cols);
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc: number = c + dc;
        const nr: number = r + dr;
        const nk = nr * g.cols + nc;
        if (nc < 0 || nr < 0 || nc >= g.cols || nr >= g.rows || seen[nk] || g.cells[nk] !== label) continue;
        seen[nk] = 1;
        stack.push(nk);
      }
    }
    if (members.length < 2) continue;
    const pts = members.map((k) => cellCenter(s, k));
    out.push({ label, x: pts.reduce((a, p) => a + p[0], 0) / pts.length, y: pts.reduce((a, p) => a + p[1], 0) / pts.length });
  }
  return out;
}
