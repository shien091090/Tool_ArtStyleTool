/** 色彩運算: OKLab 轉換、色相/飽和/色溫調整、色票抽取與對應、區塊色表。 */
import { PRESET_PALETTES } from './palettes';
import type { Recipe } from './recipe';

export type RGB = [number, number, number];
type Lab = [number, number, number];

export const TABLE_SIZE = 256;

export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: RGB): string {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const toSrgb = (v: number) => {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.max(v, 0) ** (1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, Math.round(c * 255)));
};

export function rgbToOklab([r, g, b]: RGB): Lab {
  const lr = toLinear(r), lg = toLinear(g), lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklabToRgb([L, a, b]: Lab): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** hue: 度; saturation: 彩度倍率; temperature: -1(冷)~1(暖)。 */
export function adjust(rgb: RGB, hue: number, saturation: number, temperature: number): RGB {
  if (hue === 0 && saturation === 1 && temperature === 0) return [rgb[0], rgb[1], rgb[2]];
  const [L, a, b] = rgbToOklab(rgb);
  const rad = (hue * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  let a2 = (a * cos - b * sin) * saturation;
  let b2 = (a * sin + b * cos) * saturation;
  a2 += 0.02 * temperature;
  b2 += 0.06 * temperature;
  return oklabToRgb([L, a2, b2]);
}

const dist2 = (p: Lab, q: Lab) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;

export function nearest(rgb: RGB, palette: RGB[]): RGB {
  const lab = rgbToOklab(rgb);
  let best = palette[0], bestD = Infinity;
  for (const p of palette) {
    const d = dist2(lab, rgbToOklab(p));
    if (d < bestD) { bestD = d; best = p; }
  }
  return [best[0], best[1], best[2]];
}

/** 依權重(區塊面積)在 OKLab 空間做 k-means, 初始化是決定性的: 同樣輸入一定得到同樣色票。 */
export function kmeansPalette(colors: RGB[], weights: number[], k: number): RGB[] {
  const uniq = new Map<string, { rgb: RGB; w: number }>();
  colors.forEach((c, i) => {
    const key = c.join(',');
    const e = uniq.get(key);
    if (e) e.w += weights[i] ?? 1;
    else uniq.set(key, { rgb: [c[0], c[1], c[2]], w: weights[i] ?? 1 });
  });
  const items = [...uniq.values()].sort((p, q) => q.w - p.w);
  if (items.length <= k) return items.map((e) => e.rgb);

  const labs = items.map((e) => rgbToOklab(e.rgb));
  const centers: Lab[] = [];
  for (const lab of labs) {
    if (centers.length >= k) break;
    if (centers.every((c) => dist2(c, lab) > 0.02 ** 2)) centers.push(lab);
  }
  for (const lab of labs) {
    if (centers.length >= k) break;
    if (!centers.includes(lab)) centers.push(lab);
  }

  const assign = new Array<number>(labs.length).fill(0);
  for (let iter = 0; iter < 20; iter++) {
    labs.forEach((lab, i) => {
      let best = 0, bestD = Infinity;
      centers.forEach((c, j) => {
        const d = dist2(lab, c);
        if (d < bestD) { bestD = d; best = j; }
      });
      assign[i] = best;
    });
    centers.forEach((_, j) => {
      let w = 0;
      const sum: Lab = [0, 0, 0];
      labs.forEach((lab, i) => {
        if (assign[i] !== j) return;
        const wi = items[i].w;
        w += wi;
        sum[0] += lab[0] * wi; sum[1] += lab[1] * wi; sum[2] += lab[2] * wi;
      });
      if (w > 0) centers[j] = [sum[0] / w, sum[1] / w, sum[2] / w];
    });
  }
  return centers.map(oklabToRgb);
}

/** 依配方的色彩層, 算出每個區塊最終顏色, 排成 256x256 的 RGBA 表(索引 = 區塊編號)。 */
export function buildRegionTable(
  regionColors: Record<string, RGB>,
  areas: Record<string, number>,
  color: Recipe['color'],
): Uint8Array {
  const table = new Uint8Array(TABLE_SIZE * TABLE_SIZE * 4);
  const ids = Object.keys(regionColors);
  let palette: RGB[] | null = null;
  if (color.enabled) {
    if (color.paletteMode === 'auto') {
      palette = kmeansPalette(ids.map((id) => regionColors[id]), ids.map((id) => areas[id] ?? 1), color.autoCount);
    } else if (color.paletteMode === 'preset') {
      palette = (Object.hasOwn(PRESET_PALETTES, color.preset) ? PRESET_PALETTES[color.preset] : []).map(hexToRgb);
    } else if (color.paletteMode === 'custom') {
      palette = color.custom.map(hexToRgb);
    }
    if (palette && palette.length === 0) palette = null;
  }
  for (const id of ids) {
    const n = Number(id);
    if (!Number.isInteger(n) || n < 0 || n >= TABLE_SIZE * TABLE_SIZE) continue;
    let c = regionColors[id];
    if (color.enabled) {
      if (palette) c = nearest(c, palette);
      c = adjust(c, color.hue, color.saturation, color.temperature);
    }
    table.set([c[0], c[1], c[2], 255], n * 4);
  }
  return table;
}
