/** 遊戲示意場景繪製: 編輯畫面與送 AI 的灰盒圖、素材層共用同一套。 */
import { CANVAS, drawOrder, groundGeom, isoPoint, objectBox, regions, terrainColor, type AssetObj, type BlockObj, type BoxObj, type Scene } from './model';

const FONT = "'Microsoft JhengHei', 'PingFang TC', sans-serif";
const OUTLINE = '#282828';

export type Images = Map<string, HTMLImageElement>;

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * k));
  return `rgb(${c.join(',')})`;
}

/** 白字深色描邊, 可換行, 置中於 (x, y) */
function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number) {
  const lines = text.split('\n');
  ctx.font = `bold ${size}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, size / 6);
  ctx.strokeStyle = OUTLINE;
  ctx.fillStyle = '#fff';
  lines.forEach((ln, n) => {
    const yy = y + (n - (lines.length - 1) / 2) * size * 1.15;
    ctx.strokeText(ln, x, yy);
    ctx.fillText(ln, x, yy);
  });
}

/** 字級跟著外框縮, 太小的框也看得到字 */
function fitSize(w: number, h: number, text: string): number {
  const lines = text.split('\n');
  const longest = Math.max(...lines.map((l) => [...l].length), 1);
  return Math.max(11, Math.min(22, (w * 1.6) / longest, (h * 0.8) / lines.length));
}

function drawBox(ctx: CanvasRenderingContext2D, o: BoxObj) {
  ctx.fillStyle = o.color;
  ctx.fillRect(o.x, o.y, o.w, o.h);
  ctx.lineWidth = 2;
  ctx.strokeStyle = OUTLINE;
  ctx.strokeRect(o.x, o.y, o.w, o.h);
  label(ctx, o.label, o.x + o.w / 2, o.y + o.h / 2, fitSize(o.w, o.h, o.label));
}

function poly(ctx: CanvasRenderingContext2D, pts: [number, number][], fill: string) {
  ctx.beginPath();
  pts.forEach(([x, y], n) => (n ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
}

function drawBlock(ctx: CanvasRenderingContext2D, s: Scene, o: BlockObj) {
  const { i, j, w, l, h } = o;
  const P = (a: number, b: number, z = 0) => isoPoint(s.pixel, a, b, z);
  poly(ctx, [P(i + w, j), P(i + w, j + l), P(i + w, j + l, h), P(i + w, j, h)], shade(o.color, 0.7));
  poly(ctx, [P(i, j + l), P(i + w, j + l), P(i + w, j + l, h), P(i, j + l, h)], shade(o.color, 0.85));
  poly(ctx, [P(i, j, h), P(i + w, j, h), P(i + w, j + l, h), P(i, j + l, h)], o.color);
  const [cx, cy] = P(i + w / 2, j + l / 2, h);
  const [x0, , x1] = objectBox(s, o);
  label(ctx, o.label, cx, cy, fitSize(x1 - x0, 60, o.label));
}

function drawAsset(ctx: CanvasRenderingContext2D, o: AssetObj, images: Images) {
  const img = images.get(o.asset);
  if (!img || !img.complete || !img.naturalWidth) {
    ctx.fillStyle = 'rgba(128,128,128,0.4)';
    ctx.fillRect(o.x, o.y, o.w, o.h);
    return;
  }
  ctx.save();
  if (o.flip) {
    ctx.translate(o.x + o.w, o.y);
    ctx.scale(-1, 1);
    ctx.drawImage(img, 0, 0, o.w, o.h);
  } else {
    ctx.drawImage(img, o.x, o.y, o.w, o.h);
  }
  ctx.restore();
}

function drawGround(ctx: CanvasRenderingContext2D, s: Scene) {
  const g = groundGeom(s);
  if (!g || !s.ground) return;
  const cells = s.ground.cells;
  cells.forEach((t, k) => {
    const c = k % g.cols;
    const r = Math.floor(k / g.cols);
    if (g.kind === 'iso') {
      const [ci, rj] = [c - g.offset, r - g.offset];
      const pts = [isoPoint(s.pixel, ci, rj), isoPoint(s.pixel, ci + 1, rj), isoPoint(s.pixel, ci + 1, rj + 1), isoPoint(s.pixel, ci, rj + 1)];
      ctx.beginPath();
      pts.forEach(([x, y], n) => (n ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      if (t) {
        ctx.fillStyle = terrainColor(s, t);
        ctx.fill();
      }
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(40,40,40,0.45)';
      ctx.stroke();
    } else {
      const x = g.ox + c * g.tile;
      const y = g.oy + r * g.tile;
      if (t) {
        ctx.fillStyle = terrainColor(s, t);
        ctx.fillRect(x, y, g.tile, g.tile);
      }
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(40,40,40,0.35)';
      ctx.strokeRect(x, y, g.tile, g.tile);
    }
  });
  for (const r of regions(s)) label(ctx, r.label, r.x, r.y, 16);
}

/** 畫整個場景(畫布邏輯座標); layer = 'assets' 時只畫素材、透明底 */
export function drawScene(ctx: CanvasRenderingContext2D, s: Scene, images: Images,
  opts: { layer?: 'all' | 'assets'; selected?: string | null } = {}) {
  const [w, h] = CANVAS[s.view];
  ctx.clearRect(0, 0, w, h);
  const all = (opts.layer ?? 'all') === 'all';
  if (all) {
    ctx.fillStyle = s.background.color;
    ctx.fillRect(0, 0, w, h);
    ctx.font = `bold 16px ${FONT}`;
    label(ctx, s.background.label, 16 + ctx.measureText(s.background.label).width / 2, 24, 16);
    drawGround(ctx, s);
  }
  for (const o of drawOrder(s)) {
    if (o.kind === 'asset') drawAsset(ctx, o, images);
    else if (all) (o.kind === 'box' ? drawBox(ctx, o) : drawBlock(ctx, s, o));
  }
  if (all && opts.selected) {
    const o = s.objects.find((x) => x.id === opts.selected);
    if (o) {
      const [x0, y0, x1, y1] = objectBox(s, o);
      ctx.save();
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#4f9dff';
      ctx.strokeRect(x0 - 2, y0 - 2, x1 - x0 + 4, y1 - y0 + 4);
      ctx.setLineDash([]);
      if (o.kind !== 'block') {
        ctx.fillStyle = '#4f9dff';
        ctx.fillRect(x1 - 6, y1 - 6, 12, 12);
      }
      ctx.restore();
    }
  }
}

function toBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error('產生圖片失敗'))), 'image/png'));
}

/** 送 AI 的兩張圖: 灰盒圖(含素材、不含選取框)與只有素材的透明層 */
export async function renderPngs(s: Scene, images: Images): Promise<{ greybox: Blob; layer: Blob }> {
  const [w, h] = CANVAS[s.view];
  const make = async (layer: 'all' | 'assets') => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    drawScene(c.getContext('2d')!, s, images, { layer });
    return toBlob(c);
  };
  return { greybox: await make('all'), layer: await make('assets') };
}
