/** 遊戲示意候選: 底部候選列、看候選時的框選與去背預覽面板。 */
import { api } from '../api';
import { COST, usd } from '../cost';
import { tagEditor } from '../library/grid';
import type { AssetTags } from '../library/model';
import { costNote, el, markPaid } from '../pages/ui';
import { toCanvas } from './editor';
import { CANVAS, type Candidate, type Scene } from './model';

export type Box = [number, number, number, number];

const candUrl = (s: Scene, cid: string) => api.mockups.fileUrl(s.name, `candidates/${cid}.png`, cid);

function shortTime(iso: string): string {
  return iso.replace('T', ' ').slice(5, 16);
}

/** 底部候選列, 新的在前 */
export function candidateStrip(s: Scene, current: string | null, onPick: (cid: string) => void): HTMLElement[] {
  return [...s.candidates].reverse().map((c) => {
    const img = el('img');
    img.src = candUrl(s, c.id);
    img.loading = 'lazy';
    const card = el('div', { className: `mk-cand${current === c.id ? ' on' : ''}`, title: `候選 ${c.id.slice(1)}` }, [
      img, el('div', { className: 'muted small', text: `候選 ${c.id.slice(1)} · ${shortTime(c.created)}` }),
    ]);
    card.addEventListener('click', () => onPick(c.id));
    return card;
  });
}

/** 看候選時: 畫候選圖與框 */
export function drawCandidate(ctx: CanvasRenderingContext2D, s: Scene, img: HTMLImageElement, box: Box | null) {
  const [w, h] = CANVAS[s.view];
  ctx.clearRect(0, 0, w, h);
  if (img.complete && img.naturalWidth) ctx.drawImage(img, 0, 0, w, h);
  if (!box) return;
  const [x0, y0, x1, y1] = box;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.rect(x0, y0, x1 - x0, y1 - y0);
  ctx.fill('evenodd');
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#ffd34d';
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  ctx.restore();
}

/** 看候選時拖曳畫框 */
export function attachCutter(canvas: HTMLCanvasElement, ctl: {
  scene(): Scene | null;
  active(): boolean;
  setBox(b: Box | null, done: boolean): void;
}): () => void {
  let start: [number, number] | null = null;
  let cur: Box | null = null;
  const down = (e: PointerEvent) => {
    const s = ctl.scene();
    if (!s || !ctl.active() || e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    start = toCanvas(canvas, s.view, e);
    cur = null;
    ctl.setBox(null, false);
  };
  const move = (e: PointerEvent) => {
    const s = ctl.scene();
    if (!s || !start) return;
    const [w, h] = CANVAS[s.view];
    const [x, y] = toCanvas(canvas, s.view, e);
    const cx = Math.max(0, Math.min(w, x));
    const cy = Math.max(0, Math.min(h, y));
    cur = [Math.min(start[0], cx), Math.min(start[1], cy), Math.max(start[0], cx), Math.max(start[1], cy)];
    ctl.setBox(cur, false);
  };
  const up = () => {
    if (!start) return;
    start = null;
    const big = cur !== null && cur[2] - cur[0] > 4 && cur[3] - cur[1] > 4;
    ctl.setBox(big ? cur : null, true);
  };
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  return () => {
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up);
  };
}

export interface CutPreview {
  url: string;
  name: string;
  tags: AssetTags;
}

/** 看候選時的右側面板 */
export function candidatePanel(c: Candidate, opts: {
  box: Box | null;
  preview: CutPreview | null;
  busy: boolean;
  /** 像素場景: 目前看的是 AI 原圖(未對齊) */
  raw: boolean;
  onBack(): void;
  onRaw(on: boolean): void;
  onDownload(): void;
  onDelete(): void;
  onCut(): void;
  onSave(name: string, tags: AssetTags): void;
}): HTMLElement {
  const back = el('button', { text: '← 回到編輯' });
  back.addEventListener('click', opts.onBack);
  const dl = el('button', { text: '下載 PNG', className: 'small' });
  dl.addEventListener('click', opts.onDownload);
  const del = el('button', { text: '刪除候選', className: 'small danger' });
  del.addEventListener('click', opts.onDelete);
  const prompt = el('details', {}, [el('summary', { className: 'muted small', text: '當時的指令' }),
    el('pre', { className: 'mk-prompt', text: c.prompt })]);
  const rows: HTMLElement[] = [back, el('b', { text: `候選 ${c.id.slice(1)}` }),
    el('div', { className: 'muted small', text: shortTime(c.created) })];
  if (c.raw) {
    const seg = el('div', { className: 'seg' }, ([[false, '對齊後'], [true, 'AI 原圖']] as const).map(([v, text]) => {
      const b = el('button', { text, className: opts.raw === v ? 'active' : '' });
      b.addEventListener('click', () => opts.onRaw(v));
      return b;
    }));
    rows.push(seg);
  }
  rows.push(el('div', { className: 'mk-btns' }, [dl, del]), prompt, el('hr'), el('b', { text: '截素材' }));
  if (c.raw) rows.push(el('div', { className: 'muted small', text: '截素材一律用對齊後的圖, 存成原生解析度' }));
  if (!opts.box) {
    rows.push(el('div', { className: 'muted small', text: '在圖上拖一個框, 框住想收進素材庫的物件' }));
  } else {
    const cut = markPaid(el('button', { text: opts.busy ? '去背中…' : '去背預覽' }));
    cut.disabled = opts.busy;
    cut.addEventListener('click', opts.onCut);
    rows.push(el('div', { className: 'mk-btns' }, [cut, costNote(usd(COST.segment))]));
  }
  if (opts.preview) {
    const p = opts.preview;
    const img = el('img');
    img.src = p.url;
    const name = el('input');
    name.value = p.name;
    let tags = p.tags;
    const save = el('button', { text: '存到素材庫', className: 'primary' });
    save.addEventListener('click', () => {
      if (name.value.trim()) opts.onSave(name.value.trim(), tags);
    });
    rows.push(el('div', { className: 'mk-preview checker' }, [img]),
      el('label', { className: 'mk-row' }, [el('span', { className: 'muted small', text: '名稱' }), name]),
      tagEditor(tags, (t) => { tags = t; }), save);
  }
  return el('div', { className: 'mk-pad' }, rows);
}
