import { PRESET_PALETTES } from './palettes';

/** 風格配方: 各層的所有參數。以像素為單位的參數以長邊 1024px 為基準, 渲染時依圖片大小換算。 */
export interface Recipe {
  version: 1;
  color: {
    enabled: boolean;
    paletteMode: 'source' | 'auto' | 'preset' | 'custom';
    autoCount: number;
    preset: string;
    custom: string[];
    hue: number;
    saturation: number;
    temperature: number;
  };
  lighting: {
    enabled: boolean;
    azimuth: number;
    elevation: number;
    bands: number;
    shadowMode: 'darken' | 'cool' | 'custom';
    shadowColor: string;
    shadowStrength: number;
    litColor: string;
    litStrength: number;
    softness: number;
    edgeJitter: number;
    ambient: number;
    normalStrength: number;
    detailStrength: number;
    ao: number;
    rim: boolean;
    rimStrength: number;
    rimColor: string;
    specular: boolean;
    specSize: number;
    specSharpness: number;
    specColor: string;
    specStrength: number;
    fill: boolean;
    fillAzimuth: number;
    fillElevation: number;
    fillColor: string;
    fillStrength: number;
  };
  lines: {
    enabled: boolean;
    thickness: number;
    outerThickness: number;
    innerLines: boolean;
    variation: 'uniform' | 'shadow';
    variationAmount: number;
    pressure: number;
    pressureScale: number;
    breaks: number;
    colorMode: 'black' | 'region';
    colorDarken: number;
    texture: 'clean' | 'pencil' | 'crayon';
    jitter: number;
    doubleLine: boolean;
    doubleOffset: number;
    doubleAngle: number;
    doubleColor: string;
  };
  effects: {
    enabled: boolean;
    halftone: boolean;
    halftoneSize: number;
    halftoneAngle: number;
    halftoneShadowOnly: boolean;
    halftoneStrength: number;
    hatch: boolean;
    hatchSpacing: number;
    hatchAngle: number;
    hatchWidth: number;
    crossHatch: boolean;
    hatchStrength: number;
    stipple: boolean;
    stippleSize: number;
    stippleDensity: number;
    wcEdge: number;
    wcBleed: number;
    wcGranule: number;
    brush: number;
    brushScale: number;
    riso: number;
    risoAngle: number;
    paper: number;
    grain: number;
  };
  filter: {
    enabled: boolean;
    kuwahara: number;
    pixelSize: number;
    dither: boolean;
    ditherLevels: number;
    contrast: number;
    tint: string;
    tintStrength: number;
    vignette: number;
    outlineWidth: number;
    outlineColor: string;
    bloom: number;
    bloomThreshold: number;
    bloomRadius: number;
    chroma: number;
    scan: number;
    scanSpacing: number;
  };
  grade: {
    enabled: boolean;
    preset: GradePreset;
    presetStrength: number;
    gradientMap: boolean;
    gradientStops: string[];
    gradientStrength: number;
    satShadow: number;
    satHighlight: number;
  };
}

export type GradePreset = 'none' | 'film' | 'faded' | 'warm' | 'night' | 'noir';
export const GRADE_PRESET_NAMES: GradePreset[] = ['none', 'film', 'faded', 'warm', 'night', 'noir'];

