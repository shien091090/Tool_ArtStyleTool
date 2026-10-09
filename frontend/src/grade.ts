/** 調色層: 參數化的調色預設(lift/gamma/gain、飽和、對比)與漸層映射的色帶表。 */
import { hexToRgb } from './colorMath';
import type { GradePreset } from './recipe';

type V3 = [number, number, number];

export interface GradeParams {
  lift: V3;
  gamma: V3;
  gain: V3;
  sat: number;
  contrast: number;
}

export const IDENTITY_GRADE: GradeParams = { lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], sat: 1, contrast: 1 };

export const GRADE_PRESETS: Record<GradePreset, GradeParams> = {
  none: IDENTITY_GRADE,
  film: { lift: [0, 0.02, 0.04], gamma: [1, 1, 1], gain: [1.08, 1.0, 0.9], sat: 1.1, contrast: 1.1 },
  faded: { lift: [0.08, 0.07, 0.06], gamma: [1, 1, 1], gain: [0.95, 0.94, 0.92], sat: 0.75, contrast: 0.85 },
  warm: { lift: [0.03, 0.01, -0.01], gamma: [1, 1, 1], gain: [1.1, 1.0, 0.82], sat: 1.05, contrast: 1 },
  night: { lift: [0, 0.01, 0.05], gamma: [0.95, 0.95, 1], gain: [0.75, 0.85, 1.1], sat: 0.8, contrast: 1.05 },
  noir: { lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], sat: 0, contrast: 1.4 },
};

export const GRADE_LABELS: Record<GradePreset, string> = {
  none: '無', film: '電影感', faded: '褪色底片', warm: '復古暖黃', night: '冷調夜晚', noir: '高對比黑白',
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerp3 = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** 依強度在「不調色」與預設之間內插。 */
export function gradePresetUniforms(preset: GradePreset, strength: number): GradeParams {
  const p = GRADE_PRESETS[preset] ?? IDENTITY_GRADE;
  if (preset === 'none' || strength <= 0) return IDENTITY_GRADE;
  const I = IDENTITY_GRADE;
  return {
    lift: lerp3(I.lift, p.lift, strength),
    gamma: lerp3(I.gamma, p.gamma, strength),
    gain: lerp3(I.gain, p.gain, strength),
    sat: lerp(I.sat, p.sat, strength),
    contrast: lerp(I.contrast, p.contrast, strength),
  };
}

/** 色帶 → 256 格 RGBA 表(索引 = 亮度), 各色等距分布、之間線性內插。 */
export function gradientTable(stops: string[]): Uint8Array {
  const cols = stops.map(hexToRgb);
  const out = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const pos = (i / 255) * (cols.length - 1);
    const k = Math.min(cols.length - 2, Math.floor(pos));
    const t = pos - k;
    for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.round(lerp(cols[k][c], cols[k + 1][c], t));
    out[i * 4 + 3] = 255;
  }
  return out;
}
