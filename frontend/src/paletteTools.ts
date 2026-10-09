/** 自訂色票的輸入工具: 解析貼上的色碼、從參考圖抽色。 */
import { kmeansPalette, rgbToHex, type RGB } from './colorMath';

/** 從任意文字抓出 6 碼色碼(有無 # 都可, 例如 Lospec 的 .hex 檔), 轉小寫、去重、保留順序。 */
export function parseHexList(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?<![0-9a-fA-F])#?([0-9a-fA-F]{6})(?![0-9a-fA-F])/g)) {
    const hex = `#${m[1].toLowerCase()}`;
    if (!out.includes(hex)) out.push(hex);
  }
  return out;
}

export function isLospecUrl(text: string): boolean {
  return /lospec\.com\/palette-list\//i.test(text);
}

/** RGBA 像素 → 最多 count 色的色票, 依佔比由多到少。每通道先量化成 32 階加速, 透明像素略過。 */
export function paletteFromPixels(rgba: Uint8ClampedArray, count: number): string[] {
  const buckets = new Map<number, number>();
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    const key = ((rgba[i] >> 3) << 10) | ((rgba[i + 1] >> 3) << 5) | (rgba[i + 2] >> 3);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  const colors: RGB[] = [];
  const weights: number[] = [];
  for (const [key, n] of buckets) {
    colors.push([((key >> 10) & 31) * 8 + 4, ((key >> 5) & 31) * 8 + 4, (key & 31) * 8 + 4]);
    weights.push(n);
  }
  const palette = kmeansPalette(colors, weights, count);
  // kmeans 的結果依初始化順序(權重大的在前), 再依實際涵蓋的像素數排序一次
  const cover = palette.map(() => 0);
  colors.forEach((c, i) => {
    let best = 0, bestD = Infinity;
    palette.forEach((p, j) => {
      const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
      if (d < bestD) { bestD = d; best = j; }
    });
    cover[best] += weights[i];
  });
  return palette
    .map((p, j) => ({ hex: rgbToHex(p), n: cover[j] }))
    .sort((a, b) => b.n - a.n)
    .map((e) => e.hex)
    .filter((h, i, arr) => arr.indexOf(h) === i);
}

/** 讀圖片檔(只在瀏覽器裡處理), 長邊縮到 256px 再抽色。 */
export async function paletteFromImageFile(file: File, count: number): Promise<string[]> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return paletteFromPixels(ctx.getImageData(0, 0, w, h).data, count);
}
