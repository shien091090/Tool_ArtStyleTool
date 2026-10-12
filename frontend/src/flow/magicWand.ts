/** 魔術棒: 點一下選出一塊區域, 移除或只保留它。純函式, 吃 ImageData 形狀的物件。 */

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

/** 從原圖依序套所有操作, 回傳新圖(不改原圖) */
export function applyOps(src: Img, ops: WandOp[]): Img {
  const img = { data: new Uint8ClampedArray(src.data), width: src.width, height: src.height };
  for (const op of ops) applyOp(img, op);
  return img;
}
