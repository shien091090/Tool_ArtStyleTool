import './style.css';
import { mountDecomposePage } from './pages/decomposePage';
import { mountRenderPage } from './pages/renderPage';
import { mountGridPage } from './pages/gridPage';
import { mountProportionPage } from './pages/proportionPage';
import { mountPixelPage } from './pages/pixelPage';
import { mountFlowPage } from './pages/flowPage';
import { canonicalPath } from './routes';
import { mountFalBalance } from './falBalance';
import { mountJobBar } from './jobs';

type Mount = (el: HTMLElement, params: URLSearchParams) => () => void;

const ROUTES: { path: string; label: string; mount: Mount }[] = [
  { path: 'flow', label: '流程', mount: mountFlowPage },
  { path: 'decompose', label: '拆解檢查', mount: mountDecomposePage },
  { path: 'render', label: '渲染', mount: mountRenderPage },
  { path: 'grid', label: '對照網格', mount: mountGridPage },
  { path: 'workshop', label: '部位工坊', mount: mountProportionPage },
  { path: 'pixel', label: '像素素材', mount: mountPixelPage },
];

const nav = document.querySelector<HTMLElement>('#nav')!;
const main = document.querySelector<HTMLElement>('#page')!;
let unmount: (() => void) | null = null;

for (const r of ROUTES) {
  const a = document.createElement('a');
  a.href = `#/${r.path}`;
  a.textContent = r.label;
  a.dataset.path = r.path;
  nav.append(a);
}

function route() {
  const [raw, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const path = canonicalPath(raw);
  if (path !== raw) {
    location.replace(`#/${path}${query ? `?${query}` : ''}`); // 會再觸發 hashchange
    return;
  }
  const target = ROUTES.find((r) => r.path === path) ?? ROUTES[0];
  for (const a of nav.querySelectorAll<HTMLAnchorElement>('a')) a.classList.toggle('active', a.dataset.path === target.path);
  unmount?.();
  main.replaceChildren();
  unmount = target.mount(main, new URLSearchParams(query));
}

window.addEventListener('hashchange', route);
route();
mountFalBalance(document.querySelector<HTMLButtonElement>('#fal-balance')!);
mountJobBar(document.body);
