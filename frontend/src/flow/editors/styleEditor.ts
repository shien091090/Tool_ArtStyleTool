/** 改風格節點: 拆解 + 渲染。分層包取自上游輸出, 渲染結果「設為輸出」。 */
import { api, isRenderable, type PackMeta } from '../../api';
import { mountDecomposePage } from '../../pages/decomposePage';
import { mountRenderPage } from '../../pages/renderPage';
import { confirmDelete, el, showBanner } from '../../pages/ui';
import { DEFAULT_RECIPE, normalizeRecipe, type Recipe } from '../../recipe';
import { flowJobKey } from '../model';
import type { EditorContext, NodeEditor } from './types';

type Tab = 'decompose' | 'render';

/** 配方比對用的字串(欄位順序統一) */
const recipeKey = (r: unknown) => JSON.stringify(normalizeRecipe(r).recipe);

export function mountStyleEditor(body: HTMLElement, ctx: EditorContext): NodeEditor {
  const sapi = api.flows.style(ctx.flowName, ctx.node.id);
  const jobKey = flowJobKey(ctx.flowName, ctx.node.id);
  const notice = el('div', { className: 'fe-notice hidden' });
  const tabBtns = new Map<Tab, HTMLButtonElement>();
  const tabRow = el('div', { className: 'seg fe-tabs' }, (['decompose', 'render'] as Tab[]).map((t) => {
    const b = el('button', { text: t === 'decompose' ? '1 拆解' : '2 渲染' });
    b.addEventListener('click', () => show(t));
    tabBtns.set(t, b);
    return b;
  }));
  const host = el('div', { className: 'fe-embed' });
  body.append(notice, el('div', { className: 'toolbar' }, [tabRow]), host);

  let unmount: (() => void) | null = null;
  let pack: PackMeta | null = null;
  /** 分層包取自上游第幾版 */
  let packRev: number | null = null;
  let tab: Tab = 'decompose';
  let alive = true;
  /** 渲染參數: 切頁籤保留; 一開始用節點上次設為輸出的配方 */
  let recipe: Recipe = normalizeRecipe(ctx.node.params.recipe ?? DEFAULT_RECIPE).recipe;
  /** 比對用: 輸出用的配方(還沒輸出過就是一開始的配方) */
  let savedKey = recipeKey(recipe);

  function syncTabs() {
    for (const [t, b] of tabBtns) b.classList.toggle('active', t === tab);
  }

  function show(next: Tab) {
    tab = next;
    syncTabs();
    unmount?.();
    unmount = null;
    host.replaceChildren();
    if (!pack) return;
    const load = async () => (pack = await sapi.getPack(''));
    if (tab === 'decompose') {
      unmount = mountDecomposePage(host, new URLSearchParams(), {
        api: sapi, load, banner: ctx.banner, status: ctx.status, jobKey,
        onChange: (m) => {
          pack = m;
        },
      });
      return;
    }
    if (!isRenderable(pack)) {
      host.append(el('div', { className: 'muted fe-empty', text: '還沒拆解完成: 先到「1 拆解」按「全部拆解」' }));
      return;
    }
    unmount = mountRenderPage(host, new URLSearchParams(), {
      api: sapi, load, banner: ctx.banner, recipe,
      onRecipeChange: (r) => {
        recipe = structuredClone(r);
      },
      actions: (h) => {
        const b = el('button', { text: '設為輸出', className: 'primary' });
        b.addEventListener('click', () => void setAsOutput(h.toBlob));
        return [b];
      },
    });
  }

  async function setAsOutput(toBlob: () => Promise<Blob | null>) {
    ctx.status.textContent = '設定中…';
    try {
      const blob = await toBlob();
      if (!blob) throw new Error('還沒有渲染結果');
      const r = structuredClone(recipe);
      await ctx.save({ file: blob }, { inputRev: packRev, params: { recipe: r } });
      savedKey = recipeKey(r);
      showBanner(ctx.banner, 'info', '已把目前的渲染結果設為這個節點的輸出');
    } catch (e) {
      showBanner(ctx.banner, 'error', (e as Error).message);
    } finally {
      ctx.status.textContent = '';
    }
  }

  function showStale() {
    const up = ctx.upstream;
    const stale = up !== null && packRev !== null && packRev !== up.rev;
    notice.classList.toggle('hidden', !stale);
    if (!stale || !up) return;
    const btn = el('button', { text: '改用新的上游圖' });
    btn.addEventListener('click', () => void rebuild());
    notice.replaceChildren(el('span', { text: `上游已更新(分層包用的是第 ${packRev} 版, 上游現在是第 ${up.rev} 版)` }), btn);
  }

  async function rebuild() {
    if (!confirmDelete('這個節點拆解好的分層包(改用新的上游圖, 需要重新拆解)')) return;
    ctx.status.textContent = '重建中…';
    try {
      pack = await sapi.init();
      packRev = pack.inputRev ?? null;
      showStale();
      show('decompose');
    } catch (e) {
      showBanner(ctx.banner, 'error', (e as Error).message);
    } finally {
      ctx.status.textContent = '';
    }
  }

  syncTabs();
  void (async () => {
    if (!ctx.upstreamUrl) {
      host.append(el('div', { className: 'muted fe-empty', text: '上游還沒有輸出: 先接上有輸出的節點' }));
      return;
    }
    try {
      const st = await sapi.status();
      if (!alive) return;
      pack = st.exists ? await sapi.getPack('') : await sapi.init();
      if (!alive) return;
      packRev = pack.inputRev ?? null;
      showStale();
      show(isRenderable(pack) ? 'render' : 'decompose');
    } catch (e) {
      showBanner(ctx.banner, 'error', (e as Error).message);
    }
  })();

  return {
    unsaved: () => (recipeKey(recipe) !== savedKey ? '渲染參數還沒設為輸出' : null),
    dispose: () => {
      alive = false;
      unmount?.();
    },
  };
}
