/** 部位變形的純數學(座標皆為主圖座標, 不含畫布擴大的偏移)。 */
import type { BBox, Pad, Part, PartTransform, Place } from './model';

/** 與 canvas setTransform 相同: x' = a·x + c·y + e, y' = b·x + d·y + f */
export type Mat = [number, number, number, number, number, number];

export const IDENTITY_MAT: Mat = [1, 0, 0, 1, 0, 0];
const EPS = 1e-6;
const MAX_PAD = 4096;

export function multiply(m: Mat, n: Mat): Mat {
  // m ∘ n: 先套 n 再套 m
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function applyMat(m: Mat, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function invert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2];
  const [a, b, c, d] = [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det];
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

const translate = (x: number, y: number): Mat => [1, 0, 0, 1, x, y];

export function placeMat(place: Place | null): Mat {
  return place ? [place.scale, 0, 0, place.scale, place.tx, place.ty] : IDENTITY_MAT;
}

/** 外框四邊(像素邊緣, 右下 +1)。 */
export function bboxEdges(b: BBox): { x0: number; y0: number; x1: number; y1: number; w: number; h: number } {
  return { x0: b[0], y0: b[1], x1: b[2] + 1, y1: b[3] + 1, w: b[2] - b[0] + 1, h: b[3] - b[1] + 1 };
}

/** 部位放到主圖後(套放置變形、尚未套使用者變形)的外框邊緣。 */
export function placedEdges(part: Pick<Part, 'bbox' | 'place'>) {
  const e = bboxEdges(part.bbox);
  const s = part.place?.scale ?? 1;
  const tx = part.place?.tx ?? 0;
  const ty = part.place?.ty ?? 0;
  return { x0: e.x0 * s + tx, y0: e.y0 * s + ty, x1: e.x1 * s + tx, y1: e.y1 * s + ty, w: e.w * s, h: e.h * s };
}

export function anchorPoint(part: Pick<Part, 'bbox' | 'place' | 'transform'>): [number, number] {
  const e = placedEdges(part);
  const x = (e.x0 + e.x1) / 2;
  const a = part.transform.anchor;
  const y = a === 'top' ? e.y0 : a === 'bottom' ? e.y1 : (e.y0 + e.y1) / 2;
  return [x, y];
}

/** 部位圖座標 → 主圖座標: T(A + 位移) · R · S · T(−A) · 放置。 */
export function partMatrix(part: Pick<Part, 'bbox' | 'place' | 'transform'>): Mat {
  const t = part.transform;
  const e = placedEdges(part);
  const [ax, ay] = anchorPoint(part);
  const rad = (t.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rs: Mat = [cos * t.scaleX, sin * t.scaleX, -sin * t.scaleY, cos * t.scaleY, 0, 0];
  let m = translate(-ax, -ay);
  m = multiply(rs, m);
  m = multiply(translate(ax + t.dx * e.w, ay + t.dy * e.h), m);
  return multiply(m, placeMat(part.place));
}

export function isIdentityTransform(t: PartTransform): boolean {
  return (
    Math.abs(t.scaleX - 1) < EPS &&
    Math.abs(t.scaleY - 1) < EPS &&
    Math.abs(t.rotation) < EPS &&
    Math.abs(t.dx) < EPS &&
    Math.abs(t.dy) < EPS
  );
}

/** 主圖部位: 有變形或隱藏才算動過; 外來部位: 放到主圖上就算。 */
export function isChanged(part: Part): boolean {
  if (part.image !== 'main') return part.placed;
  return part.transform.hidden || !isIdentityTransform(part.transform);
}

/** 換過材質(套用中的不是原本材質)。 */
export function hasMaterial(part: Part): boolean {
  return !!part.material?.current;
}

/** 只換材質、沒動比例: 生成時只把邊緣一圈交給 AI 順接。 */
export function isMaterialOnly(part: Part): boolean {
  return part.image === 'main' && hasMaterial(part) && !isChanged(part);
}

/** 會畫在拼貼上的部位: 動過且沒隱藏, 或只換材質(要蓋上新材質)。沒動過的主圖部位已在底圖上。 */
export function isDrawn(part: Part): boolean {
  return (isChanged(part) || isMaterialOnly(part)) && !(part.image === 'main' && part.transform.hidden);
}

/** 變形後外框(主圖座標)。 */
export function transformedBBox(part: Part): [number, number, number, number] {
  const m = partMatrix(part);
  const e = bboxEdges(part.bbox);
  const pts = [
    applyMat(m, e.x0, e.y0),
    applyMat(m, e.x1, e.y0),
    applyMat(m, e.x0, e.y1),
    applyMat(m, e.x1, e.y1),
  ];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/**
 * 外來部位初次放上主圖: 有同名部位時底邊中點對齊、依外框高度等比; 否則原尺寸置中。
 */
export function placeForeign(src: BBox, target: BBox | null, canvasW: number, canvasH: number): Place {
  const s = bboxEdges(src);
  if (target) {
    const t = bboxEdges(target);
    const scale = t.h / s.h;
    return {
      scale,
      tx: (t.x0 + t.x1) / 2 - scale * ((s.x0 + s.x1) / 2),
      ty: t.y1 - scale * s.y1,
    };
  }
  return { scale: 1, tx: canvasW / 2 - (s.x0 + s.x1) / 2, ty: canvasH / 2 - (s.y0 + s.y1) / 2 };
}

/** 超出主圖的邊補到剛好容納再加長邊 2%; 沒超出的邊為 0。 */
export function autoPad(parts: Part[], w: number, h: number): Pad {
  const drawn = parts.filter(isDrawn);
  if (!drawn.length) return { top: 0, right: 0, bottom: 0, left: 0 };
  const boxes = drawn.map(transformedBBox);
  const margin = Math.max(w, h) * 0.02;
  const over = (v: number) => (v > 0.5 ? Math.min(MAX_PAD, Math.ceil(v + margin)) : 0);
  return {
    left: over(-Math.min(...boxes.map((b) => b[0]))),
    top: over(-Math.min(...boxes.map((b) => b[1]))),
    right: over(Math.max(...boxes.map((b) => b[2])) - w),
    bottom: over(Math.max(...boxes.map((b) => b[3])) - h),
  };
}
