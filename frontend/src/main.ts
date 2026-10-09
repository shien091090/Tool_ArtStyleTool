import './style.css';
import { mountDecomposePage } from './pages/decomposePage';
import { mountRenderPage } from './pages/renderPage';
import { mountGridPage } from './pages/gridPage';

type Mount = (el: HTMLElement, params: URLSearchParams) => () => void;

const ROUTES: { path: string; label: string; mount: Mount }[] = [
  { path: 'decompose', label: '拆解檢查', mount: mountDecomposePage },
  { path: 'render', label: '渲染', mount: mountRenderPage },
  { path: 'grid', label: '對照網格', mount: mountGridPage },
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
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const target = ROUTES.find((r) => r.path === path) ?? ROUTES[0];
  for (const a of nav.querySelectorAll<HTMLAnchorElement>('a')) a.classList.toggle('active', a.dataset.path === target.path);
  unmount?.();
  main.replaceChildren();
  unmount = target.mount(main, new URLSearchParams(query));
}

window.addEventListener('hashchange', route);
route();
