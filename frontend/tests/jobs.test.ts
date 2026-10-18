import { describe, expect, it } from 'vitest';
import { jobName, runningJob, trackJob } from '../src/jobs';

describe('AI 工作', () => {
  it('標籤轉成完成提示的名稱', () => {
    expect(jobName('AI 重畫中(GPT Image 2, 約 15~60 秒)…')).toBe('AI 重畫');
    expect(jobName('AI 切部位中…')).toBe('AI 切部位');
  });

  it('跑的期間查得到, 結束(含失敗)後查不到且 done 會完成', async () => {
    let release!: () => void;
    const p = trackJob('AI 測試中…', 'k1', () => new Promise<number>((r) => (release = () => r(7))));
    const job = runningJob('k1');
    expect(job?.label).toBe('AI 測試中…');
    expect(runningJob('k2')).toBeUndefined();
    release();
    expect(await p).toBe(7);
    await job!.done;
    expect(runningJob('k1')).toBeUndefined();
    await expect(trackJob('AI 壞中…', 'k1', () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect(runningJob('k1')).toBeUndefined();
  });
});
