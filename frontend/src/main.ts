import './style.css';
import { mountFlowPage } from './pages/flowPage';
import { mountLibraryPage } from './pages/libraryPage';
import { mountMockupPage } from './pages/mockupPage';
import { mountFalBalance } from './falBalance';
import { mountJobBar } from './jobs';

type Unmount = (() => void) & { canLeave?: () => boolean };
type Mount = (el: HTMLElement, params: URLSearchParams) => Unmount;

/** 平面圖沿用 #/flow(舊書籤不失效); 其他網址一律轉到平面圖 */
const ROUTES: { path: string; label: string; mount: Mount }[] = [
  { path: 'flow', label: '平面圖', mount: mountFlowPage },
  { path: 'mockup', label: '遊戲示意', mount: mountMockupPage },
  { path: 'library', label: '素材庫', mount: (el) => mountLibraryPage(el) },
];

const nav = document.querySelector<HTMLElement>('#nav')!;
const main = document.querySelector<HTMLElement>('#page')!;
let unmount: Unmount | null = null;

for (const r of ROUTES) {
  const a = document.createElement('a');
  a.href = `#/${r.path}`;
  a.textContent = r.label;
  a.dataset.path = r.path;
  nav.append(a);
}

function route(e?: HashChangeEvent) {
  const [raw, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const target = ROUTES.find((r) => r.path === raw);
  if (!target) {
    location.replace(raw ? '#/flow' : `#/flow${query ? `?${query}` : ''}`); // 會再觸發 hashchange
    return;
  }
  const oldHash = e ? new URL(e.oldURL).hash : '';
  if (e && unmount?.canLeave && !unmount.canLeave()) {
    history.replaceState(null, '', oldHash); // 不會觸發 hashchange, 留在原頁
    return;
  }
  // 離開平面圖或遊戲示意時記住開著的流程/場景, 切回來時接著開
  for (const p of ['flow', 'mockup']) {
    if (oldHash.startsWith(`#/${p}`)) nav.querySelector<HTMLAnchorElement>(`a[data-path="${p}"]`)!.href = oldHash;
  }
  for (const a of nav.querySelectorAll<HTMLAnchorElement>('a')) a.classList.toggle('active', a.dataset.path === target.path);
  unmount?.();
  main.replaceChildren();
  unmount = target.mount(main, new URLSearchParams(query));
}

window.addEventListener('hashchange', route);
route();
mountFalBalance(document.querySelector<HTMLButtonElement>('#fal-balance')!);
mountJobBar(document.body);
