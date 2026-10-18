"""生成前後處理: 補洞、修圖指令、只採用改動範圍附近的 AI 結果。"""
import cv2
import numpy as np

from ..imaging import resize_to

# 實驗(2026-10-10)驗證過的指令: 比例不准改回去
BASE_PROMPT = ("This image is a rough cut-and-paste edit: some parts were moved, resized, rotated or removed. "
               "Repair it into a clean, seamless illustration. Fix the seams, blend the edges, redraw any broken "
               "or duplicated lines, and fill any gaps or empty areas naturally. Keep the new size, proportion and "
               "position of every part exactly as shown - do not shrink or enlarge anything back. Keep the same "
               "art style, linework, colors, pose and composition.")
FOREIGN_PROMPT = (" Some parts were taken from another illustration: keep their design, but unify their art style, "
                  "linework, coloring and shading so they match the rest of the image.")


def build_prompt(has_foreign: bool, extra: str) -> str:
    p = BASE_PROMPT + (FOREIGN_PROMPT if has_foreign else "")
    extra = (extra or "").strip()
    return f"{p} {extra}" if extra else p


def background_color(img: np.ndarray) -> tuple[int, int, int]:
    """原圖背景色: 四邊不透明像素的中位數; 四邊大多透明(去背圖)就用白色。"""
    edges = [img[0], img[-1], img[:, 0], img[:, -1]]
    border = np.concatenate(edges)
    if border.shape[1] == 4:
        opaque = border[border[:, 3] >= 128]
        if len(opaque) < len(border) / 2:
            return (255, 255, 255)
        border = opaque
    return tuple(int(v) for v in np.median(border[:, :3], axis=0))


def fill_holes(rgba: np.ndarray, bg: tuple[int, int, int]) -> np.ndarray:
    """拼貼透明處(alpha < 128)補成背景色。
    不從周圍抹色: 挖掉的大洞會被抹成原部位的殘影, AI 會把殘影當成內容保留下來。"""
    rgb = np.ascontiguousarray(rgba[..., :3]).copy()
    rgb[rgba[..., 3] < 128] = bg
    return rgb


def feather_pad(w: int, h: int) -> int:
    return max(8, round(max(w, h) * 0.03))


def paste_back(ai: np.ndarray, base: np.ndarray, region: np.ndarray) -> np.ndarray:
    """改動範圍膨脹後漸層過渡; 範圍內完全用 AI, 膨脹+漸層以外與 base 逐像素相同。"""
    h, w = base.shape[:2]
    ai = resize_to(ai[..., :3], w, h)
    pad = feather_pad(w, h)
    core = (region > 127).astype(np.float32)
    grown = cv2.dilate(core, np.ones((pad, pad), np.uint8))
    sigma = pad / 2
    k = 2 * round(3 * sigma) + 1
    alpha = np.maximum(cv2.GaussianBlur(grown, (k, k), sigma), core)[..., None]
    blend = np.clip(ai.astype(np.float32) * alpha + base.astype(np.float32) * (1 - alpha), 0, 255).round().astype(np.uint8)
    return np.where(alpha > 0, blend, base)
