/** 遊戲示意頁: 場景管理、灰盒/素材/地面格編輯、自動存檔與復原、AI 畫整張、候選與截素材。 */
import { api } from '../api';
import { onJobsChange, runningJob, trackJob } from '../jobs';
import { attachCutter, candidatePanel, candidateStrip, drawCandidate, type Box, type CutPreview } from '../mockup/candidates';
import { download } from '../pixel/pixelPanel';
import { VIEW_LABEL, type AssetTags, type ViewKey } from '../library/model';
import { pickAsset } from '../library/picker';
import { drawScene, renderPngs, type Images } from '../mockup/draw';
import { attachEditor } from '../mockup/editor';
import { createHistory } from '../mockup/history';
import {
  bodyOf, cameraScale, CANVAS, DEFAULT_BOX_COLOR, frameRect, maxViewZoom, moveLayer, viewRectAt, isoCell, LEVEL_LABEL, LEVELS, nativeRes, newObjectId, snap,
  type CameraLevel, type Rect, type Scene, type SceneBody,
} from '../mockup/model';
import { backgroundPanel, groundPanel, layerPanel, newSceneForm, objectPanel, stylePanel, type Edit } from '../mockup/panels';
import { confirmDelete, el, iconButton, option, showBanner } from './ui';

const SAVE_DELAY = 500;

