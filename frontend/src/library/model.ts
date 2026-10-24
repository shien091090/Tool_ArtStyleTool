/** 素材庫: 型別與純函式(分組、篩選)。 */

export type ViewKey = 'side' | 'vertical' | 'topdown' | 'iso' | 'flat';

export const VIEWS: ViewKey[] = ['side', 'vertical', 'topdown', 'iso', 'flat'];

export const VIEW_LABEL: Record<ViewKey, string> = {
  side: '橫向卷軸',
  vertical: '縱向卷軸',
  topdown: '俯瞰',
  iso: '斜角俯瞰',
  flat: '平面',
};

/** 與後端 library/store.py 的 KINDS 同序 */
export const KINDS = ['地形', '背景', '角色', '敵人', '道具', '建築', '景物', '其他'] as const;

export interface AssetTags {
  views: ViewKey[];
  type: string | null;
}

export type AssetSource =
  | { kind: 'import'; file: string }
  | { kind: 'flow'; flow: string; node: string; rev: number }
  | { kind: 'mockup'; [k: string]: unknown };

export interface Asset {
  id: string;
  name: string;
  created: string;
  /** 直接的原圖編號 */
  parent: string | null;
  source: AssetSource;
  tags: AssetTags;
}

export interface Filter {
  /** all = 全部; none = 未分類(沒有視角) */
  view: ViewKey | 'all' | 'none';
  kind: string;
  text: string;
}

const order = (a: Asset, b: Asset) =>
  a.created.localeCompare(b.created) || Number(a.id.slice(1)) - Number(b.id.slice(1));

/** 沿原圖一路往上到頂; 原圖不存在就停在自己 */
export function rootOf(assets: Asset[], id: string): string {
  const byId = new Map(assets.map((a) => [a.id, a]));
  let cur = id;
  const seen = new Set<string>();
  for (;;) {
    const p = byId.get(cur)?.parent;
    if (!p || !byId.has(p) || seen.has(p)) return cur;
    seen.add(cur);
    cur = p;
  }
}

/** 每組根在前、其餘依建立時間; 組之間依組內最新一張, 新的在前 */
export function groupAssets(assets: Asset[]): Asset[][] {
  const groups = new Map<string, Asset[]>();
  for (const a of assets) {
    const r = rootOf(assets, a.id);
    groups.set(r, [...(groups.get(r) ?? []), a]);
  }
  const out = [...groups.entries()].map(([r, list]) => {
    const root = list.find((a) => a.id === r)!;
    return [root, ...list.filter((a) => a.id !== r).sort(order)];
  });
  const newest = (g: Asset[]) => g.reduce((m, a) => (order(a, m) > 0 ? a : m));
  return out.sort((x, y) => order(newest(y), newest(x)));
}

export function matches(a: Asset, f: Filter): boolean {
  if (f.view === 'none' ? a.tags.views.length > 0 : f.view !== 'all' && !a.tags.views.includes(f.view)) return false;
  if (f.kind !== 'all' && a.tags.type !== f.kind) return false;
  return !f.text || a.name.toLowerCase().includes(f.text.toLowerCase());
}

export function sourceText(a: Asset): string {
  const s = a.source;
  if (s.kind === 'import') return `自己匯入: ${s.file}`;
  if (s.kind === 'flow') return `平面圖「${s.flow}」節點 ${s.node} 第 ${s.rev} 版`;
  return '遊戲示意';
}
