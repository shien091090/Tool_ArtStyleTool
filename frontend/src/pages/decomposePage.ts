import { api, type PackMeta, type RGB } from '../api';
import { hexToRgb, rgbToHex } from '../colorMath';
import { el, option, showBanner } from './ui';

const LINE_MODELS = ['teed', 'lineart', 'hed', 'pidi'];
const STEP_ORDER = ['depth', 'normal', 'line', 'line_sdf', 'regions', 'flat'];

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

export function mountDecomposePage(root: HTMLElement, params: URLSearchParams): () => void {
  let packs: PackMeta[] = [];
  let meta: PackMeta | null = null;
  let busy = false;

  const banner = el('div');
  const falBanner = el('div');
  const nameInput = el('input');
  nameInput.placeholder = '分層包名稱';
  const fileInput = el('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  const createBtn = el('button', { text: '建立' });
  const packSel = el('select');
  const runAllBtn = el('button', { text: '全部拆解', className: 'primary' });
  const status = el('span', { className: 'muted' });
  const overlayChk = el('input');
  overlayChk.type = 'checkbox';
  const overlayOpacity = el('input');
  overlayOpacity.type = 'range';
  overlayOpacity.min = '0';
  overlayOpacity.max = '1';
  overlayOpacity.step = '0.05';
  overlayOpacity.value = '0.7';

  // ---- 四格 ----
  const lineModel = el('select');
  lineModel.append(...LINE_MODELS.map((m) => option(m, m)));
  const gapInput = el('input');
  gapInput.type = 'number';
  gapInput.min = '0';
  gapInput.max = '16';
  const areaInput = el('input');
  areaInput.type = 'number';
  areaInput.min = '1';

  const actions: HTMLButtonElement[] = [createBtn, runAllBtn];
  const button = (text: string, onClick: () => void) => {
    const b = el('button', { text });
    b.addEventListener('click', onClick);
    actions.push(b);
    return b;
  };
  const uploadButton = (layer: string) => {
    const input = el('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.className = 'hidden';
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      input.value = '';
      if (f && meta) run(`上傳替換${layer}`, () => api.replaceLayer(meta!.name, layer, f));
    });
    const b = button('上傳替換', () => input.click());
    return [b, input];
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
      el('label', {}, ['模型', lineModel]),
      button('重跑', () => step('重跑線稿', [['line', { model: lineModel.value }]])),
      ...uploadButton('line'),
    ]),
    makeCell('flat', '平塗', [
      el('label', { title: '線條沒接起來導致顏色漏到隔壁時調大' }, ['補線縫', gapInput]),
      el('label', { title: '小於這個面積的碎塊併入鄰近區塊' }, ['最小面積', areaInput]),
      button('重算區塊', () => step('重算區塊', [
        ['regions', { gap_radius: Number(gapInput.value), min_area: Number(areaInput.value) }], ['flat', {}],
      ])),
      ...uploadButton('flat'),
      el('span', { className: 'muted', text: '點圖上的區塊可以改色' }),
    ]),
    makeCell('normal', '法線', [
      button('重跑', () => step('重跑法線', [['depth', {}], ['normal', {}]])),
      ...uploadButton('normal'),
    ]),
  ];
  cells[2].root.classList.add('clickable');

  root.append(
    falBanner,
    el('div', { className: 'toolbar' }, [
      el('strong', { text: '新增' }), nameInput, fileInput, createBtn,
      el('span', { className: 'spacer' }),
      el('label', {}, ['分層包', packSel]), runAllBtn, status,
    ]),
    el('div', { className: 'toolbar' }, [
      el('label', {}, [overlayChk, '疊上線稿比對']),
      el('label', {}, ['不透明度', overlayOpacity]),
    ]),
    banner,
    el('div', { className: 'cells' }, cells.map((c) => c.root)),
  );

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
    const color = hexToRgb(popColor.value) as RGB;
    run(`區塊 ${popRegion} 改色`, () => api.setRegionColor(meta!.name, popRegion, color));
  });

  async function onFlatClick(e: MouseEvent) {
    if (!meta || busy) return;
    const img = e.currentTarget as HTMLImageElement;
    const x = Math.floor((e.offsetX / img.clientWidth) * meta.width);
    const y = Math.floor((e.offsetY / img.clientHeight) * meta.height);
    try {
      const info = await api.regionAt(meta.name, x, y);
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
    for (const c of cells) {
      const info = m.layers[c.layer];
      c.origin.textContent = originLabel(info?.origin);
      c.stale.textContent = info?.stale ? '已過期' : '';
      if (!info) {
        c.view.append(el('div', { className: 'empty', text: '尚未產生' }));
        continue;
      }
      const img = el('img');
      img.src = api.fileUrl(m.name, c.layer, info.updated);
      img.alt = c.title;
      const stack = el('div', { className: 'stack' }, [img]);
      if (overlayChk.checked && lineInfo && c.layer !== 'line') {
        const ov = el('img', { className: 'overlay' });
        ov.src = api.fileUrl(m.name, 'line', lineInfo.updated);
        ov.style.opacity = overlayOpacity.value;
        stack.append(ov);
      }
      if (c.layer === 'flat') img.addEventListener('click', onFlatClick);
      c.view.append(stack);
    }
    const params = m.layers.regions?.params;
    gapInput.value = String(params?.gap_radius ?? 3);
    areaInput.value = String(params?.min_area ?? 12);
    const staleCount = STEP_ORDER.filter((s) => m.layers[s]?.stale).length;
    const missing = STEP_ORDER.filter((s) => !m.layers[s]).length;
    status.textContent = missing ? `還有 ${missing} 步未完成` : staleCount ? `有 ${staleCount} 層已過期` : '拆解完成';
    if ((m.flat_color_source ?? m.layers.flat?.color_source) === 'user_flat') cells[2].origin.textContent += '(顏色取自上傳的平塗圖)';
  }

  function setBusy(on: boolean, text = '') {
    busy = on;
    for (const b of actions) b.disabled = on;
    if (on) status.textContent = text;
  }

  async function run(label: string, fn: () => Promise<PackMeta>) {
    setBusy(true, `${label}中…可能需要一兩分鐘`);
    showBanner(banner, null);
    try {
      meta = await fn();
      packs = packs.map((p) => (p.name === meta!.name ? meta! : p));
    } catch (e) {
      showBanner(banner, 'error', `${label}失敗: ${(e as Error).message}`);
      if (meta) meta = await api.getPack(meta.name).catch(() => meta);
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
      for (const [s, p] of steps) m = await api.runStep(name, s, p);
      return m;
    });
  }

  function refreshPackList(select?: string) {
    packSel.replaceChildren(...packs.map((p) => option(p.name, p.name)));
    if (select) packSel.value = select;
  }

  function selectPack(name: string) {
    meta = packs.find((p) => p.name === name) ?? null;
    pop.classList.add('hidden');
    renderCells();
  }

  createBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    const file = fileInput.files?.[0];
    if (!name || !file) { showBanner(banner, 'warn', '請輸入名稱並選擇圖片'); return; }
    await run('建立分層包', () => api.createPack(name, file));
    if (meta && meta.name === name) {
      if (!packs.some((p) => p.name === name)) packs.push(meta);
      packs.sort((a, b) => a.name.localeCompare(b.name));
      refreshPackList(name);
      nameInput.value = '';
      fileInput.value = '';
    }
  });
  packSel.addEventListener('change', () => selectPack(packSel.value));
  runAllBtn.addEventListener('click', () => meta && run('拆解', () => api.decomposeAll(meta!.name)));
  overlayChk.addEventListener('change', renderCells);
  overlayOpacity.addEventListener('input', () => {
    for (const ov of root.querySelectorAll<HTMLImageElement>('.overlay')) ov.style.opacity = overlayOpacity.value;
  });

  (async () => {
    try {
      const st = await api.getStatus();
      if (!st.fal) showBanner(falBanner, 'error', '沒有設定 FAL_KEY, 無法執行 AI 步驟(法線、線稿)。設定方式見 README');
      packs = await api.listPacks();
      const want = params.get('pack');
      const first = packs.find((p) => p.name === want) ?? packs[0];
      refreshPackList(first?.name);
      selectPack(first?.name ?? '');
    } catch (e) {
      showBanner(banner, 'error', (e as Error).message);
    }
  })();

  return () => pop.remove();
}
