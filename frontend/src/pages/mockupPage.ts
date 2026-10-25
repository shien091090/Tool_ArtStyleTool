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
import { bodyOf, CANVAS, DEFAULT_BOX_COLOR, newObjectId, type Scene, type SceneBody } from '../mockup/model';
import { backgroundPanel, groundPanel, newSceneForm, objectPanel, stylePanel, type Edit } from '../mockup/panels';
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
  const images: Images = new Map();
  const undoStack = createHistory<string>();

  // ---- 版面 ----
  const banner = el('div');
  const sceneSel = el('select');
  const deleteBtn = el('button', { text: '刪除場景' });
  const newBtn = el('button', { text: '新場景' });
  const undoBtn = iconButton('undo', '復原 (Ctrl+Z)');
  const redoBtn = iconButton('redo', '重做 (Ctrl+Y)');
  const addBoxBtn = el('button', { text: '+ 灰盒' });
  const addAssetBtn = el('button', { text: '擺入素材' });
  const selectTool = el('button', { text: '選取' });
  const brushTool = el('button', { text: '地面筆刷' });
  const status = el('span', { className: 'muted small' });
  root.append(
    el('div', { className: 'toolbar' }, [
      el('label', {}, ['場景', sceneSel]), deleteBtn, undoBtn, redoBtn, status,
      el('span', { className: 'spacer' }), newBtn,
    ]),
    banner,
  );
  const canvas = el('canvas');
  const stage = el('div', { className: 'mk-stage' }, [canvas]);
  const sceneTools = el('div', { className: 'mk-tools' }, [addBoxBtn, addAssetBtn, selectTool, brushTool]);
  const palette = el('div', { className: 'mk-palette' });
  const side = el('div', { className: 'mk-side' });
  const strip = el('div', { className: 'mk-cands hidden' });
  root.append(el('div', { className: 'mk-body' }, [palette, el('div', { className: 'mk-center' }, [sceneTools, stage]), side]), strip);

  function error(e: unknown) {
    showBanner(banner, 'error', (e as Error).message);
  }

  // ---- 繪製 ----
  function fit() {
    if (!scene) return;
    const [w, h] = CANVAS[scene.view];
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
    drawScene(canvas.getContext('2d')!, scene, images, { selected });
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
    const editing = !!scene && mode === 'edit';
    for (const b of [undoBtn, redoBtn, addBoxBtn, addAssetBtn, selectTool]) b.disabled = !editing;
    brushTool.disabled = !editing || !scene?.ground;
    if (!scene?.ground && tool === 'brush') tool = 'select';
    selectTool.classList.toggle('primary', tool === 'select');
    brushTool.classList.toggle('primary', tool === 'brush');
    status.textContent = !scene ? '' : dirty ? '有修改尚未存檔…' : '已存檔';
    stage.classList.toggle('brush', editing && tool === 'brush');
    stage.classList.toggle('cutting', mode === 'view');
  }

  const jobKey = (s: Scene) => `mockup:${s.name}`;
  const rendering = () => renderBusy || (!!scene && !!runningJob(jobKey(scene)));

  function drawStrip() {
    strip.classList.toggle('hidden', !scene?.candidates.length);
    strip.replaceChildren(...(scene ? candidateStrip(scene, viewing, (cid) => view(cid)) : []));
  }

  function drawSide() {
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
          box, preview, busy: cutBusy,
          onBack: () => back(),
          onDownload: () => download(api.mockups.fileUrl(s.name, `candidates/${c.id}.png`), `${s.name}-候選${c.id.slice(1)}.png`),
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
    side.replaceChildren(...(o ? [objectPanel(s, o, edit, removeSelected)] : [
      stylePanel(s, edit, {
        count,
        busy: rendering(),
        refUrl: (aid) => api.mockups.fileUrl(s.name, `assets/${aid}.png`),
        onCount: (n) => {
          count = n;
          drawSide();
        },
        addRef: () => void addRef(),
        render: () => void renderAI(),
      }),
      backgroundPanel(s, edit),
    ]));
  }

  function refresh() {
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

  function view(cid: string) {
    if (!scene) return;
    mode = 'view';
    viewing = cid;
    box = null;
    preview = null;
    selected = null;
    candImg = new Image();
    candImg.onload = () => redraw();
    candImg.src = api.mockups.fileUrl(scene.name, `candidates/${cid}.png`, cid);
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
    active: () => !formOpen && mode === 'edit',
    tool: () => tool,
    brush: () => brush,
    selected: () => selected,
    select: (id) => {
      if (id === selected) return;
      selected = id;
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

  // ---- 新增物件 ----
  addBoxBtn.addEventListener('click', () => {
    if (!scene) return;
    const [w, h] = CANVAS[scene.view];
    const id = newObjectId(scene);
    edit((s) => {
      s.objects.push(s.view === 'iso'
        ? { id, kind: 'block', label: '物件 object', color: DEFAULT_BOX_COLOR, type: null, i: 4.5, j: 4.5, w: 1, l: 1, h: 60 }
        : { id, kind: 'box', label: '物件 object', color: DEFAULT_BOX_COLOR, type: null, x: w / 2 - 64, y: h / 2 - 64, w: 128, h: 128 });
    });
    selected = id;
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
      const [w, h] = CANVAS[s.view];
      const k = (h * 0.25) / Math.max(img.naturalWidth, img.naturalHeight);
      const ow = img.naturalWidth * k;
      const oh = img.naturalHeight * k;
      const id = newObjectId(s);
      edit((sc) => {
        sc.objects.push({ id, kind: 'asset', asset: a.id, name: r.asset.name, x: (w - ow) / 2, y: (h - oh) / 2, w: ow, h: oh, flip: false });
      });
      selected = id;
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
    if (!scene || formOpen || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
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
  async function loadList(want: string | null) {
    const list = await api.mockups.list();
    if (!alive) return;
    sceneSel.replaceChildren(option('', list.length ? '(選擇場景)' : '(還沒有場景)'),
      ...list.map((m) => option(m.name, `${m.name}(${VIEW_LABEL[m.view as ViewKey] ?? m.view})`)));
    const pick = want && list.some((m) => m.name === want) ? want : null;
    sceneSel.value = pick ?? '';
    await open(pick);
  }

  async function open(name: string | null) {
    await save();
    scene = null;
    selected = null;
    mode = 'edit';
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
    const [w, h] = scene ? CANVAS[scene.view] : [1, 1];
    canvas.width = w;
    canvas.height = h;
    canvas.classList.toggle('hidden', !scene);
    history.replaceState(null, '', scene ? `#/mockup?scene=${encodeURIComponent(scene.name)}` : '#/mockup');
    loadImages();
    fit();
    refresh();
  }

  sceneSel.addEventListener('change', () => void open(sceneSel.value || null));

  newBtn.addEventListener('click', () => {
    formOpen = true;
    side.replaceChildren(newSceneForm(async (name, view, empty) => {
      try {
        await api.mockups.create(name, view, empty);
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
    ro.disconnect();
    detach();
    detachCutter();
    offJobs();
    window.removeEventListener('keydown', onKey);
  }, { canLeave });
}
