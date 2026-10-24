/** 素材庫共用元件: 篩選列、分組縮圖清單、標籤編輯。素材庫頁與挑選視窗共用。 */
import { api } from '../api';
import { el, option } from '../pages/ui';
import { groupAssets, KINDS, matches, VIEW_LABEL, VIEWS, type Asset, type AssetTags, type Filter, type ViewKey } from './model';

export function filterBar(onChange: (f: Filter) => void): { root: HTMLElement; value: () => Filter } {
  const view = el('select');
  view.append(option('all', '全部視角'), ...VIEWS.map((v) => option(v, VIEW_LABEL[v])), option('none', '未分類'));
  const kind = el('select');
  kind.append(option('all', '全部類型'), ...KINDS.map((k) => option(k, k)));
  const text = el('input');
  text.placeholder = '搜尋名稱';
  const value = (): Filter => ({ view: view.value as Filter['view'], kind: kind.value, text: text.value.trim() });
  for (const c of [view, kind]) c.addEventListener('change', () => onChange(value()));
  text.addEventListener('input', () => onChange(value()));
  return { root: el('div', { className: 'lib-filter' }, [view, kind, text]), value };
}

/** 一組一列(原圖在前); 組裡只要有一張符合篩選整組都顯示, 不符合的淡化 */
export function renderGroups(container: HTMLElement, assets: Asset[], filter: Filter,
  opts: { selected?: string | null; onPick: (a: Asset) => void }) {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const groups = groupAssets(assets).filter((g) => g.some((a) => matches(a, filter)));
  if (!groups.length) {
    container.replaceChildren(el('div', { className: 'muted lib-empty', text: assets.length ? '沒有符合的素材' : '素材庫是空的' }));
    return;
  }
  container.replaceChildren(...groups.map((g) => el('div', { className: 'lib-group' }, g.map((a) => {
    const img = el('img');
    img.src = api.library.imageUrl(a.id);
    img.loading = 'lazy';
    img.alt = a.name;
    const parent = a.parent ? byId.get(a.parent) : undefined;
    const card = el('div', {
      className: `lib-card${matches(a, filter) ? '' : ' dim'}${opts.selected === a.id ? ' selected' : ''}`,
      title: a.name,
    }, [
      el('div', { className: 'lib-thumb checker' }, [img]),
      el('div', { className: 'lib-name', text: a.name }),
      ...(parent ? [el('div', { className: 'lib-from muted small', text: `← ${parent.name}` })] : []),
    ]);
    card.addEventListener('click', () => opts.onPick(a));
    return card;
  }))));
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
