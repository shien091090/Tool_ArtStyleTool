/** 遊戲示意: 場景型別與純函式(世界與鏡頭、座標換算、前後順序、點選、地面格)。與後端 mockup/geometry.py 同規則。
 *
 * 物件存在世界座標裡; 鏡頭段數決定倍率(一個世界單位 = 幾個輸出像素), 輸出框以世界中心為中心。
 * 一般場景的世界單位 = 標準鏡頭下的輸出像素; 像素場景的世界單位 = 遊戲像素。
 */
import type { ViewKey } from '../library/model';

export interface Terrain {
  label: string;
  color: string;
}

export interface Ground {
  cols: number;
  rows: number;
  /** 索引 = 列 × cols + 行; 斜角俯瞰的行是 i、列是 j(再減掉偏移) */
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

/** 斜角俯瞰的立體方塊: 位置與佔地以格為單位, 高度為世界單位 */
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
  /** 像素場景對齊格子後的色數 */
  colors: number;
}

export type CameraLevel = 'xfar' | 'far' | 'std' | 'near' | 'xnear';

export interface Candidate {
  id: string;
  created: string;
  prompt: string;
  style: MockStyle;
  objects: MockObject[];
  camera: CameraLevel;
  /** 像素場景: 對齊格子前的 AI 原圖 */
  raw?: string;
}

