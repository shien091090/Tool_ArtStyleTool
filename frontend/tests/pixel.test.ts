import { describe, it, expect } from 'vitest';
import { cellAt } from '../src/pixel/gridPicker';
import { candidateLabel, defaultColors, defaultConvertColors, displayScale, estimateCost, toGpl } from '../src/pixel/model';

describe('像素素材', () => {
  it('預設色數與後端一致', () => {
    expect(defaultColors('auto')).toBe(24);
    expect(defaultColors('grid', 1, 2)).toBe(8);
    expect(defaultColors('grid', 2, 2)).toBe(8);
    expect(defaultColors('grid', 2, 4)).toBe(12);
    expect(defaultColors('grid', 4, 8)).toBe(16);
  });

  it('花費估算: 指定格數固定 Banana Pro', () => {
    expect(estimateCost('auto', 'kontext', 2)).toBeCloseTo(0.08);
    expect(estimateCost('grid', 'kontext', 1)).toBeCloseTo(0.15);
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
    const base = { id: 'c1', created: '', model: 'nano-banana-pro' as const, colors: 8, note: '' };
    expect(candidateLabel({ ...base, mode: 'grid', cols: 1, rows: 2 })).toBe('寬1×高2格(8×16)');
    expect(candidateLabel({ ...base, mode: 'auto', cols: 0, rows: 0, model: 'kontext' })).toBe('自動 · Kontext');
    expect(candidateLabel({ ...base, mode: 'convert', cols: 4, rows: 8 })).toBe('直接轉換 · 寬4×高8格');
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
