/** 素材庫共用元件: 篩選列、縮圖格、標籤編輯、匯入。素材庫頁與挑選視窗共用。 */
import { api } from '../api';
import { el, option } from '../pages/ui';
import { KINDS, PICK_LABEL, sections, VIEW_LABEL, VIEW_PICKS, VIEWS, type Asset, type AssetTags, type Filter, type ViewKey, type ViewPick } from './model';

/** 視角、類型各一排切換鈕(可複選) + 名稱搜尋 */
export function filterBar(onChange: (f: Filter) => void): { root: HTMLElement; value: () => Filter } {
  const views = new Set<ViewPick>();
  const kinds = new Set<string>();
  const text = el('input');
  text.placeholder = '搜尋名稱';
  const value = (): Filter => ({ views: [...views], kinds: [...kinds], text: text.value.trim() });
  const toggles = <T,>(keys: readonly T[], label: (k: T) => string, set: Set<T>) => el('div', { className: 'chips' }, keys.map((k) => {
    const b = el('button', { className: 'chip pick', text: label(k) });
    b.type = 'button';
    b.addEventListener('click', () => {
      if (!set.delete(k)) set.add(k);
      b.classList.toggle('on', set.has(k));
      onChange(value());
    });
    return b;
  }));
  text.addEventListener('input', () => onChange(value()));
  return {
    root: el('div', { className: 'lib-filter' }, [
      el('div', { className: 'lib-filter-row' }, [el('span', { className: 'muted small', text: '視角' }), toggles(VIEW_PICKS, (v) => PICK_LABEL[v], views)]),
      el('div', { className: 'lib-filter-row' }, [el('span', { className: 'muted small', text: '類型' }), toggles(KINDS, (k) => k, kinds), text]),
    ]),
    value,
  };
}

/** 縮圖格狀排列; 勾多個切換鈕時依 sections 分區, 區之間用分隔線 */
export function renderGrid(container: HTMLElement, assets: Asset[], filter: Filter,
  opts: { selected?: string | null; onPick: (a: Asset) => void }) {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const secs = sections(assets, filter);
  if (!secs.some((x) => x.items.length)) {
    container.replaceChildren(el('div', { className: 'muted lib-empty', text: assets.length ? '沒有符合的素材' : '素材庫是空的' }));
    return;
  }
  const card = (a: Asset) => {
    const img = el('img');
    img.src = api.library.imageUrl(a.id);
    img.loading = 'lazy';
    img.alt = a.name;
    const parent = a.parent ? byId.get(a.parent) : undefined;
    const c = el('div', { className: `lib-card${opts.selected === a.id ? ' selected' : ''}`, title: a.name }, [
      el('div', { className: 'lib-thumb checker' }, [img]),
      el('div', { className: 'lib-name', text: a.name }),
      ...(parent ? [el('div', { className: 'lib-from muted small', text: `← ${parent.name}` })] : []),
    ]);
    c.addEventListener('click', () => opts.onPick(a));
    return c;
  };
  container.replaceChildren(...secs.map((x) => el('div', { className: 'lib-section' }, [
    ...(x.label ? [el('div', { className: 'lib-section-title', text: `${x.label}(${x.items.length})` })] : []),
    x.items.length ? el('div', { className: 'lib-grid' }, x.items.map(card)) : el('div', { className: 'muted small', text: '沒有素材' }),
  ])));
}

/** 視角勾選 + 類型下拉 */
export function tagEditor(tags: AssetTags, onChange: (t: AssetTags) => void): HTMLElement {
  let cur: AssetTags = { views: [...tags.views], type: tags.type };
  const boxes = VIEWS.map((v) => {
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = cur.views.includes(v);
    cb.addEventListener('change', () => {
      const views = VIEWS.filter((k) => (k === v ? cb.checked : cur.views.includes(k))) as ViewKey[];
      cur = { ...cur, views };
      onChange(cur);
    });
    return el('label', {}, [cb, VIEW_LABEL[v]]);
  });
  const kind = el('select');
  kind.append(option('', '不指定類型'), ...KINDS.map((k) => option(k, k)));
  kind.value = cur.type ?? '';
  kind.addEventListener('change', () => {
    cur = { ...cur, type: kind.value || null };
    onChange(cur);
  });
  return el('div', { className: 'lib-tags' }, [
    el('div', { className: 'muted small', text: '視角(沒勾 = 未分類)' }),
    el('div', { className: 'lib-views' }, boxes),
    el('label', {}, ['類型', kind]),
  ]);
}

export type ImportResult = Awaited<ReturnType<typeof api.library.import>>;

/** 「匯入圖片」按鈕(附隱藏的檔案選擇), 選好檔案交給 onFiles */
export function importButton(onFiles: (files: File[]) => void): HTMLElement[] {
  const input = el('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;
  input.className = 'hidden';
  const btn = el('button', { text: '匯入圖片', className: 'primary' });
  btn.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const files = [...(input.files ?? [])];
    input.value = '';
    if (files.length) onFiles(files);
  });
  return [btn, input];
}

/** 匯入表單: 先替這批選標籤(可略過)再匯入; 有回應(含部分失敗)交給 onDone, 整批失敗交給 onError */
export function importForm(files: File[], opts: {
  onDone: (r: ImportResult) => void | Promise<void>;
  onCancel: () => void;
  onError: (msg: string) => void;
}): HTMLElement {
  let tags: AssetTags = { views: [], type: null };
  const ok = el('button', { text: `匯入 ${files.length} 張`, className: 'primary' });
  const cancel = el('button', { text: '取消' });
  cancel.addEventListener('click', () => opts.onCancel());
  ok.addEventListener('click', async () => {
    ok.disabled = true;
    cancel.disabled = true;
    ok.textContent = '匯入中…';
    try {
      const empty = !tags.views.length && !tags.type;
      await opts.onDone(await api.library.import(files, empty ? undefined : tags));
    } catch (e) {
      opts.onError((e as Error).message);
    }
  });
  return el('div', { className: 'lib-pad' }, [
    el('b', { text: '匯入圖片' }),
    el('div', { className: 'muted small', text: files.map((f) => f.name).join('、') }),
    el('div', { className: 'muted small', text: '可以先替這批選標籤(可略過, 之後再改)' }),
    tagEditor(tags, (t) => { tags = t; }),
    el('div', { className: 'lib-row' }, [ok, cancel]),
  ]);
}

/** 部分沒匯入時的提示文字; 全部成功回傳 null */
export function importErrors(r: ImportResult): string | null {
  return r.errors.length ? `有 ${r.errors.length} 張沒匯入: ${r.errors.map((e) => `${e.file}(${e.detail})`).join('、')}` : null;
}
