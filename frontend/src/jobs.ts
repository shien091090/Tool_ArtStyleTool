/** 進行中的 AI 工作: 畫面上方的醒目進度列(換頁也看得到), 回到同一個作品/節點時可接續等它跑完。 */
import { el } from './pages/ui';

export interface Job {
  label: string;
  /** 作品或節點的識別, 例如 flow:流程:n3; 沒有就是 null */
  key: string | null;
  start: number;
  /** 跑完(不論成功失敗)時 resolve */
  done: Promise<void>;
}

const running = new Set<Job>();
const listeners = new Set<() => void>();
const DONE_SHOW_MS = 5000;
const ERROR_SHOW_MS = 9000;

function emit() {
  for (const fn of listeners) fn();
}

export function runningJob(key: string | null): Job | undefined {
  if (!key) return undefined;
  for (const j of running) if (j.key === key) return j;
  return undefined;
}

/** 有工作開始或結束時通知; 回傳取消訂閱 */
export function onJobsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 「AI 重畫中(…)…」→「AI 重畫」 */
export function jobName(label: string): string {
  return label.replace(/中[(…].*$/, '').replace(/…$/, '');
}

let finished: { text: string; ok: boolean; until: number }[] = [];

/** 跑 fn 期間顯示進度列; 結束時短暫顯示完成或失敗 */
export async function trackJob<T>(label: string, key: string | null, fn: () => Promise<T>): Promise<T> {
  let resolve!: () => void;
  const job: Job = { label, key, start: Date.now(), done: new Promise<void>((r) => (resolve = r)) };
  running.add(job);
  emit();
  try {
    const out = await fn();
    finished.push({ text: `✓ ${jobName(label)} 完成`, ok: true, until: Date.now() + DONE_SHOW_MS });
    return out;
  } catch (e) {
    finished.push({ text: `✗ ${jobName(label)} 失敗: ${(e as Error).message}`, ok: false, until: Date.now() + ERROR_SHOW_MS });
    throw e;
  } finally {
    running.delete(job);
    resolve();
    emit();
  }
}

/** 掛在頁面最上層的進度列 */
export function mountJobBar(host: HTMLElement) {
  const bar = el('div', { className: 'job-bar' });
  host.append(bar);
  let timer = 0;
  const render = () => {
    const now = Date.now();
    finished = finished.filter((f) => f.until > now);
    const items: HTMLElement[] = [...running].map((j) => el('div', { className: 'job-item' }, [
      el('span', { className: 'job-spin' }),
      el('span', { text: j.label }),
      el('span', { className: 'job-time', text: `已 ${Math.floor((now - j.start) / 1000)} 秒` }),
    ]));
    for (const f of finished) {
      const close = el('button', { text: '×', className: 'job-close' });
      close.addEventListener('click', () => {
        finished = finished.filter((x) => x !== f);
        render();
      });
      items.push(el('div', { className: `job-item ${f.ok ? 'ok' : 'fail'}` }, [el('span', { text: f.text }), close]));
    }
    bar.replaceChildren(...items);
    window.clearTimeout(timer);
    if (items.length) timer = window.setTimeout(render, 1000);
  };
  onJobsChange(render);
  render();
}
