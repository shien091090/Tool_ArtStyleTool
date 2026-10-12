/** 像素素材的來源、候選、縮小結果與右側設定; 像素素材頁與流程的像素化節點共用。 */
import { el, option, showBanner } from '../pages/ui';
import { createGridPicker } from './gridPicker';
import {
  candidateLabel, CELL, defaultColors, displayScale, estimateCost, MAX_CELLS, MODEL_LABEL, toGpl, ZOOM_EXPORT,
  type PixelCandidate, type PixelMode, type PixelModel, type PixelResult, type PixelSettings, type PixelWorkMeta,
} from './model';

const RESULT_BOX = 400;
const PICKER_CELL = 18;

/** 作品資料從哪裡來: 像素素材作品或流程節點 */
export interface PixelBackend {
  /** 下載檔名前綴 */
  name: string;
  fileUrl(path: string): string;
  generate(s: PixelSettings): Promise<{ meta: PixelWorkMeta; candidates: PixelCandidate[]; errors: string[] }>;
  deleteCandidate(cid: string): Promise<PixelWorkMeta>;
  pixelate(cid: string, colors: number): Promise<{ results: PixelResult[]; colors: number }>;
}

export interface PixelPanelOptions {
  banner: HTMLElement;
  status: HTMLElement;
  /** 每個縮小結果多一顆按鈕(流程節點的「設為輸出」) */
  resultAction?: { label: string; run: (r: PixelResult, cand: PixelCandidate) => Promise<void> };
  onBusyChange?: (busy: boolean) => void;
  confirmDelete: (what: string) => boolean;
}

export interface PixelPanel {
  main: HTMLElement;
  side: HTMLElement;
  /** 換作品; source 為來源圖網址與說明 */
  setWork(backend: PixelBackend | null, meta: PixelWorkMeta | null, source?: { url: string; label: string } | null): void;
  setFal(ok: boolean): void;
  /** 不能 AI 重畫的原因(例如上游沒有輸出); null = 可以 */
  setBlocked(reason: string | null): void;
  isBusy(): boolean;
  run(label: string, fn: () => Promise<void>): Promise<void>;
  destroy(): void;
}

export function download(href: string, filename: string) {
  const a = el('a');
  a.href = href;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
}