export const DEFAULT_RECIPE: Recipe = {
  version: 1,
  color: { enabled: true, paletteMode: 'source', autoCount: 8, preset: 'pico8', custom: [], hue: 0, saturation: 1, temperature: 0 },
  lighting: {
    enabled: true, azimuth: 135, elevation: 45, bands: 3, shadowMode: 'cool', shadowColor: '#3a3f6b', shadowStrength: 0.5,
    litColor: '#fff2d6', litStrength: 0, softness: 0, edgeJitter: 0,
    ambient: 0.25, normalStrength: 1, detailStrength: 1, ao: 0, rim: false, rimStrength: 0.5, rimColor: '#ffffff',
    specular: false, specSize: 0.3, specSharpness: 0.8, specColor: '#ffffff', specStrength: 0.8,
    fill: false, fillAzimuth: 315, fillElevation: 20, fillColor: '#7fa7ff', fillStrength: 0.4,
  },
  lines: {
    enabled: true, thickness: 0, outerThickness: 0, innerLines: true, variation: 'uniform', variationAmount: 1.5,
    pressure: 0, pressureScale: 1, breaks: 0, colorMode: 'black', colorDarken: 0.5, texture: 'clean', jitter: 0,
    doubleLine: false, doubleOffset: 3, doubleAngle: 45, doubleColor: '#e04a4a',
  },
  effects: {
    enabled: true, halftone: false, halftoneSize: 6, halftoneAngle: 45, halftoneShadowOnly: true, halftoneStrength: 0.6,
    hatch: false, hatchSpacing: 6, hatchAngle: 45, hatchWidth: 1, crossHatch: false, hatchStrength: 0.7,
    stipple: false, stippleSize: 2, stippleDensity: 0.6,
    wcEdge: 0, wcBleed: 0, wcGranule: 0, brush: 0, brushScale: 1, riso: 0, risoAngle: 30,
    paper: 0, grain: 0,
  },
  filter: {
    enabled: true, kuwahara: 0, pixelSize: 1, dither: false, ditherLevels: 4, contrast: 1, tint: '#ffffff', tintStrength: 0, vignette: 0,
    outlineWidth: 0, outlineColor: '#ffffff', bloom: 0, bloomThreshold: 0.7, bloomRadius: 1, chroma: 0, scan: 0, scanSpacing: 3,
  },
  grade: {
    enabled: true, preset: 'none', presetStrength: 1, gradientMap: false, gradientStops: ['#1b1b3a', '#f2e6c9'],
    gradientStrength: 1, satShadow: 0, satHighlight: 0,
  },
};

export type Section = Exclude<keyof Recipe, 'version'>;
export const SECTIONS: Section[] = ['color', 'lighting', 'lines', 'effects', 'filter', 'grade'];

/** 數值欄位的合法範圍 [最小, 最大, 是否整數]。 */
export const LIMITS: Record<string, [number, number, boolean?]> = {
  'color.autoCount': [2, 32, true],
  'color.hue': [-180, 180],
  'color.saturation': [0, 2],
  'color.temperature': [-1, 1],
  'lighting.azimuth': [0, 360],
  'lighting.elevation': [5, 90],
  'lighting.bands': [1, 16, true],
  'lighting.shadowStrength': [0, 1],
  'lighting.litStrength': [0, 1],
  'lighting.softness': [0, 1],
  'lighting.edgeJitter': [0, 1],
  'lighting.ambient': [0, 1],
  'lighting.normalStrength': [0, 3],
  'lighting.detailStrength': [0, 3],
  'lighting.ao': [0, 1],
  'lighting.rimStrength': [0, 1],
  'lighting.specSize': [0, 1],
  'lighting.specSharpness': [0, 1],
  'lighting.specStrength': [0, 1],
  'lighting.fillAzimuth': [0, 360],
  'lighting.fillElevation': [5, 90],
  'lighting.fillStrength': [0, 1],
  'lines.thickness': [-3, 8],
  'lines.outerThickness': [-3, 8],
  'lines.variationAmount': [0, 6],
  'lines.pressure': [0, 1],
  'lines.pressureScale': [0.2, 4],
  'lines.breaks': [0, 1],
  'lines.colorDarken': [0, 1],
  'lines.jitter': [0, 4],
  'lines.doubleOffset': [0, 12],
  'lines.doubleAngle': [0, 360],
  'effects.halftoneSize': [3, 24],
  'effects.halftoneAngle': [0, 180],
  'effects.halftoneStrength': [0, 1],
  'effects.hatchSpacing': [3, 24],
  'effects.hatchAngle': [0, 180],
  'effects.hatchWidth': [0.5, 4],
  'effects.hatchStrength': [0, 1],
  'effects.stippleSize': [1, 8],
  'effects.stippleDensity': [0, 1],
  'effects.wcEdge': [0, 1],
  'effects.wcBleed': [0, 1],
  'effects.wcGranule': [0, 1],
  'effects.brush': [0, 1],
  'effects.brushScale': [0.3, 4],
  'effects.riso': [0, 12],
  'effects.risoAngle': [0, 360],
  'effects.paper': [0, 1],
  'effects.grain': [0, 1],
  'filter.kuwahara': [0, 6, true],
  'filter.pixelSize': [1, 32, true],
  'filter.ditherLevels': [2, 16, true],
  'filter.contrast': [0.5, 2],
  'filter.tintStrength': [0, 1],
  'filter.vignette': [0, 1],
  'filter.outlineWidth': [0, 16],
  'filter.bloom': [0, 1],
  'filter.bloomThreshold': [0, 1],
  'filter.bloomRadius': [0.5, 3],
  'filter.chroma': [0, 8],
  'filter.scan': [0, 1],
  'filter.scanSpacing': [2, 12],
  'grade.presetStrength': [0, 1],
  'grade.gradientStrength': [0, 1],
  'grade.satShadow': [-1, 1],
  'grade.satHighlight': [-1, 1],
};

