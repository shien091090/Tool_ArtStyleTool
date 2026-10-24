/** 從素材庫挑一張圖的視窗; 取消回傳 null。 */
import { api } from '../api';
import { el, showBanner } from '../pages/ui';
import { filterBar, renderGrid } from './grid';
import type { Asset } from './model';

export function pickAsset(): Promise<Asset | null> {
  return new Promise((resolve) => {
    let assets: Asset[] = [];
    const banner = el('div');
    const list = el('div', { className: 'lib-groups' }, [el('div', { className: 'muted lib-empty', text: '讀取中…' })]);
    const filter = filterBar(() => draw());
    const cancel = el('button', { text: '取消' });
    const dialog = el('div', { className: 'lib-dialog' }, [
      el('div', { className: 'toolbar' }, [el('b', { text: '從素材庫選圖' }), filter.root, el('span', { className: 'spacer' }), cancel]),
      banner, list,
    ]);
    const overlay = el('div', { className: 'lib-modal' }, [dialog]);

    const close = (a: Asset | null) => {
      window.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(a);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(null);
    };
    const draw = () => renderGrid(list, assets, filter.value(), { onPick: (a) => close(a) });

    cancel.addEventListener('click', () => close(null));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null);
    });
    window.addEventListener('keydown', onKey);
    document.body.append(overlay);
    api.library.list().then((l) => {
      assets = l;
      draw();
    }).catch((e) => showBanner(banner, 'error', (e as Error).message));
  });
}
