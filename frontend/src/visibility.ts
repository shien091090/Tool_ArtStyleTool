/** 參數面板的顯示規則: 調了也不會有效果的參數就隱藏。key 是「層.欄位」, 例如 'filter.ditherLevels'。 */
import type { Recipe, Section } from './recipe';

type Rule = (r: Recipe) => boolean;

/** 光照有在產生明暗(有陰影區可言)。 */
const shading: Rule = (r) => r.lighting.enabled && r.lighting.bands >= 2;
const lit: Rule = (r) => r.lighting.bands >= 2;
const lightUsed: Rule = (r) => lit(r) || r.lighting.rim || r.lighting.specular || r.lighting.fill;
const when = (flag: Rule) => flag;

const RULES: Record<string, Rule> = {
  'color.autoCount': (r) => r.color.paletteMode === 'auto',
  'color.preset': (r) => r.color.paletteMode === 'preset',
  'color.custom': (r) => r.color.paletteMode === 'custom',
  'lighting.azimuth': lightUsed,
  'lighting.elevation': lightUsed,
  'lighting.normalStrength': lightUsed,
  'lighting.detailStrength': lightUsed,
  'lighting.shadowMode': lit,
  'lighting.shadowColor': (r) => lit(r) && r.lighting.shadowMode === 'custom',
  'lighting.shadowStrength': lit,
  'lighting.litColor': lit,
  'lighting.litStrength': lit,
  'lighting.softness': lit,
  'lighting.edgeJitter': lit,
  'lighting.ambient': lit,
  'lighting.ao': lit,
  'lighting.rimStrength': (r) => r.lighting.rim,
  'lighting.rimColor': (r) => r.lighting.rim,
  'lines.variationAmount': (r) => r.lines.variation === 'shadow' && shading(r),
  'lines.pressureScale': (r) => r.lines.pressure > 0,
  'lines.colorDarken': (r) => r.lines.colorMode === 'region',
  'effects.halftoneShadowOnly': (r) => r.effects.halftone && shading(r),
  'effects.halftoneSize': (r) => r.effects.halftone,
  'effects.halftoneAngle': (r) => r.effects.halftone,
  'effects.halftoneStrength': (r) => r.effects.halftone,
  'effects.brushScale': (r) => r.effects.brush > 0,
  'effects.risoAngle': (r) => r.effects.riso > 0,
  'filter.ditherLevels': (r) => r.filter.dither,
  'filter.outlineColor': (r) => r.filter.outlineWidth > 0,
  'filter.bloomThreshold': (r) => r.filter.bloom > 0,
  'filter.bloomRadius': (r) => r.filter.bloom > 0,
  'filter.scanSpacing': (r) => r.filter.scan > 0,
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
