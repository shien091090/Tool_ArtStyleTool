/** 像素素材的來源、候選、縮小結果與右側設定(直接轉換、AI 重畫); 像素素材頁與流程的像素化節點共用。 */
import { costNote, markPaid, el, option, showBanner } from '../pages/ui';
import { COST, usd } from '../cost';
import { createGridPicker } from './gridPicker';
import {
  candidateLabel, CELL, defaultColors, defaultConvertColors, displayScale, estimateCost, isSmall, MAX_CELLS, MAX_EYES,
  MODEL_LABEL, modelReason, pickModel, toGpl, ZOOM_EXPORT,
  type ConvertSettings, type EyeMark, type PixelCandidate, type PixelMethod, type PixelResult, type PixelSettings,
  type PixelWorkMeta, type SizeSuggestion,
} from './model';

const RESULT_BOX = 400;
const PICKER_CELL = 18;
/** 只點不拖時的眼睛半徑(相對長邊) */
const EYE_DEFAULT_R = 0.03;
const EYE_MIN_R = 0.002;
const EYE_MAX_R = 0.5;

/** 作品資料從哪裡來: 像素素材作品或流程節點 */
export interface PixelBackend {
  /** 下載檔名前綴 */
  name: string;
  fileUrl(path: string): string;
  generate(s: PixelSettings): Promise<{ meta: PixelWorkMeta; candidates: PixelCandidate[]; errors: string[] }>;
  deleteCandidate(cid: string): Promise<PixelWorkMeta>;
  pixelate(cid: string, colors: number): Promise<{ results: PixelResult[]; colors: number }>;
  convert(s: ConvertSettings): Promise<{ meta: PixelWorkMeta; candidate: PixelCandidate }>;
  suggestSizes(): Promise<{ sizes: SizeSuggestion[] }>;
}

export interface PixelPanelOptions {
  banner: HTMLElement;
  status: HTMLElement;
  /** 每個縮小結果多一顆主要按鈕(流程節點的「設為輸出」) */
  resultAction?: { label: string; run: (r: PixelResult, cand: PixelCandidate, colors: number) => Promise<void> };
  onBusyChange?: (busy: boolean) => void;
  confirmDelete: (what: string) => boolean;
}

