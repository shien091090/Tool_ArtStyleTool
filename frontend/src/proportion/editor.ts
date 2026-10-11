/** 部位比例的畫布: 顯示拼貼或素材圖、遮罩疊色、選取把手、拖曳變形、點選/框選修正、結果對照。 */
import type { Part, PartTransform, SegBox, WorkMeta } from './model';
import { collageSize, drawCollage, drawSourceView, hitPart, layerMatrix, type WorkAssets } from './draw';
import { anchorPoint, applyMat, bboxEdges, invert, isDrawn, partMatrix, placedEdges, type Mat } from './transform';

export type Tool = 'move' | 'point' | 'box';

export interface EditorState {
  meta: WorkMeta;
  assets: WorkAssets;
  /** 'main' = 主圖拼貼; 其他 = 素材圖 id */
  view: string;
  tool: Tool;
  selected: string | null;
  showMasks: boolean;
  /** 個別關掉遮罩上色的部位 */
  maskOff: ReadonlySet<string>;
  lockRatio: boolean;
  /** AI 呼叫進行中: 不接受改動作品的操作 */
  locked: boolean;
  /** 結果對照: 左邊主圖, 右邊結果 */
  compare: CompareView | null;
}

/** 結果對照: 結果用當時的畫布擴大量對齊原圖 */
export interface CompareView {
  result: HTMLImageElement;
  split: number;
  pad: { top: number; left: number };
}

export interface EditorCallbacks {
  onSelect(partId: string | null): void;
  onTransform(partId: string, t: PartTransform, final: boolean): void;
  /** 座標已換成選中部位所屬圖的座標; 沒選部位時是目前檢視圖的座標 */
  onPoint(x: number, y: number, label: 0 | 1): void;
  onBox(box: SegBox): void;
  onSplit(split: number): void;
}

type Drag =
  | { kind: 'move'; id: string; sx: number; sy: number; t0: PartTransform; w: number; h: number }
  | { kind: 'scale'; id: string; wx: number; wy: number; v0: [number, number]; t0: PartTransform }
  | { kind: 'rotate'; id: string; wx: number; wy: number; a0: number; t0: PartTransform }
  | { kind: 'box'; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'split' };

const HANDLE = 7;
const MIN_SCALE = 0.05;
const MAX_SCALE = 20;
const clampScale = (v: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.abs(v)));

export class Editor {
  readonly canvas = document.createElement('canvas');
  private state: EditorState | null = null;
  private base = document.createElement('canvas');
  private scale = 1;
  private frameW = 1;
  private frameH = 1;
  private ox = 0;
  private oy = 0;
  private drag: Drag | null = null;
  private observer: ResizeObserver;

