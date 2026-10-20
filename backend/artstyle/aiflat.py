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


def background(img: np.ndarray, level: int = 235) -> np.ndarray:
    """背景遮罩: 接到圖片邊框的近白色像素。"""
    white = (img.min(axis=2) >= level).astype(np.uint8)
    n, comp = cv2.connectedComponents(white, connectivity=4)
    edge = np.unique(np.concatenate([comp[0], comp[-1], comp[:, 0], comp[:, -1]]))
    edge = edge[edge > 0]
    return np.isin(comp, edge)


def flat_regions(ai: np.ndarray, source: np.ndarray) -> tuple[np.ndarray, dict[int, tuple[int, int, int]]]:
    """ai: AI 畫的平塗(已縮回原圖尺寸)。回傳 (區塊編號 1..N, {編號: 顏色}), 最後一號是背景。
    原圖主體內 AI 沒畫到的地方用最近的色塊補, 原圖主體外的一律當背景。"""
    h, w = source.shape[:2]
    # 細條門檻放低, 翅膀骨架、牙齒這類細節才不會被當過渡色帶併掉
    labels = color_segments(ai, k=FLAT_COLORS, min_area=max(12, h * w // 20000), thin=1.5)
    colors = region_colors(labels, ai)
    fg = ~background(source)
    known = fg & ~background(ai)
    if not known.any():
        raise ValueError("AI 畫出來的平塗是空白的, 請再畫一次")
    hole = fg & ~known
    if hole.any():
        _, nearest = cv2.distanceTransformWithLabels((~known).astype(np.uint8), cv2.DIST_L2, 5,
                                                     labelType=cv2.DIST_LABEL_PIXEL)
        lut = np.zeros(int(nearest.max()) + 1, np.int32)
        lut[nearest[known]] = labels[known]
        labels = np.where(hole, lut[nearest], labels)
    ids = np.unique(labels[fg])
    lut = np.zeros(int(labels.max()) + 1, np.int32)
    lut[ids] = np.arange(1, len(ids) + 1)
    bg = len(ids) + 1
    out = {i + 1: colors[int(old)] for i, old in enumerate(ids)}
    out[bg] = WHITE
    return np.where(fg, lut[labels], bg).astype(np.int32), out
