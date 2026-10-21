"""AI 平塗: GPT Image 2 畫出去線去光影的平塗, 再整理成乾淨色塊, 主體輪廓以原圖為準。"""
import cv2
import numpy as np

from .colorseg import color_segments
from .flat import region_colors

FLAT_MODEL = "gpt-image-2"
FLAT_PROMPT = ("Convert this illustration into a flat color base layer (the anime cel base-color layer before shading). "
               "Remove ALL line art and ALL shading, highlights, shadows, reflections and gradients. Paint every "
               "distinct area with ONE solid flat color in its own local unlit color, so each small detail (eyes, "
               "teeth, claws, accessories, patterns) stays its own separate flat shape. Keep every shape exactly the "
               "same size and position as the original. Pure white background. No outlines.")
# 2026-10-21 實驗: 分 28 色、碎塊併掉後最乾淨
FLAT_COLORS = 28
WHITE = (255, 255, 255)
# 2026-10-21 實驗: AI 各部位各自偏 1~3px, 局部對齊一次最好(輪廓 93.5% → 97.1%), 多做幾次反而變差
ALIGN_MAX_SHIFT = 12
ALIGN_SMOOTH = 3
# 貼著線稿、最厚不超過這麼多 px 的色塊細條, 當成 AI 畫歪越線的部分
SNAP_SLIVER = 3


def background(img: np.ndarray, level: int = 235) -> np.ndarray:
    """背景遮罩: 接到圖片邊框的近白色像素。"""
    white = (img.min(axis=2) >= level).astype(np.uint8)
    n, comp = cv2.connectedComponents(white, connectivity=4)
    edge = np.unique(np.concatenate([comp[0], comp[-1], comp[:, 0], comp[:, -1]]))
    edge = edge[edge > 0]
    return np.isin(comp, edge)


def _structure(edges: np.ndarray, fg: np.ndarray) -> np.ndarray:
    """邊緣 + 主體外框, 轉成越靠近邊緣越亮的圖, 給光流比對用。"""
    rim = cv2.morphologyEx(fg.astype(np.uint8), cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8)) > 0
    dist = cv2.distanceTransform((~(edges | rim)).astype(np.uint8), cv2.DIST_L2, 3)
    return np.clip(255 - dist * 20, 0, 255).astype(np.uint8)


def align_to_source(ai: np.ndarray, source: np.ndarray, lines: np.ndarray) -> np.ndarray:
    """把 AI 平塗局部挪動, 讓色塊邊界貼齊原圖的線稿與主體外框。"""
    h, w = source.shape[:2]
    gray = lambda img: cv2.cvtColor(np.ascontiguousarray(img), cv2.COLOR_RGB2GRAY)
    ref = _structure(lines, ~background(source))
    mov = _structure(cv2.Canny(gray(ai), 30, 90) > 0, ~background(ai))
    flow = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM).calc(ref, mov, None)
    flow = np.clip(cv2.GaussianBlur(flow, (0, 0), ALIGN_SMOOTH), -ALIGN_MAX_SHIFT, ALIGN_MAX_SHIFT)
    gx, gy = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))
    return cv2.remap(np.ascontiguousarray(ai), gx + flow[..., 0], gy + flow[..., 1], cv2.INTER_NEAREST,
                     borderMode=cv2.BORDER_CONSTANT, borderValue=WHITE)


def _fill_nearest(labels: np.ndarray, known: np.ndarray, target: np.ndarray) -> np.ndarray:
    """target 裡的像素改成最近的 known 像素的編號。"""
    _, nearest = cv2.distanceTransformWithLabels((~known).astype(np.uint8), cv2.DIST_L2, 5,
                                                 labelType=cv2.DIST_LABEL_PIXEL)
    lut = np.zeros(int(nearest.max()) + 1, labels.dtype)
    lut[nearest[known]] = labels[known]
    return np.where(target, lut[nearest], labels)


