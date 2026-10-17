/** 右上角 fal.ai 餘額: 開頁、切回視窗、每分鐘、花錢的請求之後更新。 */
import { api } from './api';

const POLL_MS = 60_000;
/** 寫入請求結束後等一下再查(fal 帳單有延遲), 且最多 10 秒查一次 */
const AFTER_WRITE_MS = 3_000;
const MIN_GAP_MS = 10_000;
/** 低於這個金額標紅 */
export const LOW_BALANCE = 1;

export function formatBalance(balance: number, currency: string): string {
  return currency === 'USD' ? `$${balance.toFixed(2)}` : `${balance.toFixed(2)} ${currency}`;
}

export function mountFalBalance(btn: HTMLButtonElement) {
  let last = 0;
  let timer = 0;

  async function refresh() {
    last = Date.now();
    try {
      const { balance, currency } = await api.falBalance();
      btn.replaceChildren('fal 餘額 ', Object.assign(document.createElement('b'), { textContent: formatBalance(balance, currency) }));
      btn.classList.toggle('low', balance < LOW_BALANCE);
      btn.title = `fal.ai 餘額, ${new Date().toLocaleTimeString()} 更新; 點一下重新查詢`;
    } catch (e) {
      btn.textContent = 'fal 餘額 —';
      btn.classList.remove('low');
      btn.title = (e as Error).message;
    }
  }

  function soon() {
    window.clearTimeout(timer);
    const wait = Math.max(AFTER_WRITE_MS, MIN_GAP_MS - (Date.now() - last));
    timer = window.setTimeout(() => void refresh(), wait);
  }

  btn.textContent = 'fal 餘額 …';
  btn.addEventListener('click', () => void refresh());
  window.addEventListener('focus', () => {
    if (Date.now() - last > MIN_GAP_MS) void refresh();
  });
  window.addEventListener('api-write', soon);
  window.setInterval(() => void refresh(), POLL_MS);
  void refresh();
}
