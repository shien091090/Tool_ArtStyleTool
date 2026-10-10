/** 後端 API 呼叫。非 2xx 一律拋出帶中文訊息的 Error。 */
import type { Recipe } from './recipe';
import type { Pad, Part, Place, PartTransform, ResultInfo, SegBox, SegPoint, WorkMeta } from './proportion/model';
import type { ProportionRecipe } from './proportion/recipe';

export type RGB = [number, number, number];

export interface LayerInfo {
  origin: string;
  updated: string;
  stale: boolean;
  params?: {
    method?: 'color' | 'line';
    color_source?: 'delight' | 'source';
    colors?: number;
    min_area: number;
    gap_radius: number;
    merge?: number;
  };
  color_source?: 'source' | 'delight' | 'user_flat';
}

export interface PackMeta {
  name: string;
  width: number;
  height: number;
  created: string;
  layers: Record<string, LayerInfo>;
  flat_color_source?: 'source' | 'user_flat';
  /** colors 可在檢查點編輯; sampled 是拆解當下取的顏色, 不會被改(舊分層包沒有)。 */
  regions: { count: number; colors: Record<string, RGB>; sampled?: Record<string, RGB>; areas: Record<string, number> };
}

export const RENDER_LAYERS = ['regions', 'normal', 'line_sdf', 'source'] as const;

/** 分層包是否已拆解到可以渲染。 */
export function isRenderable(meta: PackMeta): boolean {
  return RENDER_LAYERS.every((l) => l in meta.layers) && 'flat' in meta.layers;
}

const enc = encodeURIComponent;

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  const headers = new Headers(init?.headers);
  headers.set('X-ArtStyle', '1'); // 後端只接受帶這個標頭的寫入請求, 防止其他網頁偷打本機 API
  try {
    res = await fetch(url, { ...init, headers });
  } catch {
    throw new Error('連不上後端伺服器, 請確認已經啟動(見 README)');
  }
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* 非 JSON 錯誤 */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

function form(fields: Record<string, string | Blob>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

const work = (name: string) => `/api/proportion/works/${enc(name)}`;

export const api = {
  getStatus: () => request<{ fal: boolean }>('/api/status'),
  listPacks: () => request<PackMeta[]>('/api/packs'),
  getPack: (name: string) => request<PackMeta>(`/api/packs/${enc(name)}`),
  createPack: (name: string, file: File) =>
    request<PackMeta>('/api/packs', { method: 'POST', body: form({ name, file }) }),
  runStep: (name: string, step: string, params: Record<string, unknown> = {}) =>
    request<PackMeta>(`/api/packs/${enc(name)}/steps/${step}`, json('POST', params)),
  decomposeAll: (name: string) => request<PackMeta>(`/api/packs/${enc(name)}/decompose`, { method: 'POST' }),
  regionAt: (name: string, x: number, y: number) =>
    request<{ id: number; color: RGB | null }>(`/api/packs/${enc(name)}/region?x=${x}&y=${y}`),
  setRegionColor: (name: string, id: number, color: RGB) =>
    request<PackMeta>(`/api/packs/${enc(name)}/regions/${id}`, json('PUT', { color })),
  fileUrl: (name: string, layer: string, version = '') =>
    `/api/packs/${enc(name)}/files/${layer}.png?v=${enc(version || String(Date.now()))}`,
  lospec: (url: string) => request<{ name: string; colors: string[] }>(`/api/lospec?url=${enc(url)}`),
  listRecipes: () => request<string[]>('/api/recipes'),
  getRecipe: (name: string) => request<unknown>(`/api/recipes/${enc(name)}`),
  saveRecipe: (name: string, recipe: Recipe) => request<{ ok: boolean }>(`/api/recipes/${enc(name)}`, json('PUT', recipe)),
  proportion: {
    listWorks: () => request<{ name: string; updated: string; results: number }[]>('/api/proportion/works'),
    getWork: (name: string) => request<WorkMeta>(work(name)),
    createWork: (name: string, source: { file: File } | { pack: string }) =>
      request<WorkMeta>('/api/proportion/works', { method: 'POST', body: form({ name, ...source }) }),
    addImage: (name: string, source: { file: File } | { pack: string }) =>
      request<WorkMeta>(`${work(name)}/images`, { method: 'POST', body: form(source) }),
    fileUrl: (name: string, path: string, version = '') =>
      `${work(name)}/files/${path}?v=${enc(version || String(Date.now()))}`,
    segment: (name: string, image: string, names: string[], points: SegPoint[] = [], box: SegBox | null = null) =>
      request<{ meta: WorkMeta; missing: string[] }>(`${work(name)}/parts`, json('POST', { image, names, points, box })),
    refine: (name: string, partId: string, points: SegPoint[], box: SegBox | null) =>
      request<WorkMeta>(`${work(name)}/parts/${partId}/refine`, json('POST', { points, box })),
    split: (name: string, partId: string) =>
      request<WorkMeta>(`${work(name)}/parts/${partId}/split`, { method: 'POST' }),
    deletePart: (name: string, partId: string) =>
      request<WorkMeta>(`${work(name)}/parts/${partId}`, { method: 'DELETE' }),
    putLayout: (name: string, parts: Part[], pad: Pad) =>
      request<WorkMeta>(`${work(name)}/layout`, json('PUT', {
        parts: parts.map((p): { id: string; placed: boolean; place: Place | null; transform: PartTransform } =>
          ({ id: p.id, placed: p.placed, place: p.place, transform: p.transform })),
        pad,
      })),
    generate: (name: string, collage: Blob, region: Blob, options: { model: string; count: number; extra: string }) =>
      request<{ meta: WorkMeta; results: ResultInfo[]; errors: string[] }>(`${work(name)}/generate`, {
        method: 'POST',
        body: form({ collage, region, options: JSON.stringify(options) }),
      }),
    toPack: (name: string, resultId: string) =>
      request<{ pack: string }>(`${work(name)}/results/${resultId}/to-pack`, { method: 'POST' }),
    resultParams: (name: string, resultId: string) =>
      request<{ pad?: Pad; model?: string }>(`${work(name)}/files/results/${resultId}.json`),
    listRecipes: () => request<string[]>('/api/proportion/recipes'),
    getRecipe: (name: string) => request<unknown>(`/api/proportion/recipes/${enc(name)}`),
    saveRecipe: (name: string, recipe: ProportionRecipe) =>
      request<{ ok: boolean }>(`/api/proportion/recipes/${enc(name)}`, json('PUT', recipe)),
  },
};