export interface PixelPanel {
  main: HTMLElement;
  side: HTMLElement;
  /** 換作品; source 為來源圖網址與說明 */
  setWork(backend: PixelBackend | null, meta: PixelWorkMeta | null, source?: { url: string; label: string } | null): void;
  setFal(ok: boolean): void;
  /** 不能轉換的原因(例如上游沒有輸出); null = 可以 */
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

function numberInput(): HTMLInputElement {
  const i = el('input');
  i.type = 'number';
  i.min = '2';
  i.max = '64';
  return i;
}

function seg<T extends string>(items: [T, string][], onPick: (v: T) => void) {
  const btns = items.map(([v, text]) => {
    const b = el('button', { text });
    b.addEventListener('click', () => onPick(v));
    return [v, b] as const;
  });
  return {
    root: el('div', { className: 'seg' }, btns.map(([, b]) => b)),
    sync: (cur: T) => btns.forEach(([v, b]) => b.classList.toggle('active', v === cur)),
  };
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
  /** 每張候選目前選的頁籤(縮小方式的索引), 預設第一個 */
  const tabs = new Map<string, number>();
  /** 預覽圖更新過幾次, 加在網址上避免讀到舊圖 */
  const previewVer = new Map<string, number>();
  /** 選中候選的縮小結果(切頁籤時直接用, 不再叫後端) */
  let shown: { cand: PixelCandidate; results: PixelResult[] } | null = null;
  let method: PixelMethod = 'convert';
  let sizeMode: 'grid' | 'auto' = 'auto';
  let suggestions: SizeSuggestion[] | null = null;
  let eyes: EyeMark[] = [];
  let marking = false;
  /** renderWork 建立的來源圖重畫眼睛標記用 */
  let placeMarks = () => {};

  // ---- 中間: 來源、候選、縮小結果 ----
  const sourceBox = el('div', { className: 'px-source' });
  const candList = el('div', { className: 'px-cands' });
  const colorsInput = numberInput();
  const redoBtn = el('button', { text: '重新縮小' });
  const resultGrid = el('div', { className: 'px-results' });
  const resultHead = el('div', { className: 'row' }, [el('label', {}, ['色數', colorsInput]), redoBtn,
    el('span', { className: 'muted small', text: '在本機縮小, 不花錢; 匯出的原尺寸 PNG 可直接用 Aseprite 修' })]);
  const main = el('div', { className: 'px-main' }, [
    el('h3', { text: '來源' }), sourceBox,
    el('h3', { text: '候選' }), candList,
    el('h3', { text: '結果' }), resultHead, resultGrid,
  ]);

  // ---- 右側: 轉換方式 ----
  const methodSeg = seg<PixelMethod>([['convert', '直接轉換(免費)'], ['ai', 'AI 重畫(付費)']], (v) => {
    method = v;
    sync();
  });

  // ---- 右側: 尺寸 ----
  const sizeSeg = seg<'grid' | 'auto'>([['auto', '自動尺寸'], ['grid', '指定格數']], (v) => {
    sizeMode = v;
    sync();
  });
  const picker = createGridPicker(MAX_CELLS, PICKER_CELL, 4, 6, () => {
    resetColors();
    sync();
  });
  const gridSize = el('div', { className: 'px-picker-size' });
  const gridRow = el('div', { className: 'col' }, [
    el('div', { className: 'muted small', text: '從左上角拖拉選格數(一格 8px)' }), picker.root, gridSize,
  ]);
  const suggestBtn = markPaid(el('button', { text: '請 AI 建議尺寸' }));
  const suggestList = el('div', { className: 'px-suggests' });
  const autoRow = el('div', { className: 'col' }, [
    el('div', { className: 'row' }, [suggestBtn, costNote(usd(COST.vision))]),
    suggestList,
  ]);

  // ---- 右側: 直接轉換 ----
  const convColors = numberInput();
  const outline = el('input');
  outline.type = 'checkbox';
  outline.checked = true;
  const markBtn = el('button');
  const eyeList = el('div', { className: 'px-eye-list' });
  const eyeHint = el('div', { className: 'muted small' });
  const convBtn = el('button', { text: '直接轉換', className: 'primary' });

  // ---- 右側: AI 重畫 ----
  const modelInfo = el('div', { className: 'px-model' });
  const smallHint = el('div', { className: 'px-warn small' });
  const genColors = numberInput();
  const note = el('textarea');
  note.rows = 2;
  note.maxLength = 200;
  note.placeholder = '補充描述(選填), 例如「劍要保留」';
  const countSel = el('select');
  for (const n of [1, 2, 3, 4]) countSel.append(option(String(n), `${n} 張`));
  const genBtn = markPaid(el('button', { text: 'AI 重畫', className: 'primary' }));
  const costHint = costNote();

  const section = (title: string, ...children: (Node | string)[]) =>
    el('section', { className: 'prop-section' }, [el('h3', { text: title }), ...children]);
  const convertSection = section('直接轉換',
    el('div', { className: 'muted small', text: '不叫 AI, 在本機幾秒轉好; 小尺寸效果最好' }),
    el('label', {}, ['色數', convColors]), el('label', {}, [outline, '加外框']),
    el('div', { className: 'row' }, [el('span', { text: '眼睛' }), markBtn]), eyeList, eyeHint,
    el('div', { className: 'row' }, [convBtn]));
  const aiSection = section('AI 重畫', modelInfo, smallHint,
    el('label', {}, ['色數', genColors]), note, el('label', {}, ['候選張數', countSel]),
    el('div', { className: 'row' }, [genBtn, costHint]));
  const side = el('div', { className: 'panel-wrap prop-panel' }, [
    section('轉換方式', methodSeg.root),
    section('尺寸', sizeSeg.root, gridRow, autoRow),
    convertSection,
    aiSection,
  ]);

  const cells = () => picker.get();

  function resetColors() {
    const { cols, rows } = cells();
    genColors.value = String(defaultColors('grid', cols, rows));
    convColors.value = String(defaultConvertColors(cols, rows));
  }

  function renderSuggestions() {
    if (!suggestions) {
      suggestList.replaceChildren();
      return;
    }
    const { cols, rows } = cells();
    suggestList.replaceChildren(...suggestions.map((s) => {
      const card = el('button', { className: `px-suggest${s.cols === cols && s.rows === rows ? ' active' : ''}` }, [
        el('b', { text: `${s.cols * CELL}×${s.rows * CELL} 像素 · ${s.colors} 色` }),
        el('span', { className: 'muted small', text: s.reason || `寬 ${s.cols} × 高 ${s.rows} 格` }),
      ]);
      card.addEventListener('click', () => {
        picker.set(s.cols, s.rows);
        convColors.value = String(s.colors);
        genColors.value = String(s.colors);
        sync();
      });
      return card;
    }));
  }

  function renderEyes() {
    eyeList.replaceChildren(...eyes.map((_, i) => {
      const del = el('button', { text: '×', className: 'variant-del', title: '刪除這個眼睛' });
      del.addEventListener('click', () => {
        eyes = eyes.filter((__, j) => j !== i);
        placeMarks();
        sync();
      });
      return el('div', { className: 'px-eye-item' }, [el('span', { className: 'px-eye-no', text: String(i + 1) }), `眼睛 ${i + 1}`, del]);
    }));
  }

  function sync() {
    methodSeg.sync(method);
    sizeSeg.sync(sizeMode);
    const { cols, rows } = cells();
    gridRow.classList.toggle('hidden', sizeMode !== 'grid');
    autoRow.classList.toggle('hidden', sizeMode !== 'auto');
    gridSize.replaceChildren(el('b', { text: `寬 ${cols} × 高 ${rows} 格` }),
      el('span', { className: 'muted small', text: `實際尺寸 ${cols * CELL}×${rows * CELL} 像素` }));
    suggestBtn.disabled = busy || !falOk || !backend || blocked !== null;
    suggestBtn.title = !falOk ? '沒有設定 FAL_KEY' : blocked ?? '';
    suggestBtn.textContent = suggestions ? '重新建議' : '請 AI 建議尺寸';
    renderSuggestions();

    convertSection.classList.toggle('hidden', method !== 'convert');
    aiSection.classList.toggle('hidden', method !== 'ai');

    convBtn.disabled = busy || !backend || blocked !== null;
    convBtn.title = blocked ?? '';
    markBtn.disabled = busy || !source || (!marking && eyes.length >= MAX_EYES);
    markBtn.textContent = marking ? '完成' : '+ 標記眼睛';
    markBtn.classList.toggle('primary', marking);
    renderEyes();
    eyeHint.textContent = marking ? `在來源圖的眼睛上按住拖出圓, 可連續標(最多 ${MAX_EYES} 個)`
      : eyes.length ? '轉換時會重畫成圓形虹膜與瞳孔' : '選填: 眼睛轉完常糊掉, 標記後會重畫';

    const model = pickModel(cols, rows);
    modelInfo.replaceChildren(el('span', { text: '使用模型: ' }), el('b', { text: MODEL_LABEL[model] }),
      el('div', { className: 'muted small', text: `依尺寸自動選: ${modelReason(cols, rows)}` }));
    smallHint.textContent = isSmall(cols, rows) ? '這個尺寸直接轉換通常比 AI 好' : '';
    smallHint.classList.toggle('hidden', !isSmall(cols, rows));
    costHint.textContent = usd(estimateCost(cols, rows, Number(countSel.value)));
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

  // ---- 來源圖與眼睛標記 ----
  function renderSource() {
    sourceBox.replaceChildren();
    placeMarks = () => {};
    if (!source) {
      sourceBox.append(el('div', { className: 'muted', text: blocked ?? '請選擇或建立作品' }));
      return;
    }
    const src = el('img');
    src.draggable = false;
    src.src = source.url;
    const layer = el('div', { className: 'px-eye-layer' });
    const wrap = el('div', { className: `px-src-wrap${marking ? ' marking' : ''}` }, [src, layer]);
    placeMarks = () => {
      if (!src.clientWidth) return;
      const long = Math.max(src.clientWidth, src.clientHeight);
      layer.replaceChildren(...eyes.map((eye, i) => {
        const r = eye.r * long;
        const mark = el('div', { className: 'px-eye' }, [el('span', { text: String(i + 1) })]);
        Object.assign(mark.style, {
          left: `${eye.x * src.clientWidth - r}px`, top: `${eye.y * src.clientHeight - r}px`, width: `${2 * r}px`, height: `${2 * r}px`,
        });
        return mark;
      }));
    };
    src.addEventListener('load', () => placeMarks());
    src.addEventListener('pointerdown', (e) => {
      if (!marking || e.button !== 0 || eyes.length >= MAX_EYES) return;
      e.preventDefault();
      src.setPointerCapture(e.pointerId);
      const rect = src.getBoundingClientRect();
      const long = Math.max(rect.width, rect.height);
      const cx = e.clientX;
      const cy = e.clientY;
      const eye: EyeMark = { x: (cx - rect.left) / rect.width, y: (cy - rect.top) / rect.height, r: EYE_DEFAULT_R };
      eyes = [...eyes, eye];
      let dragged = false;
      const move = (ev: PointerEvent) => {
        const d = Math.hypot(ev.clientX - cx, ev.clientY - cy);
        if (d < 3 && !dragged) return;
        dragged = true;
        eye.r = Math.min(EYE_MAX_R, Math.max(EYE_MIN_R, d / long));
        placeMarks();
      };
      const up = () => {
        src.removeEventListener('pointermove', move);
        src.removeEventListener('pointerup', up);
        if (eyes.length >= MAX_EYES) setMarking(false);
        else sync();
      };
      placeMarks();
      src.addEventListener('pointermove', move);
      src.addEventListener('pointerup', up);
    });
    sourceBox.append(wrap, el('div', { className: 'muted small', text: source.label }));
  }

  function setMarking(on: boolean) {
    marking = on;
    sourceBox.querySelector('.px-src-wrap')?.classList.toggle('marking', on);
    requestAnimationFrame(() => placeMarks());
    sync();
  }

  // ---- 候選與結果 ----
  function renderCandidates() {
    candList.replaceChildren();
    if (!backend) return;
    const cands = meta?.candidates ?? [];
    if (!cands.length) candList.append(el('div', { className: 'muted', text: '還沒有候選, 在右側設定後按「直接轉換」或「AI 重畫」' }));
    for (const c of cands) {
      const items = c.previews?.items ?? [];
      const tab = tabIndex(c);
      const img = el('img');
      if (items.length) {
        const url = backend.fileUrl(`ai/${c.id}_${items[tab].method}.png`);
        img.src = `${url}${url.includes('?') ? '&' : '?'}p=${previewVer.get(c.id) ?? 0}`;
        img.classList.add('pixelated');
      } else {
        img.src = backend.fileUrl(`ai/${c.id}.png`);
      }
      const tabRow = el('div', { className: 'px-tabs' }, items.length > 1 ? items.map((it, i) => {
        const b = el('button', { text: String(i + 1), title: it.label, className: i === tab ? 'active' : '' });
        b.addEventListener('click', (ev) => {
          ev.stopPropagation();
          setTab(c.id, i);
        });
        return b;
      }) : []);
      const methodName = el('span', { className: 'px-cand-method', text: items[tab]?.label ?? '' });
      const item = el('div', { className: `px-cand${c.id === selected ? ' active' : ''}`, title: c.note }, [
        methodName, img, tabRow, el('span', { text: candidateLabel(c) }),
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

  function renderWork() {
    renderSource();
    renderCandidates();
  }

  function tabIndex(c: PixelCandidate): number {
    const n = c.previews?.items.length ?? 0;
    return Math.max(0, Math.min(tabs.get(c.id) ?? 0, n - 1));
  }

  function setTab(cid: string, i: number) {
    if (busy) return;
    tabs.set(cid, i);
    if (cid !== selected) {
      selectCandidate(cid);
      return;
    }
    renderCandidates();
    if (shown) void renderResults(shown.results, shown.cand);
  }

  /** 結果區顯示選中候選目前頁籤的那一種縮小方式 */
  async function renderResults(results: PixelResult[], cand: PixelCandidate) {
    const my = ++token;
    shown = { cand, results };
    const want = cand.previews?.items[tabIndex(cand)]?.method;
    const r = results.find((x) => x.method === want) ?? results[0];
    const cards: HTMLElement[] = [];
    if (r) {
      const card = el('div', { className: 'px-result' }, [el('div', { className: 'sel-title', text: r.label })]);
      cards.push(card);
      if (r.error || !r.png || !r.w || !r.h) {
        card.append(el('div', { className: 'muted', text: r.error ?? '縮小失敗' }));
        resultGrid.replaceChildren(...cards);
        return;
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
      const action = opts.resultAction;
      if (action) {
        const colors = Number(colorsInput.value);
        const b = btn(action.label, () => void run('設定中…', () => action.run(r, cand, colors)));
        b.className = 'primary px-main-action';
        card.append(b);
      }
      card.append(view, el('div', { className: 'muted small', text: `${r.w}×${r.h} · ${palette.length} 色` }), swatches,
        el('div', { className: 'px-export' }, [
          el('span', { className: 'muted small', text: '匯出' }),
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
    const cand = meta?.candidates.find((c) => c.id === selected);
    if (!backend || !cand) return;
    const be = backend;
    const colors = Number(colorsInput.value);
    const my = ++token;
    await run('縮小中…', async () => {
      const res = await be.pixelate(cand.id, colors);
      if (my !== token) return;
      colorsInput.value = String(res.colors);
      // 後端已把各方式的結果存成預覽圖, 這裡同步候選縮圖
      cand.previews = { colors: res.colors, items: res.results.filter((r) => r.png).map(({ method, label }) => ({ method, label })) };
      previewVer.set(cand.id, (previewVer.get(cand.id) ?? 0) + 1);
      renderCandidates();
      await renderResults(res.results, cand);
    });
  }

  function selectCandidate(cid: string | null) {
    if (busy) return;
    selected = cid;
    token++;
    shown = null;
    resultGrid.replaceChildren();
    const c = meta?.candidates.find((x) => x.id === cid);
    if (c) colorsInput.value = String(c.colors);
    renderCandidates();
    sync();
    if (c) void pixelate();
  }

  function setMeta(next: PixelWorkMeta | null) {
    meta = next;
    if (selected && !meta?.candidates.some((c) => c.id === selected)) {
      selected = null;
      token++;
      shown = null;
      resultGrid.replaceChildren();
    }
    renderCandidates();
    sync();
  }

  async function deleteCandidate(cid: string) {
    if (!backend || busy) return;
    const be = backend;
    if (!opts.confirmDelete(`候選 ${cid}`)) return;
    await run('刪除中…', async () => setMeta(await be.deleteCandidate(cid)));
  }

  function readColors(input: HTMLInputElement): number | null {
    const colors = Number(input.value);
    if (!Number.isInteger(colors) || colors < 2 || colors > 64) {
      showBanner(banner, 'error', '色數請填 2~64 的整數');
      return null;
    }
    return colors;
  }

  async function generate() {
    if (!backend) return;
    const be = backend;
    const { cols, rows } = cells();
    const colors = readColors(genColors);
    if (colors === null) return;
    let first: string | null = null;
    await run(`AI 重畫中(${MODEL_LABEL[pickModel(cols, rows)]}, 約 15~60 秒)…`, async () => {
      const res = await be.generate({ cols, rows, colors, note: note.value, count: Number(countSel.value) });
      setMeta(res.meta);
      first = res.candidates[0]?.id ?? null;
      if (res.errors.length) showBanner(banner, 'warn', res.errors.join('; '));
    });
    if (first) selectCandidate(first);
  }

  async function convert() {
    if (!backend) return;
    const be = backend;
    const { cols, rows } = cells();
    const colors = readColors(convColors);
    if (colors === null) return;
    if (marking) setMarking(false);
    let first: string | null = null;
    await run('轉換中…', async () => {
      const res = await be.convert({ cols, rows, colors, outline: outline.checked, eyes });
      setMeta(res.meta);
      first = res.candidate.id;
    });
    if (first) selectCandidate(first);
  }

  async function suggestSizes() {
    if (!backend) return;
    const be = backend;
    await run('AI 建議尺寸中…', async () => {
      suggestions = (await be.suggestSizes()).sizes;
      const s = suggestions[0];
      if (s) {
        picker.set(s.cols, s.rows);
        convColors.value = String(s.colors);
        genColors.value = String(s.colors);
      }
    });
  }

  genBtn.addEventListener('click', () => void generate());
  convBtn.addEventListener('click', () => void convert());
  suggestBtn.addEventListener('click', () => void suggestSizes());
  markBtn.addEventListener('click', () => setMarking(!marking));
  redoBtn.addEventListener('click', () => void pixelate());
  colorsInput.addEventListener('change', () => void pixelate());
  countSel.addEventListener('change', sync);

  resetColors();
  renderWork();
  sync();

  return {
    main,
    side,
    setWork(be, m, src = null) {
      backend = be;
      if (src?.url !== source?.url) {
        eyes = [];
        marking = false;
        suggestions = null;
      }
      source = src;
      selected = null;
      token++;
      shown = null;
      resultGrid.replaceChildren();
      renderSource();
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
