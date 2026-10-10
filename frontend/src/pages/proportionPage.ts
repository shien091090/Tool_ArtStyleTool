import { api, type PackMeta } from '../api';
import { exportCollage, loadImage, WorkAssets } from '../proportion/draw';
import { Editor, type Tool } from '../proportion/editor';
import { ANCHORS, EDIT_MODELS, type Anchor, type Part, type PartTransform, type SegBox, type SegPoint, type WorkMeta } from '../proportion/model';
import { applyRecipe, parseProportionRecipe, recipeFromParts } from '../proportion/recipe';
import { autoPad, isChanged, placeForeign } from '../proportion/transform';
import { el, option, showBanner } from './ui';

const QUICK_NAMES = ['頭', '手', '腳', '身體', '翅膀', '尾巴'];
const ANCHOR_LABEL: Record<Anchor, string> = { top: '上', center: '中', bottom: '下' };
const TOOL_HINT: Record<Tool, string> = {
  move: '點部位選取; 拖曳移動, 拉角落縮放, 拉上方圓點旋轉(按 Shift 每 15 度)。點空白處取消選取。',
  point: '左鍵 = 這裡也要, 右鍵 = 這裡不要。沒選部位時, 左鍵會用上面輸入的名稱新增部位。',
  box: '拖一個框, AI 只在框內找。沒選部位時用上面輸入的名稱新增部位; 有選部位時重切該部位。',
};
const SAVE_DELAY = 400;

const identity = (z: number): PartTransform => ({ scaleX: 1, scaleY: 1, rotation: 0, anchor: 'bottom', dx: 0, dy: 0, z, hidden: false });
const baseName = (n: string) => n.replace(/\((左|右)\)$/, '');
const splitNames = (t: string) => [...new Set(t.split(/[、,，;；\n]/).map((s) => s.trim()).filter(Boolean))];

