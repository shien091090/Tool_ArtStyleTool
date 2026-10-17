/** 節點畫布: DOM 節點 + SVG 連線, 平移縮放、拖拉節點、拉線、選取刪除。 */
import { el } from '../pages/ui';
import { isMaterial, NODE_INFO, STATUS_LABEL, type FlowLink, type FlowMeta, type FlowNode, type NodeStatus, type PortKind } from './model';

export const NODE_W = 180;
export const NODE_H = 160;
const PORT_Y = 93;
/** 素材接點 */
const MAT_PORT_Y = 133;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2;

export type Selection = { kind: 'node'; id: string } | { kind: 'link'; link: FlowLink } | null;

export interface CanvasHandlers {
  /** 拖拉結束 */
  onMove(id: string): void;
  onConnect(from: string, to: string, port: PortKind): void;
  onDelete(sel: NonNullable<Selection>): void;
  onOpen(id: string): void;
  /** 畫布空白處右鍵: 世界座標與畫面座標 */
  onContextMenu(x: number, y: number, clientX: number, clientY: number): void;
  /** 節點右鍵 */
  onNodeMenu(id: string, clientX: number, clientY: number): void;
  /** 連線右鍵 */
  onLinkMenu(link: FlowLink, clientX: number, clientY: number): void;
  /** 從輸出接點拉線放到空地: 新節點的左上角(輸入接點對齊放開處)與畫面座標 */
  onDropLink(from: string, x: number, y: number, clientX: number, clientY: number): void;
  thumbUrl(node: FlowNode): string | null;
  status(node: FlowNode): NodeStatus;
}

export interface FlowCanvas {
  root: HTMLElement;
  render(flow: FlowMeta | null): void;
  destroy(): void;
}

interface NodeView {
  root: HTMLElement;
  dot: HTMLElement;
  thumb: HTMLElement;
  img: HTMLImageElement;
  url: string | null;
}

const SVG = 'http://www.w3.org/2000/svg';

function curve(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(40, Math.abs(x2 - x1) / 2);
  return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
}

