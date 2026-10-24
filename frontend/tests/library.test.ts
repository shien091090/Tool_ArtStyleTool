import { describe, it, expect } from 'vitest';
import { groupAssets, matches, rootOf, sections, sourceText, type Asset, type Filter } from '../src/library/model';

const asset = (id: string, created: string, parent: string | null = null, tags: Asset['tags'] = { views: [], type: null },
  name = id): Asset => ({ id, name, created, parent, source: { kind: 'import', file: `${id}.png` }, tags });

const ALL: Filter = { views: [], kinds: [], text: '' };

describe('素材庫分組', () => {
  it('派生鏈歸到根底下, 最新的組排前面', () => {
    const list = [asset('a1', '2026-10-01'), asset('a2', '2026-10-02', 'a1'), asset('a3', '2026-10-03', 'a2'),
      asset('a4', '2026-10-05')];
    expect(groupAssets(list).map((g) => g.map((a) => a.id))).toEqual([['a4'], ['a1', 'a2', 'a3']]);
    expect(rootOf(list, 'a3')).toBe('a1');
  });

  it('原圖不存在時自己當根', () => {
    const list = [asset('a1', '2026-10-01'), asset('a2', '2026-10-02', 'a9')];
    expect(groupAssets(list).map((g) => g.map((a) => a.id))).toEqual([['a2'], ['a1']]);
  });

  it('組內較新的派生讓整組排前面', () => {
    const list = [asset('a1', '2026-10-01'), asset('a2', '2026-10-02'), asset('a3', '2026-10-09', 'a1')];
    expect(groupAssets(list).map((g) => g[0].id)).toEqual(['a1', 'a2']);
  });
});

describe('素材庫篩選', () => {
  it('未分類 = 沒有視角, 即使有類型', () => {
    const a = asset('a1', '2026-10-01', null, { views: [], type: '建築' });
    expect(matches(a, { ...ALL, views: ['none'] })).toBe(true);
    expect(matches(a, { ...ALL, views: ['side'] })).toBe(false);
    expect(matches(a, { ...ALL, kinds: ['建築'] })).toBe(true);
    expect(matches(a, { ...ALL, kinds: ['角色'] })).toBe(false);
  });

  it('同一類勾多個是「任一符合」', () => {
    const a = asset('a1', '2026-10-01', null, { views: ['iso'], type: '角色' });
    expect(matches(a, { ...ALL, views: ['side', 'iso'] })).toBe(true);
    expect(matches(a, { ...ALL, kinds: ['敵人', '角色'] })).toBe(true);
    expect(matches(a, { ...ALL, views: ['side', 'none'] })).toBe(false);
  });

  it('名稱搜尋不分大小寫', () => {
    const a = asset('a1', '2026-10-01', null, undefined, 'Pixel 樹');
    expect(matches(a, { ...ALL, text: 'pixel' })).toBe(true);
    expect(matches(a, { ...ALL, text: '石' })).toBe(false);
  });
});

describe('素材庫分區', () => {
  const list = [
    asset('a1', '2026-10-01', null, { views: ['side'], type: '角色' }),
    asset('a2', '2026-10-02', 'a1', { views: ['side', 'iso'], type: '角色' }),
    asset('a3', '2026-10-03', null, { views: ['iso'], type: '敵人' }),
    asset('a4', '2026-10-04', null, { views: [], type: '角色' }),
  ];
  const ids = (f: Filter) => sections(list, f).map((s) => [s.label, s.items.map((a) => a.id)]);

  it('沒勾或只勾一個不分區, 依組排(原圖後接派生)', () => {
    expect(ids(ALL)).toEqual([[null, ['a4', 'a3', 'a1', 'a2']]]);
    expect(ids({ ...ALL, views: ['side'] })).toEqual([[null, ['a1', 'a2']]]);
  });

  it('勾多個視角就依視角分區, 依固定順序, 多視角的素材在每區都出現', () => {
    expect(ids({ ...ALL, views: ['none', 'iso', 'side'] })).toEqual([
      ['橫向卷軸', ['a1', 'a2']], ['斜角俯瞰', ['a3', 'a2']], ['未分類', ['a4']]]);
  });

  it('視角與類型都勾多個時兩兩組合分區, 沒素材的區也留著', () => {
    expect(ids({ ...ALL, views: ['side', 'iso'], kinds: ['敵人', '角色'] })).toEqual([
      ['橫向卷軸・角色', ['a1', 'a2']], ['橫向卷軸・敵人', []],
      ['斜角俯瞰・角色', ['a2']], ['斜角俯瞰・敵人', ['a3']]]);
  });
});

describe('來源說明', () => {
  it('匯入與平面圖', () => {
    expect(sourceText(asset('a1', 'x'))).toBe('自己匯入: a1.png');
    expect(sourceText({ ...asset('a2', 'x'), source: { kind: 'flow', flow: '樹', node: 'n4', rev: 2 } }))
      .toBe('平面圖「樹」節點 n4 第 2 版');
  });
});
