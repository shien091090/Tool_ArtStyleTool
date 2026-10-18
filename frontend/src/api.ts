/** 後端 API 呼叫。非 2xx 一律拋出帶中文訊息的 Error。 */
import type { Recipe } from './recipe';
import type { Pad, Part, Place, PartTransform, ResultInfo, SegBox, SegPoint, WorkMeta } from './proportion/model';
import type { ProportionRecipe } from './proportion/recipe';
import type { FlowMeta, FlowNode, FlowLink } from './flow/model';
import type { ConvertSettings, PixelCandidate, PixelResult, PixelSettings, PixelWorkMeta, SizeSuggestion } from './pixel/model';

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
  /** 流程改風格節點: 分層包取自上游第幾版 */
  inputRev?: number;
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
  // 寫入請求可能花了 fal 的錢, 讓右上角的餘額更新
  if (init?.method && init.method !== 'GET') window.dispatchEvent(new Event('api-write'));
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
const pwork = (name: string) => `/api/pixel/works/${enc(name)}`;
const pflow = (name: string) => `/api/flows/${enc(name)}`;

/** 單一分層包的呼叫; base 由分層包名組出網址(流程節點忽略名稱) */
function packApi(base: (name: string) => string) {
  return {
    getPack: (name: string) => request<PackMeta>(base(name)),
    runStep: (name: string, step: string, params: Record<string, unknown> = {}) =>
      request<PackMeta>(`${base(name)}/steps/${step}`, json('POST', params)),
    decomposeAll: (name: string) => request<PackMeta>(`${base(name)}/decompose`, { method: 'POST' }),
    regionAt: (name: string, x: number, y: number) =>
      request<{ id: number; color: RGB | null }>(`${base(name)}/region?x=${x}&y=${y}`),
    setRegionColor: (name: string, id: number, color: RGB) =>
      request<PackMeta>(`${base(name)}/regions/${id}`, json('PUT', { color })),
    fileUrl: (name: string, layer: string, version = '') =>
      `${base(name)}/files/${layer}.png?v=${enc(version || String(Date.now()))}`,
  };
}

export type PackApi = ReturnType<typeof packApi>;

/** 單一部位工坊作品的呼叫; base 由作品名組出網址(流程節點忽略作品名) */
function workshopApi(base: (name: string) => string) {
  return {
    getWork: (name: string) => request<WorkMeta>(base(name)),
    addImage: (name: string, source: { file: File } | { pack: string }) =>
      request<WorkMeta>(`${base(name)}/images`, { method: 'POST', body: form(source) }),
    fileUrl: (name: string, path: string, version = '') =>
      `${base(name)}/files/${path}?v=${enc(version || String(Date.now()))}`,
    segment: (name: string, image: string, names: string[], points: SegPoint[] = [], box: SegBox | null = null) =>
      request<{ meta: WorkMeta; missing: string[] }>(`${base(name)}/parts`, json('POST', { image, names, points, box })),
    refine: (name: string, partId: string, points: SegPoint[], box: SegBox | null) =>
      request<WorkMeta>(`${base(name)}/parts/${partId}/refine`, json('POST', { points, box })),
    split: (name: string, partId: string) =>
      request<WorkMeta>(`${base(name)}/parts/${partId}/split`, { method: 'POST' }),
    deletePart: (name: string, partId: string) =>
      request<WorkMeta>(`${base(name)}/parts/${partId}`, { method: 'DELETE' }),
    putLayout: (name: string, parts: Part[], pad: Pad) =>
      request<WorkMeta>(`${base(name)}/layout`, json('PUT', {
        parts: parts.map((p): { id: string; placed: boolean; place: Place | null; transform: PartTransform } =>
          ({ id: p.id, placed: p.placed, place: p.place, transform: p.transform })),
        pad,
      })),
    generate: (name: string, collage: Blob, region: Blob, options: { model: string; count: number; extra: string }) =>
      request<{ meta: WorkMeta; results: ResultInfo[]; errors: string[] }>(`${base(name)}/generate`, {
        method: 'POST',
        body: form({ collage, region, options: JSON.stringify(options) }),
      }),
    toPack: (name: string, resultId: string) =>
      request<{ pack: string }>(`${base(name)}/results/${resultId}/to-pack`, { method: 'POST' }),
    resultParams: (name: string, resultId: string) =>
      request<{ pad?: Pad; model?: string }>(`${base(name)}/files/results/${resultId}.json`),
    suggestParts: (name: string, image: string) =>
      request<{ parts: { name: string; en: string }[]; meta: WorkMeta }>(`${base(name)}/suggest-parts`, json('POST', { image })),
    addMaterials: (name: string, partId: string, material: string, count: number, reference: File | null) =>
      request<{ meta: WorkMeta; errors: string[] }>(`${base(name)}/parts/${partId}/materials`, {
        method: 'POST',
        body: form({ material, count: String(count), ...(reference ? { reference } : {}) }),
      }),
    setMaterial: (name: string, partId: string, variant: string | null) =>
      request<WorkMeta>(`${base(name)}/parts/${partId}/material`, json('PUT', { variant })),
    deleteMaterial: (name: string, partId: string, variantId: string) =>
      request<WorkMeta>(`${base(name)}/parts/${partId}/materials/${variantId}`, { method: 'DELETE' }),
  };
}