const ENUMS: Record<string, readonly string[]> = {
  'color.paletteMode': ['source', 'auto', 'preset', 'custom'],
  'lighting.shadowMode': ['darken', 'cool', 'custom'],
  'lines.variation': ['uniform', 'shadow'],
  'lines.colorMode': ['black', 'region'],
  'lines.texture': ['clean', 'pencil', 'crayon'],
  'grade.preset': GRADE_PRESET_NAMES,
};

/** 色碼陣列的數量限制 [最少, 最多]。 */
const HEX_LISTS: Record<string, [number, number]> = {
  'color.custom': [0, 256],
  'grade.gradientStops': [2, 6],
};

const HEX = /^#[0-9a-fA-F]{6}$/;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * 讀入任意 JSON → 合法配方。缺欄位安靜補預設(舊配方沒有新效果很正常);
 * 型別錯、越界、未知選項才改回預設或夾回範圍, 並列在 fixed 裡。
 */
export function normalizeRecipe(raw: unknown): { recipe: Recipe; fixed: string[] } {
  const recipe = structuredClone(DEFAULT_RECIPE);
  const fixed: string[] = [];
  const input = isObject(raw) ? raw : {};
  for (const section of SECTIONS) {
    const src = input[section];
    if (src === undefined) continue;
    if (!isObject(src)) {
      fixed.push(section);
      continue;
    }
    const target = recipe[section] as unknown as Record<string, unknown>;
    for (const key of Object.keys(target)) {
      if (src[key] === undefined) continue;
      const path = `${section}.${key}`;
      const result = normalizeField(path, src[key], target[key]);
      if (!result) {
        fixed.push(path);
        continue;
      }
      if (result.changed) fixed.push(path);
      target[key] = result.value;
    }
  }
  return { recipe, fixed };
}

/** 回傳 null 代表值不合法, 沿用預設。 */
function normalizeField(path: string, value: unknown, fallback: unknown): { value: unknown; changed: boolean } | null {
  if (typeof fallback === 'boolean') return typeof value === 'boolean' ? { value, changed: false } : null;
  if (typeof fallback === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    const [min, max, integer] = LIMITS[path] ?? [-Infinity, Infinity];
    let v = Math.min(max, Math.max(min, value));
    if (integer) v = Math.round(v);
    return { value: v, changed: v !== value };
  }
  if (Array.isArray(fallback)) {
    if (!Array.isArray(value)) return null;
    const [min, max] = HEX_LISTS[path] ?? [0, 256];
    const valid = value.filter((c): c is string => typeof c === 'string' && HEX.test(c)).map((c) => c.toLowerCase());
    if (valid.length < min) return null;
    const kept = valid.slice(0, max);
    return { value: kept, changed: kept.length !== value.length };
  }
  if (typeof value !== 'string') return null;
  if (ENUMS[path]) return ENUMS[path].includes(value) ? { value, changed: false } : null;
  if (path === 'color.preset') return Object.hasOwn(PRESET_PALETTES, value) ? { value, changed: false } : null;
  if (HEX.test(String(fallback))) return HEX.test(value) ? { value: value.toLowerCase(), changed: false } : null;
  return { value, changed: false };
}
