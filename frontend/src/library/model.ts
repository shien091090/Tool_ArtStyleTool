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

/** none = 未分類(沒有視角) */
export type ViewPick = ViewKey | 'none';

export const VIEW_PICKS: ViewPick[] = [...VIEWS, 'none'];

export const PICK_LABEL: Record<ViewPick, string> = { ...VIEW_LABEL, none: '未分類' };

/** 每類沒勾 = 不限; 勾多個 = 任一符合 */
export interface Filter {
  views: ViewPick[];
  kinds: string[];
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

const inView = (a: Asset, v: ViewPick) => (v === 'none' ? !a.tags.views.length : a.tags.views.includes(v));

export function matches(a: Asset, f: Filter): boolean {
  if (f.views.length && !f.views.some((v) => inView(a, v))) return false;
  if (f.kinds.length && !f.kinds.includes(a.tags.type ?? '')) return false;
  return !f.text || a.name.toLowerCase().includes(f.text.toLowerCase());
}

export interface Section {
  /** 不分區時為 null */
  label: string | null;
  items: Asset[];
}

/** 視角或類型勾了兩個以上就依它分區(都勾多個則兩兩組合), 區的順序固定; 區內依組排, 原圖後接派生 */
export function sections(assets: Asset[], f: Filter): Section[] {
  const list = groupAssets(assets).flat().filter((a) => matches(a, f));
  const vs: (ViewPick | null)[] = f.views.length > 1 ? VIEW_PICKS.filter((v) => f.views.includes(v)) : [null];
  const ks: (string | null)[] = f.kinds.length > 1 ? KINDS.filter((k) => f.kinds.includes(k)) : [null];
  return vs.flatMap((v) => ks.map((k) => ({
    label: [v && PICK_LABEL[v], k].filter(Boolean).join('・') || null,
    items: list.filter((a) => (!v || inView(a, v)) && (!k || a.tags.type === k)),
  })));
}

export function sourceText(a: Asset): string {
  const s = a.source;
  if (s.kind === 'import') return `自己匯入: ${s.file}`;
  if (s.kind === 'flow') return `平面圖「${s.flow}」節點 ${s.node} 第 ${s.rev} 版`;
  return '遊戲示意';
}
