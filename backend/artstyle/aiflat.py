"""AI 平塗: GPT Image 2 畫出去線去光影的平塗, 再依線稿分格整理成色塊, 主體輪廓以原圖為準。"""
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
NEAR_WHITE = 235


def background(img: np.ndarray, level: int = NEAR_WHITE) -> np.ndarray:
    """背景遮罩: 接到圖片邊框的近白色像素。"""
    white = (img.min(axis=2) >= level).astype(np.uint8)
    n, comp = cv2.connectedComponents(white, connectivity=4)
    edge = np.unique(np.concatenate([comp[0], comp[-1], comp[:, 0], comp[:, -1]]))
    edge = edge[edge > 0]
    return np.isin(comp, edge)


def _fill_nearest(labels: np.ndarray, known: np.ndarray, target: np.ndarray) -> np.ndarray:
    """target 裡的像素改成最近的 known 像素的編號。"""
    _, nearest = cv2.distanceTransformWithLabels((~known).astype(np.uint8), cv2.DIST_L2, 5,
                                                 labelType=cv2.DIST_LABEL_PIXEL)
    lut = np.zeros(int(nearest.max()) + 1, labels.dtype)
    lut[nearest[known]] = labels[known]
    return np.where(target, lut[nearest], labels)


def fill_cells(labels: np.ndarray, lines: np.ndarray, fg: np.ndarray) -> np.ndarray:
    """照線稿分格上色: 線稿把主體切成格子, 每格整格改成格內最多的編號; 線底下取最近的格子。
    交界因此一定落在線上; 線有缺口時相連的兩格會變成同一色(已知代價)。"""
    free = fg & ~lines
    if not free.any():
        return labels
    n, cell = cv2.connectedComponents(free.astype(np.uint8), connectivity=4)
    span = int(labels.max()) + 1
    keys, counts = np.unique(cell[free].astype(np.int64) * span + labels[free], return_counts=True)
    cells, ids = keys // span, keys % span
    order = np.lexsort((-counts, cells))
    first = order[np.r_[True, cells[order][1:] != cells[order][:-1]]]
    major = np.zeros(n, labels.dtype)
    major[cells[first]] = ids[first]
    out = np.where(free, major[cell], labels)
    return _fill_nearest(out, free, fg & lines)


def segment_flat(ai: np.ndarray, source: np.ndarray) -> np.ndarray:
    """AI 平塗切成色塊編號(還沒照線稿分格)。原圖主體內 AI 沒畫到(或畫成白色)的地方用最近的色塊補。
    大圖要十幾秒, 結果存起來給換線稿時重用。"""
    h, w = source.shape[:2]
    # 細條門檻放低, 翅膀骨架、牙齒這類細節才不會被當過渡色帶併掉
    labels = color_segments(ai, k=FLAT_COLORS, min_area=max(12, h * w // 20000), thin=1.5)
    fg = ~background(source)
    # AI 在主體裡畫成白色(原圖那裡不是白的)也當沒畫到, 不然會像缺了一塊
    blank = background(ai) | ((ai.min(axis=2) >= NEAR_WHITE) & (source.min(axis=2) < NEAR_WHITE))
    known = fg & ~blank
    if not known.any():
        raise ValueError("AI 畫出來的平塗是空白的, 請再畫一次")
    hole = fg & ~known
    if hole.any():
        labels = _fill_nearest(labels, known, hole)
    return labels


def flat_regions(ai: np.ndarray, source: np.ndarray, lines: np.ndarray | None = None,
                 segments: np.ndarray | None = None) -> tuple[np.ndarray, dict[int, tuple[int, int, int]]]:
    """ai: AI 畫的平塗(已縮回原圖尺寸); lines: 乾淨線稿遮罩, 有的話照它分格; segments: 之前切好的色塊。
    回傳 (區塊編號 1..N, {編號: 顏色}), 最後一號是背景; 原圖主體外的一律當背景。"""
    labels = segment_flat(ai, source) if segments is None else segments
    colors = region_colors(labels, ai)
    fg = ~background(source)
    if lines is not None:
        labels = fill_cells(labels, lines, fg)
    ids = np.unique(labels[fg])
    lut = np.zeros(int(labels.max()) + 1, np.int32)
    lut[ids] = np.arange(1, len(ids) + 1)
    bg = len(ids) + 1
    out = {i + 1: colors[int(old)] for i, old in enumerate(ids)}
    out[bg] = WHITE
    return np.where(fg, lut[labels], bg).astype(np.int32), out
