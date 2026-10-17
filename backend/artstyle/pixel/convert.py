"""直接轉換: 插畫 → 像素圖, 不叫 AI(規格 2026-10-17-pixel-convert-design)。輸入 RGB/RGBA, 輸出 RGBA, 皆 RGB 順序。"""
import cv2
import numpy as np

from .downscale import _kmeans

INK = (0x17, 0x16, 0x1E)
POOL = 4  # 先縮到目標的幾倍再取眾數


def default_colors(w: int, h: int) -> int:
    return 16 if max(w, h) <= 32 else 24


def _mix(c, d, t: float) -> tuple:
    return tuple(int(round(int(a) + (int(b) - int(a)) * t)) for a, b in zip(c[:3], d[:3]))


def subject_mask(img: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """回傳 (鋪白底的 RGB, 主體遮罩)。有透明用 alpha; 否則跟圖邊相連的白紙與灰陰影算背景。"""
    if img.ndim == 2:
        img = np.repeat(img[..., None], 3, axis=2)
    if img.shape[2] == 4 and (img[..., 3] < 255).any():
        a = img[..., 3:4].astype(np.float32) / 255
        rgb = (img[..., :3] * a + 255 * (1 - a)).round().astype(np.uint8)
        return rgb, img[..., 3] >= 128
    rgb = np.ascontiguousarray(img[..., :3])
    c = rgb.astype(np.int16)
    v, mn = c.max(2), c.min(2)
    bg = ((v - mn) / np.maximum(v, 1) < 0.10) & (v > 150)
    n, lab = cv2.connectedComponents(bg.astype(np.uint8), connectivity=4)
    edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    edge = edge[edge > 0]
    return rgb, ~np.isin(lab, edge) | ~bg


def crop_box(fg: np.ndarray, aspect: float, margin: float = 0.02) -> tuple[int, int, int, int]:
    ys, xs = np.nonzero(fg)
    if not len(xs):
        raise ValueError("找不到主體: 整張圖都被當成背景了")
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    cw, ch = (x1 - x0) * (1 + 2 * margin), (y1 - y0) * (1 + 2 * margin)
    if cw / ch < aspect:
        cw = ch * aspect
    else:
        ch = cw / aspect
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    return int(cx - cw / 2), int(cy - ch / 2), int(cx + cw / 2), int(cy + ch / 2)


def _crop(arr: np.ndarray, box, fill) -> np.ndarray:
    """裁 box 範圍, 超出原圖的地方補 fill。"""
    x0, y0, x1, y1 = box
    out = np.empty((y1 - y0, x1 - x0) + arr.shape[2:], arr.dtype)
    out[...] = fill
    h, w = arr.shape[:2]
    sx0, sy0, sx1, sy1 = max(0, x0), max(0, y0), min(w, x1), min(h, y1)
    if sx1 > sx0 and sy1 > sy0:
        out[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0] = arr[sy0:sy1, sx0:sx1]
    return out


def enhance(rgb: np.ndarray, color: float = 1.25, contrast: float = 1.1) -> np.ndarray:
    """同 PIL ImageEnhance: 飽和度往灰階外推, 對比往灰階平均外推。"""
    f = rgb.astype(np.float32)
    gray = (f @ np.array([0.299, 0.587, 0.114], np.float32))[..., None]
    f = np.clip(gray + (f - gray) * color, 0, 255)
    mean = float((f @ np.array([0.299, 0.587, 0.114], np.float32)).mean())
    return np.clip(mean + (f - mean) * contrast, 0, 255).round().astype(np.uint8)


def pool(labels: np.ndarray, valid: np.ndarray, iw: int, ih: int, n: int) -> np.ndarray:
    """每格取 POOL×POOL 區塊內最多的群; 主體不到一半回 -1。"""
    out = np.full((ih, iw), -1, int)
    for j in range(ih):
        for i in range(iw):
            ok = valid[j * POOL:(j + 1) * POOL, i * POOL:(i + 1) * POOL]
            if ok.mean() < 0.5:
                continue
            blk = labels[j * POOL:(j + 1) * POOL, i * POOL:(i + 1) * POOL]
            out[j, i] = np.bincount(blk[ok], minlength=n).argmax()
    return out


def majority(g: np.ndarray, passes: int = 2) -> np.ndarray:
    h, w = g.shape
    for _ in range(passes):
        out = g.copy()
        for j in range(h):
            for i in range(w):
                if g[j, i] < 0:
                    continue
                nb = g[max(0, j - 1):j + 2, max(0, i - 1):i + 2].ravel()
                vals, cnt = np.unique(nb[nb >= 0], return_counts=True)
                if cnt.max() >= 5:
                    out[j, i] = vals[cnt.argmax()]
        g = out
    return g


def despeckle(rgba: np.ndarray, min_cluster: int = 3) -> None:
    """4 方向相連、不到 min_cluster 顆的不透明小塊變透明(就地修改)。"""
    n, lab, stats, _ = cv2.connectedComponentsWithStats((rgba[..., 3] > 0).astype(np.uint8), connectivity=4)
    small = np.nonzero(stats[:, cv2.CC_STAT_AREA] < min_cluster)[0]
    small = small[small > 0]
    rgba[np.isin(lab, small)] = 0


def ink_grid(rgb: np.ndarray, iw: int, ih: int, thresh: float) -> np.ndarray:
    """線稿 → 目標格上的線(比周圍中位數暗、8 方向相連 3 顆以上)。"""
    g = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    ink = (cv2.medianBlur(g, 15).astype(np.int16) - g.astype(np.int16)) > 38
    H, W = ink.shape
    ys = np.linspace(0, H, ih + 1).astype(int)
    xs = np.linspace(0, W, iw + 1).astype(int)
    grid = np.array([[ink[ys[j]:ys[j + 1], xs[i]:xs[i + 1]].mean() > thresh for i in range(iw)] for j in range(ih)])
    n, lab, stats, _ = cv2.connectedComponentsWithStats(grid.astype(np.uint8), connectivity=8)
    keep = np.nonzero(stats[:, cv2.CC_STAT_AREA] >= 3)[0]
    return np.isin(lab, keep[keep > 0])


def _circle_points(cx: int, cy: int, r: int) -> set:
    """中點畫圓(直徑 2r+1), 同 pixelstudio。"""
    pts = set()
    x, y, d = r, 0, 3 - 2 * r
    while y <= x:
        for px, py in ((x, y), (y, x), (-x, y), (-y, x), (x, -y), (y, -x), (-x, -y), (-y, -x)):
            pts.add((cx + px, cy + py))
        if d <= 0:
            d += 4 * y + 6
        else:
            d += 4 * (y - x) + 10
            x -= 1
        y += 1
    return pts


def _put(rgba, x, y, color, only=None):
    h, w = rgba.shape[:2]
    if 0 <= x < w and 0 <= y < h and (only is None or tuple(rgba[y, x, :3]) == only and rgba[y, x, 3]):
        rgba[y, x] = (*color, 255)


def circle(rgba, cx, cy, r, color, fill=False, only=None):
    pts = _circle_points(cx, cy, r)
    if not fill:
        for x, y in pts:
            _put(rgba, x, y, color, only)
        return
    rows: dict[int, tuple[int, int]] = {}
    for x, y in pts:
        lo, hi = rows.get(y, (x, x))
        rows[y] = (min(lo, x), max(hi, x))
    for y, (lo, hi) in rows.items():
        for x in range(lo, hi + 1):
            _put(rgba, x, y, color, only)


def eye_color(rgb: np.ndarray, ex: float, ey: float, er: float) -> tuple:
    """眼睛範圍內最飽和那一半像素的中位數。"""
    yy, xx = np.mgrid[0:rgb.shape[0], 0:rgb.shape[1]]
    inside = (xx + 0.5 - ex) ** 2 + (yy + 0.5 - ey) ** 2 <= max(er, 1) ** 2
    px = rgb[inside].astype(np.int16)
    if not len(px):
        return (240, 191, 85)
    sat = px.max(1) - px.min(1)
    top = px[sat >= np.median(sat)]
    return tuple(int(v) for v in np.median(top, axis=0))


def draw_eye(rgba, cx: int, cy: int, r: int, iris: tuple) -> None:
    """焦點眼睛重畫: 圓形虹膜、豎直瞳孔、反光點(轉換會把它抹掉)。"""
    circle(rgba, cx, cy, r, _mix(iris, INK, 0.4), fill=True)
    circle(rgba, cx, cy, r - 1, iris, fill=True)
    if r >= 4:
        circle(rgba, cx + 1, cy + 1, r - 2, _mix(iris, INK, 0.15), fill=True, only=iris)
    pupil = _mix(iris, INK, 0.8)
    for y in range(cy - r + 1, cy + r):
        _put(rgba, cx, y, pupil)
    _put(rgba, cx - max(1, r // 2), cy - max(1, r // 2), _mix(iris, (255, 255, 255), 0.8))
    if r >= 4:
        circle(rgba, cx, cy, r, INK)


def add_outline(rgba: np.ndarray) -> None:
    """主體外圍 4 方向加 1px 墨線(就地修改)。"""
    a = rgba[..., 3] > 0
    near = cv2.dilate(a.astype(np.uint8), np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]], np.uint8)) > 0
    rgba[near & ~a] = (*INK, 255)


