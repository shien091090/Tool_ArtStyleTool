/** 去除區塊節點: 魔術棒點選移除或保留, 橡皮擦直接擦掉。 */
import { el, iconButton, showBanner } from '../../pages/ui';
import { applyOps, DEFAULT_TOL, eraseSegment, MAX_TOL, type CutoutOp, type EraseOp, type Img, type WandOp } from '../magicWand';
import type { EditorContext, NodeEditor } from './types';

export async function loadImageData(url: string): Promise<Img> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('圖片載入失敗'));
    img.src = url;
  });
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  return g.getImageData(0, 0, c.width, c.height);
}

export function imgToBlob(img: Img): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG 編碼失敗'))), 'image/png'));
}

export function readOps(params: Record<string, unknown>): CutoutOp[] {
  return Array.isArray(params.ops) ? (params.ops as CutoutOp[]) : [];
}

/** 橡皮擦筆刷直徑(畫面像素) */
const BRUSH_MIN = 2;
const BRUSH_MAX = 120;
const BRUSH_DEFAULT = 24;

export function mountCutoutEditor(body: HTMLElement, ctx: EditorContext): NodeEditor {
  let src: Img | null = null;
  /** 目前畫面上的結果(src 套完所有操作), 擦的時候直接改它 */
  let cur: Img | null = null;
  let ops = readOps(ctx.node.params);
  let tool = 'wand' as 'wand' | 'erase';
  let dirty = false;
  let mode: WandOp['mode'] = 'remove';
  let how: WandOp['how'] = 'color';

  const canvas = el('canvas', { className: 'fe-canvas checker' });
  const brush = el('div', { className: 'fe-brush hidden' });
  const stage = el('div', { className: 'fe-stage' }, [canvas, brush]);

  const seg = <T extends string>(items: [T, string][], get: () => T, set: (v: T) => void) => {
    const btns = items.map(([v, text]) => {
      const b = el('button', { text });
      b.addEventListener('click', () => {
        set(v);
        sync();
      });
      return [v, b] as const;
    });
    return { root: el('div', { className: 'seg' }, btns.map(([, b]) => b)), sync: () => btns.forEach(([v, b]) => b.classList.toggle('active', v === get())) };
  };
  const toolSeg = seg<typeof tool>([['wand', '魔術棒'], ['erase', '橡皮擦']], () => tool, (v) => (tool = v));
  const size = el('input');
  size.type = 'range';
  size.min = String(BRUSH_MIN);
  size.max = String(BRUSH_MAX);
  size.value = String(BRUSH_DEFAULT);
  const sizeVal = el('span', { className: 'muted small' });
  const modeSeg = seg<WandOp['mode']>([['remove', '移除'], ['keep', '保留']], () => mode, (v) => (mode = v));
  const howSeg = seg<WandOp['how']>([['color', '顏色相近'], ['object', '整塊物件']], () => how, (v) => (how = v));
  const tol = el('input');
  tol.type = 'range';
  tol.min = '0';
  tol.max = String(MAX_TOL);
  tol.value = String(DEFAULT_TOL);
  const tolVal = el('span', { className: 'muted small' });
  const contiguous = el('input');
  contiguous.type = 'checkbox';
  contiguous.checked = true;
  const grow = el('input');
  grow.type = 'checkbox';
  grow.checked = true;
  const undoBtn = iconButton('undo', '復原');
  const resetBtn = el('button', { text: '全部重來' });
  const applyBtn = el('button', { text: '套用', className: 'primary' });
  const hint = el('div', { className: 'muted small' });
  const tolRow = el('label', {}, ['容許差異', tol, tolVal]);
  const contRow = el('label', {}, [contiguous, '只選相連']);
  const growRow = el('label', {}, [grow, '邊緣外擴 1px']);
  const section = (title: string, ...children: (Node | string)[]) =>
    el('section', { className: 'prop-section' }, [el('h3', { text: title }), ...children]);
  const wandParts = [
    section('點圖上的區塊', modeSeg.root, hint),
    section('選取方式', howSeg.root, tolRow, contRow, growRow),
  ];
  const eraseParts = [
    section('橡皮擦', el('label', {}, ['筆刷大小', size, sizeVal]),
      el('div', { className: 'muted small', text: '在圖上按住拖拉, 擦到的地方變透明' })),
  ];
  const side = el('div', { className: 'panel-wrap prop-panel' }, [
    section('工具', toolSeg.root),
    ...wandParts,
    ...eraseParts,
    section('操作', el('div', { className: 'row' }, [undoBtn, resetBtn]), el('div', { className: 'row' }, [applyBtn])),
  ]);
  body.append(el('div', { className: 'prop-layout' }, [stage, side]));

  function draw() {
    if (!src) return;
    cur = applyOps(src, ops);
    canvas.width = cur.width;
    canvas.height = cur.height;
    paint();
    fit();
  }

  function paint() {
    if (cur) canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(cur.data), cur.width, cur.height), 0, 0);
  }

  /** 放進畫面: 大圖等比縮小, 小圖(像素圖)整數倍放大才點得到 */
  function fit() {
    if (!canvas.width) return;
    const fitScale = Math.min((stage.clientWidth - 32) / canvas.width, (stage.clientHeight - 32) / canvas.height);
    const k = fitScale >= 2 ? Math.floor(fitScale) : Math.min(1, fitScale);
    canvas.style.width = `${Math.max(1, Math.floor(canvas.width * k))}px`;
    canvas.style.height = `${Math.max(1, Math.floor(canvas.height * k))}px`;
    canvas.style.imageRendering = k >= 2 ? 'pixelated' : 'auto';
  }
  const observer = new ResizeObserver(fit);
  observer.observe(stage);

  function sync() {
    toolSeg.sync();
    wandParts.forEach((p) => p.classList.toggle('hidden', tool !== 'wand'));
    eraseParts.forEach((p) => p.classList.toggle('hidden', tool !== 'erase'));
    canvas.classList.toggle('erasing', tool === 'erase');
    if (tool !== 'erase') brush.classList.add('hidden');
    sizeVal.textContent = `${size.value}px`;
    modeSeg.sync();
    howSeg.sync();
    tolVal.textContent = tol.value;
    tolRow.classList.toggle('hidden', how !== 'color');
    contRow.classList.toggle('hidden', how !== 'color');
    grow.disabled = mode !== 'remove';
    hint.textContent = mode === 'remove' ? '點到的區塊會被去掉' : '點到的區塊留下, 其他全部去掉';
    undoBtn.disabled = !ops.length;
    resetBtn.disabled = !ops.length;
    applyBtn.disabled = !src || !dirty;
    applyBtn.textContent = dirty ? '套用' : '已套用';
  }

  canvas.addEventListener('click', (e) => {
    if (!src || tool !== 'wand') return;
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    if (x < 0 || y < 0 || x >= 1 || y >= 1) return;
    const op: WandOp = { mode, how, x, y, tol: Number(tol.value), contiguous: contiguous.checked, grow: grow.checked && mode === 'remove' };
    const before = applyOps(src, ops);
    const after = applyOps(before, [op]);
    if (after.data.every((v, i) => v === before.data[i])) {
      showBanner(ctx.banner, 'info', '這裡已經是透明的, 沒有可以選的區塊');
      return;
    }
    showBanner(ctx.banner, null);
    ops = [...ops, op];
    dirty = true;
    draw();
    sync();
  });
  tol.addEventListener('input', sync);
  size.addEventListener('input', sync);

  // ---- 橡皮擦 ----
  function moveBrush(e: PointerEvent) {
    if (tool !== 'erase') return;
    const st = stage.getBoundingClientRect();
    const d = Number(size.value);
    brush.style.width = brush.style.height = `${d}px`;
    brush.style.left = `${e.clientX - st.left - d / 2}px`;
    brush.style.top = `${e.clientY - st.top - d / 2}px`;
    brush.classList.remove('hidden');
  }
  canvas.addEventListener('pointerleave', () => brush.classList.add('hidden'));
  canvas.addEventListener('pointermove', moveBrush);
  canvas.addEventListener('pointerdown', (e) => {
    if (!cur || tool !== 'erase' || e.button !== 0) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const img = cur;
    const rect = canvas.getBoundingClientRect();
    // 畫面上的筆刷直徑換成圖的像素
    const radius = (Number(size.value) / 2) * (img.width / rect.width);
    const stroke: EraseOp = { tool: 'erase', points: [], r: radius / Math.max(img.width, img.height) };
    const at = (ev: PointerEvent): [number, number] => [(ev.clientX - rect.left) / rect.width, (ev.clientY - rect.top) / rect.height];
    const add = (ev: PointerEvent) => {
      const p = at(ev);
      const prev = stroke.points.at(-1) ?? p;
      stroke.points.push(p);
      eraseSegment(img, prev[0] * img.width, prev[1] * img.height, p[0] * img.width, p[1] * img.height, radius);
      paint();
    };
    const move = (ev: PointerEvent) => add(ev);
    const up = () => {
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      ops = [...ops, stroke];
      dirty = true;
      showBanner(ctx.banner, null);
      sync();
    };
    add(e);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
  });
  undoBtn.addEventListener('click', () => {
    ops = ops.slice(0, -1);
    dirty = true;
    draw();
    sync();
  });
  resetBtn.addEventListener('click', () => {
    ops = [];
    dirty = true;
    draw();
    sync();
  });
  applyBtn.addEventListener('click', () => void (async () => {
    if (!src || !ctx.upstream) return;
    ctx.status.textContent = '套用中…';
    applyBtn.disabled = true;
    try {
      await ctx.save({ file: await imgToBlob(applyOps(src, ops)) }, { inputRev: ctx.upstream.rev, params: { ops } });
      dirty = false;
    } catch (e) {
      showBanner(ctx.banner, 'error', (e as Error).message);
    } finally {
      ctx.status.textContent = '';
      sync();
    }
  })());

  sync();
  if (!ctx.upstreamUrl) {
    stage.replaceChildren(el('div', { className: 'muted', text: '上游還沒有輸出: 先接上圖片輸入節點並選圖' }));
  } else {
    void loadImageData(ctx.upstreamUrl).then((img) => {
      src = img;
      // 第一次打開且還沒有輸出: 直接當作有修改, 讓使用者一按就能套用
      dirty = ctx.node.rev === 0 || ctx.node.inputRev !== ctx.upstream?.rev;
      draw();
      sync();
    }).catch((e) => showBanner(ctx.banner, 'error', (e as Error).message));
  }

  return {
    unsaved: () => (dirty && ops.length ? '去除區塊有還沒套用的修改' : null),
    dispose: () => observer.disconnect(),
  };
}
