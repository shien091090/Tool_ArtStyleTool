/** 像素素材: 型別與純函式。 */

/** auto 只剩舊候選會出現(AI 自己決定大小) */
export type PixelMode = 'auto' | 'grid';
/** kontext 只剩舊候選會出現 */
export type PixelModel = 'gpt-image-2' | 'nano-banana-pro' | 'kontext';
/** 右側「轉換方式」 */
export type PixelMethod = 'convert' | 'ai';

export const CELL = 8;
export const MAX_CELLS = 16;
export const ZOOM_EXPORT = 8;
export const MAX_EYES = 4;
/** 長邊 ≤ 這個像素用 GPT Image 2, 否則 Nano Banana Pro(與後端 GPT_MAX_SIDE 相同) */
export const GPT_MAX_SIDE = 96;
/** 長邊 ≤ 這個像素時 AI 不如直接轉換(2026-10-17 實驗) */
export const SMALL_SIDE = 48;

export const MODEL_LABEL: Record<PixelModel, string> = {
  'gpt-image-2': 'GPT Image 2',
  'nano-banana-pro': 'Nano Banana Pro',
  kontext: 'Kontext',
};
/** 每張約略花費(美元), 2026-10-17 fal 用量 */
export const MODEL_COST: Record<PixelModel, number> = { 'gpt-image-2': 0.06, 'nano-banana-pro': 0.15, kontext: 0.04 };

/** 眼睛標記: x、y 是 0~1 相對來源圖位置, r 是相對來源圖長邊的半徑 */
export interface EyeMark {
  x: number;
  y: number;
  r: number;
}

export interface PixelCandidate {
  id: string;
  created: string;
  /** convert = 直接轉換(不叫 AI) */
  mode: PixelMode | 'convert';
  model: PixelModel | '';
  cols: number;
  rows: number;
  colors: number;
  note: string;
  /** 流程像素化節點: 產生時的上游版本 */
  inputRev?: number;
  /** 直接轉換: 加外框、眼睛標記(舊候選是單一 eye) */
  outline?: boolean;
  eyes?: EyeMark[];
  eye?: EyeMark | null;
  /** 各縮小方式的預覽圖(ai/<候選>_<方式>.png), 依頁籤順序; 舊候選沒有 */
  previews?: { colors: number; items: { method: string; label: string }[] };
}

/** AI 重畫的設定; 模型由後端依尺寸選 */
export interface PixelSettings {
  cols: number;
  rows: number;
  colors: number;
  note: string;
  count: number;
}

export interface ConvertSettings {
  cols: number;
  rows: number;
  colors: number;
  outline: boolean;
  eyes: EyeMark[];
}

/** AI 建議的尺寸 */
export interface SizeSuggestion {
  cols: number;
  rows: number;
  colors: number;
  reason: string;
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

const longSide = (cols: number, rows: number) => Math.max(cols, rows) * CELL;

/** 與後端 default_colors 相同 */
export function defaultColors(mode: PixelMode, cols = 0, rows = 0): number {
  if (mode === 'auto') return 24;
  const side = longSide(cols, rows);
  return side <= 16 ? 8 : side <= 32 ? 12 : 16;
}

/** 與後端 convert.default_colors 相同 */
export function defaultConvertColors(cols: number, rows: number): number {
  return longSide(cols, rows) <= 32 ? 16 : 24;
}

/** 與後端 pick_model 相同 */
export function pickModel(cols: number, rows: number): PixelModel {
  return longSide(cols, rows) <= GPT_MAX_SIDE ? 'gpt-image-2' : 'nano-banana-pro';
}

export function modelReason(cols: number, rows: number): string {
  return pickModel(cols, rows) === 'gpt-image-2'
    ? `長邊 ${GPT_MAX_SIDE}px 以下, 這個模型最接近要求的格數`
    : `長邊超過 ${GPT_MAX_SIDE}px, 這個模型細節最好`;
}

export function isSmall(cols: number, rows: number): boolean {
  return longSide(cols, rows) <= SMALL_SIDE;
}

export function estimateCost(cols: number, rows: number, count: number): number {
  return MODEL_COST[pickModel(cols, rows)] * count;
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

/** 候選卡片標籤: 方式 · 實際像素尺寸 */
export function candidateLabel(c: PixelCandidate): string {
  const how = c.mode === 'convert' ? '直接轉換' : 'AI 重畫';
  return c.mode === 'auto' ? `${how} · 自動尺寸` : `${how} · ${c.cols * CELL}×${c.rows * CELL}`;
}

/** 候選的眼睛標記(相容舊的單一 eye) */
export function candidateEyes(c: PixelCandidate): EyeMark[] {
  return c.eyes ?? (c.eye ? [c.eye] : []);
}
