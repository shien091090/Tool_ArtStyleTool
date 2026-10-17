import { api, type PackMeta } from '../api';
import { createPixelPanel, type PixelBackend } from '../pixel/pixelPanel';
import type { PixelWorkMeta } from '../pixel/model';
import { confirmDelete, el, option, showBanner } from './ui';

function workBackend(name: string): PixelBackend {
  return {
    name,
    fileUrl: (path) => api.pixel.fileUrl(name, path),
    generate: (s) => api.pixel.addCandidates(name, s),
    deleteCandidate: (cid) => api.pixel.deleteCandidate(name, cid),
    pixelate: (cid, colors) => api.pixel.pixelate(name, cid, colors),
    convert: (s) => api.pixel.convert(name, s),
    suggestSizes: () => api.pixel.suggestSizes(name),
  };
}

/** 任意圖 → AI 重畫成像素素材 → 本機縮成真實解析度 → 匯出給 Aseprite。 */
export function mountPixelPage(root: HTMLElement, params: URLSearchParams): () => void {
  let meta: PixelWorkMeta | null = null;
  let alive = true;

  // ---- 上方工具列 ----
  const banner = el('div');
  const workSel = el('select');
  const deleteWorkBtn = el('button', { text: '刪除' });
  const status = el('span', { className: 'muted' });
  const nameInput = el('input');
  nameInput.placeholder = '新作品名稱';
  const fileInput = el('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  const packSel = el('select');
  const shopSel = el('select');
  const createBtn = el('button', { text: '建立作品' });
  const toolbar = el('div', { className: 'toolbar' }, [
    el('label', {}, ['作品', workSel]), deleteWorkBtn, status, el('span', { className: 'spacer' }),
    nameInput, fileInput, el('label', {}, ['或分層包', packSel]), el('label', {}, ['或部位工坊結果', shopSel]), createBtn,
  ]);

  const panel = createPixelPanel({ banner, status, confirmDelete, onBusyChange: () => sync() });
  root.append(toolbar, banner, el('div', { className: 'prop-layout' }, [panel.main, panel.side]));

  function sync() {
    const busy = panel.isBusy();
    deleteWorkBtn.disabled = busy || !meta;
    createBtn.disabled = busy;
    workSel.disabled = busy;
  }

  function setMeta(next: PixelWorkMeta | null) {
    meta = next;
    panel.setWork(next ? workBackend(next.name) : null, next,
      next ? { url: `${api.pixel.fileUrl(next.name, 'source.png')}?v=${Date.now()}`, label: next.source } : null);
    sync();
  }

  async function refreshWorks(want = '') {
    const works = await api.pixel.listWorks();
    workSel.replaceChildren(option('', works.length ? '— 選擇作品 —' : '— 尚無作品 —'), ...works.map((w) => option(w.name, w.name)));
    workSel.value = want;
  }

  async function refreshSources() {
    const packs: PackMeta[] = await api.listPacks();
    packSel.replaceChildren(option('', '—'), ...packs.map((p) => option(p.name, p.name)));
    const shop = await api.pixel.workshopResults();
    shopSel.replaceChildren(option('', '—'), ...shop.map((r) => option(`${r.work}/${r.id}`, `${r.work} ${r.id}`)));
  }

  async function openWork(name: string) {
    if (panel.isBusy()) {
      workSel.value = meta?.name ?? '';
      return;
    }
    if (!name) {
      setMeta(null);
      history.replaceState(null, '', '#/pixel');
      return;
    }
    let next: PixelWorkMeta | null = null;
    await panel.run('載入中…', async () => {
      next = await api.pixel.getWork(name);
      workSel.value = name;
      history.replaceState(null, '', `#/pixel?work=${encodeURIComponent(name)}`);
    });
    if (next && alive) setMeta(next);
  }

  async function deleteWork() {
    if (!meta || panel.isBusy()) return;
    const name = meta.name;
    if (!confirmDelete(`作品「${name}」(含來源圖與所有 AI 候選)`)) return;
    await panel.run('刪除中…', async () => {
      await api.pixel.deleteWork(name);
      setMeta(null);
      history.replaceState(null, '', '#/pixel');
      await refreshWorks('');
      showBanner(banner, 'info', `已刪除作品「${name}」`);
    });
  }

  workSel.addEventListener('change', () => void openWork(workSel.value));
  deleteWorkBtn.addEventListener('click', () => void deleteWork());
  createBtn.addEventListener('click', () => {
    let created = '';
    void panel.run('建立中…', async () => {
      const name = nameInput.value.trim();
      const file = fileInput.files?.[0];
      if (!name) throw new Error('請輸入作品名稱');
      const source = file ? { file } : packSel.value ? { pack: packSel.value } : shopSel.value ? { workshop: shopSel.value } : null;
      if (!source) throw new Error('請選擇圖片、分層包或部位工坊結果');
      const m = await api.pixel.createWork(name, source);
      nameInput.value = '';
      fileInput.value = '';
      await refreshWorks(m.name);
      created = m.name;
    }).then(() => {
      if (created) void openWork(created);
    });
  });

  setMeta(null);
  void (async () => {
    try {
      const falOk = (await api.getStatus()).fal;
      panel.setFal(falOk);
      await Promise.all([refreshWorks(), refreshSources()]);
      if (!falOk) showBanner(banner, 'warn', '沒有設定 FAL_KEY: 可以看已有的候選與重新縮小, 但不能 AI 重畫');
      const want = params.get('work');
      if (want && alive) await openWork(want);
    } catch (e) {
      showBanner(banner, 'error', (e as Error).message);
    }
  })();

  return () => {
    alive = false;
    panel.destroy();
  };
}