def snap_to_lines(labels: np.ndarray, lines: np.ndarray, fg: np.ndarray) -> np.ndarray:
    """色塊交界貼到線稿上: 線稿圍出的每一格裡, 貼著線的細條(越線畫過來或沒畫到線)
    改成同一格裡相鄰的色塊, 線稿底下的像素分給兩側最近的色塊, 交界就落在線中間。"""
    free = fg & ~lines
    if not free.any():
        return labels
    dist = cv2.distanceTransform((~lines).astype(np.uint8), cv2.DIST_L2, 3)
    _, cell = cv2.connectedComponents(free.astype(np.uint8), connectivity=4)
    # 每個編號各自切成連通的小塊, 全部編進同一張圖(0 = 不在 free 裡)
    piece = np.zeros(labels.shape, np.int32)
    count = 0
    for k in np.unique(labels[free]):
        n, cc = cv2.connectedComponents((free & (labels == k)).astype(np.uint8), connectivity=4)
        piece = np.where(cc > 0, cc + count, piece)
        count += n - 1
    on = piece > 0
    thick = np.zeros(count + 1, np.float32)
    np.maximum.at(thick, piece[on], dist[on])
    area = np.bincount(piece[on], minlength=count + 1)
    piece_cell = np.zeros(count + 1, np.int32)
    piece_cell[piece[on]] = cell[on]  # 一塊只會落在一格裡
    thin = thick <= SNAP_SLIVER
    thin[0] = False
    # 整格都是細條(兩條線中間的窄格): 留最大的那塊
    has_thick = np.zeros(int(cell.max()) + 1, bool)
    has_thick[piece_cell[1:][~thin[1:]]] = True
    for c in np.unique(piece_cell[thin]):
        if not has_thick[c]:
            ids = np.nonzero(thin & (piece_cell == c))[0]
            thin[ids[np.argmax(area[ids])]] = False
    sliver = thin[piece]
    # 細條從同一格的鄰居往內長, 不跨線
    out = np.where(free & ~sliver, labels, -1)
    for _ in range(4 * SNAP_SLIVER + 4):
        todo = sliver & (out < 0)
        if not todo.any():
            break
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            near, near_cell = np.roll(out, (dy, dx), (0, 1)), np.roll(cell, (dy, dx), (0, 1))
            take = todo & (out < 0) & (near >= 0) & (near_cell == cell)
            out[take] = near[take]
    out = np.where(out < 0, labels, out)
    out = _fill_nearest(out, free, fg & lines)
    return np.where(fg, out, labels)


def flat_regions(ai: np.ndarray, source: np.ndarray,
                 lines: np.ndarray | None = None) -> tuple[np.ndarray, dict[int, tuple[int, int, int]]]:
    """ai: AI 畫的平塗(已縮回原圖尺寸); lines: 原圖線稿遮罩, 有的話先對齊再把交界貼到線上
    (用原圖邊緣代替會被光影干擾, 反而更偏)。
    回傳 (區塊編號 1..N, {編號: 顏色}), 最後一號是背景。
    原圖主體內 AI 沒畫到的地方用最近的色塊補, 原圖主體外的一律當背景。"""
    h, w = source.shape[:2]
    if lines is not None:
        ai = align_to_source(ai, source, lines)
    # 細條門檻放低, 翅膀骨架、牙齒這類細節才不會被當過渡色帶併掉
    labels = color_segments(ai, k=FLAT_COLORS, min_area=max(12, h * w // 20000), thin=1.5)
    colors = region_colors(labels, ai)
    fg = ~background(source)
    known = fg & ~background(ai)
    if not known.any():
        raise ValueError("AI 畫出來的平塗是空白的, 請再畫一次")
    hole = fg & ~known
    if hole.any():
        labels = _fill_nearest(labels, known, hole)
    if lines is not None:
        labels = snap_to_lines(labels, lines, fg)
    ids = np.unique(labels[fg])
    lut = np.zeros(int(labels.max()) + 1, np.int32)
    lut[ids] = np.arange(1, len(ids) + 1)
    bg = len(ids) + 1
    out = {i + 1: colors[int(old)] for i, old in enumerate(ids)}
    out[bg] = WHITE
    return np.where(fg, lut[labels], bg).astype(np.int32), out
