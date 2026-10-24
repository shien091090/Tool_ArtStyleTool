import { describe, it, expect } from 'vitest';
import { groupAssets, matches, rootOf, sourceText, type Asset, type Filter } from '../src/library/model';

const asset = (id: string, created: string, parent: string | null = null, tags: Asset['tags'] = { views: [], type: null },
  name = id): Asset => ({ id, name, created, parent, source: { kind: 'import', file: `${id}.png` }, tags });

const ALL: Filter = { view: 'all', kind: 'all', text: '' };

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
    expect(matches(a, { ...ALL, view: 'none' })).toBe(true);
    expect(matches(a, { ...ALL, view: 'side' })).toBe(false);
    expect(matches(a, { ...ALL, kind: '建築' })).toBe(true);
    expect(matches(a, { ...ALL, kind: '角色' })).toBe(false);
  });

  it('名稱搜尋不分大小寫', () => {
    const a = asset('a1', '2026-10-01', null, undefined, 'Pixel 樹');
    expect(matches(a, { ...ALL, text: 'pixel' })).toBe(true);
    expect(matches(a, { ...ALL, text: '石' })).toBe(false);
  });
});

describe('來源說明', () => {
  it('匯入與平面圖', () => {
    expect(sourceText(asset('a1', 'x'))).toBe('自己匯入: a1.png');
    expect(sourceText({ ...asset('a2', 'x'), source: { kind: 'flow', flow: '樹', node: 'n4', rev: 2 } }))
      .toBe('平面圖「樹」節點 n4 第 2 版');
  });
});