export function mountProportionPage(root: HTMLElement, params: URLSearchParams): () => void {
  let meta: WorkMeta | null = null;
  let assets = new WorkAssets();
  let view = 'main';
  let tool: Tool = 'move';
  let selected: string | null = null;
  let showMasks = true;
  let lockRatio = true;
  let compare: { id: string; img: HTMLImageElement; split: number } | null = null;
  let falOk = false;
  let busy = false;
  let saveTimer: number | undefined;
  let savePromise: Promise<void> = Promise.resolve();
  let alive = true;

  // ---- 上方工具列 ----
  const banner = el('div');
  const workSel = el('select');
  const nameInput = el('input');
  nameInput.placeholder = '新作品名稱';
  const fileInput = el('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  const packSel = el('select');
  const createBtn = el('button', { text: '建立作品' });
  const status = el('span', { className: 'muted' });
  const toolbar = el('div', { className: 'toolbar' }, [
    el('label', {}, ['作品', workSel]),
    status,
    el('span', { className: 'spacer' }),
    nameInput, fileInput, el('label', {}, ['或從分層包', packSel]), createBtn,
  ]);

  // ---- 畫布 ----
  const stage = el('div', { className: 'prop-stage' });
  const canvasWrap = el('div', { className: 'prop-canvas-wrap' });
  const compareBar = el('div', { className: 'prop-compare-bar hidden' });
  stage.append(canvasWrap, compareBar);

  // ---- 右側面板 ----
  const panel = el('div', { className: 'panel-wrap prop-panel' });
  const section = (title: string, ...children: (Node | string)[]) =>
    el('section', { className: 'prop-section' }, [el('h3', { text: title }), ...children]);
  const button = (text: string, onClick: () => void, className = '') => {
    const b = el('button', { text, className });
    b.addEventListener('click', onClick);
    return b;
  };
  const num = (step: string) => {
    const i = el('input');
    i.type = 'number';
    i.step = step;
    return i;
  };

  // 檢視與素材圖
  const viewSel = el('select');
  const imgFile = el('input');
  imgFile.type = 'file';
  imgFile.accept = 'image/*';
  const imgPackSel = el('select');
  const addImgBtn = button('加入素材圖', () => void addImage());
  const viewSection = section('檢視', el('label', {}, ['畫布顯示', viewSel]),
    el('div', { className: 'muted small', text: '素材圖: 從別張圖拿部位(例如換頭)' }),
    el('div', { className: 'row' }, [imgFile]), el('div', { className: 'row' }, [el('label', {}, ['或分層包', imgPackSel]), addImgBtn]));

  // 切部位
  const partNames = el('input');
  partNames.placeholder = '部位名稱, 多個用頓號分隔';
  const chips = el('div', { className: 'chips' }, QUICK_NAMES.map((n) => {
    const b = el('button', { text: n, className: 'chip' });
    b.addEventListener('click', () => {
      const cur = splitNames(partNames.value);
      if (!cur.includes(n)) partNames.value = [...cur, n].join('、');
    });
    return b;
  }));
  const segBtn = button('切部位', () => void segmentNames(), 'primary');
  const toolBtns = new Map<Tool, HTMLButtonElement>();
  const toolRow = el('div', { className: 'seg' }, (['move', 'point', 'box'] as Tool[]).map((t) => {
    const b = button({ move: '選取移動', point: '點選修正', box: '框選' }[t], () => {
      tool = t;
      redraw();
      syncAll();
    });
    toolBtns.set(t, b);
    return b;
  }));
  const toolHint = el('div', { className: 'muted small' });
  const maskChk = el('input');
  maskChk.type = 'checkbox';
  maskChk.checked = true;
  maskChk.addEventListener('change', () => {
    showMasks = maskChk.checked;
    redraw();
  });
  const segSection = section('拆部位', partNames, chips, el('div', { className: 'row' }, [segBtn, el('label', {}, [maskChk, '顯示遮罩'])]),
    toolRow, toolHint);

  // 部位清單
  const partList = el('div', { className: 'part-list' });
  const listSection = section('部位', partList);

  // 選中部位
  const selTitle = el('div', { className: 'sel-title' });
  const placeBtn = button('放到主圖', () => placeOnMain());
  const unplaceBtn = button('從主圖移除', () => unplace());
  const hideChk = el('input');
  hideChk.type = 'checkbox';
  hideChk.addEventListener('change', () => editSelected((t) => ({ ...t, hidden: hideChk.checked })));
  const hideLabel = el('label', { title: '從圖上挖掉, 留下的洞交給 AI 補' }, [hideChk, '隱藏']);
  const splitBtn = button('拆成左右', () => void splitSelected());
  const delBtn = button('刪除部位', () => void deleteSelected());
  const resetBtn = button('重設變形', () => editSelected((t) => identity(t.z)));
  const lockChk = el('input');
  lockChk.type = 'checkbox';
  lockChk.checked = true;
  lockChk.addEventListener('change', () => {
    lockRatio = lockChk.checked;
    redraw();
  });
  const fScaleX = num('0.05');
  const fScaleY = num('0.05');
  const fRot = num('1');
  const fDx = num('0.01');
  const fDy = num('0.01');
  const anchorSel = el('select');
  for (const a of ANCHORS) anchorSel.append(option(a, ANCHOR_LABEL[a]));
  const upBtn = button('上移一層', () => restack(1));
  const downBtn = button('下移一層', () => restack(-1));
  const fieldBox = el('div', { className: 'fields' }, [
    el('label', {}, [lockChk, '等比']),
    el('label', {}, ['寬', fScaleX]), el('label', {}, ['高', fScaleY]),
    el('label', {}, ['旋轉', fRot]), el('label', { title: '縮放與旋轉的基準點' }, ['錨點', anchorSel]),
    el('label', { title: '以部位寬的比例計' }, ['水平位移', fDx]), el('label', { title: '以部位高的比例計' }, ['垂直位移', fDy]),
    el('div', { className: 'row' }, [upBtn, downBtn]),
  ]);
  const onNum = (input: HTMLInputElement, apply: (t: PartTransform, v: number) => PartTransform) =>
    input.addEventListener('change', () => {
      const v = Number(input.value);
      if (!Number.isFinite(v)) return syncFields();
      editSelected((t) => apply(t, v));
    });
  const clampS = (v: number) => Math.min(20, Math.max(0.05, v));
  onNum(fScaleX, (t, v) => (lockRatio ? { ...t, scaleX: clampS(v), scaleY: clampS((t.scaleY * v) / t.scaleX) } : { ...t, scaleX: clampS(v) }));
  onNum(fScaleY, (t, v) => (lockRatio ? { ...t, scaleY: clampS(v), scaleX: clampS((t.scaleX * v) / t.scaleY) } : { ...t, scaleY: clampS(v) }));
  onNum(fRot, (t, v) => ({ ...t, rotation: v }));
  onNum(fDx, (t, v) => ({ ...t, dx: v }));
  onNum(fDy, (t, v) => ({ ...t, dy: v }));
  anchorSel.addEventListener('change', () => editSelected((t) => ({ ...t, anchor: anchorSel.value as Anchor })));
  const selSection = section('選中部位', selTitle,
    el('div', { className: 'row' }, [placeBtn, unplaceBtn, hideLabel]),
    el('div', { className: 'row' }, [splitBtn, resetBtn, delBtn]), fieldBox);

  // 畫布擴大
  const padInputs = (['top', 'right', 'bottom', 'left'] as const).map((k) => {
    const i = num('1');
    i.min = '0';
    i.addEventListener('change', () => {
      if (!meta) return;
      const v = Math.max(0, Math.min(4096, Math.round(Number(i.value) || 0)));
      meta.pad = { ...meta.pad, [k]: v };
      changed();
    });
    return [k, i] as const;
  });
  const padLabel: Record<string, string> = { top: '上', right: '右', bottom: '下', left: '左' };
  const autoPadBtn = button('自動', () => {
    if (!meta) return;
    const main = mainInfo();
    meta.pad = autoPad(meta.parts, main.w, main.h);
    changed();
  });
  const padSection = section('擴大畫布', el('div', { className: 'muted small', text: '放大後超出畫面時用; 擴出的區域交給 AI 補' }),
    el('div', { className: 'fields' }, [...padInputs.map(([k, i]) => el('label', {}, [padLabel[k], i])), autoPadBtn]));

  // 比例配方
  const recipeSel = el('select');
  const applyRecipeBtn = button('套用', () => void applySelectedRecipe());
  const recipeName = el('input');
  recipeName.placeholder = '配方名稱';
  const saveRecipeBtn = button('存成配方', () => void saveRecipe());
  const recipeSection = section('比例配方', el('div', { className: 'row' }, [recipeSel, applyRecipeBtn]),
    el('div', { className: 'row' }, [recipeName, saveRecipeBtn]),
    el('div', { className: 'muted small', text: '只記主圖上調整過的部位; 套到別張圖時依名稱自動切部位' }));

  // 生成
  const modelSel = el('select');
  for (const m of EDIT_MODELS) modelSel.append(option(m.id, m.label));
  const countSel = el('select');
  for (const n of [1, 2, 3, 4]) countSel.append(option(String(n), `${n} 張`));
  const extra = el('textarea');
  extra.placeholder = '補充描述(選填), 例如: 接縫處畫成毛皮';
  extra.rows = 2;
  const genBtn = button('生成', () => void generate(), 'primary');
  const genHint = el('div', { className: 'muted small' });
  const genSection = section('生成', el('div', { className: 'row' }, [modelSel, countSel]), extra, el('div', { className: 'row' }, [genBtn]), genHint);

  // 結果
  const resultList = el('div', { className: 'result-list' });
  const resultSection = section('結果', resultList);

  panel.append(viewSection, segSection, listSection, selSection, padSection, recipeSection, genSection, resultSection);
  root.append(toolbar, banner, el('div', { className: 'prop-layout' }, [stage, panel]));

  const editor = new Editor(canvasWrap, {
    onSelect: (id) => {
      selected = id;
      syncAll();
    },
    onTransform: (id, t, final) => {
      const p = meta?.parts.find((x) => x.id === id);
      if (!p) return;
      p.transform = t;
      redraw();
      syncFields();
      if (final) scheduleSave();
    },
    onPoint: (x, y, label) => void pointAt(x, y, label),
    onBox: (box) => void boxAt(box),
    onSplit: (split) => {
      if (compare) compare.split = split;
      redraw();
    },
  });

  // ---- 共用 ----
  const mainInfo = () => meta!.images.find((i) => i.id === 'main')!;
  const selPart = (): Part | undefined => meta?.parts.find((p) => p.id === selected);
  const actionButtons = [createBtn, addImgBtn, segBtn, splitBtn, delBtn, genBtn, applyRecipeBtn, saveRecipeBtn];

  function redraw() {
    if (!meta) return;
    editor.set({
      meta, assets, view, tool, selected, showMasks, lockRatio,
      compare: compare ? { result: compare.img, split: compare.split } : null,
    });
  }

  async function run(label: string, fn: () => Promise<void>) {
    if (busy) return;
    busy = true;
    status.textContent = label;
    showBanner(banner, null);
    syncAll();
    try {
      await fn();
    } catch (e) {
      showBanner(banner, 'error', (e as Error).message);
    } finally {
      busy = false;
      status.textContent = '';
      if (alive) syncAll();
    }
  }

  function scheduleSave() {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void flushSave(), SAVE_DELAY);
  }

  async function flushSave() {
    window.clearTimeout(saveTimer);
    saveTimer = undefined;
    const m = meta;
    if (!m) return;
    savePromise = savePromise.then(() =>
      api.proportion.putLayout(m.name, m.parts, m.pad).then(
        () => undefined,
        (e: Error) => showBanner(banner, 'error', `儲存調整失敗: ${e.message}`),
      ),
    );
    await savePromise;
  }

  /** 本機調整後: 重畫、同步面板、排程存檔。 */
  function changed() {
    compare = null;
    redraw();
    syncAll();
    scheduleSave();
  }

  function editSelected(fn: (t: PartTransform) => PartTransform) {
    const p = selPart();
    if (!p) return;
    p.transform = fn(p.transform);
    changed();
  }

  async function setMeta(next: WorkMeta) {
    meta = next;
    await assets.sync(next);
    if (selected && !next.parts.some((p) => p.id === selected)) selected = null;
    if (!next.images.some((i) => i.id === view)) view = 'main';
  }

  // ---- 同步面板 ----
  function syncFields() {
    const p = selPart();
    const canEdit = !!p && (p.image === 'main' ? !p.transform.hidden : p.placed);
    fieldBox.classList.toggle('hidden', !canEdit);
    if (!p) return;
    const t = p.transform;
    fScaleX.value = t.scaleX.toFixed(2);
    fScaleY.value = t.scaleY.toFixed(2);
    fRot.value = String(Math.round(t.rotation * 10) / 10);
    fDx.value = t.dx.toFixed(2);
    fDy.value = t.dy.toFixed(2);
    anchorSel.value = t.anchor;
  }

  function syncAll() {
    const has = !!meta;
    for (const s of [viewSection, segSection, listSection, padSection, recipeSection, genSection, resultSection]) {
      s.classList.toggle('hidden', !has);
    }
    for (const b of actionButtons) b.disabled = busy;
    for (const [t, b] of toolBtns) b.classList.toggle('active', t === tool);
    toolHint.textContent = TOOL_HINT[tool];
    if (!meta) {
      selSection.classList.add('hidden');
      compareBar.classList.add('hidden');
      return;
    }
    segBtn.disabled = busy || !falOk;
    // 檢視選單
    viewSel.replaceChildren(...meta.images.map((im) => option(im.id, im.id === 'main' ? '主圖(拼貼)' : `素材: ${im.name}`)));
    viewSel.value = view;
    // 部位清單
    const imgName = (id: string) => (id === 'main' ? '主圖' : meta!.images.find((i) => i.id === id)?.name ?? id);
    partList.replaceChildren(...meta.parts.map((p) => {
      const tags: string[] = [];
      if (p.image !== 'main') tags.push(p.placed ? `來自 ${imgName(p.image)} · 已放到主圖` : `來自 ${imgName(p.image)}`);
      if (p.image === 'main' && p.transform.hidden) tags.push('隱藏');
      else if (isChanged(p) && p.image === 'main') tags.push('已調整');
      const row = el('div', { className: `part-row${p.id === selected ? ' active' : ''}` }, [
        el('span', { className: 'dot' }),
        el('span', { text: p.name }),
        el('span', { className: 'muted small', text: tags.join(' · ') }),
      ]);
      (row.firstChild as HTMLElement).style.background = p.color;
      row.addEventListener('click', () => {
        selected = p.id;
        if (p.image !== 'main' && !p.placed) view = p.image;
        compare = null;
        redraw();
        syncAll();
      });
      return row;
    }));
    if (!meta.parts.length) partList.append(el('div', { className: 'muted small', text: '還沒有部位。輸入名稱後按「切部位」。' }));
    // 選中部位
    const p = selPart();
    selSection.classList.toggle('hidden', !p);
    if (p) {
      selTitle.textContent = `${p.name}(${imgName(p.image)})`;
      placeBtn.classList.toggle('hidden', p.image === 'main' || p.placed);
      unplaceBtn.classList.toggle('hidden', p.image === 'main' || !p.placed);
      hideLabel.classList.toggle('hidden', p.image !== 'main');
      hideChk.checked = p.transform.hidden;
      resetBtn.classList.toggle('hidden', !(p.image === 'main' ? isChanged(p) : p.placed));
    }
    syncFields();
    for (const [k, i] of padInputs) i.value = String(meta.pad[k]);
    // 生成
    const anyChange = meta.parts.some(isChanged);
    genBtn.disabled = busy || !falOk || !anyChange;
    genHint.textContent = !falOk ? '沒有設定 FAL_KEY, 無法生成(本機調整仍可使用)' : anyChange ? '' : '還沒有調整任何部位';
    // 結果
    resultList.replaceChildren(...[...meta.results].reverse().map((r) => {
      const img = el('img');
      img.src = api.proportion.fileUrl(meta!.name, `results/${r.id}.png`, r.created);
      img.title = `${r.id} · ${r.model} · ${r.created}`;
      const item = el('div', { className: `result-item${compare?.id === r.id ? ' active' : ''}` }, [img]);
      item.addEventListener('click', () => void openCompare(r.id));
      return item;
    }));
    if (!meta.results.length) resultList.append(el('div', { className: 'muted small', text: '還沒有生成結果' }));
    // 對照列
    compareBar.classList.toggle('hidden', !compare);
    if (compare) {
      const id = compare.id;
      compareBar.replaceChildren(
        el('span', { text: `對照 ${id}: 左 = 原圖, 右 = 結果(拖曳畫面調整分界)` }),
        el('span', { className: 'spacer' }),
        button('送到拆解檢查', () => void toPack(id)),
        button('開新分頁看原尺寸', () => window.open(api.proportion.fileUrl(meta!.name, `results/${id}.png`), '_blank')),
        button('回到編輯', () => {
          compare = null;
          redraw();
          syncAll();
        }),
      );
    }
  }

  // ---- 作品 ----
  async function refreshWorks(want = '') {
    const works = await api.proportion.listWorks();
    workSel.replaceChildren(option('', works.length ? '— 選擇作品 —' : '— 尚無作品 —'), ...works.map((w) => option(w.name, w.name)));
    workSel.value = want;
  }

  async function refreshPacks() {
    const packs: PackMeta[] = await api.listPacks();
    const opts = () => [option('', '—'), ...packs.map((p) => option(p.name, p.name))];
    packSel.replaceChildren(...opts());
    imgPackSel.replaceChildren(...opts());
  }

  async function refreshRecipes() {
    const names = await api.proportion.listRecipes();
    recipeSel.replaceChildren(option('', names.length ? '— 選擇配方 —' : '— 尚無配方 —'), ...names.map((n) => option(n, n)));
  }

  async function openWork(name: string) {
    if (saveTimer !== undefined) await flushSave();
    compare = null;
    selected = null;
    view = 'main';
    meta = null;
    assets = new WorkAssets();
    syncAll();
    if (!name) {
      redraw();
      return;
    }
    await run('載入中…', async () => {
      await setMeta(await api.proportion.getWork(name));
      history.replaceState(null, '', `#/proportion?work=${encodeURIComponent(name)}`);
      redraw();
    });
  }

  workSel.addEventListener('change', () => void openWork(workSel.value));
  viewSel.addEventListener('change', () => {
    view = viewSel.value;
    compare = null;
    redraw();
    syncAll();
  });

  createBtn.addEventListener('click', () => void run('建立中…', async () => {
    const name = nameInput.value.trim();
    const file = fileInput.files?.[0];
    if (!name) throw new Error('請輸入作品名稱');
    if (!file && !packSel.value) throw new Error('請選擇圖片或分層包');
    const m = await api.proportion.createWork(name, file ? { file } : { pack: packSel.value });
    nameInput.value = '';
    fileInput.value = '';
    await refreshWorks(m.name);
    busy = false;
    await openWork(m.name);
  }));

  async function addImage() {
    await run('加入素材圖中…', async () => {
      if (!meta) return;
      const file = imgFile.files?.[0];
      if (!file && !imgPackSel.value) throw new Error('請選擇圖片或分層包');
      await flushSave();
      const before = new Set(meta.images.map((i) => i.id));
      await setMeta(await api.proportion.addImage(meta.name, file ? { file } : { pack: imgPackSel.value }));
      imgFile.value = '';
      view = meta.images.find((i) => !before.has(i.id))?.id ?? view;
      selected = null;
      redraw();
    });
  }

  // ---- 切部位 ----
  async function segmentNames() {
    await run('AI 切部位中…', async () => {
      if (!meta) return;
      const names = splitNames(partNames.value);
      if (!names.length) throw new Error('請輸入部位名稱');
      await flushSave();
      const before = new Set(meta.parts.map((p) => p.id));
      const res = await api.proportion.segment(meta.name, view, names);
      await setMeta(res.meta);
      const added = res.meta.parts.filter((p) => !before.has(p.id));
      if (added.length) selected = added[added.length - 1].id;
      if (res.missing.length) {
        showBanner(banner, 'warn', `找不到「${res.missing.join('、')}」。請在「部位名稱」只留這個名稱, 改用框選或點選工具在圖上指出位置。`);
      }
      redraw();
    });
  }

  /** 有選中部位且在目前檢視上 → 重切; 否則用名稱欄新增部位。 */
  function refineTarget(): Part | undefined {
    const p = selPart();
    if (!p) return undefined;
    if (view === 'main') return p.image === 'main' || p.placed ? p : undefined;
    return p.image === view ? p : undefined;
  }

  async function addByGeometry(points: SegPoint[], box: SegBox | null) {
    if (!meta) return;
    const names = splitNames(partNames.value);
    if (names.length !== 1) throw new Error('沒有選中部位時, 請在「部位名稱」輸入一個名稱再點選或框選');
    const before = new Set(meta.parts.map((p) => p.id));
    const res = await api.proportion.segment(meta.name, view, names, points, box);
    await setMeta(res.meta);
    const added = res.meta.parts.find((p) => !before.has(p.id));
    if (added) selected = added.id;
    if (res.missing.length) throw new Error(`這個位置切不到「${names[0]}」, 請換個位置或改用框選`);
  }

  async function pointAt(x: number, y: number, label: 0 | 1) {
    if (!meta || !falOk) return;
    await run('AI 重切中…', async () => {
      await flushSave();
      const p = refineTarget();
      if (!p) {
        if (label === 0) throw new Error('右鍵(這裡不要)只能用在已選中的部位');
        await addByGeometry([{ x, y, label: 1 }], null);
      } else {
        const img = meta!.images.find((i) => i.id === p.image)!;
        if (x < 0 || y < 0 || x >= img.w || y >= img.h) throw new Error('點的位置超出這個部位所屬的圖');
        await setMeta(await api.proportion.refine(meta!.name, p.id, [...p.points, { x, y, label }], p.box));
      }
      redraw();
    });
  }

  async function boxAt(box: SegBox) {
    if (!meta || !falOk) return;
    await run('AI 框選中…', async () => {
      await flushSave();
      const p = refineTarget();
      if (!p) await addByGeometry([], box);
      else await setMeta(await api.proportion.refine(meta!.name, p.id, [], box));
      redraw();
    });
  }

  async function splitSelected() {
    const p = selPart();
    if (!p || !meta) return;
    await run('拆分中…', async () => {
      await flushSave();
      await setMeta(await api.proportion.split(meta!.name, p.id));
      redraw();
    });
  }

  async function deleteSelected() {
    const p = selPart();
    if (!p || !meta) return;
    await run('刪除中…', async () => {
      await flushSave();
      await setMeta(await api.proportion.deletePart(meta!.name, p.id));
      selected = null;
      compare = null;
      redraw();
    });
  }

  // ---- 外來部位與圖層 ----
  const maxZ = () => Math.max(0, ...meta!.parts.map((p) => p.transform.z));

  function placeOnMain() {
    const p = selPart();
    if (!meta || !p || p.image === 'main') return;
    const target = meta.parts.find((q) => q.image === 'main' && baseName(q.name) === baseName(p.name));
    const main = mainInfo();
    p.place = placeForeign(p.bbox, target?.bbox ?? null, main.w, main.h);
    p.placed = true;
    p.transform = identity(maxZ() + 1);
    if (target) target.transform = { ...target.transform, hidden: true };
    view = 'main';
    if (target) showBanner(banner, 'info', `已對齊到主圖的「${target.name}」並把它隱藏`);
    changed();
  }

  function unplace() {
    const p = selPart();
    if (!p) return;
    p.placed = false;
    p.place = null;
    p.transform = identity(p.transform.z);
    changed();
  }

  function restack(dir: 1 | -1) {
    const p = selPart();
    if (!meta || !p) return;
    const sorted = [...meta.parts].sort((a, b) => a.transform.z - b.transform.z);
    const i = sorted.indexOf(p);
    const other = sorted[i + dir];
    if (!other) return;
    const z = p.transform.z;
    p.transform = { ...p.transform, z: other.transform.z };
    other.transform = { ...other.transform, z };
    if (p.transform.z === other.transform.z) p.transform.z += dir;
    changed();
  }

  // ---- 比例配方 ----
  async function applySelectedRecipe() {
    const name = recipeSel.value;
    if (!name || !meta) return;
    await run('套用配方中…', async () => {
      await flushSave();
      const recipe = parseProportionRecipe(await api.proportion.getRecipe(name));
      let { missing } = applyRecipe(meta!.parts, recipe);
      let skipped: string[] = [];
      if (missing.length) {
        if (!falOk) {
          skipped = missing;
        } else {
          const res = await api.proportion.segment(meta!.name, 'main', missing);
          await setMeta(res.meta);
          skipped = res.missing;
        }
      }
      const { transforms } = applyRecipe(meta!.parts, recipe);
      for (const p of meta!.parts) {
        const t = transforms.get(p.id);
        if (t) p.transform = t;
      }
      const main = mainInfo();
      const need = autoPad(meta!.parts, main.w, main.h);
      const pad = meta!.pad;
      meta!.pad = {
        top: Math.max(pad.top, need.top), right: Math.max(pad.right, need.right),
        bottom: Math.max(pad.bottom, need.bottom), left: Math.max(pad.left, need.left),
      };
      changed();
      await flushSave();
      missing = skipped;
      if (missing.length) showBanner(banner, 'warn', `配方中的「${missing.join('、')}」在這張圖切不到, 已跳過`);
      else showBanner(banner, 'info', `已套用配方「${name}」`);
    });
  }

  async function saveRecipe() {
    if (!meta) return;
    await run('儲存配方中…', async () => {
      const name = recipeName.value.trim();
      if (!name) throw new Error('請輸入配方名稱');
      await api.proportion.saveRecipe(name, recipeFromParts(meta!.parts));
      await refreshRecipes();
      recipeSel.value = name;
      showBanner(banner, 'info', `已存成配方「${name}」`);
    });
  }

  // ---- 生成與結果 ----
  async function generate() {
    if (!meta) return;
    await run('AI 生成中(約 15 秒)…', async () => {
      await flushSave();
      const { collage, region } = await exportCollage(meta!, assets);
      const res = await api.proportion.generate(meta!.name, collage, region, {
        model: modelSel.value, count: Number(countSel.value), extra: extra.value,
      });
      meta!.results = res.meta.results;
      if (res.errors.length) showBanner(banner, 'warn', res.errors.join('; '));
      if (res.results.length) {
        busy = false;
        await openCompare(res.results[0].id);
      }
    });
  }

  async function openCompare(id: string) {
    if (!meta) return;
    try {
      const img = await loadImage(api.proportion.fileUrl(meta.name, `results/${id}.png`, id));
      compare = { id, img, split: 0.5 };
      view = 'main';
      redraw();
      syncAll();
    } catch (e) {
      showBanner(banner, 'error', (e as Error).message);
    }
  }

  async function toPack(id: string) {
    if (!meta) return;
    await run('建立分層包中…', async () => {
      const { pack } = await api.proportion.toPack(meta!.name, id);
      location.hash = `#/decompose?pack=${encodeURIComponent(pack)}`;
    });
  }

  // ---- 啟動 ----
  syncAll();
  void (async () => {
    try {
      falOk = (await api.getStatus()).fal;
      await Promise.all([refreshWorks(), refreshPacks(), refreshRecipes()]);
      const want = params.get('work');
      if (want) {
        workSel.value = want;
        await openWork(want);
      }
      syncAll();
    } catch (e) {
      showBanner(banner, 'error', (e as Error).message);
    }
  })();

  return () => {
    alive = false;
    if (saveTimer !== undefined) void flushSave();
    editor.destroy();
  };
}
