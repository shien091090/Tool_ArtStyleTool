/**
 * 拼貼與改動範圍的繪製。畫面預覽與送給後端的輸出走同一條 Canvas 2D 路徑, 看到的就是送出的。
 */
import { api } from '../api';
import type { Part, WorkMeta } from './model';
import { applyMat, bboxEdges, invert, isChanged, isDrawn, isMaterialOnly, multiply, partMatrix, type Mat } from './transform';

export interface PartLayer {
  /** 部位外框裁切: 原圖像素 × 遮罩 alpha */
  pixels: HTMLCanvasElement;
  /** 部位外框裁切: 白色 × 遮罩 alpha(畫改動範圍用) */
  white: HTMLCanvasElement;
  /** 部位外框裁切: 部位色 × 遮罩 alpha(畫面疊色用) */
  tint: HTMLCanvasElement;
  /** 外擴後的白色遮罩: 挖掉原位置用, 連邊緣的毛邊、反鋸齒一起挖掉, 避免留下原部位殘影 */
  cut: HTMLCanvasElement;
  cutOx: number;
  cutOy: number;
  /** 遮罩邊緣一圈(外擴 − 內縮): 只換材質的部位生成時只讓 AI 改這裡 */
  ring: HTMLCanvasElement;
  ringOx: number;
  ringOy: number;
  /** 整張圖大小的遮罩(0/255), 點選命中測試用 */
  alpha: Uint8Array;
  w: number;
  h: number;
  ox: number;
  oy: number;
}

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`圖片載入失敗: ${url}`));
    img.src = url;
  });
}

/** 挖原位置時遮罩外擴的半徑(像素)。 */
export function cutRadius(w: number, h: number): number {
  return Math.max(2, Math.round(Math.max(w, h) * 0.012));
}

/** 方形外擴(先橫向再縱向取最大值)。src 為 w×h, 回傳 (w+2r)×(h+2r)。 */
export function dilate(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const W = w + 2 * r;
  const H = h + 2 * r;
  const row = new Uint8Array(W * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!src[y * w + x]) continue;
      row.fill(255, y * W + x, y * W + x + 2 * r + 1);
    }
  }
  const out = new Uint8Array(W * H);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < W; x++) {
      if (!row[y * W + x]) continue;
      for (let k = 0; k <= 2 * r; k++) out[(y + k) * W + x] = 255;
    }
  }
  return out;
}

/** 只換材質部位的邊緣環半徑(像素)。 */
export function ringRadius(w: number, h: number): number {
  return Math.max(2, Math.round(Math.max(w, h) * 0.008));
}

/** 邊緣環: 外擴 r − 內縮 r。src 為 w×h, 回傳 (w+2r)×(h+2r)(與 dilate 對齊)。 */
export function ringMask(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const W = w + 2 * r;
  const H = h + 2 * r;
  const grown = dilate(src, w, h, r);
  // 內縮 = 反相後外擴再反相; 外框外當作「不是部位」, 所以貼邊處也會內縮
  const inv = new Uint8Array(W * H).fill(255);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) inv[(y + r) * W + x + r] = 255 - src[y * w + x];
  const dInv = dilate(inv, W, H, r);
  const W2 = W + 2 * r;
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const eroded = 255 - dInv[(y + r) * W2 + x + r];
      out[y * W + x] = grown[y * W + x] && !eroded ? 255 : 0;
    }
  }
  return out;
}

