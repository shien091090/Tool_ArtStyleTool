/** 去除區塊的操作: 魔術棒(點一下選出一塊區域, 移除或只保留)與橡皮擦。純函式, 吃 ImageData 形狀的物件。 */

export interface Img {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface WandOp {
  mode: 'remove' | 'keep';
  /** color = 顏色相近; object = 不透明且相連的整塊 */
  how: 'color' | 'object';
  /** 0~1 相對位置, 上游換成不同尺寸也能重套 */
  x: number;
  y: number;
  tol: number;
  contiguous: boolean;
  grow: boolean;
}

/** 橡皮擦一筆: 沿路徑擦成透明 */
export interface EraseOp {
  tool: 'erase';
  /** 路徑點, 0~1 相對位置 */
  points: [number, number][];
  /** 筆刷半徑, 相對於圖的長邊 */
  r: number;
}

/** AI 去背: 套用節點存的透明度圖(matte.png) */
export interface MatteOp {
  tool: 'matte';
  /** 算透明度圖時的上游版本; 上游換了就要重跑 */
  rev: number;
}

/** 舊資料的魔術棒操作沒有 tool 欄位 */
export type CutoutOp = WandOp | EraseOp | MatteOp;

export const isErase = (op: CutoutOp): op is EraseOp => (op as EraseOp).tool === 'erase';
export const isMatte = (op: CutoutOp): op is MatteOp => (op as MatteOp).tool === 'matte';

/** 透明度乘上去背結果(matte 的紅色頻道 = 灰階值); 尺寸不同就不套 */
export function applyMatte(img: Img, matte: Img): void {
  if (matte.width !== img.width || matte.height !== img.height) return;
  for (let i = 0; i < img.width * img.height; i++) {
    img.data[i * 4 + 3] = Math.round((img.data[i * 4 + 3] * matte.data[i * 4]) / 255);
  }
}

export const DEFAULT_TOL = 40;
export const MAX_TOL = 150;

/** 選出區域; 點在透明處或圖外回傳 null */
export function selectRegion(img: Img, px: number, py: number, how: WandOp['how'], tol: number,
  contiguous: boolean): Uint8Array | null {
  const { data, width: w, height: h } = img;
  if (px < 0 || py < 0 || px >= w || py >= h) return null;
  const seed = py * w + px;
  if (data[seed * 4 + 3] === 0) return null;
  const [sr, sg, sb] = [data[seed * 4], data[seed * 4 + 1], data[seed * 4 + 2]];
  const tol2 = tol * tol;
  const match = (i: number) => {
    if (data[i * 4 + 3] === 0) return false;
    if (how === 'object') return true;
    const dr = data[i * 4] - sr;
    const dg = data[i * 4 + 1] - sg;
    const db = data[i * 4 + 2] - sb;
    return dr * dr + dg * dg + db * db <= tol2;
  };
  const mask = new Uint8Array(w * h);
  if (how === 'color' && !contiguous) {
    for (let i = 0; i < w * h; i++) if (match(i)) mask[i] = 1;
    return mask;
  }
  const stack = [seed];
  mask[seed] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i - x) / w;
    const next = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
    for (const j of next) {
      if (j >= 0 && !mask[j] && match(j)) {
        mask[j] = 1;
        stack.push(j);
      }
    }
  }
  return mask;
}

/** 往外擴 1px(含斜角) */
export function growMask(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = mask.slice();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h) out[ny * w + nx] = 1;
        }
      }
    }
  }
  return out;
}

/** 相對位置 → 像素座標 */
export function toPixel(img: Img, x: number, y: number): [number, number] {
  return [Math.min(img.width - 1, Math.floor(x * img.width)), Math.min(img.height - 1, Math.floor(y * img.height))];
}

/** 套一筆操作(就地修改); 點在透明處回傳 false */
export function applyOp(img: Img, op: WandOp): boolean {
  const [px, py] = toPixel(img, op.x, op.y);
  let mask = selectRegion(img, px, py, op.how, op.tol, op.contiguous);
  if (!mask) return false;
  if (op.mode === 'remove' && op.grow) mask = growMask(mask, img.width, img.height);
  const removeIf = op.mode === 'remove' ? 1 : 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] === removeIf) img.data[i * 4 + 3] = 0;
  return true;
}

/** 橡皮擦: 擦掉 from→to 線段附近(像素中心距離 ≤ 半徑)的像素, 就地修改。座標是像素單位 */
export function eraseSegment(img: Img, x1: number, y1: number, x2: number, y2: number, radius: number) {
  const { width: w, height: h, data } = img;
  // 至少擦到游標所在的那一格
  const r = Math.max(0.71, radius);
  const x0 = Math.max(0, Math.floor(Math.min(x1, x2) - r));
  const xe = Math.min(w - 1, Math.ceil(Math.max(x1, x2) + r));
  const y0 = Math.max(0, Math.floor(Math.min(y1, y2) - r));
  const ye = Math.min(h - 1, Math.ceil(Math.max(y1, y2) + r));
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  for (let y = y0; y <= ye; y++) {
    for (let x = x0; x <= xe; x++) {
      const cx = x + 0.5;
      const cy = y + 0.5;
      const t = len2 ? Math.max(0, Math.min(1, ((cx - x1) * dx + (cy - y1) * dy) / len2)) : 0;
      const ex = cx - (x1 + t * dx);
      const ey = cy - (y1 + t * dy);
      if (ex * ex + ey * ey <= r * r) data[(y * w + x) * 4 + 3] = 0;
    }
  }
}

/** 套一筆橡皮擦(就地修改) */
export function applyErase(img: Img, op: EraseOp) {
  const radius = op.r * Math.max(img.width, img.height);
  const pts = op.points.map(([x, y]) => [x * img.width, y * img.height]);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    eraseSegment(img, a[0], a[1], pts[i][0], pts[i][1], radius);
  }
}

/** 從原圖依序套所有操作, 回傳新圖(不改原圖) */
/** matte: AI 去背的透明度圖; 沒給就略過去背那一步 */
export function applyOps(src: Img, ops: CutoutOp[], matte: Img | null = null): Img {
  const img = { data: new Uint8ClampedArray(src.data), width: src.width, height: src.height };
  for (const op of ops) {
    if (isErase(op)) applyErase(img, op);
    else if (isMatte(op)) {
      if (matte) applyMatte(img, matte);
    } else applyOp(img, op);
  }
  return img;
}
