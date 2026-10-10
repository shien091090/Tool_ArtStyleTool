/**
 * 參數面板的顯示規則: 只看核取方塊(與下拉選單選的模式)決定顯示哪些參數。
 * 不看拉桿的值: 拉桿拉到某個值時其他參數突然消失, 會讓人不知道發生什麼事。
 * key 是「層.欄位」, 例如 'filter.ditherLevels'。
 */
import type { Recipe, Section } from './recipe';

type Rule = (r: Recipe) => boolean;
const when = (flag: Rule) => flag;

const RULES: Record<string, Rule> = {
  'color.autoCount': (r) => r.color.paletteMode === 'auto',
  'color.preset': (r) => r.color.paletteMode === 'preset',
  'color.custom': (r) => r.color.paletteMode === 'custom',
  'lighting.shadowColor': (r) => r.lighting.shadowMode === 'custom',
  'lighting.rimStrength': (r) => r.lighting.rim,
  'lighting.rimColor': (r) => r.lighting.rim,
  'lines.variationAmount': (r) => r.lines.variation === 'shadow',
  'lines.colorDarken': (r) => r.lines.colorMode === 'region',
  'effects.halftoneShadowOnly': (r) => r.effects.halftone,
  'effects.halftoneSize': (r) => r.effects.halftone,
  'effects.halftoneAngle': (r) => r.effects.halftone,
  'effects.halftoneStrength': (r) => r.effects.halftone,
  'filter.ditherLevels': (r) => r.filter.dither,
  'grade.presetStrength': (r) => r.grade.preset !== 'none',
  'grade.gradientStops': (r) => r.grade.gradientMap,
  'grade.gradientStrength': (r) => r.grade.gradientMap,
};

// 「開關 + 一組子參數」型的效果: 開關打開才顯示子參數
const GROUPS: [string, Rule, string[]][] = [
  ['lighting', when((r) => r.lighting.specular), ['specSize', 'specSharpness', 'specColor', 'specStrength']],
  ['lighting', when((r) => r.lighting.fill), ['fillAzimuth', 'fillElevation', 'fillColor', 'fillStrength']],
  ['lines', when((r) => r.lines.doubleLine), ['doubleOffset', 'doubleAngle', 'doubleColor']],
  ['effects', when((r) => r.effects.hatch), ['hatchSpacing', 'hatchAngle', 'hatchWidth', 'crossHatch', 'hatchStrength']],
  ['effects', when((r) => r.effects.stipple), ['stippleSize', 'stippleDensity']],
];
for (const [section, rule, fields] of GROUPS) for (const f of fields) RULES[`${section}.${f}`] = rule;

export function isVisible(key: string, recipe: Recipe): boolean {
  const [section, field] = key.split('.') as [Section, string];
  if (field !== 'enabled' && !recipe[section].enabled) return false;
  return RULES[key]?.(recipe) ?? true;
}
