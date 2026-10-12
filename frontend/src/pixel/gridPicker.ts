/** 指定格數用的拖拉格子: 從左上角拉出 寬×高 格。 */
import { el } from '../pages/ui';

/** 指標相對格子區左上角的位置 → 選到的格數(1..max) */
export function cellAt(x: number, y: number, cellPx: number, max: number): { cols: number; rows: number } {
  const clamp = (v: number) => Math.min(max, Math.max(1, Math.floor(v / cellPx) + 1));
  return { cols: clamp(x), rows: clamp(y) };
}

export interface GridPicker {
  root: HTMLElement;
  get(): { cols: number; rows: number };
  set(cols: number, rows: number): void;
}

export function createGridPicker(max: number, cellPx: number, cols: number, rows: number,
  onChange: () => void): GridPicker {
  let value = { cols, rows };
  let preview: { cols: number; rows: number } | null = null;
  let dragging = false;

  const area = el('div', { className: 'px-picker' });
  area.style.gridTemplateColumns = `repeat(${max}, ${cellPx}px)`;
  const cellEls: HTMLElement[] = [];
  for (let i = 0; i < max * max; i++) cellEls.push(area.appendChild(el('div')));

  const paint = () => {
    const show = preview ?? value;
    for (let i = 0; i < cellEls.length; i++) {
      const c = i % max;
      const r = Math.floor(i / max);
      cellEls[i].classList.toggle('on', c < value.cols && r < value.rows);
      cellEls[i].classList.toggle('preview', preview !== null && c < show.cols && r < show.rows);
    }
  };
  const at = (e: PointerEvent) => {
    const rect = area.getBoundingClientRect();
    return cellAt(e.clientX - rect.left, e.clientY - rect.top, rect.width / max, max);
  };
  const choose = (v: { cols: number; rows: number }) => {
    if (v.cols === value.cols && v.rows === value.rows) return;
    value = v;
    onChange();
  };

  area.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    dragging = true;
    area.setPointerCapture(e.pointerId);
    preview = null;
    choose(at(e));
    paint();
  });
  area.addEventListener('pointermove', (e) => {
    if (dragging) choose(at(e));
    else preview = at(e);
    paint();
  });
  const stop = () => {
    dragging = false;
  };
  area.addEventListener('pointerup', stop);
  area.addEventListener('pointercancel', stop);
  area.addEventListener('pointerleave', () => {
    preview = null;
    paint();
  });

  paint();
  return {
    root: area,
    get: () => value,
    set(c, r) {
      value = { cols: c, rows: r };
      paint();
    },
  };
}
