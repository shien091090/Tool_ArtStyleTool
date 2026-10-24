/** 遊戲示意頁: 場景管理、灰盒/素材/地面格編輯、自動存檔與復原。 */
import { api } from '../api';
import { VIEW_LABEL, type ViewKey } from '../library/model';
import { pickAsset } from '../library/picker';
import { drawScene, type Images } from '../mockup/draw';
import { attachEditor } from '../mockup/editor';
import { createHistory } from '../mockup/history';
import { bodyOf, CANVAS, DEFAULT_BOX_COLOR, newObjectId, type Scene, type SceneBody } from '../mockup/model';
import { backgroundPanel, groundPanel, newSceneForm, objectPanel, type Edit } from '../mockup/panels';
import { confirmDelete, el, option, showBanner } from './ui';

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
  const images: Images = new Map();
  const undoStack = createHistory<string>();

  // ---- 版面 ----
  const banner = el('div');
  const sceneSel = el('select');
  const deleteBtn = el('button', { text: '刪除場景' });
  const newBtn = el('button', { text: '新場景' });
  const undoBtn = el('button', { text: '復原', title: 'Ctrl+Z' });
  const redoBtn = el('button', { text: '重做', title: 'Ctrl+Y' });
  const addBoxBtn = el('button', { text: '+ 灰盒' });
  const addAssetBtn = el('button', { text: '擺入素材' });
  const selectTool = el('button', { text: '選取' });
  const brushTool = el('button', { text: '地面筆刷' });
  const status = el('span', { className: 'muted small' });
  root.append(
    el('div', { className: 'toolbar' }, [
      el('label', {}, ['場景', sceneSel]), deleteBtn, undoBtn, redoBtn, addBoxBtn, addAssetBtn, selectTool, brushTool, status,
      el('span', { className: 'spacer' }), newBtn,
    ]),
    banner,
  );
  const canvas = el('canvas');
  const stage = el('div', { className: 'mk-stage' }, [canvas]);
  const palette = el('div', { className: 'mk-palette' });
  const side = el('div', { className: 'mk-side' });
  root.append(el('div', { className: 'mk-body' }, [palette, stage, side]));

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
    for (const b of [undoBtn, redoBtn, addBoxBtn, addAssetBtn, selectTool]) b.disabled = !scene;
    brushTool.disabled = !scene?.ground;
    if (!scene?.ground && tool === 'brush') tool = 'select';
    selectTool.classList.toggle('primary', tool === 'select');
    brushTool.classList.toggle('primary', tool === 'brush');
    status.textContent = !scene ? '' : dirty ? '有修改尚未存檔…' : '已存檔';
    stage.classList.toggle('brush', tool === 'brush');
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
    palette.replaceChildren(groundPanel(s, brush, (b) => {
      brush = b;
      tool = 'brush';
      sync();
      drawSide();
    }, edit));
    const o = s.objects.find((x) => x.id === selected);
    side.replaceChildren(o ? objectPanel(s, o, edit, removeSelected) : backgroundPanel(s, edit));
  }

  function refresh() {
    sync();
    drawSide();
    redraw();
  }

  // ---- 編輯與存檔 ----
  const snapshotOf = (s: Scene) => JSON.stringify(bodyOf(s));

  const edit: Edit = (fn) => {
    if (!scene) return;
    undoStack.push(snapshotOf(scene));
    fn(scene);
    loadImages();
    markDirty();
    refresh();
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
    });
  }

  const detach = attachEditor(canvas, {
    scene: () => scene,
    active: () => !formOpen,
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
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
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
    window.removeEventListener('keydown', onKey);
  }, { canLeave });
}
