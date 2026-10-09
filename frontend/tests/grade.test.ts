import { describe, it, expect } from 'vitest';
import { GRADE_PRESETS, gradePresetUniforms, gradientTable, IDENTITY_GRADE } from '../src/grade';
import { GRADE_PRESET_NAMES } from '../src/recipe';

describe('調色預設', () => {
  it('none 或強度 0 等於不調色', () => {
    expect(gradePresetUniforms('none', 1)).toEqual(IDENTITY_GRADE);
    expect(gradePresetUniforms('film', 0)).toEqual(IDENTITY_GRADE);
  });
  it('每個預設都有定義, 數值在合理範圍', () => {
    for (const name of GRADE_PRESET_NAMES) {
      const g = GRADE_PRESETS[name];
      expect(g).toBeDefined();
      for (const v of [...g.lift]) expect(Math.abs(v)).toBeLessThanOrEqual(0.2);
      for (const v of [...g.gain, ...g.gamma]) expect(v).toBeGreaterThan(0.5);
      expect(g.sat).toBeGreaterThanOrEqual(0);
    }
  });
  it('強度一半時在單位值與預設之間', () => {
    const half = gradePresetUniforms('noir', 0.5);
    expect(half.sat).toBeCloseTo(0.5);
    expect(half.contrast).toBeCloseTo((1 + GRADE_PRESETS.noir.contrast) / 2);
  });
});

describe('gradientTable', () => {
  it('兩端等於色帶兩端, 中間線性內插', () => {
    const t = gradientTable(['#000000', '#ff8040']);
    expect(Array.from(t.slice(0, 4))).toEqual([0, 0, 0, 255]);
    expect(Array.from(t.slice(255 * 4, 255 * 4 + 3))).toEqual([255, 128, 64]);
    expect(t[128 * 4]).toBeGreaterThan(120);
    expect(t[128 * 4]).toBeLessThan(135);
  });
  it('多色帶依序經過每個顏色', () => {
    const t = gradientTable(['#000000', '#ffffff', '#000000']);
    expect(t[128 * 4]).toBeGreaterThan(250);
    expect(t[255 * 4]).toBe(0);
  });
});
