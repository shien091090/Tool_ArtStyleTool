/** 從素材庫挑一張圖的視窗, 也能直接匯入新圖; 取消回傳 null。 */
import { api } from '../api';
import { el, showBanner } from '../pages/ui';
import { filterBar, importButton, importErrors, importForm, renderGrid, renderStrip } from './grid';
import type { Asset } from './model';

export function pickAsset(): Promise<Asset | null> {
  return new Promise((resolve) => {
    let assets: Asset[] = [];
    const banner = el('div');
    const importSlot = el('div', { className: 'lib-import' });
    const list = el('div', { className: 'lib-groups' }, [el('div', { className: 'muted lib-empty', text: '讀取中…' })]);
    const strip = el('div', { className: 'lib-strip hidden' });
    const filter = filterBar(() => draw());
    const cancel = el('button', { text: '取消' });
    const dialog = el('div', { className: 'lib-dialog' }, [
      el('div', { className: 'toolbar' }, [el('b', { text: '從素材庫選圖' }), ...importButton(showImport), filter.root,
        el('span', { className: 'spacer' }), cancel]),
      banner, importSlot, el('div', { className: 'lib-layout' }, [list, strip]),
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
    let group: Asset[] | null = null;
    /** 沒有派生的直接選; 有派生的先在右側列出整組再挑 */
    const draw = () => {
      renderGrid(list, assets, filter.value(), {
        selected: group?.[0].id,
        onPick: (a, g) => {
          if (g.length < 2) return close(a);
          group = g;
          draw();
        },
      });
      strip.classList.toggle('hidden', !group);
      if (group) renderStrip(strip, group, { onPick: (a) => close(a) });
    };

    async function load() {
      try {
        assets = await api.library.list();
        group = null;
        draw();
      } catch (e) {
        showBanner(banner, 'error', (e as Error).message);
      }
    }

    /** 只匯入一張且成功就直接選它; 多張則留在視窗裡讓人挑 */
    function showImport(files: File[]) {
      importSlot.replaceChildren(importForm(files, {
        onDone: async (r) => {
          importSlot.replaceChildren();
          const warn = importErrors(r);
          showBanner(banner, warn ? 'warn' : null, warn ?? undefined);
          if (r.added.length === 1 && files.length === 1) return close(r.added[0]);
          await load();
        },
        onCancel: () => importSlot.replaceChildren(),
        onError: (msg) => {
          importSlot.replaceChildren();
          showBanner(banner, 'error', msg);
        },
      }));
    }

    cancel.addEventListener('click', () => close(null));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null);
    });
    window.addEventListener('keydown', onKey);
    document.body.append(overlay);
    void load();
  });
}