function whiteCanvas(alpha: Uint8Array, w: number, h: number): HTMLCanvasElement {
  const c = canvas(w, h);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(c.width, c.height);
  for (let i = 0; i < alpha.length; i++) {
    img.data.fill(255, i * 4, i * 4 + 3);
    img.data[i * 4 + 3] = alpha[i];
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** 部位像素來源的圖片快取鍵: 套用中的材質候選, 否則來源圖。 */
const sourceKey = (p: Part) => (p.material?.current ? `mat:${p.material.current}` : p.image);

/** 作品的圖與部位圖層快取。部位遮罩或圖改變時呼叫 sync 重載。 */
export class WorkAssets {
  images = new Map<string, HTMLImageElement>();
  layers = new Map<string, PartLayer>();
  private keys = new Map<string, string>();

  async sync(meta: WorkMeta): Promise<void> {
    for (const im of meta.images) {
      if (!this.images.has(im.id)) this.images.set(im.id, await loadImage(api.proportion.fileUrl(meta.name, `images/${im.id}.png`)));
    }
    for (const p of meta.parts) {
      const cur = p.material?.current;
      if (cur && !this.images.has(`mat:${cur}`)) {
        this.images.set(`mat:${cur}`, await loadImage(api.proportion.fileUrl(meta.name, `materials/${cur}.png`)));
      }
    }
    const alive = new Set(meta.parts.map((p) => p.id));
    for (const id of [...this.layers.keys()]) {
      if (!alive.has(id)) {
        this.layers.delete(id);
        this.keys.delete(id);
      }
    }
    for (const p of meta.parts) {
      const key = `${p.rev ?? 0}|${p.bbox.join(',')}|${JSON.stringify(p.points)}|${JSON.stringify(p.box)}|${p.color}|${sourceKey(p)}`;
      if (this.keys.get(p.id) === key) continue;
      const mask = await loadImage(api.proportion.fileUrl(meta.name, `masks/${p.id}.png`));
      this.layers.set(p.id, this.buildLayer(p, mask));
      this.keys.set(p.id, key);
    }
  }

  private buildLayer(part: Part, mask: HTMLImageElement): PartLayer {
    const src = this.images.get(sourceKey(part))!;
    const W = mask.naturalWidth;
    const H = mask.naturalHeight;
    const full = canvas(W, H).getContext('2d', { willReadFrequently: true })!;
    full.drawImage(mask, 0, 0);
    const data = full.getImageData(0, 0, W, H).data;
    const alpha = new Uint8Array(W * H);
    for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4] > 127 ? 255 : 0;

    const e = bboxEdges(part.bbox);
    const crop = (r: number, g: number, b: number): HTMLCanvasElement => {
      const c = canvas(e.w, e.h);
      const ctx = c.getContext('2d')!;
      const img = ctx.createImageData(e.w, e.h);
      for (let y = 0; y < e.h; y++) {
        for (let x = 0; x < e.w; x++) {
          const a = alpha[(y + e.y0) * W + x + e.x0];
          const o = (y * e.w + x) * 4;
          img.data[o] = r;
          img.data[o + 1] = g;
          img.data[o + 2] = b;
          img.data[o + 3] = a;
        }
      }
      ctx.putImageData(img, 0, 0);
      return c;
    };
    const white = crop(255, 255, 255);
    const hex = part.color.replace('#', '');
    const tint = crop(parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16));
    const pixels = canvas(e.w, e.h);
    const pctx = pixels.getContext('2d')!;
    pctx.drawImage(white, 0, 0);
    pctx.globalCompositeOperation = 'source-in';
    pctx.drawImage(src, -e.x0, -e.y0);

    const r = cutRadius(W, H);
    const local = new Uint8Array(e.w * e.h);
    for (let y = 0; y < e.h; y++) local.set(alpha.subarray((y + e.y0) * W + e.x0, (y + e.y0) * W + e.x0 + e.w), y * e.w);
    const cut = whiteCanvas(dilate(local, e.w, e.h, r), e.w + 2 * r, e.h + 2 * r);
    const rr = ringRadius(W, H);
    const ring = whiteCanvas(ringMask(local, e.w, e.h, rr), e.w + 2 * rr, e.h + 2 * rr);
    return {
      pixels, white, tint, cut, cutOx: e.x0 - r, cutOy: e.y0 - r, ring, ringOx: e.x0 - rr, ringOy: e.y0 - rr,
      alpha, w: W, h: H, ox: e.x0, oy: e.y0,
    };
  }
}

/** 部位裁切圖座標 → 拼貼畫布座標(含畫布擴大偏移)。 */
export function layerMatrix(part: Part, layer: PartLayer, padLeft: number, padTop: number): Mat {
  const m = multiply(partMatrix(part), [1, 0, 0, 1, layer.ox, layer.oy]);
  return multiply([1, 0, 0, 1, padLeft, padTop], m);
}

/** 邊緣環座標 → 拼貼畫布座標(跟著部位變形)。 */
function ringMatrix(part: Part, layer: PartLayer, padLeft: number, padTop: number): Mat {
  const m = multiply(partMatrix(part), [1, 0, 0, 1, layer.ringOx, layer.ringOy]);
  return multiply([1, 0, 0, 1, padLeft, padTop], m);
}

/** 原位置(未變形)外擴遮罩座標 → 拼貼畫布座標。 */
function cutMatrix(layer: PartLayer, padLeft: number, padTop: number): Mat {
  return [1, 0, 0, 1, layer.cutOx + padLeft, layer.cutOy + padTop];
}

