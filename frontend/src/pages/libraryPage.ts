/** 素材庫頁: 分組瀏覽、篩選、改名稱與標籤、匯入、刪除。 */
import { api } from '../api';
import { filterBar, importButton, importErrors, importForm, renderGrid, renderStrip, tagEditor } from '../library/grid';
import { groupAssets, rootOf, sourceText, type Asset, type AssetTags } from '../library/model';
import { download } from '../pixel/pixelPanel';
import { confirmDelete, el, showBanner } from './ui';

export function mountLibraryPage(root: HTMLElement): () => void {
  let assets: Asset[] = [];
  let selected: string | null = null;
  let alive = true;

  const banner = el('div');
  const filter = filterBar(() => draw());
  const list = el('div', { className: 'lib-groups' });
  const strip = el('div', { className: 'lib-strip hidden' });
  const detail = el('div', { className: 'lib-detail panel-wrap' });
  root.append(
    el('div', { className: 'toolbar' }, [...importButton(showImport), filter.root]),
    banner,
    el('div', { className: 'lib-layout' }, [list, strip, detail]),
  );

  const pick = (a: Asset) => {
    selected = a.id;
    draw();
  };

  /** 選到的素材那組有派生時, 在右側欄左邊列出整組 */
  function draw() {
    renderGrid(list, assets, filter.value(), { selected, onPick: pick });
    const group = selected ? groupAssets(assets).find((g) => g.some((a) => a.id === selected)) : undefined;
    strip.classList.toggle('hidden', !group || group.length < 2);
    if (group && group.length > 1) renderStrip(strip, group, { selected, onPick: pick });
    drawDetail();
  }

  async function refresh(select: string | null = selected) {
    try {
      const l = await api.library.list();
      if (!alive) return;
      assets = l;
      selected = select && l.some((a) => a.id === select) ? select : null;
      draw();
    } catch (e) {
      showBanner(banner, 'error', (e as Error).message);
    }
  }

  async function patch(id: string, p: { name?: string; tags?: AssetTags }) {
    try {
      const a = await api.library.update(id, p);
      showBanner(banner, null);
      if (p.tags) await refresh(); // 原圖的標籤會帶到所有派生
      else {
        assets = assets.map((x) => (x.id === id ? a : x));
        draw();
      }
    } catch (e) {
      showBanner(banner, 'error', (e as Error).message);
    }
  }

  function drawDetail() {
    const a = assets.find((x) => x.id === selected);
    if (!a) {
      detail.replaceChildren(el('div', { className: 'muted lib-pad', text: '點一張素材看詳細資料' }));
      return;
    }
    const img = el('img');
    img.src = api.library.imageUrl(a.id);
    const name = el('input');
    name.value = a.name;
    const saveName = () => {
      if (name.value.trim() && name.value.trim() !== a.name) void patch(a.id, { name: name.value });
      else name.value = a.name;
    };
    name.addEventListener('change', saveName);
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') name.blur();
    });
    const parent = a.parent ? assets.find((x) => x.id === a.parent) : undefined;
    const children = assets.filter((x) => x.parent === a.id);
    const dl = el('button', { text: '下載 PNG' });
    dl.addEventListener('click', () => download(api.library.imageUrl(a.id), `${a.name}.png`));
    const del = el('button', { text: '刪除', className: 'danger' });
    del.addEventListener('click', () => void remove(a));
    const rows: HTMLElement[] = [
      el('div', { className: 'lib-big checker' }, [img]),
      el('label', { className: 'lib-row' }, ['名稱', name]),
      tagEditor(a.tags, (t) => void patch(a.id, { tags: t }), a.parent ? assets.find((x) => x.id === rootOf(assets, a.id))?.name : undefined),
      el('div', { className: 'muted small', text: `來源: ${sourceText(a)}` }),
    ];
    if (parent) {
      const go = el('button', { text: parent.name, className: 'small' });
      go.addEventListener('click', () => {
        selected = parent.id;
        draw();
      });
      rows.push(el('div', { className: 'lib-row small' }, ['原圖', go]));
    }
    if (children.length) rows.push(el('div', { className: 'muted small', text: `有 ${children.length} 張派生` }));
    rows.push(el('div', { className: 'lib-row' }, [dl, del]));
    detail.replaceChildren(el('div', { className: 'lib-pad' }, rows));
  }

  async function remove(a: Asset) {
    const kids = assets.some((x) => x.parent === a.id);
    if (!confirmDelete(`素材「${a.name}」${kids ? '(它的派生會改掛到它的原圖)' : ''}`)) return;
    try {
      await api.library.remove(a.id);
      await refresh(a.parent);
    } catch (e) {
      showBanner(banner, 'error', (e as Error).message);
    }
  }

  /** 選好檔案後先在右側選這批的標籤, 確定才匯入 */
  function showImport(files: File[]) {
    detail.replaceChildren(importForm(files, {
      onDone: async (r) => {
        const warn = importErrors(r);
        showBanner(banner, warn ? 'warn' : null, warn ?? undefined);
        await refresh(r.added[0]?.id ?? selected);
      },
      onCancel: () => drawDetail(),
      onError: (msg) => {
        showBanner(banner, 'error', msg);
        drawDetail();
      },
    }));
  }

  void refresh();
  return () => {
    alive = false;
  };
}
