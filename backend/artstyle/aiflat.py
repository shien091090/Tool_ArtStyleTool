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


def flat_regions(ai: np.ndarray, source: np.ndarray,
                 lines: np.ndarray | None = None) -> tuple[np.ndarray, dict[int, tuple[int, int, int]]]:
    """ai: AI 畫的平塗(已縮回原圖尺寸); lines: 原圖線稿遮罩, 有的話先對齊(用原圖邊緣代替會被光影干擾, 反而更偏)。
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
