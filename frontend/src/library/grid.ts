/** 素材庫共用元件: 篩選列、縮圖格、標籤編輯。素材庫頁與挑選視窗共用。 */
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