  constructor(private container: HTMLElement, private cb: EditorCallbacks) {
    this.canvas.className = 'prop-canvas';
    container.append(this.canvas);
    this.observer = new ResizeObserver(() => this.render());
    this.observer.observe(container);
    this.canvas.addEventListener('pointerdown', this.down);
    this.canvas.addEventListener('pointermove', this.move);
    this.canvas.addEventListener('pointerup', this.up);
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  destroy() {
    this.observer.disconnect();
    this.canvas.remove();
  }

  /** 換資料時重畫底圖; 只動把手時用 render()。 */
  set(state: EditorState) {
    this.state = state;
    this.redrawBase();
    this.render();
  }

  private padOf(): { left: number; top: number } {
    const s = this.state!;
    return s.view === 'main' ? { left: s.meta.pad.left, top: s.meta.pad.top } : { left: 0, top: 0 };
  }

  private redrawBase() {
    const s = this.state!;
    if (s.view === 'main') {
      const { w, h } = collageSize(s.meta);
      this.base.width = w;
      this.base.height = h;
      drawCollage(this.base.getContext('2d')!, s.meta, s.assets);
    } else {
      const img = s.assets.images.get(s.view);
      if (!img) return;
      this.base.width = img.naturalWidth;
      this.base.height = img.naturalHeight;
      drawSourceView(this.base.getContext('2d')!, s.meta, s.assets, s.view);
    }
  }

  // ---- 座標 ----
  /** 畫面像素 → 檢視圖座標(主圖座標或素材圖座標) */
  private toImage(e: PointerEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const px = (e.clientX - r.left) * dpr;
    const py = (e.clientY - r.top) * dpr;
    const pad = this.padOf();
    return [(px - this.ox) / this.scale - pad.left, (py - this.oy) / this.scale - pad.top];
  }

  private toScreen(x: number, y: number): [number, number] {
    const pad = this.padOf();
    return [(x + pad.left) * this.scale + this.ox, (y + pad.top) * this.scale + this.oy];
  }

  private part(id: string | null): Part | undefined {
    return id ? this.state!.meta.parts.find((p) => p.id === id) : undefined;
  }

  /** 這張檢視圖上看得到、可點選的部位(由上往下)。 */
  private visibleParts(): Part[] {
    const s = this.state!;
    const list = s.view === 'main'
      ? s.meta.parts.filter((p) => (p.image === 'main' ? !p.transform.hidden : p.placed))
      : s.meta.parts.filter((p) => p.image === s.view);
    return list.sort((a, b) => b.transform.z - a.transform.z);
  }

  /** 部位在目前檢視圖上用的矩陣(部位所屬圖座標 → 檢視圖座標)。 */
  private viewMatrix(p: Part): Mat {
    return this.state!.view === 'main' && isDrawn(p) ? partMatrix(p) : [1, 0, 0, 1, 0, 0];
  }

  private corners(p: Part): [number, number][] {
    const m = this.viewMatrix(p);
    const e = bboxEdges(p.bbox);
    return [applyMat(m, e.x0, e.y0), applyMat(m, e.x1, e.y0), applyMat(m, e.x1, e.y1), applyMat(m, e.x0, e.y1)].map(
      ([x, y]) => this.toScreen(x, y),
    );
  }

  /** 錨點在主圖座標的位置(變形後) */
  private anchorWorld(p: Part): [number, number] {
    const [ax, ay] = anchorPoint(p);
    const e = placedEdges(p);
    return [ax + p.transform.dx * e.w, ay + p.transform.dy * e.h];
  }

  private rotateHandle(p: Part): [number, number] {
    const c = this.corners(p);
    const mx = (c[0][0] + c[1][0]) / 2;
    const my = (c[0][1] + c[1][1]) / 2;
    const cx = (c[0][0] + c[2][0]) / 2;
    const cy = (c[0][1] + c[2][1]) / 2;
    const len = Math.hypot(mx - cx, my - cy) || 1;
    const dpr = window.devicePixelRatio || 1;
    return [mx + ((mx - cx) / len) * 28 * dpr, my + ((my - cy) / len) * 28 * dpr];
  }

  private canTransform(p: Part | undefined): p is Part {
    const s = this.state!;
    return !!p && s.view === 'main' && s.tool === 'move' && (p.image === 'main' ? !p.transform.hidden : p.placed);
  }

  // ---- 繪製 ----
  render() {
    const s = this.state;
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.max(1, Math.round(this.container.clientWidth * dpr));
    const ch = Math.max(1, Math.round(this.container.clientHeight * dpr));
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
    const ctx = this.canvas.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    if (!s || !this.base.width) return;
    const margin = 24 * dpr;
    const cmp = s.compare && s.view === 'main' ? s.compare : null;
    this.frameW = cmp ? cmp.result.naturalWidth : this.base.width;
    this.frameH = cmp ? cmp.result.naturalHeight : this.base.height;
    this.scale = Math.min((cw - margin * 2) / this.frameW, (ch - margin * 2) / this.frameH);
    this.ox = (cw - this.frameW * this.scale) / 2;
    this.oy = (ch - this.frameH * this.scale) / 2;
    const bw = this.frameW * this.scale;
    const bh = this.frameH * this.scale;

    // 畫布範圍與主圖範圍
    ctx.fillStyle = '#ffffff10';
    ctx.fillRect(this.ox, this.oy, bw, bh);
    ctx.imageSmoothingQuality = 'high';

    if (cmp) {
      this.renderCompare(ctx, cmp, bw, bh);
      return;
    }
    ctx.drawImage(this.base, this.ox, this.oy, bw, bh);
    if (s.view === 'main' && (s.meta.pad.left || s.meta.pad.top || s.meta.pad.right || s.meta.pad.bottom)) {
      const main = s.meta.images.find((i) => i.id === 'main')!;
      const [x0, y0] = this.toScreen(0, 0);
      ctx.strokeStyle = '#ffffff55';
      ctx.setLineDash([6 * dpr, 4 * dpr]);
      ctx.strokeRect(x0, y0, main.w * this.scale, main.h * this.scale);
      ctx.setLineDash([]);
    }

    if (s.showMasks) {
      ctx.globalAlpha = 0.45;
      for (const p of [...this.visibleParts()].reverse()) {
        if (s.maskOff.has(p.id)) continue;
        const layer = s.assets.layers.get(p.id);
        if (!layer) continue;
        const pad = this.padOf();
        const m: Mat = s.view === 'main' && isDrawn(p)
          ? layerMatrix(p, layer, pad.left, pad.top)
          : [1, 0, 0, 1, layer.ox + pad.left, layer.oy + pad.top];
        ctx.setTransform(m[0] * this.scale, m[1] * this.scale, m[2] * this.scale, m[3] * this.scale,
          m[4] * this.scale + this.ox, m[5] * this.scale + this.oy);
        ctx.drawImage(layer.tint, 0, 0);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
    }

    const sel = this.part(s.selected);
    if (sel && this.visibleParts().includes(sel)) this.renderSelection(ctx, sel, dpr);
    if (this.drag?.kind === 'box') {
      const d = this.drag;
      const [x0, y0] = this.toScreen(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1));
      const [x1, y1] = this.toScreen(Math.max(d.x0, d.x1), Math.max(d.y0, d.y1));
      ctx.strokeStyle = '#6ea8fe';
      ctx.lineWidth = 2 * dpr;
      ctx.setLineDash([6 * dpr, 4 * dpr]);
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      ctx.setLineDash([]);
    }
  }

  private renderSelection(ctx: CanvasRenderingContext2D, p: Part, dpr: number) {
    const c = this.corners(p);
    ctx.strokeStyle = p.color;
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    c.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.stroke();
    // 修正點
    const m = this.viewMatrix(p);
    for (const pt of p.points) {
      const [x, y] = this.toScreen(...applyMat(m, pt.x + 0.5, pt.y + 0.5));
      ctx.fillStyle = pt.label ? '#30a46c' : '#e5484d';
      ctx.beginPath();
      ctx.arc(x, y, 5 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5 * dpr;
      ctx.stroke();
    }
    if (!this.canTransform(p)) return;
    const h = HANDLE * dpr;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1 * dpr;
    for (const [x, y] of c) {
      ctx.fillRect(x - h / 2, y - h / 2, h, h);
      ctx.strokeRect(x - h / 2, y - h / 2, h, h);
    }
    const [rx, ry] = this.rotateHandle(p);
    const mx = (c[0][0] + c[1][0]) / 2;
    const my = (c[0][1] + c[1][1]) / 2;
    ctx.strokeStyle = p.color;
    ctx.beginPath();
    ctx.moveTo(mx, my);
    ctx.lineTo(rx, ry);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(rx, ry, h * 0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    const [ax, ay] = this.toScreen(...this.anchorWorld(p));
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(ax, ay, 4 * dpr, 0, Math.PI * 2);
    ctx.fill();
  }

  private renderCompare(ctx: CanvasRenderingContext2D, cmp: CompareView, bw: number, bh: number) {
    const s = this.state!;
    const sx = this.ox + bw * cmp.split;
    // 左: 原主圖(放在擴大後的畫布對應位置)
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.ox, this.oy, sx - this.ox, bh);
    ctx.clip();
    const main = s.assets.images.get('main')!;
    const mx = this.ox + cmp.pad.left * this.scale;
    const my = this.oy + cmp.pad.top * this.scale;
    ctx.drawImage(main, mx, my, main.naturalWidth * this.scale, main.naturalHeight * this.scale);
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.rect(sx, this.oy, this.ox + bw - sx, bh);
    ctx.clip();
    ctx.drawImage(cmp.result, this.ox, this.oy, bw, bh);
    ctx.restore();
    const dpr = window.devicePixelRatio || 1;
    ctx.fillStyle = '#fff';
    ctx.fillRect(sx - dpr, this.oy, 2 * dpr, bh);
    ctx.beginPath();
    ctx.arc(sx, this.oy + bh / 2, 9 * dpr, 0, Math.PI * 2);
    ctx.fill();
  }

  // ---- 互動 ----
  private down = (e: PointerEvent) => {
    const s = this.state;
    if (!s) return;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* 指標已失效時拖曳照樣進行, 只是游標移出畫布後收不到事件 */
    }
    const [x, y] = this.toImage(e);
    if (s.compare && s.view === 'main') {
      this.drag = { kind: 'split' };
      this.move(e);
      return;
    }
    if (s.locked) return;
    if (s.tool === 'box') {
      this.drag = { kind: 'box', x0: x, y0: y, x1: x, y1: y };
      return;
    }
    if (s.tool === 'point') {
      const label: 0 | 1 = e.button === 2 ? 0 : 1;
      const sel = this.part(s.selected);
      const [px, py] = sel ? applyMat(invert(this.viewMatrix(sel)), x, y) : [x, y];
      this.cb.onPoint(Math.floor(px), Math.floor(py), label);
      return;
    }
    // 移動工具: 先看選中部位的把手
    const sel = this.part(s.selected);
    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const sp: [number, number] = [(e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr];
    const near = (q: [number, number]) => Math.hypot(q[0] - sp[0], q[1] - sp[1]) <= HANDLE * dpr * 1.4;
    if (this.canTransform(sel)) {
      const [wx, wy] = this.anchorWorld(sel);
      if (near(this.rotateHandle(sel))) {
        this.drag = { kind: 'rotate', id: sel.id, wx, wy, a0: Math.atan2(y - wy, x - wx), t0: { ...sel.transform } };
        return;
      }
      if (this.corners(sel).some(near)) {
        this.drag = { kind: 'scale', id: sel.id, wx, wy, v0: this.local(sel.transform.rotation, x - wx, y - wy), t0: { ...sel.transform } };
        return;
      }
    }
    const hit = this.visibleParts().find((p) => {
      const layer = s.assets.layers.get(p.id);
      return layer && hitPart(p, layer, x, y);
    });
    this.cb.onSelect(hit?.id ?? null);
    if (hit && this.canTransform(hit)) {
      const e2 = placedEdges(hit);
      this.drag = { kind: 'move', id: hit.id, sx: x, sy: y, t0: { ...hit.transform }, w: e2.w, h: e2.h };
    }
  };

  /** 世界向量轉到部位旋轉後的座標軸 */
  private local(rotation: number, vx: number, vy: number): [number, number] {
    const r = (-rotation * Math.PI) / 180;
    return [vx * Math.cos(r) - vy * Math.sin(r), vx * Math.sin(r) + vy * Math.cos(r)];
  }

  private move = (e: PointerEvent) => {
    const d = this.drag;
    const s = this.state;
    if (!d || !s) return;
    const [x, y] = this.toImage(e);
    if (d.kind === 'split') {
      const r = this.canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const px = (e.clientX - r.left) * dpr;
      this.cb.onSplit(Math.min(1, Math.max(0, (px - this.ox) / (this.frameW * this.scale))));
      return;
    }
    if (d.kind === 'box') {
      d.x1 = x;
      d.y1 = y;
      this.render();
      return;
    }
    let t: PartTransform;
    if (d.kind === 'move') {
      t = { ...d.t0, dx: d.t0.dx + (x - d.sx) / d.w, dy: d.t0.dy + (y - d.sy) / d.h };
    } else if (d.kind === 'scale') {
      const v = this.local(d.t0.rotation, x - d.wx, y - d.wy);
      if (s.lockRatio) {
        const k = Math.hypot(...v) / (Math.hypot(...d.v0) || 1);
        t = { ...d.t0, scaleX: clampScale(d.t0.scaleX * k), scaleY: clampScale(d.t0.scaleY * k) };
      } else {
        const kx = Math.abs(d.v0[0]) > 2 ? v[0] / d.v0[0] : 1;
        const ky = Math.abs(d.v0[1]) > 2 ? v[1] / d.v0[1] : 1;
        t = { ...d.t0, scaleX: clampScale(d.t0.scaleX * kx), scaleY: clampScale(d.t0.scaleY * ky) };
      }
    } else {
      let deg = d.t0.rotation + ((Math.atan2(y - d.wy, x - d.wx) - d.a0) * 180) / Math.PI;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      t = { ...d.t0, rotation: Math.round(deg * 10) / 10 };
    }
    this.cb.onTransform(d.id, t, false);
  };

  private up = () => {
    const d = this.drag;
    this.drag = null;
    if (!d || !this.state) return;
    if (d.kind === 'box') {
      const sel = this.part(this.state.selected);
      let pts: [number, number][] = [[d.x0, d.y0], [d.x1, d.y0], [d.x0, d.y1], [d.x1, d.y1]];
      if (sel) {
        const inv = invert(this.viewMatrix(sel));
        pts = pts.map(([px, py]) => applyMat(inv, px, py));
      }
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      this.render();
      this.cb.onBox({
        x_min: Math.floor(Math.min(...xs)), y_min: Math.floor(Math.min(...ys)),
        x_max: Math.ceil(Math.max(...xs)), y_max: Math.ceil(Math.max(...ys)),
      });
      return;
    }
    if (d.kind === 'move' || d.kind === 'scale' || d.kind === 'rotate') {
      const p = this.part(d.id);
      if (p) this.cb.onTransform(d.id, p.transform, true);
    }
  };
}
