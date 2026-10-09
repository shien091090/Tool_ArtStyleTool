import { api, isRenderable } from '../api';
import { Renderer } from '../gl/renderer';
import { DEFAULT_RECIPE, normalizeRecipe, type Recipe } from '../recipe';
import { el, option, showBanner } from './ui';

const THUMB = 360;

/** 同一份配方套到所有分層包上並排比較, 檢驗「換圖後還是同一個風格」。 */
export function mountGridPage(root: HTMLElement, params: URLSearchParams): () => void {
  const recipeSel = el('select');
  const status = el('span', { className: 'muted' });
  const banner = el('div');
  const grid = el('div', { className: 'grid' });
  root.append(el('div', { className: 'toolbar' }, [el('label', {}, ['配方', recipeSel]), status]), banner, grid);

  const offscreen = el('canvas');
  let renderer: Renderer | null = null;
  try {
    renderer = new Renderer(offscreen);
  } catch (e) {
    showBanner(banner, 'error', (e as Error).message);
  }
  let token = 0;

  async function draw() {
    const my = ++token;
    const name = recipeSel.value;
    showBanner(banner, null);
    let recipe: Recipe = DEFAULT_RECIPE;
    try {
      if (name) {
        const { recipe: r, fixed } = normalizeRecipe(await api.getRecipe(name));
        recipe = r;
        if (fixed.length) showBanner(banner, 'warn', `配方「${name}」有欄位已補預設值或修正: ${fixed.join(', ')}`);
      }
      const packs = await api.listPacks();
      if (my !== token) return;
      grid.replaceChildren();
      if (!packs.length) grid.append(el('div', { className: 'muted', text: '還沒有分層包, 請先到「拆解檢查」頁建立' }));
      let done = 0;
      for (const pack of packs) {
        const fig = el('figure');
        grid.append(fig);
        if (!isRenderable(pack) || !renderer) {
          fig.append(el('div', { className: 'unfinished', text: '未完成' }), el('figcaption', { text: pack.name }));
          continue;
        }
        status.textContent = `渲染中 ${++done}/${packs.length}…`;
        await renderer.loadPack(pack);
        if (my !== token) return;
        renderer.render(recipe);
        const scale = THUMB / Math.max(pack.width, pack.height);
        const thumb = el('canvas');
        thumb.width = Math.round(pack.width * scale);
        thumb.height = Math.round(pack.height * scale);
        thumb.getContext('2d')!.drawImage(offscreen, 0, 0, thumb.width, thumb.height);
        fig.append(thumb, el('figcaption', { text: pack.name }));
        fig.addEventListener('click', () => {
          const q = new URLSearchParams({ pack: pack.name });
          if (name) q.set('recipe', name);
          location.hash = `#/render?${q}`;
        });
      }
      status.textContent = '';
    } catch (e) {
      status.textContent = '';
      showBanner(banner, 'error', (e as Error).message);
    }
  }

  recipeSel.addEventListener('change', draw);
  (async () => {
    try {
      const names = await api.listRecipes();
      recipeSel.replaceChildren(option('', '(預設值)'), ...names.map((n) => option(n, n)));
      const want = params.get('recipe');
      if (want && names.includes(want)) recipeSel.value = want;
      await draw();
    } catch (e) {
      showBanner(banner, 'error', (e as Error).message);
    }
  })();

  return () => {
    token++;
    renderer?.dispose();
  };
}