export type WorkshopApi = ReturnType<typeof workshopApi>;


export const api = {
  getStatus: () => request<{ fal: boolean }>('/api/status'),
  falBalance: () => request<{ balance: number; currency: string }>('/api/fal/balance'),
  listPacks: () => request<PackMeta[]>('/api/packs'),
  createPack: (name: string, file: File) =>
    request<PackMeta>('/api/packs', { method: 'POST', body: form({ name, file }) }),
  deletePack: (name: string) => request<{ ok: boolean }>(`/api/packs/${enc(name)}`, { method: 'DELETE' }),
  ...packApi((name) => `/api/packs/${enc(name)}`),
  lospec: (url: string) => request<{ name: string; colors: string[] }>(`/api/lospec?url=${enc(url)}`),
  listRecipes: () => request<string[]>('/api/recipes'),
  getRecipe: (name: string) => request<unknown>(`/api/recipes/${enc(name)}`),
  saveRecipe: (name: string, recipe: Recipe) => request<{ ok: boolean }>(`/api/recipes/${enc(name)}`, json('PUT', recipe)),
  deleteRecipe: (name: string) => request<{ ok: boolean }>(`/api/recipes/${enc(name)}`, { method: 'DELETE' }),
  proportion: {
    listWorks: () => request<{ name: string; updated: string; results: number }[]>('/api/proportion/works'),
    ...workshopApi(work),
    deleteWork: (name: string) => request<{ ok: boolean }>(work(name), { method: 'DELETE' }),
    createWork: (name: string, source: { file: File } | { pack: string }) =>
      request<WorkMeta>('/api/proportion/works', { method: 'POST', body: form({ name, ...source }) }),
    listRecipes: () => request<string[]>('/api/proportion/recipes'),
    getRecipe: (name: string) => request<unknown>(`/api/proportion/recipes/${enc(name)}`),
    saveRecipe: (name: string, recipe: ProportionRecipe) =>
      request<{ ok: boolean }>(`/api/proportion/recipes/${enc(name)}`, json('PUT', recipe)),
    deleteRecipe: (name: string) =>
      request<{ ok: boolean }>(`/api/proportion/recipes/${enc(name)}`, { method: 'DELETE' }),
  },
  pixel: {
    listWorks: () => request<{ name: string; updated: string; candidates: number }[]>('/api/pixel/works'),
    getWork: (name: string) => request<PixelWorkMeta>(pwork(name)),
    deleteWork: (name: string) => request<{ ok: boolean }>(pwork(name), { method: 'DELETE' }),
    workshopResults: () => request<{ work: string; id: string }[]>('/api/pixel/workshop-results'),
    createWork: (name: string, source: { file: File } | { pack: string } | { workshop: string }) =>
      request<PixelWorkMeta>('/api/pixel/works', { method: 'POST', body: form({ name, ...source }) }),
    fileUrl: (name: string, path: string) => `${pwork(name)}/files/${path}`,
    addCandidates: (name: string, settings: PixelSettings) => request<{ meta: PixelWorkMeta; candidates: PixelCandidate[]; errors: string[] }>(
      `${pwork(name)}/candidates`, json('POST', settings)),
    deleteCandidate: (name: string, cid: string) =>
      request<PixelWorkMeta>(`${pwork(name)}/candidates/${cid}`, { method: 'DELETE' }),
    suggestSizes: (name: string) => request<{ sizes: SizeSuggestion[] }>(`${pwork(name)}/suggest`, { method: 'POST' }),
    convert: (name: string, settings: ConvertSettings) =>
      request<{ meta: PixelWorkMeta; candidate: PixelCandidate }>(`${pwork(name)}/convert`, json('POST', settings)),
    pixelate: (name: string, cid: string, colors: number) =>
      request<{ results: PixelResult[]; colors: number }>(`${pwork(name)}/candidates/${cid}/pixelate`, json('POST', { colors })),
  },
  flows: {
    list: () => request<{ name: string; updated: string; nodes: number }[]>('/api/flows'),
    create: (name: string) => request<FlowMeta>('/api/flows', json('POST', { name })),
    get: (name: string) => request<FlowMeta>(pflow(name)),
    delete: (name: string) => request<{ ok: boolean }>(pflow(name), { method: 'DELETE' }),
    saveGraph: (name: string, nodes: Pick<FlowNode, 'id' | 'type' | 'x' | 'y' | 'params'>[], links: FlowLink[]) =>
      request<FlowMeta>(`${pflow(name)}/graph`, json('PUT', { nodes, links })),
    fileUrl: (name: string, path: string, version: string | number = Date.now()) =>
      `${pflow(name)}/files/${path}?v=${version}`,
    setOutput: (name: string, nid: string,
      source: { file: Blob } | { pack: string } | { workshop: string },
      opts: { inputRev?: number | null; params?: Record<string, unknown> } = {}) => {
      const fields: Record<string, string | Blob> = { ...source };
      if (opts.inputRev != null) fields.inputRev = String(opts.inputRev);
      if (opts.params) fields.params = JSON.stringify(opts.params);
      return request<FlowMeta>(`${pflow(name)}/nodes/${nid}/output`, { method: 'POST', body: form(fields) });
    },
    /** 改部位節點的作品 */
    workshop: (name: string, nid: string) => {
      const base = `${pflow(name)}/nodes/${nid}/workshop`;
      return {
        ...workshopApi(() => base),
        status: () => request<{ exists: boolean; inputRev: number | null }>(`${base}/status`),
        init: () => request<WorkMeta>(`${base}/init`, { method: 'POST' }),
        /** 素材圖對齊素材線; names: 來源節點 → 顯示名稱 */
        syncMaterials: (names: Record<string, string>) =>
          request<WorkMeta>(`${base}/materials/sync`, json('POST', { names })),
        refreshMaterial: (src: string) => request<WorkMeta>(`${base}/materials/${src}/refresh`, { method: 'POST' }),
      };
    },
    /** 改風格節點的分層包 */
    style: (name: string, nid: string) => {
      const base = `${pflow(name)}/nodes/${nid}/style`;
      return {
        ...packApi(() => base),
        status: () => request<{ exists: boolean; inputRev: number | null }>(`${base}/status`),
        init: () => request<PackMeta>(`${base}/init`, { method: 'POST' }),
      };
    },
    getPixel: (name: string, nid: string) => request<PixelWorkMeta>(`${pflow(name)}/nodes/${nid}/pixel`),
    addCandidates: (name: string, nid: string, settings: PixelSettings) =>
      request<{ meta: PixelWorkMeta; candidates: PixelCandidate[]; errors: string[] }>(
        `${pflow(name)}/nodes/${nid}/pixel/candidates`, json('POST', settings)),
    suggestPixelSizes: (name: string, nid: string) =>
      request<{ sizes: SizeSuggestion[] }>(`${pflow(name)}/nodes/${nid}/pixel/suggest`, { method: 'POST' }),
    convertPixel: (name: string, nid: string, settings: ConvertSettings) =>
      request<{ meta: PixelWorkMeta; candidate: PixelCandidate }>(`${pflow(name)}/nodes/${nid}/pixel/convert`, json('POST', settings)),
    deleteCandidate: (name: string, nid: string, cid: string) =>
      request<PixelWorkMeta>(`${pflow(name)}/nodes/${nid}/pixel/candidates/${cid}`, { method: 'DELETE' }),
    pixelate: (name: string, nid: string, cid: string, colors: number) =>
      request<{ results: PixelResult[]; colors: number }>(
        `${pflow(name)}/nodes/${nid}/pixel/candidates/${cid}/pixelate`, json('POST', { colors })),
  },
};
