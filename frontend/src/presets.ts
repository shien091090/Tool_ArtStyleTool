/** 內建的風格起始配方(唯讀): 從接近的畫風開始調, 存檔時要另存新名稱。 */
import { DEFAULT_RECIPE, type Recipe } from './recipe';

type Patch = { [S in keyof Omit<Recipe, 'version'>]?: Partial<Recipe[S]> };

function make(patch: Patch): Recipe {
  const r = structuredClone(DEFAULT_RECIPE);
  for (const [section, values] of Object.entries(patch)) Object.assign(r[section as keyof Patch], values);
  return r;
}

export const STARTER_RECIPES: { name: string; recipe: Recipe }[] = [
  {
    name: '漫畫網點',
    recipe: make({
      lighting: { bands: 2, shadowMode: 'darken', shadowStrength: 0.15, ambient: 0.3 },
      lines: { thickness: 0.5, outerThickness: 2 },
      effects: { halftone: true, halftoneShadowOnly: true, halftoneSize: 6, halftoneStrength: 0.8 },
      grade: { preset: 'noir', presetStrength: 1 },
    }),
  },
  {
    name: '水彩',
    recipe: make({
      lighting: { bands: 2, softness: 0.8, shadowStrength: 0.3 },
      lines: { thickness: -0.5, colorMode: 'region', colorDarken: 0.5, pressure: 0.5, breaks: 0.2 },
      effects: { wcEdge: 0.6, wcBleed: 0.5, wcGranule: 0.5, paper: 0.6 },
      filter: { kuwahara: 2 },
      grade: { satShadow: -0.4 },
    }),
  },
  {
    name: '像素',
    recipe: make({
      color: { paletteMode: 'preset', preset: 'pico8' },
      lighting: { bands: 2 },
      lines: { thickness: 0.5 },
      filter: { pixelSize: 6, dither: true, ditherLevels: 4, outlineWidth: 6, outlineColor: '#1d2b53' },
    }),
  },
  {
    name: '木刻版畫',
    recipe: make({
      lighting: { bands: 2, shadowMode: 'darken', shadowStrength: 0.2 },
      lines: { thickness: 1, outerThickness: 3, pressure: 0.6 },
      effects: { hatch: true, hatchSpacing: 7, hatchWidth: 1.5, crossHatch: true, hatchStrength: 0.9, paper: 0.5 },
      grade: { gradientMap: true, gradientStops: ['#1a1410', '#efe4cf'] },
    }),
  },
  {
    name: '賽璐璐',
    recipe: make({
      lighting: {
        bands: 2, shadowMode: 'custom', shadowColor: '#5a4f8a', shadowStrength: 0.6, ambient: 0.2,
        specular: true, rim: true, rimStrength: 0.4,
      },
      lines: { thickness: -0.5, outerThickness: 1 },
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
