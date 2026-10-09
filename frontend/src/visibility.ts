/** 參數面板的顯示規則: 調了也不會有效果的參數就隱藏。key 是「層.欄位」, 例如 'filter.ditherLevels'。 */
import type { Recipe } from './recipe';

type Rule = (r: Recipe) => boolean;

/** 光照有在產生明暗(有陰影區可言)。 */
const shading: Rule = (r) => r.lighting.enabled && r.lighting.bands >= 2;
const lit: Rule = (r) => r.lighting.bands >= 2;
const lightUsed: Rule = (r) => lit(r) || r.lighting.rim;

const RULES: Record<string, Rule> = {
  'color.autoCount': (r) => r.color.paletteMode === 'auto',
  'color.preset': (r) => r.color.paletteMode === 'preset',
  'color.custom': (r) => r.color.paletteMode === 'custom',
  'lighting.azimuth': lightUsed,
  'lighting.elevation': lightUsed,
  'lighting.normalStrength': lightUsed,
  'lighting.detailStrength': lightUsed,
  'lighting.shadowMode': lit,
  'lighting.shadowStrength': lit,
  'lighting.ambient': lit,
  'lighting.rimStrength': (r) => r.lighting.rim,
  'lighting.rimColor': (r) => r.lighting.rim,
  'lines.variationAmount': (r) => r.lines.variation === 'shadow' && shading(r),
  'lines.colorDarken': (r) => r.lines.colorMode === 'region',
  'effects.halftoneShadowOnly': (r) => r.effects.halftone && shading(r),
  'effects.halftoneSize': (r) => r.effects.halftone,
  'effects.halftoneAngle': (r) => r.effects.halftone,
  'effects.halftoneStrength': (r) => r.effects.halftone,
  'filter.ditherLevels': (r) => r.filter.dither,
};

export function isVisible(key: string, recipe: Recipe): boolean {
  const [section, field] = key.split('.') as [Exclude<keyof Recipe, 'version'>, string];
  if (field !== 'enabled' && !recipe[section].enabled) return false;
  return RULES[key]?.(recipe) ?? true;
}
