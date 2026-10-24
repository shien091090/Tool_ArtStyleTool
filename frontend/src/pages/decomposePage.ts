import { api, type PackApi, type PackMeta, type RGB } from '../api';
import { hexToRgb, rgbToHex } from '../colorMath';
import { runningJob, trackJob } from '../jobs';
import { costNote, markPaid, el, option, showBanner } from './ui';
import { COST, usd } from '../cost';

const STEP_ORDER = ['depth', 'normal', 'normal_detail', 'line', 'line_sdf', 'regions', 'flat', 'shade', 'ao', 'silhouette_sdf'];

function originLabel(origin: string | undefined): string {
  if (!origin) return '尚未產生';
  if (origin.startsWith('ai:')) return `AI: ${origin.split('/').pop()}`;
  return origin === 'user' ? '使用者上傳' : '本機計算';
}

interface Cell {
  layer: 'source' | 'line' | 'flat' | 'normal';
  title: string;
  root: HTMLElement;
  origin: HTMLElement;
  stale: HTMLElement;
  view: HTMLElement;
}

/** 改風格節點的設定: 節點固定一個分層包 */
export interface DecomposeEmbed {
  api: PackApi;
  load(): Promise<PackMeta>;
  banner: HTMLElement;
  status: HTMLElement;
  /** 進行中 AI 工作的識別(離開再回來時接續) */
  jobKey: string;
  /** 分層包改過(拆解、改色) */
  onChange?(meta: PackMeta): void;
}