export function mountMockupPage(root: HTMLElement, params: URLSearchParams): (() => void) & { canLeave: () => boolean } {
  let scene: Scene | null = null;
  let selected: string | null = null;
  let tool: 'select' | 'brush' = 'select';
  let brush: string | null = null;
  let formOpen = false;
  let dirty = false;
  let saveTimer = 0;
  let saving: Promise<void> = Promise.resolve();
  let alive = true;
  let mode: 'edit' | 'view' = 'edit';
  let viewing: string | null = null;
  let candImg: HTMLImageElement | null = null;
  let box: Box | null = null;
  let preview: CutPreview | null = null;
  let cutBusy = false;
  let count = 1;
  let wasRendering = false;
  let renderBusy = false;
  let showGrid = true;
  let showRaw = false;
  let viewZoom = 1;
  let bgOn = false; // 圖層清單選到背景
  let genBody: HTMLElement | null = null; // 生成視窗開著時的內容區
  const images: Images = new Map();
  const undoStack = createHistory<string>();

  // ---- 版面 ----
  const banner = el('div');
  const sceneSel = el('select');
  const deleteBtn = el('button', { text: '刪除場景', className: 'danger-fill' });
  const renameBtn = el('button', { text: '重新命名' });
  const newBtn = el('button', { text: '新場景' });
  const undoBtn = iconButton('undo', '復原 (Ctrl+Z)');
  const redoBtn = iconButton('redo', '重做 (Ctrl+Y)');
  const addBoxBtn = el('button', { text: '+ 灰盒' });
  const addAssetBtn = el('button', { text: '擺入素材' });
  const selectTool = el('button', { text: '選取' });
  const brushTool = el('button', { text: '地面筆刷' });
  const cameraSeg = el('div', { className: 'seg mk-camera' });
  const gridBtn = el('button', { text: '格線', title: '像素場景: 疊上遊戲像素格線' });
  const zoomBtn = el('button', { text: '還原視野', title: '滾輪縮放後回到預設視野' });
  const genBtn = el('button', { text: '生成', className: 'primary', title: '風格設定與 AI 畫整張' });
  const status = el('span', { className: 'muted small' });
  const viewTag = el('span', { className: 'mk-tag' });
  const pixelTag = el('span', { className: 'mk-tag pixel', text: '像素' });
  root.append(
    el('div', { className: 'toolbar' }, [
      el('label', {}, ['場景', sceneSel]), viewTag, pixelTag, renameBtn, deleteBtn, undoBtn, redoBtn, status,
      el('span', { className: 'spacer' }), newBtn,
    ]),
    banner,
  );
  const canvas = el('canvas');
  const stage = el('div', { className: 'mk-stage' }, [canvas]);
  const sceneTools = el('div', { className: 'mk-tools' }, [addBoxBtn, addAssetBtn, selectTool, brushTool, cameraSeg, gridBtn, zoomBtn, el('span', { className: 'spacer' }), genBtn]);
  const palette = el('div', { className: 'mk-palette' });
  const layers = el('div', { className: 'mk-layers' });
  const side = el('div', { className: 'mk-side' });
  const strip = el('div', { className: 'mk-cands hidden' });
  root.append(el('div', { className: 'mk-body' }, [palette, el('div', { className: 'mk-center' }, [sceneTools, stage]), layers, side]), strip);

  function error(e: unknown) {
    showBanner(banner, 'error', (e as Error).message);
  }

  // ---- 繪製 ----
  /** 編輯時畫布顯示的世界範圍 */
  const viewRect = (): Rect => (scene ? viewRectAt(scene, viewZoom) : [0, 0, 1, 1]);

  /** 畫布大小: 編輯 = 編輯範圍 × 鏡頭倍率, 看候選 = 輸出尺寸 */
  function sizeCanvas() {
    if (!scene) return;
    let [w, h] = CANVAS[scene.view];
    if (mode === 'edit') {
      const r = viewRect();
      const k = cameraScale(scene, scene.camera);
      [w, h] = [(r[2] - r[0]) * k, (r[3] - r[1]) * k];
      // 縮小看整個世界時畫布可能很大, 長邊最多 2560 畫素
      const cap = Math.min(1, 2560 / Math.max(w, h));
      [w, h] = [Math.round(w * cap), Math.round(h * cap)];
    }
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    fit();
  }

  function fit() {
    if (!scene) return;
    const [w, h] = [canvas.width, canvas.height];
    const k = Math.min((stage.clientWidth - 24) / w, (stage.clientHeight - 24) / h);
    canvas.style.width = `${Math.max(50, w * k)}px`;
    canvas.style.height = `${Math.max(30, h * k)}px`;
  }

  function redraw() {
    if (!scene) return;
    if (mode === 'view' && candImg) {
      drawCandidate(canvas.getContext('2d')!, scene, candImg, box);
      return;
    }
    drawScene(canvas.getContext('2d')!, scene, images, { selected, rect: viewRect(), grid: showGrid });
  }

  function loadImages() {
    if (!scene) return;
    const ids = new Set([...scene.objects.flatMap((o) => (o.kind === 'asset' ? [o.asset] : [])), ...scene.style.refs]);
    for (const id of ids) {
      if (images.has(id)) continue;
      const img = new Image();
      img.onload = () => redraw();
      img.src = api.mockups.fileUrl(scene.name, `assets/${id}.png`);
      images.set(id, img);
    }
  }

  function sync() {
    deleteBtn.disabled = !scene;
    renameBtn.disabled = !scene;
    const editing = !!scene && mode === 'edit';
    for (const b of [undoBtn, redoBtn, addBoxBtn, addAssetBtn, selectTool]) b.disabled = !editing;
    brushTool.disabled = !editing;
    // 沒有地面格的場景(橫向/縱向卷軸、沒開棋盤的桌面)用不到筆刷, 選取也不必切換, 兩顆都不顯示
    selectTool.classList.toggle('hidden', !scene?.ground);
    brushTool.classList.toggle('hidden', !scene?.ground);
    if (!scene?.ground && tool === 'brush') tool = 'select';
    selectTool.classList.toggle('primary', tool === 'select');
    brushTool.classList.toggle('primary', tool === 'brush');
    viewTag.textContent = scene ? VIEW_LABEL[scene.view as ViewKey] ?? scene.view : '';
    viewTag.classList.toggle('hidden', !scene);
    pixelTag.classList.toggle('hidden', !scene?.pixel);
    status.textContent = !scene ? '' : dirty ? '有修改尚未存檔…' : '已存檔';
    // 鏡頭: 一般桌面鎖在標準, 不顯示
    const camOn = !!scene && !(scene.view === 'flat' && !scene.pixel);
    cameraSeg.classList.toggle('hidden', !camOn);
    if (camOn && scene) {
      const s = scene;
      cameraSeg.replaceChildren(...LEVELS.map((lv) => {
        const res = s.pixel ? ` ${nativeRes(s, lv).join('×')}` : '';
        const b = el('button', { text: `${LEVEL_LABEL[lv]}${res}`, className: lv === s.camera ? 'active' : '' });
        b.disabled = !editing;
        b.addEventListener('click', () => setCamera(lv));
        return b;
      }));
    }
    gridBtn.classList.toggle('hidden', !scene?.pixel);
    gridBtn.classList.toggle('primary', showGrid);
    gridBtn.disabled = !editing;
    genBtn.disabled = !editing;
    zoomBtn.classList.toggle('hidden', !editing || viewZoom <= 1.001);
    stage.classList.toggle('brush', editing && tool === 'brush');
    stage.classList.toggle('cutting', mode === 'view');
  }

  const jobKey = (s: Scene) => `mockup:${s.name}`;
  const rendering = () => renderBusy || (!!scene && !!runningJob(jobKey(scene)));

  function drawStrip() {
    strip.classList.toggle('hidden', !scene?.candidates.length);
    strip.replaceChildren(...(scene ? candidateStrip(scene, viewing, (cid) => view(cid)) : []));
  }

  // ---- 生成視窗(風格設定與 AI 畫整張) ----
  function drawGen() {
    const s = scene;
    if (!genBody) return;
    if (!s || mode !== 'edit') {
      closeGen();
      return;
    }
    genBody.replaceChildren(
      stylePanel(s, edit, {
        count,
        busy: rendering(),
        refUrl: (aid) => api.mockups.fileUrl(s.name, `assets/${aid}.png`),
        onCount: (n) => {
          count = n;
          drawSide();
        },
        addRef: () => void addRef(),
        render: () => {
          closeGen();
          void renderAI();
        },
      }));
  }

  function closeGen() {
    if (!genBody) return;
    genBody.closest('.lib-modal')?.remove();
    genBody = null;
    window.removeEventListener('keydown', onGenKey);
  }

  function onGenKey(e: KeyboardEvent) {
    if (e.key === 'Escape') closeGen();
  }

  genBtn.addEventListener('click', () => {
    if (!scene || genBody) return;
    genBody = el('div', { className: 'mk-gen-body' });
    const close = el('button', { text: '關閉' });
    close.addEventListener('click', closeGen);
    const overlay = el('div', { className: 'lib-modal' }, [el('div', { className: 'mk-gen-dialog' }, [
      el('div', { className: 'toolbar' }, [el('b', { text: '生成' }), el('span', { className: 'spacer' }), close]),
      genBody,
    ])]);
    overlay.addEventListener('pointerdown', (e) => {
      if (e.target === overlay) closeGen();
    });
    document.body.append(overlay);
    window.addEventListener('keydown', onGenKey);
    drawGen();
  });

  function drawLayers() {
    const s = scene;
    layers.classList.toggle('hidden', !s || mode !== 'edit' || formOpen);
    if (!s || mode !== 'edit' || formOpen) return;
    layers.replaceChildren(layerPanel(s, selected, {
      thumb: (aid) => api.mockups.fileUrl(s.name, `assets/${aid}.png`),
      onSelect: (id) => {
        selected = id;
        bgOn = false;
        drawSide();
        redraw();
      },
      onMove: (id, gap) => edit((sc) => moveLayer(sc, id, gap)),
      bgOn,
      onBackground: () => {
        selected = null;
        bgOn = true;
        drawSide();
        redraw();
      },
    }));
  }

  function drawSide() {
    drawLayers();
    if (formOpen) return;
    const s = scene;
    palette.classList.toggle('hidden', !s || (s.view !== 'flat' && !s.ground));
    if (!s) {
      palette.replaceChildren();
      side.replaceChildren(el('div', { className: 'mk-pad muted', text: '選一個場景, 或按「新場景」' }));
      return;
    }
    if (mode === 'view' && viewing) {
      const c = s.candidates.find((x) => x.id === viewing);
      palette.classList.add('hidden');
      if (c) {
        side.replaceChildren(candidatePanel(c, {
          box, preview, busy: cutBusy, raw: showRaw,
          onBack: () => back(),
          onRaw: (on) => {
            showRaw = on;
            loadCandidate();
            drawSide();
          },
          onDownload: () => download(api.mockups.fileUrl(s.name, candFile(c)),
            `${s.name}-候選${c.id.slice(1)}${showRaw && c.raw ? '-原圖' : ''}.png`),
          onDelete: () => void removeCandidate(c.id),
          onCut: () => void cut(),
          onSave: (name, tags) => void saveCut(name, tags),
        }));
      }
      return;
    }
    palette.replaceChildren(groundPanel(s, brush, (b) => {
      brush = b;
      tool = 'brush';
      sync();
      drawSide();
    }, edit));
    const o = s.objects.find((x) => x.id === selected);
    side.replaceChildren(o ? objectPanel(s, o, edit, removeSelected) : bgOn ? backgroundPanel(s, edit)
      : el('div', { className: 'mk-pad muted small', text: '點選圖層或畫布上的物件來編輯' }));
    drawGen();
  }

  function refresh() {
    sizeCanvas();
    sync();
    drawSide();
    drawStrip();
    redraw();
  }

  // ---- AI 畫整張、候選 ----
  async function addRef() {
    const s = scene;
    if (!s) return;
    const a = await pickAsset();
    if (!a || scene !== s || s.style.refs.includes(a.id)) return;
    try {
      await save();
      await api.mockups.addAsset(s.name, a.id);
      if (scene !== s) return;
      images.delete(a.id);
      edit((sc) => {
        sc.style.refs = [...sc.style.refs, a.id].slice(0, 4);
      }, true);
    } catch (e) {
      error(e);
    }
  }

  /** 素材圖都載好才畫得出正確的灰盒圖 */
  async function imagesReady() {
    await Promise.all([...images.values()].map((img) => img.decode().catch(() => undefined)));
  }

  async function renderAI() {
    const s = scene;
    if (!s || rendering()) return;
    renderBusy = true; // 送出前就鎖住, 存檔與產圖期間連點不會再付一次錢
    drawSide();
    try {
      await save();
      await imagesReady();
      const pngs = await renderPngs(s, images);
      const before = new Set(s.candidates.map((c) => c.id));
      const next = await trackJob(`AI 畫整張中(${count} 張)…`, jobKey(s),
        () => api.mockups.render(s.name, pngs.greybox, pngs.layer, count));
      if (scene !== s) return;
      s.candidates = next.candidates;
      s.nextCandidate = next.nextCandidate;
      const added = next.candidates.find((c) => !before.has(c.id));
      showBanner(banner, null);
      renderBusy = false;
      if (added) view(added.id);
      else refresh();
    } catch (e) {
      renderBusy = false;
      error(e);
      refresh();
    }
  }

  /** 換頁回來時 AI 還在跑: 跑完後重新讀候選 */
  const offJobs = onJobsChange(() => {
    const now = rendering();
    if (wasRendering && !now && scene) {
      const s = scene;
      api.mockups.get(s.name).then((next) => {
        if (scene !== s) return;
        s.candidates = next.candidates;
        s.nextCandidate = next.nextCandidate;
        refresh();
      }).catch(error);
    }
    wasRendering = now;
    if (mode === 'edit' && !selected && !formOpen) drawSide();
  });

  /** 目前要看的候選圖檔: 像素場景可切換看 AI 原圖 */
  const candFile = (c: Scene['candidates'][number]) => (showRaw && c.raw ? c.raw : `candidates/${c.id}.png`);

  function loadCandidate() {
    const c = scene?.candidates.find((x) => x.id === viewing);
    if (!scene || !c) return;
    candImg = new Image();
    candImg.onload = () => redraw();
    candImg.src = api.mockups.fileUrl(scene.name, candFile(c), c.id);
  }

  function view(cid: string) {
    if (!scene) return;
    mode = 'view';
    viewing = cid;
    box = null;
    preview = null;
    selected = null;
    bgOn = false;
    showRaw = false;
    loadCandidate();
    refresh();
  }

  function back() {
    mode = 'edit';
    viewing = null;
    candImg = null;
    box = null;
    preview = null;
    refresh();
  }

  async function removeCandidate(cid: string) {
    const s = scene;
    if (!s || !confirmDelete(`候選 ${cid.slice(1)}`)) return;
    try {
      const next = await api.mockups.removeCandidate(s.name, cid);
      if (scene !== s) return;
      s.candidates = next.candidates;
      back();
    } catch (e) {
      error(e);
    }
  }

  async function cut() {
    const s = scene;
    const cid = viewing;
    const b = box;
    if (!s || !cid || !b || cutBusy) return;
    cutBusy = true;
    drawSide();
    try {
      const r = await trackJob('去背中…', null, () => api.mockups.cut(s.name, cid, b));
      if (scene !== s || viewing !== cid) return;
      preview = { url: api.mockups.fileUrl(s.name, r.file, Date.now()), name: r.name, tags: { views: [s.view], type: r.type } };
      showBanner(banner, null);
    } catch (e) {
      error(e);
    } finally {
      cutBusy = false;
      drawSide();
    }
  }

  async function saveCut(name: string, tags: AssetTags) {
    const s = scene;
    const cid = viewing;
    if (!s || !cid) return;
    try {
      const a = await api.mockups.saveCut(s.name, cid, name, tags);
      showBanner(banner, 'info', `已存到素材庫: ${a.name}`);
      preview = null;
      box = null;
      refresh();
    } catch (e) {
      error(e);
    }
  }

  const detachCutter = attachCutter(canvas, {
    scene: () => scene,
    active: () => mode === 'view' && !cutBusy,
    setBox: (b, done) => {
      box = b;
      if (done) preview = null;
      redraw();
      if (done) drawSide();
    },
  });

  // ---- 編輯與存檔 ----
  const snapshotOf = (s: Scene) => JSON.stringify(bodyOf(s));

  /** 面板改值: 預設不重建面板(重建會吃掉滑鼠正要點的按鈕、讓焦點掉回頁面); 面板結構會變時傳 rebuild */
  const edit: Edit = (fn, rebuild = false) => {
    if (!scene) return;
    undoStack.push(snapshotOf(scene));
    fn(scene);
    loadImages();
    markDirty();
    sync();
    if (rebuild) drawSide();
    else drawLayers();
    drawStrip();
    redraw();
  };

  function markDirty() {
    dirty = true;
    sync();
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void save(), SAVE_DELAY);
  }

  function save(): Promise<void> {
    window.clearTimeout(saveTimer);
    if (!scene || !dirty) return saving;
    const s = scene;
    const body: SceneBody = JSON.parse(snapshotOf(s));
    dirty = false;
    saving = saving.then(() => api.mockups.save(s.name, body)).then((next) => {
      if (scene !== s) return;
      // 物件等內容以前端為準(存檔期間可能又改了), 只接後端管的欄位
      s.updated = next.updated;
      s.candidates = next.candidates;
      s.nextCandidate = next.nextCandidate;
      sync();
    }).catch((e) => {
      if (scene === s) dirty = true;
      error(e);
      sync();
    });
    return saving;
  }

  function restore(snap: string | null) {
    if (!scene || snap === null) return;
    Object.assign(scene, JSON.parse(snap) as SceneBody);
    if (selected && !scene.objects.some((o) => o.id === selected)) selected = null;
    loadImages();
    markDirty();
    refresh();
  }

  function removeSelected() {
    if (!selected) return;
    const id = selected;
    selected = null;
    edit((s) => {
      s.objects = s.objects.filter((o) => o.id !== id);
    }, true);
  }

  const detach = attachEditor(canvas, {
    scene: () => scene,
    rect: viewRect,
    active: () => !formOpen && mode === 'edit',
    tool: () => tool,
    brush: () => brush,
    selected: () => selected,
    select: (id) => {
      if (id === selected && !bgOn) return;
      selected = id;
      bgOn = false;
      drawSide();
      redraw();
    },
    snapshot: () => {
      if (scene) undoStack.push(snapshotOf(scene));
    },
    changed: (commit) => {
      redraw();
      if (commit) {
        markDirty();
        drawSide();
      }
    },
  });

  function setCamera(lv: CameraLevel) {
    if (!scene || scene.camera === lv) return;
    edit((s) => {
      s.camera = lv;
    }, true);
    viewZoom = Math.min(viewZoom, maxViewZoom(scene));
    refresh();
  }

  // 滾輪縮放編輯區(連同輸出框一起縮), 看得到框外的物件好拉回來
  function setViewZoom(z: number) {
    if (!scene) return;
    const next = Math.min(Math.max(z, 1), maxViewZoom(scene));
    if (Math.abs(next - viewZoom) < 1e-6) return;
    viewZoom = next;
    sizeCanvas();
    sync();
    redraw();
  }
  stage.addEventListener('wheel', (e) => {
    if (!scene || mode !== 'edit') return;
    e.preventDefault();
    setViewZoom(viewZoom * (e.deltaY > 0 ? 1.15 : 1 / 1.15));
  }, { passive: false });
  zoomBtn.addEventListener('click', () => setViewZoom(1));

  gridBtn.addEventListener('click', () => {
    showGrid = !showGrid;
    sync();
    redraw();
  });

  // ---- 新增物件(放在目前輸出框中間) ----
  addBoxBtn.addEventListener('click', () => {
    if (!scene) return;
    const [fx0, fy0, fx1, fy1] = frameRect(scene);
    const [cx, cy] = [(fx0 + fx1) / 2, (fy0 + fy1) / 2];
    const id = newObjectId(scene);
    const size = scene.pixel ? 16 : 128;
    const [ci, cj] = isoCell(scene.pixel, cx, cy).map((v) => snap(v - 0.5, 0.5));
    edit((s) => {
      s.objects.push(s.view === 'iso'
        ? { id, kind: 'block', label: '物件 object', color: DEFAULT_BOX_COLOR, type: null, i: ci, j: cj, w: 1, l: 1, h: s.pixel ? 24 : 60 }
        : { id, kind: 'box', label: '物件 object', color: DEFAULT_BOX_COLOR, type: null,
          x: Math.round(cx - size / 2), y: Math.round(cy - size / 2), w: size, h: size });
    });
    selected = id;
    bgOn = false;
    refresh();
  });

  addAssetBtn.addEventListener('click', async () => {
    if (!scene) return;
    const s = scene;
    const a = await pickAsset();
    if (!a || scene !== s) return;
    try {
      await save();
      const r = await api.mockups.addAsset(s.name, a.id);
      images.delete(a.id);
      loadImages();
      const img = new Image();
      img.src = api.mockups.fileUrl(s.name, `assets/${a.id}.png`, Date.now());
      await img.decode();
      images.set(a.id, img);
      if (scene !== s) return;
      // 一般: 目前畫面高度的 25%; 像素: 原圖像素大小, 大於畫面一半才縮
      const [fx0, fy0, fx1, fy1] = frameRect(s);
      const [fw, fh] = [fx1 - fx0, fy1 - fy0];
      const [nw, nh] = [img.naturalWidth, img.naturalHeight];
      const k = s.pixel ? Math.min(1, fw / 2 / nw, fh / 2 / nh) : (fh * 0.25) / Math.max(nw, nh);
      let [ow, oh] = [nw * k, nh * k];
      let [ox, oy] = [(fx0 + fx1 - ow) / 2, (fy0 + fy1 - oh) / 2];
      if (s.pixel) [ow, oh, ox, oy] = [Math.max(1, Math.round(ow)), Math.max(1, Math.round(oh)), Math.round(ox), Math.round(oy)];
      const id = newObjectId(s);
      edit((sc) => {
        sc.objects.push({ id, kind: 'asset', asset: a.id, name: r.asset.name, x: ox, y: oy, w: ow, h: oh, flip: false });
      });
      selected = id;
      bgOn = false;
      refresh();
    } catch (e) {
      error(e);
    }
  });

  selectTool.addEventListener('click', () => {
    tool = 'select';
    sync();
  });
  brushTool.addEventListener('click', () => {
    tool = 'brush';
    sync();
  });
  undoBtn.addEventListener('click', () => scene && restore(undoStack.undo(snapshotOf(scene))));
  redoBtn.addEventListener('click', () => scene && restore(undoStack.redo(snapshotOf(scene))));

  function onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (!scene || formOpen || genBody || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (mode === 'view') {
      if (e.key === 'Escape') back();
      return;
    }
    if (e.key === 'Delete' && selected) {
      e.preventDefault();
      removeSelected();
    } else if (e.ctrlKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      restore(undoStack.undo(snapshotOf(scene)));
    } else if (e.ctrlKey && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      restore(undoStack.redo(snapshotOf(scene)));
    }
  }
  window.addEventListener('keydown', onKey);

  // ---- 場景管理 ----
  /** 重建場景下拉選單, 回傳選中的名稱(want 不存在就是 null) */
  async function fillList(want: string | null): Promise<string | null> {
    const list = await api.mockups.list();
    sceneSel.replaceChildren(option('', list.length ? '(選擇場景)' : '(還沒有場景)'),
      ...list.map((m) => option(m.name, m.name)));
    const pick = want && list.some((m) => m.name === want) ? want : null;
    sceneSel.value = pick ?? '';
    return pick;
  }

  async function loadList(want: string | null) {
    const pick = await fillList(want);
    if (!alive) return;
    await open(pick);
  }

  async function open(name: string | null) {
    await save();
    scene = null;
    selected = null;
    bgOn = false;
    mode = 'edit';
    viewZoom = 1;
    viewing = null;
    candImg = null;
    box = null;
    preview = null;
    images.clear();
    undoStack.clear();
    if (name) {
      try {
        scene = await api.mockups.get(name);
      } catch (e) {
        error(e);
      }
    }
    if (!alive) return;
    wasRendering = rendering();
    canvas.classList.toggle('hidden', !scene);
    history.replaceState(null, '', scene ? `#/mockup?scene=${encodeURIComponent(scene.name)}` : '#/mockup');
    loadImages();
    refresh();
  }

  sceneSel.addEventListener('change', () => void open(sceneSel.value || null));

  newBtn.addEventListener('click', () => {
    formOpen = true;
    drawLayers();
    side.replaceChildren(newSceneForm(async (name, view, empty, pixel, camera) => {
      try {
        await api.mockups.create(name, view, empty, pixel, camera);
        formOpen = false;
        showBanner(banner, null);
        await loadList(name);
      } catch (e) {
        error(e);
      }
    }, () => {
      formOpen = false;
      drawSide();
    }));
  });

  renameBtn.addEventListener('click', async () => {
    if (!scene) return;
    if (rendering()) {
      showBanner(banner, 'info', 'AI 畫整張還在跑, 跑完再改名');
      return;
    }
    const s = scene;
    const to = prompt('新的場景名稱', s.name)?.trim();
    if (!to || to === s.name) return;
    try {
      await save(); // 還沒送出的修改先存到舊名稱
      if (dirty) return; // 存檔失敗, 錯誤已顯示
      const next = await api.mockups.rename(s.name, to);
      // 改名只換資料夾, 畫面上的場景與復原紀錄照舊
      s.name = next.name;
      s.updated = next.updated;
      if (scene === s) history.replaceState(null, '', `#/mockup?scene=${encodeURIComponent(s.name)}`);
      await fillList(scene?.name ?? null);
      showBanner(banner, null);
    } catch (e) {
      error(e);
    }
  });

  deleteBtn.addEventListener('click', async () => {
    if (!scene || !confirmDelete(`場景「${scene.name}」(含所有候選圖)`)) return;
    try {
      window.clearTimeout(saveTimer);
      dirty = false;
      await api.mockups.remove(scene.name);
      await loadList(null);
    } catch (e) {
      error(e);
    }
  });

  const ro = new ResizeObserver(() => fit());
  ro.observe(stage);
  loadList(params.get('scene')).catch(error);

  const canLeave = () => {
    void save(); // 自動存檔: 離開前把還沒送出的修改送出
    return true;
  };
  return Object.assign(() => {
    void save();
    alive = false;
    closeGen();
    ro.disconnect();
    detach();
    detachCutter();
    offJobs();
    window.removeEventListener('keydown', onKey);
  }, { canLeave });
}
