/** 部位比例作品的資料型別(與後端 meta.json 一致)。 */

export type Anchor = 'top' | 'center' | 'bottom';
export const ANCHORS: Anchor[] = ['top', 'center', 'bottom'];

export interface PartTransform {
  scaleX: number;
  scaleY: number;
  rotation: number; // 度
  anchor: Anchor;
  dx: number; // 外框寬的比例
  dy: number; // 外框高的比例
  z: number;
  hidden: boolean;
}

/** 外來部位: 素材圖座標 → 主圖座標。 */
export interface Place {
  scale: number;
  tx: number;
  ty: number;
}

export interface Pad {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface SegPoint {
  x: number;
  y: number;
  label: 0 | 1;
}

export interface SegBox {
  x_min: number;
  y_min: number;
  x_max: number;
  y_max: number;
}

/** [x0, y0, x1, y1], 含端點。 */
export type BBox = [number, number, number, number];

export interface MaterialVariant {
  id: string;
  material: string;
  ref: boolean;
  created: string;
}

export interface PartMaterial {
  /** 套用中的候選; null = 原本材質 */
  current: string | null;
  variants: MaterialVariant[];
}

export interface Part {
  id: string;
  name: string;
  image: string;
  color: string;
  points: SegPoint[];
  box: SegBox | null;
  placed: boolean;
  place: Place | null;
  transform: PartTransform;
  bbox: BBox;
  /** 遮罩重切次數(前端快取用) */
  rev?: number;
  /** 舊作品沒有 = 原本材質 */
  material?: PartMaterial;
  /** 之前的切法, 有才可以「復原上一次切法」 */
  history?: MaskHistory[];
}

/** 部位切法的上一版(復原用) */
export interface MaskHistory {
  file: string;
}

export interface WorkImage {
  id: string;
  name: string;
  w: number;
  h: number;
  /** 流程改部位節點的素材: 來源節點與取自第幾版 */
  source?: string;
  inputRev?: number;
}

export interface ResultInfo {
  id: string;
  created: string;
  model: string;
}

export interface WorkMeta {
  version: number;
  /** 流程改部位節點: 主圖取自上游第幾版 */
  inputRev?: number;
  name: string;
  created: string;
  updated: string;
  images: WorkImage[];
  parts: Part[];
  pad: Pad;
  results: ResultInfo[];
  /** AI 列部位記下的中文名 → 英文 */
  aliases?: Record<string, string>;
}

export const ZERO_PAD: Pad = { top: 0, right: 0, bottom: 0, left: 0 };

export const EDIT_MODELS = [
  { id: 'nano-banana', label: 'Nano Banana(最忠實)' },
  { id: 'qwen', label: 'Qwen' },
] as const;