export interface Scene {
  name: string;
  view: ViewKey;
  pixel: boolean;
  camera: CameraLevel;
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
export type SceneBody = Pick<Scene, 'background' | 'ground' | 'objects' | 'style' | 'camera'>;

/** 世界座標的矩形 [x0, y0, x1, y1] */
export type Rect = [number, number, number, number];

type Geo = Pick<Scene, 'view' | 'pixel'>;
type CamGeo = Geo & Pick<Scene, 'camera'>;

/** 輸出圖尺寸 */
export const CANVAS: Record<ViewKey, [number, number]> = {
  side: [1280, 720],
  vertical: [720, 1280],
  topdown: [1280, 720],
  iso: [1280, 720],
  flat: [1280, 720],
};

export const LEVELS: CameraLevel[] = ['xfar', 'far', 'std', 'near', 'xnear'];
export const LEVEL_LABEL: Record<CameraLevel, string> = { xfar: '超遠', far: '遠', std: '標準', near: '近', xnear: '超近' };
const SCALE_NORMAL: Record<CameraLevel, number> = { xfar: 0.5, far: 0.7, std: 1, near: 1.4, xnear: 2 };
const SCALE_PIXEL: Record<CameraLevel, number> = { xfar: 2, far: 4, std: 5, near: 8, xnear: 10 };

export const TERRAINS: Terrain[] = [
  { label: '草地 grass', color: '#96b978' },
  { label: '水 water', color: '#78a5cd' },
  { label: '道路 road', color: '#b9aa8c' },
  { label: '沙地 sand', color: '#e0cc95' },
  { label: '石地 stone', color: '#9b9b9b' },
  { label: '牆 wall', color: '#6e6258' },
];

export const DEFAULT_BOX_COLOR = '#9a9a9a';
export const COLOR_CHOICES = [16, 24, 32, 48, 64];
/** 地面方格邊長(世界單位) */
export const tileOf = (pixel: boolean) => (pixel ? 16 : 64);
/** 斜角: 格寬高、格點 (0,0) 的世界座標、格數、格索引偏移(一般場景的舊 10×10 在 26×26 中間) */
const ISO_GEO = {
  normal: { tw: 96, th: 48, ox: 640, oy: 120, n: 26, offset: 8 },
  pixel: { tw: 32, th: 16, ox: 320, oy: 20, n: 20, offset: 0 },
};
const isoGeo = (pixel: boolean) => (pixel ? ISO_GEO.pixel : ISO_GEO.normal);

export function bodyOf(s: Scene): SceneBody {
  return { background: s.background, ground: s.ground, objects: s.objects, style: s.style, camera: s.camera };
}

// ---- 世界與鏡頭 ----

export function cameraScale(s: Pick<Scene, 'pixel'>, camera: CameraLevel): number {
  return (s.pixel ? SCALE_PIXEL : SCALE_NORMAL)[camera];
}

export function worldRect(s: Geo): Rect {
  const [w, h] = CANVAS[s.view];
  if (s.pixel) return [0, 0, w / 2, h / 2];
  if (s.view === 'flat') return [0, 0, w, h];
  return [-w / 2, -h / 2, w * 1.5, h * 1.5];
}

/** 鏡頭的輸出框(世界座標) */
export function frameRect(s: CamGeo, camera: CameraLevel = s.camera): Rect {
  const [x0, y0, x1, y1] = worldRect(s);
  const [w, h] = CANVAS[s.view];
  const k = cameraScale(s, camera);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return [cx - w / k / 2, cy - h / k / 2, cx + w / k / 2, cy + h / k / 2];
}

/** 像素場景的原生解析度 */
export function nativeRes(s: Geo, camera: CameraLevel): [number, number] {
  const [w, h] = CANVAS[s.view];
  const k = cameraScale(s, camera);
  return [w / k, h / k];
}

const overlaps = (a: Rect, b: Rect) => Math.min(a[2], b[2]) > Math.max(a[0], b[0]) && Math.min(a[3], b[3]) > Math.max(a[1], b[1]);

/** 物件和輸出框相交(送 AI 時看得到) */
export function visible(s: CamGeo, o: MockObject, camera: CameraLevel = s.camera): boolean {
  return overlaps(objectBox(s, o), frameRect(s, camera));
}

// ---- 斜角與地面格 ----

export function isoPoint(pixel: boolean, i: number, j: number, z = 0): [number, number] {
  const g = isoGeo(pixel);
  return [g.ox + ((i - j) * g.tw) / 2, g.oy + ((i + j) * g.th) / 2 - z];
}

/** 世界座標 → 斜角格座標(小數) */
export function isoCell(pixel: boolean, x: number, y: number): [number, number] {
  const g = isoGeo(pixel);
  const a = (x - g.ox) / (g.tw / 2);
  const b = (y - g.oy) / (g.th / 2);
  return [(a + b) / 2, (b - a) / 2];
}

export type GroundGeom =
  | { kind: 'square'; tile: number; cols: number; rows: number; ox: number; oy: number }
  | { kind: 'iso'; cols: number; rows: number; offset: number };

export function groundGeom(s: Scene): GroundGeom | null {
  const g = s.ground;
  if (!g) return null;
  if (s.view === 'iso') return { kind: 'iso', cols: g.cols, rows: g.rows, offset: isoGeo(s.pixel).offset };
  const tile = tileOf(s.pixel);
  if (s.view === 'topdown') {
    // 一般場景從 (-640,-384) 鋪起: 舊的 20×12 格落在原位, 對齊 64 的基準不變
    const [ox, oy] = s.pixel ? [0, 0] : [-640, -384];
    return { kind: 'square', tile, cols: g.cols, rows: g.rows, ox, oy };
  }
  const [x0, y0, x1, y1] = worldRect(s);
  return { kind: 'square', tile, cols: g.cols, rows: g.rows, ox: (x0 + x1 - g.cols * tile) / 2, oy: (y0 + y1 - g.rows * tile) / 2 };
}

/** 世界座標落在哪一格(索引); 沒有地面格或在格外回 null */
export function cellAt(s: Scene, x: number, y: number): number | null {
  const g = groundGeom(s);
  if (!g) return null;
  let c: number, r: number;
  if (g.kind === 'iso') [c, r] = isoCell(s.pixel, x, y).map((v) => Math.floor(v) + g.offset) as [number, number];
  else [c, r] = [Math.floor((x - g.ox) / g.tile), Math.floor((y - g.oy) / g.tile)];
  return c >= 0 && r >= 0 && c < g.cols && r < g.rows ? r * g.cols + c : null;
}

/** 格中心的世界座標 */
export function cellCenter(s: Scene, idx: number): [number, number] {
  const g = groundGeom(s)!;
  const c = idx % g.cols;
  const r = Math.floor(idx / g.cols);
  if (g.kind === 'iso') return isoPoint(s.pixel, c - g.offset + 0.5, r - g.offset + 0.5);
  return [g.ox + (c + 0.5) * g.tile, g.oy + (r + 0.5) * g.tile];
}

// ---- 物件 ----

export function objectBox(s: Geo, o: MockObject): Rect {
  if (o.kind === 'block') {
    const pts = [[o.i, o.j], [o.i + o.w, o.j], [o.i + o.w, o.j + o.l], [o.i, o.j + o.l]]
      .flatMap(([a, b]) => [isoPoint(s.pixel, a, b), isoPoint(s.pixel, a, b, o.h)]);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }
  return [o.x, o.y, o.x + o.w, o.y + o.h];
}

/** 斜角俯瞰的前後: 腳底越下面越前面 */
export function isoDepth(pixel: boolean, o: MockObject): number {
  if (o.kind === 'block') return isoPoint(pixel, o.i + o.w, o.j + o.l)[1];
  return o.y + o.h;
}

/** 由後往前的繪製順序: 斜角依腳底, 其他照清單 */
export function drawOrder(s: Scene): MockObject[] {
  if (s.view !== 'iso') return s.objects;
  return s.objects.map((o, n) => ({ o, n })).sort((a, b) => isoDepth(s.pixel, a.o) - isoDepth(s.pixel, b.o) || a.n - b.n).map((x) => x.o);
}

export function hitTest(s: Scene, x: number, y: number): MockObject | null {
  const order = drawOrder(s);
  for (let n = order.length - 1; n >= 0; n--) {
    const [x0, y0, x1, y1] = objectBox(s, order[n]);
    if (x >= x0 && x <= x1 && y >= y0 && y <= y1) return order[n];
  }
  return null;
}

export function snapStep(s: Geo): number {
  if (s.view === 'topdown') return tileOf(s.pixel);
  return s.pixel ? 1 : 8;
}

export function snap(v: number, step: number): number {
  return Math.round(v / step) * step;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(Math.max(lo, hi), v));

/** 把物件夾回世界範圍內(斜角方塊夾在格子內) */
export function clampToWorld(s: Geo, o: MockObject): void {
  if (o.kind === 'block') {
    const g = isoGeo(s.pixel);
    o.i = clamp(o.i, -g.offset, g.n - g.offset - o.w);
    o.j = clamp(o.j, -g.offset, g.n - g.offset - o.l);
    return;
  }
  const [x0, y0, x1, y1] = worldRect(s);
  o.x = clamp(o.x, x0, x1 - o.w);
  o.y = clamp(o.y, y0, y1 - o.h);
}

/** 像素場景: 位置大小取整數遊戲像素; 斜角方塊位置佔地取半格、高度取整。一般場景不動。 */
export function roundPixel(s: Pick<Scene, 'pixel'>, o: MockObject): void {
  if (!s.pixel) return;
  if (o.kind === 'block') {
    o.i = snap(o.i, 0.5);
    o.j = snap(o.j, 0.5);
    o.w = Math.max(0.5, snap(o.w, 0.5));
    o.l = Math.max(0.5, snap(o.l, 0.5));
    o.h = Math.max(1, Math.round(o.h));
    return;
  }
  o.x = Math.round(o.x);
  o.y = Math.round(o.y);
  o.w = Math.max(1, Math.round(o.w));
  o.h = Math.max(1, Math.round(o.h));
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