/** 拆解檢查(改風格節點的「拆解」分頁)。 */
export function mountDecomposePage(root: HTMLElement, embed: DecomposeEmbed): () => void {
  const papi = embed.api;
  let meta: PackMeta | null = null;
  let busy = false;

  const { banner, status } = embed;
  const falBanner = el('div');
  const runAllBtn = markPaid(el('button', { text: '全部拆解', className: 'primary' }));
  const overlayChk = el('input');
  overlayChk.type = 'checkbox';
  const overlayOpacity = el('input');
  overlayOpacity.type = 'range';
  overlayOpacity.min = '0';
  overlayOpacity.max = '1';
  overlayOpacity.step = '0.05';
  overlayOpacity.value = '0.7';

  // ---- 四格 ----
  const normalView = el('select');
  normalView.append(option('normal', '看大形'), option('normal_detail', '看細部'));
  normalView.addEventListener('change', () => renderCells());

  /** 線稿去雜線程度, 對應後端 lines.CLEAN_DEFAULT_LEVEL / CLEAN_MAX_LEVEL */
  const CLEAN_DEFAULT = 5;
  const cleanLevel = el('input');
  cleanLevel.type = 'range';
  cleanLevel.min = '0';
  cleanLevel.max = '10';
  cleanLevel.step = '1';
  cleanLevel.value = String(CLEAN_DEFAULT);
  const cleanValue = el('span', { text: String(CLEAN_DEFAULT) });
  cleanLevel.addEventListener('input', () => { cleanValue.textContent = cleanLevel.value; });
  cleanLevel.addEventListener('change', () => step('整理線稿', [['line_clean', { level: Number(cleanLevel.value) }]]));

  const actions: (HTMLButtonElement | HTMLInputElement)[] = [runAllBtn, cleanLevel];
  const button = (text: string, onClick: () => void) => {
    const b = el('button', { text });
    b.addEventListener('click', onClick);
    actions.push(b);
    return b;
  };
  const makeCell = (layer: Cell['layer'], title: string, controls: (Node | string)[]): Cell => {
    const origin = el('div', { className: 'origin' });
    const stale = el('span', { className: 'tag-stale' });
    const view = el('div', { className: 'view' });
    const rootEl = el('section', { className: 'cell' }, [
      el('header', {}, [
        el('div', { className: 'title' }, [el('strong', { text: title }), stale]),
        origin,
        el('div', { className: 'controls' }, controls),
      ]),
      view,
    ]);
    return { layer, title, root: rootEl, origin, stale, view };
  };

  const cells: Cell[] = [
    makeCell('source', '原圖', []),
    makeCell('line', '線稿', [
      markPaid(button('重跑', () => step('重跑線稿', [['line', { level: Number(cleanLevel.value) }]]))), costNote(usd(COST.line)),
      el('label', {}, ['去雜線', cleanLevel, cleanValue]),
      el('span', { className: 'muted', text: '拉動會重新整理線稿並重新分格平塗(免費), 平塗改過的顏色會重設' }),
    ]),
    makeCell('flat', '平塗', [
      markPaid(button('重畫', () => step('重畫平塗', [['regions', {}], ['flat', {}]]))), costNote(usd(COST.gptImage)),
      button('復原', () => undoColor()), button('重做', () => redoColor()),
      el('span', { className: 'muted', text: 'GPT Image 2 畫平塗, 再依線稿分格上色; 點圖上的區塊可以改色(Ctrl+Z 復原、Ctrl+Y 重做)' }),
    ]),
    makeCell('normal', '法線', [
      normalView,
      markPaid(button('重跑', () => step('重跑法線', [['depth', {}], ['normal', {}], ['normal_detail', {}]]))),
      costNote(`${usd(COST.depth)}(含 AI 深度)`),
      el('span', {
        className: 'muted',
        text: '渲染時兩張都會用: 大形決定整體明暗, 細部疊上去; 各自強度在渲染頁的「大形立體感」「細部立體感」調',
      }),
    ]),
  ];
  cells[2].root.classList.add('clickable');

  const runAllCost = costNote(`最多${usd(COST.depth + COST.line + COST.gptImage)}(只跑還沒跑過的步驟)`);
  const overlayBar = [el('label', {}, [overlayChk, '疊上線稿比對']), el('label', {}, ['不透明度', overlayOpacity])];
  root.append(falBanner, el('div', { className: 'toolbar' }, [runAllBtn, runAllCost, el('span', { className: 'spacer' }), ...overlayBar]),
    el('div', { className: 'cells' }, cells.map((c) => c.root)));

  // ---- 區塊改色 ----
  const popColor = el('input');
  popColor.type = 'color';
  const popLabel = el('span');
  const popClose = el('button', { text: '關閉' });
  const pop = el('div', { className: 'region-pop hidden' }, [popLabel, popColor, popClose]);
  document.body.append(pop);
  let popRegion = 0;
  popClose.addEventListener('click', () => pop.classList.add('hidden'));
  popColor.addEventListener('change', () => {
    if (!meta || !popRegion) return;
    const region = popRegion;
    const before = meta.regions?.colors[String(region)];
    const after = hexToRgb(popColor.value) as RGB;
    if (before) {
      syncHistory();
      undoStack.push({ region, before, after });
      redoStack = [];
    }
    run(`區塊 ${region} 改色`, () => papi.setRegionColor(meta!.name, region, after));
  });

  // ---- 改色復原 ----
  interface ColorEdit { region: number; before: RGB; after: RGB }
  let undoStack: ColorEdit[] = [];
  let redoStack: ColorEdit[] = [];
  let historyKey = '';
  /** 區塊重畫過, 編號對不上了, 清空復原紀錄 */
  function syncHistory() {
    const key = meta ? `${meta.name}|${meta.layers.regions?.updated ?? ''}` : '';
    if (key !== historyKey) {
      undoStack = [];
      redoStack = [];
      historyKey = key;
    }
  }
  function applyColor(edit: ColorEdit, color: RGB, label: string) {
    if (!meta) return;
    if (popRegion === edit.region) popColor.value = rgbToHex(color);
    void run(`${label}區塊 ${edit.region} 改色`, () => papi.setRegionColor(meta!.name, edit.region, color));
  }
  function undoColor() {
    if (busy) return;
    syncHistory();
    const edit = undoStack.pop();
    if (!edit) { showBanner(banner, 'info', '沒有可以復原的改色'); return; }
    redoStack.push(edit);
    applyColor(edit, edit.before, '復原');
  }
  function redoColor() {
    if (busy) return;
    syncHistory();
    const edit = redoStack.pop();
    if (!edit) { showBanner(banner, 'info', '沒有可以重做的改色'); return; }
    undoStack.push(edit);
    applyColor(edit, edit.after, '重做');
  }
  const onKey = (e: KeyboardEvent) => {
    if (!meta || !root.isConnected || !(e.ctrlKey || e.metaKey)) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); undoColor(); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redoColor(); }
  };
  document.addEventListener('keydown', onKey);

  async function onFlatClick(e: MouseEvent) {
    if (!meta || busy) return;
    const img = e.currentTarget as HTMLImageElement;
    const x = Math.floor((e.offsetX / img.clientWidth) * meta.width);
    const y = Math.floor((e.offsetY / img.clientHeight) * meta.height);
    try {
      const info = await papi.regionAt(meta.name, x, y);
      popRegion = info.id;
      popLabel.textContent = `區塊 ${info.id}`;
      popColor.value = info.color ? rgbToHex(info.color) : '#808080';
      pop.style.left = `${Math.min(e.clientX + 12, window.innerWidth - 220)}px`;
      pop.style.top = `${Math.min(e.clientY + 12, window.innerHeight - 60)}px`;
      pop.classList.remove('hidden');
    } catch (err) {
      showBanner(banner, 'error', (err as Error).message);
    }
  }

  // ---- 畫面更新 ----
  function renderCells() {
    for (const c of cells) c.view.replaceChildren();
    if (!meta) return;
    const m = meta;
    const lineInfo = m.layers.line;
    const level = lineInfo?.level ?? CLEAN_DEFAULT;
    cleanLevel.value = String(level);
    cleanValue.textContent = String(level);
    for (const c of cells) {
      const shown = c.layer === 'normal' ? normalView.value : c.layer;
      const info = m.layers[shown];
      c.origin.textContent = originLabel(info?.origin);
      c.stale.textContent = info?.stale ? '已過期' : '';
      if (!info) {
        c.view.append(el('div', { className: 'empty', text: '尚未產生' }));
        continue;
      }
      const img = el('img');
      img.src = papi.fileUrl(m.name, shown, info.updated);
      img.alt = c.title;
      const stack = el('div', { className: 'stack' }, [img]);
      if (overlayChk.checked && lineInfo && c.layer !== 'line') {
        const ov = el('img', { className: 'overlay' });
        ov.src = papi.fileUrl(m.name, 'line', lineInfo.updated);
        ov.style.opacity = overlayOpacity.value;
        stack.append(ov);
      }
      if (c.layer === 'flat') img.addEventListener('click', onFlatClick);
      c.view.append(stack);
    }
    const staleCount = STEP_ORDER.filter((s) => m.layers[s]?.stale).length;
    const missing = STEP_ORDER.filter((s) => !m.layers[s]).length;
    status.textContent = missing ? `還有 ${missing} 步未完成` : staleCount ? `有 ${staleCount} 層已過期` : '拆解完成';
  }

  function setBusy(on: boolean, text = '') {
    busy = on;
    for (const b of actions) b.disabled = on;
    if (on) status.textContent = text;
  }

  /** 會呼叫 fal.ai 的步驟, 顯示在上方進度列 */
  const AI_LABELS = ['拆解', '重跑線稿', '重跑法線', '重畫平塗'];

  async function run(label: string, fn: () => Promise<PackMeta>) {
    setBusy(true, `${label}中…可能需要一兩分鐘`);
    showBanner(banner, null);
    try {
      meta = await (AI_LABELS.includes(label) ? trackJob(`AI ${label}中(約一兩分鐘)…`, embed.jobKey, fn) : fn());
      embed.onChange?.(meta);
    } catch (e) {
      showBanner(banner, 'error', `${label}失敗: ${(e as Error).message}`);
      if (meta) meta = await papi.getPack(meta.name).catch(() => meta);
    } finally {
      setBusy(false);
      renderCells();
    }
  }

  function step(label: string, steps: [string, Record<string, unknown>][]) {
    if (!meta) return;
    const name = meta.name;
    run(label, async () => {
      let m = meta!;
      for (const [s, p] of steps) m = await papi.runStep(name, s, p);
      return m;
    });
  }

  /** 上次離開時這個分層包還在拆解: 鎖住操作, 跑完重新載入 */
  function resumeJob() {
    const job = runningJob(embed.jobKey);
    if (!job || !meta) return;
    const name = meta.name;
    void run('上一次的拆解還在跑, 等待', async () => {
      await job.done;
      return papi.getPack(name);
    });
  }

  runAllBtn.addEventListener('click', () => meta && run('拆解', () => papi.decomposeAll(meta!.name)));
  overlayChk.addEventListener('change', renderCells);
  overlayOpacity.addEventListener('input', () => {
    for (const ov of root.querySelectorAll<HTMLImageElement>('.overlay')) ov.style.opacity = overlayOpacity.value;
  });

  (async () => {
    try {
      const st = await api.getStatus();
      if (!st.fal) showBanner(falBanner, 'error', '沒有設定 FAL_KEY, 無法執行 AI 步驟(法線、線稿)。設定方式見 README');
      meta = await embed.load();
      renderCells();
      resumeJob();
    } catch (e) {
      showBanner(banner, 'error', (e as Error).message);
    }
  })();

  return () => {
    pop.remove();
    document.removeEventListener('keydown', onKey);
  };
}