export function collageSize(meta: WorkMeta): { w: number; h: number } {
  const main = meta.images.find((i) => i.id === 'main')!;
  return { w: main.w + meta.pad.left + meta.pad.right, h: main.h + meta.pad.top + meta.pad.bottom };
}

function drawAt(ctx: CanvasRenderingContext2D, src: CanvasImageSource, m: Mat) {
  ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
  ctx.drawImage(src, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

const mainParts = (meta: WorkMeta) => meta.parts.filter((p) => p.image === 'main');
const drawnByZ = (meta: WorkMeta) => meta.parts.filter(isDrawn).sort((a, b) => a.transform.z - b.transform.z);

/** 拼貼: 主圖 → 挖掉動過/隱藏部位原位置(外擴) → 依 z 畫上動過的部位; 擴大的區域透明。 */
export function drawCollage(ctx: CanvasRenderingContext2D, meta: WorkMeta, assets: WorkAssets): void {
  const { w, h } = collageSize(meta);
  const { left, top } = meta.pad;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(assets.images.get('main')!, left, top);
  ctx.globalCompositeOperation = 'destination-out';
  for (const p of mainParts(meta)) {
    const layer = assets.layers.get(p.id);
    if (layer && isChanged(p)) drawAt(ctx, layer.cut, cutMatrix(layer, left, top));
  }
  ctx.globalCompositeOperation = 'source-over';
  for (const p of drawnByZ(meta)) {
    const layer = assets.layers.get(p.id);
    if (layer) drawAt(ctx, layer.pixels, layerMatrix(p, layer, left, top));
  }
}

/** 改動範圍: 動過/隱藏的主圖部位原位置 ∪ 動過的部位新位置 ∪ 只換材質部位的邊緣環。黑底白範圍。 */
export function drawRegion(ctx: CanvasRenderingContext2D, meta: WorkMeta, assets: WorkAssets): void {
  const { w, h } = collageSize(meta);
  const { left, top } = meta.pad;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  for (const p of mainParts(meta)) {
    const layer = assets.layers.get(p.id);
    if (layer && isChanged(p)) drawAt(ctx, layer.cut, cutMatrix(layer, left, top));
  }
  for (const p of drawnByZ(meta)) {
    const layer = assets.layers.get(p.id);
    if (!layer) continue;
    if (isMaterialOnly(p)) drawAt(ctx, layer.ring, ringMatrix(p, layer, left, top));
    else drawAt(ctx, layer.white, layerMatrix(p, layer, left, top));
  }
}

/** 素材圖檢視: 原圖 + 該圖上換過材質的部位。 */
export function drawSourceView(ctx: CanvasRenderingContext2D, meta: WorkMeta, assets: WorkAssets, imageId: string): void {
  const img = assets.images.get(imageId);
  if (!img) return;
  ctx.drawImage(img, 0, 0);
  for (const p of meta.parts) {
    const layer = assets.layers.get(p.id);
    if (p.image === imageId && p.material?.current && layer) drawAt(ctx, layer.pixels, [1, 0, 0, 1, layer.ox, layer.oy]);
  }
}

/** 是否有東西可以生成: 動過比例或換過材質。 */
export function hasEdits(meta: WorkMeta): boolean {
  return meta.parts.some((p) => isChanged(p) || isMaterialOnly(p));
}

function toBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('輸出圖片失敗'))), 'image/png'));
}

export async function exportCollage(meta: WorkMeta, assets: WorkAssets): Promise<{ collage: Blob; region: Blob }> {
  const { w, h } = collageSize(meta);
  const c1 = canvas(w, h);
  drawCollage(c1.getContext('2d')!, meta, assets);
  const c2 = canvas(w, h);
  drawRegion(c2.getContext('2d')!, meta, assets);
  return { collage: await toBlob(c1), region: await toBlob(c2) };
}

/** 主圖座標的點是否落在部位(變形後)上。 */
export function hitPart(part: Part, layer: PartLayer, x: number, y: number): boolean {
  const m = isDrawn(part) ? partMatrix(part) : ([1, 0, 0, 1, 0, 0] as Mat);
  const [sx, sy] = applyMat(invert(m), x, y);
  const ix = Math.floor(sx);
  const iy = Math.floor(sy);
  if (ix < 0 || iy < 0 || ix >= layer.w || iy >= layer.h) return false;
  return layer.alpha[iy * layer.w + ix] > 0;
}