export function loadImage(src: string): Promise<HTMLImageElement> {
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

export function createPixelPanel(opts: PixelPanelOptions): PixelPanel {
  const { banner, status } = opts;
  let backend: PixelBackend | null = null;
  let meta: PixelWorkMeta | null = null;
  let source: { url: string; label: string } | null = null;
  let selected: string | null = null;
  let falOk = false;
  let blocked: string | null = null;
  let busy = false;
  let alive = true;
  let token = 0;
  let mode: PixelMode = 'grid';

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
  const main = el('div', { className: 'px-main' }, [
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
  const picker = createGridPicker(MAX_CELLS, PICKER_CELL, 1, 2, () => {
    resetColors();
    sync();
  });
  const gridSize = el('div', { className: 'px-picker-size' });
  const gridHint = el('div', { className: 'muted small' });
  const gridRow = el('div', { className: 'col' }, [
    el('div', { className: 'muted small', text: '從左上角拖拉選格數(一格 8px)' }), picker.root, gridSize, gridHint,
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
  const side = el('div', { className: 'panel-wrap prop-panel' }, [
    section('尺寸', modeRow, modelRow, gridRow),
    section('重畫', el('label', {}, ['色數', genColors]), note, el('label', {}, ['候選張數', countSel]),
      el('div', { className: 'row' }, [genBtn, costHint])),
  ]);

  const cells = () => picker.get();

  function resetColors() {
    const { cols, rows } = cells();
    genColors.value = String(defaultColors(mode, cols, rows));
  }

  function sync() {
    for (const [m, b] of modeBtns) b.classList.toggle('active', m === mode);
    modelRow.classList.toggle('hidden', mode !== 'auto');
    gridRow.classList.toggle('hidden', mode !== 'grid');
    const { cols, rows } = cells();
    gridSize.replaceChildren(el('b', { text: `寬 ${cols} × 高 ${rows} 格` }),
      el('span', { className: 'muted small', text: `實際尺寸 ${cols * CELL}×${rows * CELL} 像素` }));
    gridHint.textContent = '比例跟原圖不同時 AI 會重新設計, 例如正方形畫成 Q 版。固定用 Nano Banana Pro';
    const cost = estimateCost(mode, modelSel.value as PixelModel, Number(countSel.value));
    costHint.textContent = `約 ${cost.toFixed(2)} 美元`;
    genBtn.disabled = busy || !falOk || !backend || blocked !== null;
    genBtn.title = !falOk ? '沒有設定 FAL_KEY' : blocked ?? '';
    redoBtn.disabled = busy || !selected;
    colorsInput.disabled = busy || !selected;
  }

  async function run(label: string, fn: () => Promise<void>) {
    if (busy) return;
    busy = true;
    status.textContent = label;
    showBanner(banner, null);
    sync();
    opts.onBusyChange?.(true);
    try {
      await fn();
    } catch (e) {
      showBanner(banner, 'error', (e as Error).message);
    } finally {
      busy = false;
      status.textContent = '';
      if (alive) {
        sync();
        opts.onBusyChange?.(false);
      }
    }
  }

  // ---- 顯示 ----
  function renderWork() {
    sourceBox.replaceChildren();
    candList.replaceChildren();
    if (source) {
      const src = el('img');
      src.src = source.url;
      sourceBox.append(src, el('div', { className: 'muted small', text: source.label }));
    } else {
      sourceBox.append(el('div', { className: 'muted', text: blocked ?? '請選擇或建立作品' }));
    }
    if (!backend) return;
    const cands = meta?.candidates ?? [];
    if (!cands.length) candList.append(el('div', { className: 'muted', text: '還沒有候選, 在右側設定後按「AI 重畫」' }));
    for (const c of cands) {
      const img = el('img');
      img.src = backend.fileUrl(`ai/${c.id}.png`);
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

  async function renderResults(results: PixelResult[], cand: PixelCandidate) {
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
      const base = `${backend?.name ?? 'pixel'}_${cand.id}_${r.method}`;
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
      const buttons = [
        btn('原尺寸 PNG', () => download(r.png!, `${base}.png`)),
        btn(`放大 ×${ZOOM_EXPORT}`, () => download(pixelCanvas(img, ZOOM_EXPORT).toDataURL('image/png'), `${base}_x${ZOOM_EXPORT}.png`)),
        btn('調色盤 .gpl', () => {
          const url = URL.createObjectURL(new Blob([toGpl(base, palette)], { type: 'text/plain' }));
          download(url, `${base}.gpl`);
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }),
      ];
      const action = opts.resultAction;
      if (action) {
        const b = btn(action.label, () => void run('設定中…', () => action.run(r, cand)));
        b.className = 'primary';
        buttons.unshift(b);
      }
      card.append(view, el('div', { className: 'muted small', text: `${r.w}×${r.h} · ${palette.length} 色` }), swatches,
        el('div', { className: 'row' }, buttons));
    }
    if (my === token) resultGrid.replaceChildren(...cards);
  }

  async function pixelate() {
    const cand = meta?.candidates.find((c) => c.id === selected);
    if (!backend || !cand) return;
    const be = backend;
    const colors = Number(colorsInput.value);
    const my = ++token;
    await run('縮小中…', async () => {
      const res = await be.pixelate(cand.id, colors);
      if (my !== token) return;
      colorsInput.value = String(res.colors);
      await renderResults(res.results, cand);
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

  async function deleteCandidate(cid: string) {
    if (!backend || busy) return;
    const be = backend;
    if (!opts.confirmDelete(`候選 ${cid}`)) return;
    await run('刪除中…', async () => setMeta(await be.deleteCandidate(cid)));
  }

  async function generate() {
    if (!backend) return;
    const be = backend;
    const { cols, rows } = cells();
    const colors = Number(genColors.value);
    if (!Number.isInteger(colors) || colors < 2 || colors > 64) {
      showBanner(banner, 'error', '色數請填 2~64 的整數');
      return;
    }
    let first: string | null = null;
    await run('AI 重畫中…(約 15~60 秒)', async () => {
      const res = await be.generate({
        mode, model: modelSel.value as PixelModel, cols: mode === 'grid' ? cols : 0, rows: mode === 'grid' ? rows : 0,
        colors, note: note.value, count: Number(countSel.value),
      });
      setMeta(res.meta);
      first = res.candidates[0]?.id ?? null;
      if (res.errors.length) showBanner(banner, 'warn', res.errors.join('; '));
    });
    if (first) selectCandidate(first);
  }

  genBtn.addEventListener('click', () => void generate());
  redoBtn.addEventListener('click', () => void pixelate());
  colorsInput.addEventListener('change', () => void pixelate());
  modelSel.addEventListener('change', sync);
  countSel.addEventListener('change', sync);

  resetColors();
  renderWork();
  sync();

  return {
    main,
    side,
    setWork(be, m, src = null) {
      backend = be;
      source = src;
      selected = null;
      token++;
      resultGrid.replaceChildren();
      setMeta(m);
      const last = m?.candidates.at(-1);
      if (last) selectCandidate(last.id);
    },
    setFal(ok) {
      falOk = ok;
      sync();
    },
    setBlocked(reason) {
      blocked = reason;
      renderWork();
      sync();
    },
    isBusy: () => busy,
    run,
    destroy() {
      alive = false;
      token++;
    },
  };
}
