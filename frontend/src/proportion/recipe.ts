/** 比例配方: 只記「部位名稱 → 變形」, 套到別張圖時依名稱找部位。格式錯一律報錯, 不靜默修正。 */
import { ANCHORS, type Anchor, type Part, type PartTransform } from './model';
import { isChanged } from './transform';

export const PROPORTION_RECIPE_VERSION = 1;
const MAX_SCALE = 20;

export interface RecipePart {
  name: string;
  scaleX: number;
  scaleY: number;
  rotation: number;
  anchor: Anchor;
  dx: number;
  dy: number;
  z: number;
}

export interface ProportionRecipe {
  version: 1;
  parts: RecipePart[];
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function parseProportionRecipe(data: unknown): ProportionRecipe {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('比例配方必須是 JSON 物件');
  const d = data as Record<string, unknown>;
  if (d.version !== PROPORTION_RECIPE_VERSION) {
    throw new Error(`比例配方版本不支援: ${JSON.stringify(d.version)}(目前只支援 ${PROPORTION_RECIPE_VERSION})`);
  }
  if (!Array.isArray(d.parts) || !d.parts.length) throw new Error('比例配方沒有任何部位');
  const parts = d.parts.map((raw, i): RecipePart => {
    if (!raw || typeof raw !== 'object') throw new Error(`第 ${i + 1} 個部位格式錯誤`);
    const p = raw as Record<string, unknown>;
    if (typeof p.name !== 'string' || !p.name.trim()) throw new Error(`第 ${i + 1} 個部位缺少名稱`);
    const where = `部位「${p.name}」`;
    for (const k of ['scaleX', 'scaleY'] as const) {
      const v = p[k];
      if (!isNum(v) || v <= 0 || v > MAX_SCALE) throw new Error(`${where} 的 ${k} 必須在 0~${MAX_SCALE} 之間(不含 0)`);
    }
    for (const k of ['rotation', 'dx', 'dy'] as const) {
      if (!isNum(p[k])) throw new Error(`${where} 的 ${k} 必須是數字`);
    }
    if (!ANCHORS.includes(p.anchor as Anchor)) throw new Error(`${where} 的 anchor 不合法: ${JSON.stringify(p.anchor)}`);
    if (!Number.isInteger(p.z)) throw new Error(`${where} 的 z 必須是整數`);
    return {
      name: p.name.trim(),
      scaleX: p.scaleX as number,
      scaleY: p.scaleY as number,
      rotation: p.rotation as number,
      anchor: p.anchor as Anchor,
      dx: p.dx as number,
      dy: p.dy as number,
      z: p.z as number,
    };
  });
  return { version: 1, parts };
}

/** 只收主圖上動過且沒隱藏的部位。 */
export function recipeFromParts(parts: Part[]): ProportionRecipe {
  const picked = parts.filter((p) => p.image === 'main' && isChanged(p) && !p.transform.hidden);
  if (!picked.length) throw new Error('主圖上沒有調整過的部位, 無法存成比例配方');
  return {
    version: 1,
    parts: picked.map((p) => {
      const { scaleX, scaleY, rotation, anchor, dx, dy, z } = p.transform;
      return { name: p.name, scaleX, scaleY, rotation, anchor, dx, dy, z };
    }),
  };
}

/** 依名稱找主圖部位套變形; 找不到的名稱回傳給呼叫端去切。 */
export function applyRecipe(
  parts: Part[],
  recipe: ProportionRecipe,
): { transforms: Map<string, PartTransform>; missing: string[] } {
  const transforms = new Map<string, PartTransform>();
  const missing: string[] = [];
  for (const r of recipe.parts) {
    const target = parts.find((p) => p.image === 'main' && p.name === r.name && !transforms.has(p.id));
    if (!target) {
      missing.push(r.name);
      continue;
    }
    const { name: _name, ...t } = r;
    transforms.set(target.id, { ...t, hidden: false });
  }
  return { transforms, missing };
}
