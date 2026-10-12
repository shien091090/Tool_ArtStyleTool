/** 像素素材: 型別與純函式。 */

export type PixelMode = 'auto' | 'grid';
export type PixelModel = 'kontext' | 'nano-banana-pro';

export const CELL = 8;
export const MAX_CELLS = 16;
export const ZOOM_EXPORT = 8;

export const MODEL_LABEL: Record<PixelModel, string> = {
  kontext: 'Kontext(遊戲感強, 會改色)',
  'nano-banana-pro': 'Nano Banana Pro(忠於原圖)',
};
/** 每張約略花費(美元), 2026-10-12 fal 用量 */
export const MODEL_COST: Record<PixelModel, number> = { kontext: 0.04, 'nano-banana-pro': 0.15 };

export interface PixelCandidate {
  id: string;
  created: string;
  mode: PixelMode;
  model: PixelModel;
  cols: number;
  rows: number;
  colors: number;
  note: string;
  /** 流程像素化節點: 產生時的上游版本 */
  inputRev?: number;
}

export interface PixelSettings {
  mode: PixelMode;
  model: PixelModel;
  cols: number;
  rows: number;
  colors: number;
  note: string;
  count: number;
}

export interface PixelWorkMeta {
  name: string;
  source: string;
  candidates: PixelCandidate[];
}

export interface PixelResult {
  method: string;
  label: string;
  png?: string;
  w?: number;
  h?: number;
  palette?: string[];
  error?: string;
}

/** 與後端 default_colors 相同 */
export function defaultColors(mode: PixelMode, cols = 0, rows = 0): number {
  if (mode === 'auto') return 24;
  const side = Math.max(cols, rows) * CELL;
  return side <= 16 ? 8 : side <= 32 ? 12 : 16;
}

export function estimateCost(mode: PixelMode, model: PixelModel, count: number): number {
  return MODEL_COST[mode === 'grid' ? 'nano-banana-pro' : model] * count;
}

/** GIMP / Aseprite 調色盤 */
export function toGpl(name: string, palette: string[]): string {
  const lines = ['GIMP Palette', `Name: ${name}`, 'Columns: 8', '#'];
  for (const hex of palette) {
    const v = hex.replace('#', '');
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
    lines.push(`${String(r).padStart(3)} ${String(g).padStart(3)} ${String(b).padStart(3)}\t${hex}`);
  }
  return lines.join('\n') + '\n';
}

/** 放進 box×box 的最大整數倍(至少 1) */
export function displayScale(w: number, h: number, box: number): number {
  return Math.max(1, Math.floor(box / Math.max(w, h)));
}

export function candidateLabel(c: PixelCandidate): string {
  if (c.mode === 'auto') return `自動 · ${c.model === 'kontext' ? 'Kontext' : 'Banana Pro'}`;
  return `寬${c.cols}×高${c.rows}格(${c.cols * CELL}×${c.rows * CELL})`;
}
