/** 遊戲示意場景繪製: 編輯畫面與送 AI 的灰盒圖、素材層共用同一套。
 *
 * 一律把一塊世界矩形畫滿畫布: 送 AI 時矩形 = 鏡頭輸出框; 編輯時 = 輸出框外擴一圈, 框外蓋暗罩。
 * 線寬、字、控點以畫布像素為準(除以變換倍率 k), 不跟鏡頭縮放。
 */
import {
  CANVAS, drawOrder, frameRect, groundGeom, isoPoint, objectBox, regions, terrainColor,
  type AssetObj, type BlockObj, type BoxObj, type Rect, type Scene,
} from './model';

const FONT = "'Microsoft JhengHei', 'PingFang TC', sans-serif";
const OUTLINE = '#282828';
/** 編輯區底色(同 .mk-stage), 框外暗罩用 */
const STAGE_DIM = 'rgba(21,23,26,0.65)';
/** 遊戲像素格線: 一格在畫布上至少這麼大才畫 */
const GRID_MIN_PX = 6;

export type Images = Map<string, HTMLImageElement>;

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * k));
  return `rgb(${c.join(',')})`;
}

/** 白字深色描邊, 可換行, 置中於 (x, y); size 是世界單位 */
function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number) {
  const lines = text.split('\n');
  ctx.font = `bold ${size}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = size / 6;
  ctx.strokeStyle = OUTLINE;
  ctx.fillStyle = '#fff';
  lines.forEach((ln, n) => {
    const yy = y + (n - (lines.length - 1) / 2) * size * 1.15;
    ctx.strokeText(ln, x, yy);
    ctx.fillText(ln, x, yy);
  });
}

/** 字級(畫布像素)跟著外框縮, 至少 11px, 太小的框字可以超出框 */
function fitSize(w: number, h: number, text: string): number {
  const lines = text.split('\n');
  const longest = Math.max(...lines.map((l) => [...l].length), 1);
  return Math.max(11, Math.min(22, (w * 1.6) / longest, (h * 0.8) / lines.length));
}

/** k = 每世界單位幾個畫布像素 */
function drawBox(ctx: CanvasRenderingContext2D, o: BoxObj, k: number) {
  ctx.fillStyle = o.color;
  ctx.fillRect(o.x, o.y, o.w, o.h);
  ctx.lineWidth = 2 / k;
  ctx.strokeStyle = OUTLINE;
  ctx.strokeRect(o.x, o.y, o.w, o.h);
  label(ctx, o.label, o.x + o.w / 2, o.y + o.h / 2, fitSize(o.w * k, o.h * k, o.label) / k);
}

function poly(ctx: CanvasRenderingContext2D, pts: [number, number][], fill: string, k: number) {
  ctx.beginPath();
  pts.forEach(([x, y], n) => (n ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 1.5 / k;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
}

function drawBlock(ctx: CanvasRenderingContext2D, s: Scene, o: BlockObj, k: number) {
  const { i, j, w, l, h } = o;
  const P = (a: number, b: number, z = 0) => isoPoint(s.pixel, a, b, z);
  poly(ctx, [P(i + w, j), P(i + w, j + l), P(i + w, j + l, h), P(i + w, j, h)], shade(o.color, 0.7), k);
  poly(ctx, [P(i, j + l), P(i + w, j + l), P(i + w, j + l, h), P(i, j + l, h)], shade(o.color, 0.85), k);
  poly(ctx, [P(i, j, h), P(i + w, j, h), P(i + w, j + l, h), P(i, j + l, h)], o.color, k);
  const [cx, cy] = P(i + w / 2, j + l / 2, h);
  const [x0, , x1] = objectBox(s, o);
  label(ctx, o.label, cx, cy, fitSize((x1 - x0) * k, 60, o.label) / k);
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

function drawGround(ctx: CanvasRenderingContext2D, s: Scene, k: number) {
  const g = groundGeom(s);
  if (!g || !s.ground) return;
  s.ground.cells.forEach((t, idx) => {
    const c = idx % g.cols;
    const r = Math.floor(idx / g.cols);
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
      ctx.lineWidth = 1 / k;
      ctx.strokeStyle = 'rgba(40,40,40,0.45)';
      ctx.stroke();
    } else {
      const x = g.ox + c * g.tile;
      const y = g.oy + r * g.tile;
      if (t) {
        ctx.fillStyle = terrainColor(s, t);
        ctx.fillRect(x, y, g.tile, g.tile);
      }
      ctx.lineWidth = 1 / k;
      ctx.strokeStyle = 'rgba(40,40,40,0.35)';
      ctx.strokeRect(x, y, g.tile, g.tile);
    }
  });
  for (const r of regions(s)) label(ctx, r.label, r.x, r.y, 16 / k);
}

/** 像素場景的遊戲像素格線 */
function drawPixelGrid(ctx: CanvasRenderingContext2D, rect: Rect, k: number) {
  ctx.beginPath();
  for (let x = Math.ceil(rect[0]); x <= rect[2]; x++) {
    ctx.moveTo(x, rect[1]);
    ctx.lineTo(x, rect[3]);
  }
  for (let y = Math.ceil(rect[1]); y <= rect[3]; y++) {
    ctx.moveTo(rect[0], y);
    ctx.lineTo(rect[2], y);
  }
  ctx.lineWidth = 1 / k;
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.stroke();
}

/** 畫場景: 世界矩形 rect(預設輸出框)畫滿畫布; layer = 'assets' 時只畫素材、透明底 */
export function drawScene(ctx: CanvasRenderingContext2D, s: Scene, images: Images,
  opts: { layer?: 'all' | 'assets'; selected?: string | null; rect?: Rect; grid?: boolean } = {}) {
  const frame = frameRect(s);
  const rect = opts.rect ?? frame;
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const k = W / (rect[2] - rect[0]);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.setTransform(k, 0, 0, k, -rect[0] * k, -rect[1] * k);
  ctx.imageSmoothingEnabled = !s.pixel;
  const all = (opts.layer ?? 'all') === 'all';
  if (all) {
    ctx.fillStyle = s.background.color;
    ctx.fillRect(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]);
    ctx.font = `bold ${16 / k}px ${FONT}`;
    label(ctx, s.background.label, frame[0] + 16 / k + ctx.measureText(s.background.label).width / 2, frame[1] + 24 / k, 16 / k);
    drawGround(ctx, s, k);
  }
  for (const o of drawOrder(s)) {
    if (o.kind === 'asset') drawAsset(ctx, o, images);
    else if (all) (o.kind === 'box' ? drawBox(ctx, o, k) : drawBlock(ctx, s, o, k));
  }
  if (!all) return;
  if (opts.grid && s.pixel && k >= GRID_MIN_PX) drawPixelGrid(ctx, rect, k);
  if (rect !== frame) {
    ctx.beginPath();
    ctx.rect(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]);
    ctx.rect(frame[0], frame[1], frame[2] - frame[0], frame[3] - frame[1]);
    ctx.fillStyle = STAGE_DIM;
    ctx.fill('evenodd');
    ctx.lineWidth = 2 / k;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.strokeRect(frame[0], frame[1], frame[2] - frame[0], frame[3] - frame[1]);
  }
  if (opts.selected) {
    const o = s.objects.find((x) => x.id === opts.selected);
    if (o) {
      const [x0, y0, x1, y1] = objectBox(s, o);
      const m = 2 / k;
      ctx.save();
      ctx.setLineDash([6 / k, 4 / k]);
      ctx.lineWidth = 2 / k;
      ctx.strokeStyle = '#4f9dff';
      ctx.strokeRect(x0 - m, y0 - m, x1 - x0 + 2 * m, y1 - y0 + 2 * m);
      ctx.setLineDash([]);
      if (o.kind !== 'block') {
        ctx.fillStyle = '#4f9dff';
        ctx.fillRect(x1 - 6 / k, y1 - 6 / k, 12 / k, 12 / k);
      }
      ctx.restore();
    }
  }
}

function toBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error('產生圖片失敗'))), 'image/png'));
}

/** 送 AI 的兩張圖(輸出尺寸, 照目前鏡頭): 灰盒圖(含素材、不含選取框)與只有素材的透明層 */
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
