import { api, type PackApi, type PackMeta } from '../api';
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
  /** 分層包改過(拆解) */
  onChange?(meta: PackMeta): void;
}

/** 拆解檢查(改風格節點的「1 拆解」)。 */
export function mountDecomposePage(root: HTMLElement, embed: DecomposeEmbed): () => void {
  const papi = embed.api;
  let meta: PackMeta | null = null;

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
      el('span', { className: 'muted', text: '拉動會重新整理線稿並重新分格平塗(免費)' }),
    ]),
    makeCell('flat', '平塗', [
      markPaid(button('重畫', () => step('重畫平塗', [['regions', {}], ['flat', {}]]))), costNote(usd(COST.gptImage)),
      el('span', { className: 'muted', text: 'GPT Image 2 畫平塗, 再依線稿分格上色' }),
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

  const runAllCost = costNote(`最多${usd(COST.depth + COST.line + COST.gptImage)}(只跑還沒跑過的步驟)`);
  const overlayBar = [el('label', {}, [overlayChk, '疊上線稿比對']), el('label', {}, ['不透明度', overlayOpacity])];
  root.append(falBanner, el('div', { className: 'toolbar' }, [runAllBtn, runAllCost, el('span', { className: 'spacer' }), ...overlayBar]),
    el('div', { className: 'cells' }, cells.map((c) => c.root)));

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
      c.view.append(stack);
    }
    const staleCount = STEP_ORDER.filter((s) => m.layers[s]?.stale).length;
    const missing = STEP_ORDER.filter((s) => !m.layers[s]).length;
    status.textContent = missing ? `還有 ${missing} 步未完成` : staleCount ? `有 ${staleCount} 層已過期` : '拆解完成';
  }

  function setBusy(on: boolean, text = '') {
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

  return () => {};
}
