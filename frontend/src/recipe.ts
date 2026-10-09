import { PRESET_PALETTES } from './palettes';

/** 風格配方: 五層的所有參數。以像素為單位的參數以長邊 1024px 為基準, 渲染時依圖片大小換算。 */
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
    shadowMode: 'darken' | 'cool';
    shadowStrength: number;
    ambient: number;
    normalStrength: number;
    rim: boolean;
    rimStrength: number;
    rimColor: string;
  };
  lines: {
    enabled: boolean;
    thickness: number;
    variation: 'uniform' | 'shadow';
    variationAmount: number;
    colorMode: 'black' | 'region';
    colorDarken: number;
    texture: 'clean' | 'pencil' | 'crayon';
    jitter: number;
  };
  effects: {
    enabled: boolean;
    halftone: boolean;
    halftoneSize: number;
    halftoneAngle: number;
    halftoneShadowOnly: boolean;
    halftoneStrength: number;
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
  };
}

export const DEFAULT_RECIPE: Recipe = {
  version: 1,
  color: { enabled: true, paletteMode: 'source', autoCount: 8, preset: 'pico8', custom: [], hue: 0, saturation: 1, temperature: 0 },
  lighting: {
    enabled: true, azimuth: 135, elevation: 45, bands: 3, shadowMode: 'cool', shadowStrength: 0.5,
    ambient: 0.25, normalStrength: 1, rim: false, rimStrength: 0.5, rimColor: '#ffffff',
  },
  lines: { enabled: true, thickness: 0, variation: 'uniform', variationAmount: 1.5, colorMode: 'black', colorDarken: 0.5, texture: 'clean', jitter: 0 },
  effects: { enabled: true, halftone: false, halftoneSize: 6, halftoneAngle: 45, halftoneShadowOnly: true, halftoneStrength: 0.6, paper: 0, grain: 0 },
  filter: { enabled: true, kuwahara: 0, pixelSize: 1, dither: false, ditherLevels: 4, contrast: 1, tint: '#ffffff', tintStrength: 0, vignette: 0 },
};

type Section = Exclude<keyof Recipe, 'version'>;
const SECTIONS: Section[] = ['color', 'lighting', 'lines', 'effects', 'filter'];

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
  'lighting.ambient': [0, 1],
  'lighting.normalStrength': [0, 3],
  'lighting.rimStrength': [0, 1],
  'lines.thickness': [-3, 8],
  'lines.variationAmount': [0, 6],
  'lines.colorDarken': [0, 1],
  'lines.jitter': [0, 4],
  'effects.halftoneSize': [3, 24],
  'effects.halftoneAngle': [0, 180],
  'effects.halftoneStrength': [0, 1],
  'effects.paper': [0, 1],
  'effects.grain': [0, 1],
  'filter.kuwahara': [0, 6, true],
  'filter.pixelSize': [1, 32, true],
  'filter.ditherLevels': [2, 16, true],
  'filter.contrast': [0.5, 2],
  'filter.tintStrength': [0, 1],
  'filter.vignette': [0, 1],
};

const ENUMS: Record<string, readonly string[]> = {
  'color.paletteMode': ['source', 'auto', 'preset', 'custom'],
  'lighting.shadowMode': ['darken', 'cool'],
  'lines.variation': ['uniform', 'shadow'],
  'lines.colorMode': ['black', 'region'],
  'lines.texture': ['clean', 'pencil', 'crayon'],
};

const HEX = /^#[0-9a-fA-F]{6}$/;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** 讀入任意 JSON → 合法配方。缺的補預設, 越界的夾回範圍, 型別錯的改回預設; fixed 列出被動過的欄位。 */
export function normalizeRecipe(raw: unknown): { recipe: Recipe; fixed: string[] } {
  const recipe = structuredClone(DEFAULT_RECIPE);
  const fixed: string[] = [];
  const input = isObject(raw) ? raw : {};
  for (const section of SECTIONS) {
    const src = input[section];
    if (!isObject(src)) {
      fixed.push(section);
      continue;
    }
    const target = recipe[section] as unknown as Record<string, unknown>;
    for (const key of Object.keys(target)) {
      const path = `${section}.${key}`;
      const value = normalizeField(path, src[key], target[key]);
      if (value === undefined) fixed.push(path);
      else {
        if (value.changed) fixed.push(path);
        target[key] = value.value;
      }
    }
  }
  return { recipe, fixed };
}

/** 回傳 undefined 代表沿用預設值。 */
function normalizeField(path: string, value: unknown, fallback: unknown): { value: unknown; changed: boolean } | undefined {
  if (value === undefined) return undefined;
  if (typeof fallback === 'boolean') return typeof value === 'boolean' ? { value, changed: false } : undefined;
  if (typeof fallback === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    const [min, max, integer] = LIMITS[path] ?? [-Infinity, Infinity];
    let v = Math.min(max, Math.max(min, value));
    if (integer) v = Math.round(v);
    return { value: v, changed: v !== value };
  }
  if (Array.isArray(fallback)) {
    if (!Array.isArray(value)) return undefined;
    const kept = value.filter((c): c is string => typeof c === 'string' && HEX.test(c)).map((c) => c.toLowerCase());
    return { value: kept, changed: kept.length !== value.length };
  }
  if (typeof value !== 'string') return undefined;
  if (ENUMS[path]) return ENUMS[path].includes(value) ? { value, changed: false } : undefined;
  if (path === 'color.preset') return value in PRESET_PALETTES ? { value, changed: false } : undefined;
  if (HEX.test(String(fallback))) return HEX.test(value) ? { value: value.toLowerCase(), changed: false } : undefined;
  return { value, changed: false };
}
