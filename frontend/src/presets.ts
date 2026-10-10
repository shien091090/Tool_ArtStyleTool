/** 內建的風格起始配方(唯讀): 從接近的畫風開始調, 存檔時要另存新名稱。 */
import { DEFAULT_RECIPE, type Recipe } from './recipe';

type Patch = { [S in keyof Omit<Recipe, 'version'>]?: Partial<Recipe[S]> };

/** 起始配方以「不保留原圖、線條開啟」為基準(它們是完全風格化的畫風), 個別配方再調。 */
function make(patch: Patch): Recipe {
  const r = structuredClone(DEFAULT_RECIPE);
  r.keep = { enabled: true, shade: 0, texture: 0 };
  r.lines.enabled = true;
  for (const [section, values] of Object.entries(patch)) Object.assign(r[section as keyof Patch], values);
  return r;
}

export const STARTER_RECIPES: { name: string; recipe: Recipe }[] = [
  {
    name: '漫畫網點',
    recipe: make({
      color: { saturation: 0 },
      lighting: { bands: 2, shadowMode: 'darken', shadowStrength: 0.1, ambient: 0.4, detailStrength: 0.6 },
      lines: { thickness: 0.8, outerThickness: 2.5 },
      effects: { halftone: true, halftoneShadowOnly: false, halftoneSize: 7, halftoneStrength: 0.9 },
      grade: { preset: 'noir', presetStrength: 0.35 },
    }),
  },
  {
    name: '水彩',
    recipe: make({
      lighting: { bands: 2, softness: 0.8, shadowStrength: 0.3 },
      lines: { thickness: -0.5, colorMode: 'region', colorDarken: 0.5, pressure: 0.5, breaks: 0.2 },
      keep: { texture: 0.35 },
      effects: { wcEdge: 0.7, wcBleed: 0.5, wcGranule: 0.35, paper: 0.35 },
      filter: { kuwahara: 2 },
      grade: { satShadow: -0.4 },
    }),
  },
  {
    name: '像素',
    recipe: make({
      color: { paletteMode: 'preset', preset: 'pico8' },
      lighting: { bands: 3, detailStrength: 0.5 },
      lines: { thickness: 0.5 },
      filter: { pixelSize: 6, outlineWidth: 6, outlineColor: '#1d2b53' },
    }),
  },
  {
    name: '木刻版畫',
    recipe: make({
      lighting: { bands: 2, shadowMode: 'darken', shadowStrength: 0.2 },
      lines: { thickness: 1, outerThickness: 3, pressure: 0.6 },
      effects: { hatch: true, hatchSpacing: 9, hatchWidth: 2.5, crossHatch: true, hatchStrength: 1, paper: 0.5 },
      grade: { gradientMap: true, gradientStops: ['#1a1410', '#efe4cf'] },
    }),
  },
  {
    name: '賽璐璐',
    recipe: make({
      lighting: {
        bands: 2, shadowMode: 'custom', shadowColor: '#4b3f8f', shadowStrength: 0.75, ambient: 0.15,
        normalStrength: 1.6, detailStrength: 0.35, specular: true, specSize: 0.25, rim: true, rimStrength: 0.5,
      },
      color: { saturation: 1.15 },
      keep: { texture: 0.3 },
      lines: { thickness: -0.3, outerThickness: 1.5 },
    }),
  },
  {
    name: '復古印刷',
    recipe: make({
      color: { paletteMode: 'custom', custom: ['#2b2d42', '#ef233c', '#f2c14e', '#3a86ff', '#f5ebe0'] },
      lighting: { bands: 2 },
      effects: { halftone: true, halftoneShadowOnly: false, halftoneSize: 5, halftoneStrength: 0.5, riso: 3, paper: 0.7, grain: 0.3 },
      grade: { preset: 'faded', presetStrength: 0.7 },
    }),
  },
  {
    name: 'Game Boy',
    recipe: make({
      color: { paletteMode: 'preset', preset: 'gameboy' },
      lighting: { bands: 3, detailStrength: 0.4 },
      lines: { thickness: 0.3 },
      filter: { pixelSize: 4, dither: true, ditherLevels: 4 },
    }),
  },
  {
    name: '鉛筆素描',
    recipe: make({
      color: { saturation: 0 },
      lighting: { bands: 3, shadowMode: 'darken', shadowStrength: 0.35, ambient: 0.5, softness: 0.4 },
      lines: { thickness: -0.5, texture: 'pencil', jitter: 0.8, pressure: 0.7, breaks: 0.15 },
      effects: { hatch: true, hatchSpacing: 5, hatchWidth: 0.8, hatchAngle: 50, hatchStrength: 0.45, paper: 0.6, grain: 0.15 },
      grade: { gradientMap: true, gradientStops: ['#2a2a2e', '#f4f1ea'] },
    }),
  },
  {
    name: '厚塗油畫',
    recipe: make({
      keep: { shade: 0.35, texture: 0.25 },
      lighting: { bands: 4, softness: 0.9, shadowMode: 'cool', shadowStrength: 0.45, litStrength: 0.35, ao: 0.4 },
      lines: { enabled: false },
      effects: { brush: 0.7, brushScale: 1.4, paper: 0.25 },
      filter: { kuwahara: 4, contrast: 1.1 },
      grade: { satShadow: -0.2, satHighlight: 0.15 },
    }),
  },
  {
    name: '霓虹賽博',
    recipe: make({
      color: { saturation: 1.5, hue: -15 },
      lighting: {
        bands: 2, shadowMode: 'custom', shadowColor: '#2b1055', shadowStrength: 0.7, ambient: 0.2,
        rim: true, rimStrength: 0.8, rimColor: '#00e5ff', fill: true, fillColor: '#ff2bd6', fillStrength: 0.5,
      },
      lines: { thickness: -0.5, colorMode: 'region', colorDarken: 0.7 },
      filter: { bloom: 0.6, bloomThreshold: 0.6, chroma: 2, scan: 0.25, vignette: 0.7, contrast: 1.3 },
      grade: { preset: 'night', presetStrength: 0.75 },
    }),
  },
  {
    name: '粉彩繪本',
    recipe: make({
      color: { saturation: 0.7, temperature: 0.15 },
      lighting: { bands: 2, softness: 0.7, litColor: '#fff4e0', litStrength: 0.4, shadowMode: 'custom', shadowColor: '#a3a0d8', shadowStrength: 0.35, ambient: 0.45 },
      lines: { thickness: -0.3, colorMode: 'region', colorDarken: 0.45, texture: 'crayon' },
      effects: { wcGranule: 0.25, paper: 0.5 },
      filter: { contrast: 0.85 },
      grade: { preset: 'faded', presetStrength: 0.5, satHighlight: -0.2 },
    }),
  },
  {
    name: '復古底片',
    recipe: make({
      keep: { shade: 0.7, texture: 0.7 },
      lighting: { bands: 3, softness: 0.6 },
      lines: { enabled: false },
      effects: { grain: 0.4 },
      filter: { vignette: 0.5, contrast: 0.9 },
      grade: { preset: 'film', presetStrength: 0.85, satShadow: -0.25 },
    }),
  },
];
