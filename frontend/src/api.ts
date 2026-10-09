/** 後端 API 呼叫。非 2xx 一律拋出帶中文訊息的 Error。 */
import type { Recipe } from './recipe';

export type RGB = [number, number, number];

export interface LayerInfo {
  origin: string;
  updated: string;
  stale: boolean;
  params?: { gap_radius: number; min_area: number };
  color_source?: 'source' | 'user_flat';
}

export interface PackMeta {
  name: string;
  width: number;
  height: number;
  created: string;
  layers: Record<string, LayerInfo>;
  flat_color_source?: 'source' | 'user_flat';
  regions: { count: number; colors: Record<string, RGB>; areas: Record<string, number> };
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

export const api = {
  getStatus: () => request<{ fal: boolean }>('/api/status'),
  listPacks: () => request<PackMeta[]>('/api/packs'),
  getPack: (name: string) => request<PackMeta>(`/api/packs/${enc(name)}`),
  createPack: (name: string, file: File) =>
    request<PackMeta>('/api/packs', { method: 'POST', body: form({ name, file }) }),
  runStep: (name: string, step: string, params: Record<string, unknown> = {}) =>
    request<PackMeta>(`/api/packs/${enc(name)}/steps/${step}`, json('POST', params)),
  decomposeAll: (name: string) => request<PackMeta>(`/api/packs/${enc(name)}/decompose`, { method: 'POST' }),
  replaceLayer: (name: string, layer: string, file: File) =>
    request<PackMeta>(`/api/packs/${enc(name)}/layers/${layer}`, { method: 'PUT', body: form({ file }) }),
  regionAt: (name: string, x: number, y: number) =>
    request<{ id: number; color: RGB | null }>(`/api/packs/${enc(name)}/region?x=${x}&y=${y}`),
  setRegionColor: (name: string, id: number, color: RGB) =>
    request<PackMeta>(`/api/packs/${enc(name)}/regions/${id}`, json('PUT', { color })),
  fileUrl: (name: string, layer: string, version = '') =>
    `/api/packs/${enc(name)}/files/${layer}.png?v=${enc(version || String(Date.now()))}`,
  listRecipes: () => request<string[]>('/api/recipes'),
  getRecipe: (name: string) => request<unknown>(`/api/recipes/${enc(name)}`),
  saveRecipe: (name: string, recipe: Recipe) => request<{ ok: boolean }>(`/api/recipes/${enc(name)}`, json('PUT', recipe)),
};