def convert(img: np.ndarray, w: int, h: int, colors: int, lines: bool = False, outline: bool = True,
            eyes: list[dict] = ()) -> np.ndarray:
    """eyes = [{x, y, r}]: 0~1 相對來源圖位置與相對長邊的半徑。"""
    rgb, fg = subject_mask(img)
    pad = 1 if outline else 0
    iw, ih = w - 2 * pad, h - 2 * pad
    if iw < 1 or ih < 1:
        raise ValueError("尺寸太小, 加外框後沒有空間")
    box = crop_box(fg, iw / ih)
    crop = _crop(rgb, box, 255)
    fgc = _crop(fg, box, False)
    small = enhance(cv2.resize(crop, (iw * POOL, ih * POOL), interpolation=cv2.INTER_AREA))
    valid = cv2.resize(fgc.astype(np.float32), (iw * POOL, ih * POOL), interpolation=cv2.INTER_AREA) > 0.5
    if not valid.any():
        raise ValueError("主體太小, 轉不出像素")
    lab_valid, centers = _kmeans(small[valid], colors)
    labels = np.zeros(valid.shape, int)
    labels[valid] = lab_valid
    grid = majority(pool(labels, valid, iw, ih, len(centers)))

    out = np.zeros((h, w, 4), np.uint8)
    inner = out[pad:pad + ih, pad:pad + iw]
    on = grid >= 0
    inner[on, :3] = centers[grid[on]]
    inner[on, 3] = 255
    despeckle(out)
    if lines:
        line = ink_grid(crop, iw, ih, 0.19 if w >= 64 else 0.16)
        for j, i in zip(*np.nonzero(line)):
            c = inner[j, i]
            if not c[3] or 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] < 70:
                continue
            inner[j, i, :3] = _mix(c, INK, 0.85)
    sh, sw = rgb.shape[:2]
    x0, y0, x1, _ = box
    k = iw / (x1 - x0)
    for eye in eyes:
        ex, ey, er = eye["x"] * sw, eye["y"] * sh, eye["r"] * max(sw, sh)
        draw_eye(out, int(pad + (ex - x0) * k), int(pad + (ey - y0) * k), max(2, round(er * k)), eye_color(rgb, ex, ey, er))
    if outline:
        add_outline(out)
    return out
