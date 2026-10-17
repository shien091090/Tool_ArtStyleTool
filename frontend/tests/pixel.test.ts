import { describe, it, expect } from 'vitest';
import { cellAt } from '../src/pixel/gridPicker';
import {
  candidateEyes, candidateLabel, defaultColors, defaultConvertColors, displayScale, estimateCost, isSmall, pickModel, toGpl,
} from '../src/pixel/model';

describe('像素素材', () => {
  it('預設色數與後端一致', () => {
    expect(defaultColors('auto')).toBe(24);
    expect(defaultColors('grid', 1, 2)).toBe(8);
    expect(defaultColors('grid', 2, 2)).toBe(8);
    expect(defaultColors('grid', 2, 4)).toBe(12);
    expect(defaultColors('grid', 4, 8)).toBe(16);
  });

  it('依尺寸自動選模型與花費(長邊 96px 為界, 同後端)', () => {
    expect(pickModel(12, 12)).toBe('gpt-image-2');
    expect(pickModel(4, 13)).toBe('nano-banana-pro');
    expect(estimateCost(12, 12, 2)).toBeCloseTo(0.12);
    expect(estimateCost(13, 4, 1)).toBeCloseTo(0.15);
    expect(isSmall(6, 4)).toBe(true);
    expect(isSmall(7, 4)).toBe(false);
  });

  it('gpl 格式', () => {
    expect(toGpl('騎士', ['#ff0000', '#00080a'])).toBe(
      'GIMP Palette\nName: 騎士\nColumns: 8\n#\n255   0   0\t#ff0000\n  0   8  10\t#00080a\n',
    );
  });

  it('顯示倍率取整數', () => {
    expect(displayScale(8, 16, 200)).toBe(12);
    expect(displayScale(300, 10, 200)).toBe(1);
  });

  it('候選標籤', () => {
    const base = { id: 'c1', created: '', model: 'gpt-image-2' as const, colors: 8, note: '' };
    expect(candidateLabel({ ...base, mode: 'grid', cols: 8, rows: 12 })).toBe('AI 重畫 · 64×96');
    expect(candidateLabel({ ...base, mode: 'auto', cols: 0, rows: 0, model: 'kontext' })).toBe('AI 重畫 · 自動尺寸');
    expect(candidateLabel({ ...base, mode: 'convert', cols: 4, rows: 8, model: '' })).toBe('直接轉換 · 32×64');
  });

  it('候選眼睛相容舊的單一 eye', () => {
    const base = { id: 'c1', created: '', model: '' as const, colors: 8, note: '', mode: 'convert' as const, cols: 4, rows: 4 };
    const e = { x: 0.5, y: 0.5, r: 0.1 };
    expect(candidateEyes({ ...base, eye: e })).toEqual([e]);
    expect(candidateEyes({ ...base, eyes: [e, e] })).toHaveLength(2);
    expect(candidateEyes(base)).toEqual([]);
  });

  it('拖拉位置換算格數並限制在 1~16', () => {
    expect(cellAt(0, 0, 18, 16)).toEqual({ cols: 1, rows: 1 });
    expect(cellAt(19, 40, 18, 16)).toEqual({ cols: 2, rows: 3 });
    expect(cellAt(-5, 999, 18, 16)).toEqual({ cols: 1, rows: 16 });
  });
});

describe('直接轉換', () => {
  it('預設色數: 長邊 32px 以下 16 色, 否則 24 色(同後端)', () => {
    expect(defaultConvertColors(4, 4)).toBe(16);
    expect(defaultConvertColors(2, 4)).toBe(16);
    expect(defaultConvertColors(8, 5)).toBe(24);
  });
});

describe('fal 餘額', () => {
  it('格式', async () => {
    const { formatBalance } = await import('../src/falBalance');
    expect(formatBalance(4.734, 'USD')).toBe('$4.73');
    expect(formatBalance(2, 'EUR')).toBe('2.00 EUR');
  });
});
