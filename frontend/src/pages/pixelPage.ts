import { api, type PackMeta } from '../api';
import {
  candidateLabel, defaultColors, displayScale, estimateCost, MAX_CELLS, MODEL_LABEL, toGpl, ZOOM_EXPORT, CELL,
  type PixelMode, type PixelModel, type PixelResult, type PixelWorkMeta,
} from '../pixel/model';
import { confirmDelete, el, option, showBanner } from './ui';

const RESULT_BOX = 400;

function download(href: string, filename: string) {
  const a = el('a');
  a.href = href;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('圖片載入失敗'));
    img.src = src;
  });
}

/** 關掉平滑, 整數倍放大 */
function pixelCanvas(img: HTMLImageElement, scale: number): HTMLCanvasElement {
  const c = el('canvas');
  c.width = img.width * scale;
  c.height = img.height * scale;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

/** 任意圖 → AI 重畫成像素素材 → 本機縮成真實解析度 → 匯出給 Aseprite。 */
export function mountPixelPage(root: HTMLElement, params: URLSearchParams): () => void {
  let meta: PixelWorkMeta | null = null;
  let selected: string | null = null;
  let falOk = false;
  let busy = false;
  let alive = true;
  let token = 0;
  let mode: PixelMode = 'grid';

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

  // ---- 中間: 來源、候選、縮小結果 ----
  const sourceBox = el('div', { className: 'px-source' });
  const candList = el('div', { className: 'px-cands' });
  const colorsInput = el('input');
  colorsInput.type = 'number';
  colorsInput.min = '2';
  colorsInput.max = '64';
  const redoBtn = el('button', { text: '重新縮小' });
  const resultGrid = el('div', { className: 'px-results' });
  const resultHead = el('div', { className: 'row' }, [el('label', {}, ['色數', colorsInput]), redoBtn,
    el('span', { className: 'muted small', text: '在本機縮小, 不花錢; 匯出的原尺寸 PNG 可直接用 Aseprite 修' })]);
  const mainArea = el('div', { className: 'px-main' }, [
    el('h3', { text: '來源' }), sourceBox,
    el('h3', { text: 'AI 候選' }), candList,
    el('h3', { text: '縮小結果' }), resultHead, resultGrid,
  ]);

  // ---- 右側設定 ----
  const modeBtns = new Map<PixelMode, HTMLButtonElement>();
  const modeRow = el('div', { className: 'seg' }, (['grid', 'auto'] as PixelMode[]).map((m) => {
    const b = el('button', { text: m === 'grid' ? '指定格數' : '自動尺寸' });
    b.addEventListener('click', () => {
      mode = m;
      resetColors();
      sync();
    });
    modeBtns.set(m, b);
    return b;
  }));
  const modelSel = el('select');
  for (const m of Object.keys(MODEL_LABEL) as PixelModel[]) modelSel.append(option(m, MODEL_LABEL[m]));
  const modelRow = el('label', {}, ['模型', modelSel]);
  const cellInput = (v: string) => {
    const i = el('input');
    i.type = 'number';
    i.min = '1';
    i.max = String(MAX_CELLS);
    i.value = v;
    i.addEventListener('input', () => {
      resetColors();
      sync();
    });
    return i;
  };
  const colsInput = cellInput('1');
  const rowsInput = cellInput('2');
  const gridHint = el('div', { className: 'muted small' });
  const gridRow = el('div', { className: 'col' }, [
    el('div', { className: 'row' }, [el('label', {}, ['寬', colsInput, '格']), el('label', {}, ['高', rowsInput, '格'])]),
    gridHint,
  ]);
  const genColors = el('input');
  genColors.type = 'number';
  genColors.min = '2';
  genColors.max = '64';
  const note = el('textarea');
  note.rows = 2;
  note.maxLength = 200;
  note.placeholder = '補充描述(選填), 例如「劍要保留」';
  const countSel = el('select');
  for (const n of [1, 2, 3, 4]) countSel.append(option(String(n), `${n} 張`));
  const genBtn = el('button', { text: 'AI 重畫', className: 'primary' });
  const costHint = el('span', { className: 'muted small' });
  const section = (title: string, ...children: (Node | string)[]) =>
    el('section', { className: 'prop-section' }, [el('h3', { text: title }), ...children]);
  const panel = el('div', { className: 'panel-wrap prop-panel' }, [
    section('尺寸', modeRow, modelRow, gridRow),
    section('重畫', el('label', {}, ['色數', genColors]), note, el('label', {}, ['候選張數', countSel]),
      el('div', { className: 'row' }, [genBtn, costHint])),
  ]);

  root.append(toolbar, banner, el('div', { className: 'prop-layout' }, [mainArea, panel]));

  const cells = () => ({ cols: Number(colsInput.value), rows: Number(rowsInput.value) });
  const cellsOk = () => {
    const { cols, rows } = cells();
    return [cols, rows].every((v) => Number.isInteger(v) && v >= 1 && v <= MAX_CELLS);
  };

  function resetColors() {
    const { cols, rows } = cells();
    if (mode === 'auto' || cellsOk()) genColors.value = String(defaultColors(mode, cols, rows));
  }

  function sync() {
    for (const [m, b] of modeBtns) b.classList.toggle('active', m === mode);
    modelRow.classList.toggle('hidden', mode !== 'auto');
    gridRow.classList.toggle('hidden', mode !== 'grid');
    const { cols, rows } = cells();
    gridHint.textContent = cellsOk()
      ? `${cols * CELL}×${rows * CELL} 像素(一格 ${CELL}px); 比例跟原圖不同時 AI 會重新設計, 例如正方形畫成 Q 版。固定用 Nano Banana Pro`
      : `寬、高請填 1~${MAX_CELLS} 的整數`;
    const cost = estimateCost(mode, modelSel.value as PixelModel, Number(countSel.value));
    costHint.textContent = `約 ${cost.toFixed(2)} 美元`;
    genBtn.disabled = busy || !falOk || !meta || (mode === 'grid' && !cellsOk());
    genBtn.title = falOk ? '' : '沒有設定 FAL_KEY';
    deleteWorkBtn.disabled = busy || !meta;
    createBtn.disabled = busy;
    redoBtn.disabled = busy || !selected;
    colorsInput.disabled = busy || !selected;
    workSel.disabled = busy;
  }

  async function run(label: string, fn: () => Promise<void>) {
    if (busy) return;
    busy = true;
    status.textContent = label;
    showBanner(banner, null);
    sync();
    try {
      await fn();
    } catch (e) {
      showBanner(banner, 'error', (e as Error).message);
    } finally {
      busy = false;
      status.textContent = '';
      if (alive) sync();
    }
  }

  // ---- 顯示 ----
  function renderWork() {
    sourceBox.replaceChildren();
    candList.replaceChildren();
    if (!meta) {
      sourceBox.append(el('div', { className: 'muted', text: '請選擇或建立作品' }));
      resultGrid.replaceChildren();
      return;
    }
    const src = el('img');
    src.src = `${api.pixel.fileUrl(meta.name, 'source.png')}?v=${Date.now()}`;
    sourceBox.append(src, el('div', { className: 'muted small', text: meta.source }));
    if (!meta.candidates.length) candList.append(el('div', { className: 'muted', text: '還沒有候選, 在右側設定後按「AI 重畫」' }));
    for (const c of meta.candidates) {
      const img = el('img');
      img.src = api.pixel.fileUrl(meta.name, `ai/${c.id}.png`);
      const item = el('div', { className: `px-cand${c.id === selected ? ' active' : ''}`, title: c.note }, [
        img, el('span', { text: candidateLabel(c) }),
      ]);
      item.addEventListener('click', () => selectCandidate(c.id));
      const del = el('button', { text: '×', className: 'variant-del', title: '刪除這張候選' });
      del.addEventListener('click', (ev) => {
        ev.stopPropagation();
        void deleteCandidate(c.id);
      });
      candList.append(el('div', { className: 'variant-item' }, [item, del]));
    }
  }

  async function renderResults(results: PixelResult[], cid: string) {
    const my = token;
    const cards: HTMLElement[] = [];
    for (const r of results) {
      const card = el('div', { className: 'px-result' }, [el('div', { className: 'sel-title', text: r.label })]);
      cards.push(card);
      if (r.error || !r.png || !r.w || !r.h) {
        card.append(el('div', { className: 'muted', text: r.error ?? '縮小失敗' }));
        continue;
      }
      const img = await loadImage(r.png);
      if (my !== token) return;
      const view = pixelCanvas(img, displayScale(r.w, r.h, RESULT_BOX));
      view.className = 'px-view';
      const base = `${meta?.name ?? 'pixel'}_${cid}_${r.method}`;
      const palette = r.palette ?? [];
      const btn = (text: string, onClick: () => void) => {
        const b = el('button', { text });
        b.addEventListener('click', onClick);
        return b;
      };
      const swatches = el('div', { className: 'px-palette' }, palette.map((hex) => {
        const s = el('span', { title: hex });
        s.style.background = hex;
        return s;
      }));
      card.append(view, el('div', { className: 'muted small', text: `${r.w}×${r.h} · ${palette.length} 色` }), swatches,
        el('div', { className: 'row' }, [
          btn('原尺寸 PNG', () => download(r.png!, `${base}.png`)),
          btn(`放大 ×${ZOOM_EXPORT}`, () => download(pixelCanvas(img, ZOOM_EXPORT).toDataURL('image/png'), `${base}_x${ZOOM_EXPORT}.png`)),
          btn('調色盤 .gpl', () => {
            const url = URL.createObjectURL(new Blob([toGpl(base, palette)], { type: 'text/plain' }));
            download(url, `${base}.gpl`);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }),
        ]));
    }
    if (my === token) resultGrid.replaceChildren(...cards);
  }

  async function pixelate() {
    if (!meta || !selected) return;
    const name = meta.name;
    const cid = selected;
    const colors = Number(colorsInput.value);
    const my = ++token;
    await run('縮小中…', async () => {
      const res = await api.pixel.pixelate(name, cid, colors);
      if (my !== token) return;
      colorsInput.value = String(res.colors);
      await renderResults(res.results, cid);
    });
  }

  function selectCandidate(cid: string | null) {
    if (busy) return;
    selected = cid;
    token++;
    resultGrid.replaceChildren();
    const c = meta?.candidates.find((x) => x.id === cid);
    if (c) colorsInput.value = String(c.colors);
    renderWork();
    sync();
    if (c) void pixelate();
  }

  // ---- 作品 ----
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

  function setMeta(next: PixelWorkMeta | null) {
    meta = next;
    if (selected && !meta?.candidates.some((c) => c.id === selected)) {
      selected = null;
      token++;
      resultGrid.replaceChildren();
    }
    renderWork();
    sync();
  }

  async function openWork(name: string) {
    if (busy) {
      workSel.value = meta?.name ?? '';
      return;
    }
    selected = null;
    token++;
    resultGrid.replaceChildren();
    if (!name) {
      setMeta(null);
      history.replaceState(null, '', '#/pixel');
      return;
    }
    await run('載入中…', async () => {
      setMeta(await api.pixel.getWork(name));
      workSel.value = name;
      history.replaceState(null, '', `#/pixel?work=${encodeURIComponent(name)}`);
    });
    const last = meta?.candidates.at(-1);
    if (last) selectCandidate(last.id);
  }

  async function deleteWork() {
    if (!meta || busy) return;
    const name = meta.name;
    if (!confirmDelete(`作品「${name}」(含來源圖與所有 AI 候選)`)) return;
    await run('刪除中…', async () => {
      await api.pixel.deleteWork(name);
      selected = null;
      token++;
      resultGrid.replaceChildren();
      setMeta(null);
      history.replaceState(null, '', '#/pixel');
      await refreshWorks('');
      showBanner(banner, 'info', `已刪除作品「${name}」`);
    });
  }

  async function deleteCandidate(cid: string) {
    if (!meta || busy) return;
    const name = meta.name;
    if (!confirmDelete(`候選 ${cid}`)) return;
    await run('刪除中…', async () => setMeta(await api.pixel.deleteCandidate(name, cid)));
  }

  async function generate() {
    if (!meta) return;
    const name = meta.name;
    const { cols, rows } = cells();
    const colors = Number(genColors.value);
    if (!Number.isInteger(colors) || colors < 2 || colors > 64) {
      showBanner(banner, 'error', '色數請填 2~64 的整數');
      return;
    }
    let first: string | null = null;
    await run('AI 重畫中…(約 15~60 秒)', async () => {
      const res = await api.pixel.addCandidates(name, {
        mode, model: modelSel.value as PixelModel, cols: mode === 'grid' ? cols : 0, rows: mode === 'grid' ? rows : 0,
        colors, note: note.value, count: Number(countSel.value),
      });
      setMeta(res.meta);
      first = res.candidates[0]?.id ?? null;
      if (res.errors.length) showBanner(banner, 'warn', res.errors.join('; '));
    });
    if (first) selectCandidate(first);
  }

  workSel.addEventListener('change', () => void openWork(workSel.value));
  deleteWorkBtn.addEventListener('click', () => void deleteWork());
  genBtn.addEventListener('click', () => void generate());
  redoBtn.addEventListener('click', () => void pixelate());
  colorsInput.addEventListener('change', () => void pixelate());
  modelSel.addEventListener('change', sync);
  countSel.addEventListener('change', sync);
  createBtn.addEventListener('click', () => void run('建立中…', async () => {
    const name = nameInput.value.trim();
    const file = fileInput.files?.[0];
    if (!name) throw new Error('請輸入作品名稱');
    const source = file ? { file } : packSel.value ? { pack: packSel.value } : shopSel.value ? { workshop: shopSel.value } : null;
    if (!source) throw new Error('請選擇圖片、分層包或部位工坊結果');
    const m = await api.pixel.createWork(name, source);
    nameInput.value = '';
    fileInput.value = '';
    await refreshWorks(m.name);
    busy = false;
    await openWork(m.name);
  }));

  resetColors();
  renderWork();
  sync();
  void (async () => {
    try {
      falOk = (await api.getStatus()).fal;
      await Promise.all([refreshWorks(), refreshSources()]);
      if (!falOk) showBanner(banner, 'warn', '沒有設定 FAL_KEY: 可以看已有的候選與重新縮小, 但不能 AI 重畫');
      const want = params.get('work');
      if (want && alive) await openWork(want);
      else sync();
    } catch (e) {
      showBanner(banner, 'error', (e as Error).message);
    }
  })();

  return () => {
    alive = false;
    token++;
  };
}
