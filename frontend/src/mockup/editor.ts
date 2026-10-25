/** 遊戲示意編輯畫布的滑鼠互動: 選取、拖曳移動、右下角縮放、地面筆刷。座標一律換成世界座標。 */
import {
  CANVAS, cellAt, clampToWorld, hitTest, isoCell, objectBox, roundPixel, snap, snapStep,
  type MockObject, type Rect, type Scene,
} from './model';

export interface EditorControl {
  scene(): Scene | null;
  /** 畫布目前顯示的世界範圍 */
  rect(): Rect;
  /** 互動中(選取工具)才處理; 看候選時回 false */
  active(): boolean;
  tool(): 'select' | 'brush';
  /** 筆刷地形; null = 橡皮擦 */
  brush(): string | null;
  selected(): string | null;
  select(id: string | null): void;
  /** 改動前呼叫一次, 存復原點 */
  snapshot(): void;
  /** 畫面要重畫; commit = 這次改動結束, 排程存檔 */
  changed(commit: boolean): void;
}

/** 控點判定半徑(螢幕 px) */
const HANDLE_PX = 10;

/** 滑鼠位置 → 輸出圖像素(看候選時用, 畫布 = 輸出尺寸) */
export function toCanvas(canvas: HTMLCanvasElement, view: Scene['view'], e: { clientX: number; clientY: number }): [number, number] {
  const r = canvas.getBoundingClientRect();
  const [w, h] = CANVAS[view];
  return [((e.clientX - r.left) * w) / r.width, ((e.clientY - r.top) * h) / r.height];
}

/** 滑鼠位置 → 世界座標(畫布顯示 rect 這塊世界) */
export function toWorld(canvas: HTMLCanvasElement, rect: Rect, e: { clientX: number; clientY: number }): [number, number] {
  const r = canvas.getBoundingClientRect();
  return [rect[0] + ((e.clientX - r.left) * (rect[2] - rect[0])) / r.width,
    rect[1] + ((e.clientY - r.top) * (rect[3] - rect[1])) / r.height];
}

type Drag =
  | { kind: 'move'; obj: MockObject; start: [number, number]; orig: MockObject; moved: boolean }
  | { kind: 'resize'; obj: MockObject; start: [number, number]; orig: MockObject; moved: boolean }
  | { kind: 'brush'; last: number | null };

export function attachEditor(canvas: HTMLCanvasElement, ctl: EditorControl): () => void {
  let drag: Drag | null = null;

  const pos = (e: PointerEvent) => toWorld(canvas, ctl.rect(), e);
  /** 一個螢幕 px 等於幾個世界單位 */
  const worldPerPx = () => {
    const rect = ctl.rect();
    return (rect[2] - rect[0]) / Math.max(1, canvas.getBoundingClientRect().width);
  };

  function paint(s: Scene, x: number, y: number) {
    const k = cellAt(s, x, y);
    if (k === null || !s.ground || drag?.kind !== 'brush' || drag.last === k) return;
    drag.last = k;
    if (s.ground.cells[k] === ctl.brush()) return;
    s.ground.cells[k] = ctl.brush();
    ctl.changed(false);
  }

  function onDown(e: PointerEvent) {
    const s = ctl.scene();
    if (!s || !ctl.active() || e.button !== 0) return;
    const p = pos(e);
    canvas.setPointerCapture(e.pointerId);
    if (ctl.tool() === 'brush' && s.ground) {
      ctl.snapshot();
      drag = { kind: 'brush', last: null };
      paint(s, ...p);
      return;
    }
    const sel = s.objects.find((o) => o.id === ctl.selected());
    if (sel && sel.kind !== 'block') {
      const [, , x1, y1] = objectBox(s, sel);
      const r = HANDLE_PX * worldPerPx();
      if (Math.abs(p[0] - x1) <= r && Math.abs(p[1] - y1) <= r) {
        drag = { kind: 'resize', obj: sel, start: p, orig: { ...sel }, moved: false };
        return;
      }
    }
    const hit = hitTest(s, ...p);
    ctl.select(hit?.id ?? null);
    drag = hit ? { kind: 'move', obj: hit, start: p, orig: { ...hit }, moved: false } : null;
  }

  function onMove(e: PointerEvent) {
    const s = ctl.scene();
    if (!s || !drag) return;
    const p = pos(e);
    if (drag.kind === 'brush') {
      paint(s, ...p);
      return;
    }
    const dx = p[0] - drag.start[0];
    const dy = p[1] - drag.start[1];
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < 3 * worldPerPx()) return;
      drag.moved = true;
      ctl.snapshot();
    }
    const free = e.altKey;
    const step = snapStep(s);
    const min = s.pixel ? 1 : 8;
    const o = drag.obj;
    const orig = drag.orig;
    if (drag.kind === 'move') {
      if (o.kind === 'block' && orig.kind === 'block') {
        const [si, sj] = isoCell(s.pixel, ...drag.start);
        const [pi, pj] = isoCell(s.pixel, ...p);
        o.i = free ? orig.i + pi - si : snap(orig.i + pi - si, 0.5);
        o.j = free ? orig.j + pj - sj : snap(orig.j + pj - sj, 0.5);
      } else if (o.kind !== 'block' && orig.kind !== 'block') {
        o.x = free ? orig.x + dx : snap(orig.x + dx, step);
        o.y = free ? orig.y + dy : snap(orig.y + dy, step);
      }
    } else if (o.kind === 'asset' && orig.kind === 'asset') {
      const k = Math.max((orig.w + dx) / orig.w, (orig.h + dy) / orig.h, min / Math.min(orig.w, orig.h));
      o.w = orig.w * k;
      o.h = orig.h * k;
    } else if (o.kind === 'box' && orig.kind === 'box') {
      o.w = Math.max(min, free ? orig.w + dx : snap(orig.w + dx, step));
      o.h = Math.max(min, free ? orig.h + dy : snap(orig.h + dy, step));
    }
    roundPixel(s, o);
    clampToWorld(s, o);
    ctl.changed(false);
  }

  function onUp() {
    if (!drag) return;
    const commit = drag.kind === 'brush' || drag.moved;
    drag = null;
    if (commit) ctl.changed(true);
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  return () => {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onUp);
  };
}
