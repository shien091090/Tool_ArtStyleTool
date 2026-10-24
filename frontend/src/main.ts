import './style.css';
import { mountFlowPage } from './pages/flowPage';
import { mountFalBalance } from './falBalance';
import { mountJobBar } from './jobs';

const main = document.querySelector<HTMLElement>('#page')!;
let unmount: (() => void) | null = null;

/** 只剩流程一個畫面; 舊頁籤網址(#/decompose、#/render…)一律轉到流程 */
function route() {
  const [raw, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  if (raw !== 'flow') {
    location.replace(raw ? '#/flow' : `#/flow${query ? `?${query}` : ''}`); // 會再觸發 hashchange
    return;
  }
  unmount?.();
  main.replaceChildren();
  unmount = mountFlowPage(main, new URLSearchParams(query));
}

window.addEventListener('hashchange', route);
route();
mountFalBalance(document.querySelector<HTMLButtonElement>('#fal-balance')!);
mountJobBar(document.body);
