/** 素材庫頁: 分組瀏覽、篩選、改名稱與標籤、匯入、刪除。 */
import { api } from '../api';
import { filterBar, renderGroups, tagEditor } from '../library/grid';
import { sourceText, type Asset, type AssetTags } from '../library/model';
import { download } from '../pixel/pixelPanel';
import { confirmDelete, el, showBanner } from './ui';

export function mountLibraryPage(root: HTMLElement): () => void {
  let assets: Asset[] = [];
  let selected: string | null = null;
  let alive = true;

  const banner = el('div');
  const status = el('span', { className: 'muted' });
  const fileInput = el('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.multiple = true;
  fileInput.className = 'hidden';
  const importBtn = el('button', { text: '匯入圖片', className: 'primary' });
  const filter = filterBar(() => draw());
  const list = el('div', { className: 'lib-groups' });
  const detail = el('div', { className: 'lib-detail panel-wrap' });
  root.append(
    el('div', { className: 'toolbar' }, [importBtn, fileInput, filter.root, status]),
    banner,
    el('div', { className: 'lib-layout' }, [list, detail]),
  );

  function draw() {
    renderGroups(list, assets, filter.value(), {
      selected,
      onPick: (a) => {
        selected = a.id;
        draw();
      },
    });
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
      assets = assets.map((x) => (x.id === id ? a : x));
      showBanner(banner, null);
      draw();
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
      tagEditor(a.tags, (t) => void patch(a.id, { tags: t })),
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
    let tags: AssetTags = { views: [], type: null };
    const ok = el('button', { text: `匯入 ${files.length} 張`, className: 'primary' });
    const cancel = el('button', { text: '取消' });
    cancel.addEventListener('click', () => drawDetail());
    ok.addEventListener('click', async () => {
      ok.disabled = true;
      status.textContent = '匯入中…';
      try {
        const empty = !tags.views.length && !tags.type;
        const r = await api.library.import(files, empty ? undefined : tags);
        if (r.errors.length) showBanner(banner, 'warn', `有 ${r.errors.length} 張沒匯入: ${r.errors.map((e) => `${e.file}(${e.detail})`).join('、')}`);
        else showBanner(banner, null);
        await refresh(r.added[0]?.id ?? selected);
      } catch (e) {
        showBanner(banner, 'error', (e as Error).message);
        drawDetail();
      } finally {
        status.textContent = '';
      }
    });
    detail.replaceChildren(el('div', { className: 'lib-pad' }, [
      el('b', { text: '匯入圖片' }),
      el('div', { className: 'muted small', text: files.map((f) => f.name).join('、') }),
      el('div', { className: 'muted small', text: '可以先替這批選標籤(可略過, 之後再改)' }),
      tagEditor(tags, (t) => { tags = t; }),
      el('div', { className: 'lib-row' }, [ok, cancel]),
    ]));
  }

  importBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const files = [...(fileInput.files ?? [])];
    fileInput.value = '';
    if (files.length) showImport(files);
  });

  void refresh();
  return () => {
    alive = false;
  };
}
