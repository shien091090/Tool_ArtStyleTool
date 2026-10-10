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
];
