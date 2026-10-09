/** 配方下拉選單: 「起始配方」(內建唯讀)與「我的配方」兩組。起始配方的值以 starter: 開頭。 */
import { api } from '../api';
import { STARTER_RECIPES } from '../presets';
import { option } from './ui';

export const STARTER_PREFIX = 'starter:';

export const isStarter = (value: string) => value.startsWith(STARTER_PREFIX);

export async function fillRecipeSelect(select: HTMLSelectElement, selected = ''): Promise<string[]> {
  const mine = await api.listRecipes();
  const starters = document.createElement('optgroup');
  starters.label = '起始配方';
  starters.append(...STARTER_RECIPES.map((p) => option(STARTER_PREFIX + p.name, p.name)));
  const own = document.createElement('optgroup');
  own.label = '我的配方';
  own.append(...mine.map((n) => option(n, n)));
  select.replaceChildren(option('', '(預設值)'), starters, own);
  const values = ['', ...STARTER_RECIPES.map((p) => STARTER_PREFIX + p.name), ...mine];
  select.value = values.includes(selected) ? selected : '';
  return mine;
}

/** 依下拉選單的值取得配方內容(尚未正規化)。 */
export async function loadRecipeValue(value: string): Promise<unknown> {
  if (isStarter(value)) {
    const p = STARTER_RECIPES.find((x) => STARTER_PREFIX + x.name === value);
    if (!p) throw new Error('找不到這份起始配方');
    return structuredClone(p.recipe);
  }
  return api.getRecipe(value);
}