export function createFlowCanvas(h: CanvasHandlers): FlowCanvas {
  let flow: FlowMeta | null = null;
  let pan = { x: 40, y: 40 };
  let zoom = 1;
  let sel: Selection = null;
  const views = new Map<string, NodeView>();

  const root = el('div', { className: 'fc-root' });
  root.tabIndex = 0;
  const world = el('div', { className: 'fc-world' });
  const svg = document.createElementNS(SVG, 'svg');
  svg.classList.add('fc-links');
  const temp = document.createElementNS(SVG, 'path');
  temp.classList.add('fc-temp');
  world.append(svg);
  root.append(world);

  const applyView = () => {
    world.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
  };
  const toWorld = (cx: number, cy: number) => {
    const r = root.getBoundingClientRect();
    return { x: (cx - r.left - pan.x) / zoom, y: (cy - r.top - pan.y) / zoom };
  };
  const node = (id: string) => flow?.nodes.find((n) => n.id === id);

  // ---- 連線 ----
  function drawLinks() {
    svg.replaceChildren();
    if (!flow) return;
    for (const l of flow.links) {
      const a = node(l.from);
      const b = node(l.to);
      if (!a || !b) continue;
      const d = curve(a.x + NODE_W, a.y + PORT_Y, b.x, b.y + (isMaterial(l) ? MAT_PORT_Y : PORT_Y));
      const hit = document.createElementNS(SVG, 'path');
      hit.setAttribute('d', d);
      hit.classList.add('fc-hit');
      const line = document.createElementNS(SVG, 'path');
      line.setAttribute('d', d);
      line.classList.add('fc-link');
      if (isMaterial(l)) line.classList.add('material');
      if (sel?.kind === 'link' && sel.link.from === l.from && sel.link.to === l.to) line.classList.add('selected');
      hit.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        select({ kind: 'link', link: l });
      });
      hit.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        h.onLinkMenu(l, e.clientX, e.clientY);
      });
      svg.append(line, hit);
    }
    svg.append(temp);
  }

  function select(next: Selection) {
    sel = next;
    for (const [id, v] of views) v.root.classList.toggle('selected', sel?.kind === 'node' && sel.id === id);
    drawLinks();
    root.focus({ preventScroll: true });
  }

  // ---- 節點 ----
  function makeView(n: FlowNode): NodeView {
    const dot = el('span', { className: 'fc-dot' });
    const head = el('div', { className: 'fc-head' }, [el('span', { text: NODE_INFO[n.type].label }), dot]);
    const img = el('img');
    img.draggable = false;
    img.addEventListener('load', () => {
      // 小圖(像素圖)放大時不要糊
      img.classList.toggle('pixelated', img.naturalWidth * 2 <= NODE_W);
    });
    const thumb = el('div', { className: 'fc-thumb' });
    const r = el('div', { className: 'fc-node' }, [head, thumb]);
    r.dataset.id = n.id;
    if (NODE_INFO[n.type].hasInput) {
      const pin = el('div', { className: 'fc-port in' });
      pin.dataset.port = 'main';
      r.append(pin);
    }
    if (NODE_INFO[n.type].materials) {
      const pm = el('div', { className: 'fc-port in material', title: '素材: 可接多條, 每條是一張素材圖(從別張圖拿部位用)' });
      pm.dataset.port = 'material';
      r.querySelector('.fc-port.in')!.setAttribute('title', '主圖');
      r.append(pm, el('span', { className: 'fc-plabel', text: '主圖' }), el('span', { className: 'fc-plabel material', text: '素材' }));
    }
    const pout = el('div', { className: 'fc-port out', title: '拖到另一個節點的輸入接點' });
    r.append(pout);

    r.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      select({ kind: 'node', id: n.id });
    });
    r.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      select({ kind: 'node', id: n.id });
      h.onNodeMenu(n.id, e.clientX, e.clientY);
    });
    r.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      h.onOpen(n.id);
    });
    head.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const cur = node(n.id);
      if (!cur) return;
      const start = toWorld(e.clientX, e.clientY);
      const ox = cur.x;
      const oy = cur.y;
      let moved = false;
      head.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => {
        const p = toWorld(ev.clientX, ev.clientY);
        cur.x = Math.round(ox + p.x - start.x);
        cur.y = Math.round(oy + p.y - start.y);
        moved = true;
        place(cur);
        drawLinks();
      };
      const up = () => {
        head.removeEventListener('pointermove', move);
        head.removeEventListener('pointerup', up);
        if (moved) h.onMove(n.id);
      };
      head.addEventListener('pointermove', move);
      head.addEventListener('pointerup', up);
    });
    pout.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      const cur = node(n.id);
      if (!cur) return;
      pout.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => {
        const p = toWorld(ev.clientX, ev.clientY);
        temp.setAttribute('d', curve(cur.x + NODE_W, cur.y + PORT_Y, p.x, p.y));
      };
      const up = (ev: PointerEvent) => {
        pout.removeEventListener('pointermove', move);
        pout.removeEventListener('pointerup', up);
        temp.setAttribute('d', '');
        const hit = document.elementFromPoint(ev.clientX, ev.clientY);
        const target = hit?.closest<HTMLElement>('.fc-node');
        const to = target?.dataset.id;
        const port = (hit?.closest<HTMLElement>('.fc-port.in')?.dataset.port ?? 'main') as PortKind;
        if (to && to !== n.id && target?.querySelector('.fc-port.in')) h.onConnect(n.id, to, port);
        else if (!target && hit && root.contains(hit)) {
          const p = toWorld(ev.clientX, ev.clientY);
          h.onDropLink(n.id, Math.round(p.x), Math.round(p.y - PORT_Y), ev.clientX, ev.clientY);
        }
      };
      pout.addEventListener('pointermove', move);
      pout.addEventListener('pointerup', up);
    });
    return { root: r, dot, thumb, img, url: null };
  }

  function place(n: FlowNode) {
    const v = views.get(n.id);
    if (!v) return;
    v.root.style.left = `${n.x}px`;
    v.root.style.top = `${n.y}px`;
  }

  function render(next: FlowMeta | null) {
    flow = next;
    const ids = new Set(flow?.nodes.map((n) => n.id) ?? []);
    for (const [id, v] of views) {
      if (!ids.has(id)) {
        v.root.remove();
        views.delete(id);
      }
    }
    if (sel?.kind === 'node' && !ids.has(sel.id)) sel = null;
    if (sel?.kind === 'link' && !flow?.links.some((l) => sel?.kind === 'link' && l.from === sel.link.from && l.to === sel.link.to)) sel = null;
    for (const n of flow?.nodes ?? []) {
      let v = views.get(n.id);
      if (!v) {
        v = makeView(n);
        views.set(n.id, v);
        world.append(v.root);
      }
      place(n);
      const st = h.status(n);
      v.dot.className = `fc-dot ${st}`;
      v.dot.title = n.error ? `${STATUS_LABEL.error}: ${n.error}` : STATUS_LABEL[st];
      const url = h.thumbUrl(n);
      if (url !== v.url) {
        v.url = url;
        if (url) {
          v.img.src = url;
          v.thumb.replaceChildren(v.img);
        } else {
          v.thumb.replaceChildren(el('span', { className: 'muted small', text: '雙擊開啟設定' }));
        }
      }
      v.root.classList.toggle('selected', sel?.kind === 'node' && sel.id === n.id);
    }
    drawLinks();
  }

  // ---- 平移縮放 ----
  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.button !== 1) return;
    select(null);
    const sx = e.clientX - pan.x;
    const sy = e.clientY - pan.y;
    root.setPointerCapture(e.pointerId);
    root.classList.add('panning');
    const move = (ev: PointerEvent) => {
      pan = { x: ev.clientX - sx, y: ev.clientY - sy };
      applyView();
    };
    const up = () => {
      root.classList.remove('panning');
      root.removeEventListener('pointermove', move);
      root.removeEventListener('pointerup', up);
    };
    root.addEventListener('pointermove', move);
    root.addEventListener('pointerup', up);
  });
  root.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = root.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * Math.exp(-e.deltaY * 0.0015)));
    pan = { x: mx - ((mx - pan.x) / zoom) * next, y: my - ((my - pan.y) / zoom) * next };
    zoom = next;
    applyView();
  }, { passive: false });
  root.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const p = toWorld(e.clientX, e.clientY);
    h.onContextMenu(Math.round(p.x), Math.round(p.y), e.clientX, e.clientY);
  });
  root.addEventListener('keydown', (e) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel) {
      e.preventDefault();
      const s = sel;
      sel = null;
      h.onDelete(s);
    }
  });

  applyView();
  return {
    root,
    render,
    destroy() {
      views.clear();
    },
  };
}
