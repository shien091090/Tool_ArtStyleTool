"""材質替換: 只送部位附近的裁切給 AI, 結果只貼回部位範圍。"""
import cv2
import numpy as np

from ..imaging import resize_to

MAX_MATERIAL = 200
MAX_COUNT = 4


def crop_box(mask: np.ndarray) -> tuple[int, int, int, int]:
    """部位外框外加 長邊×5% 邊距, 夾在圖內。回傳 (x0, y0, x1, y1), x1/y1 不含。"""
    h, w = mask.shape[:2]
    ys, xs = np.nonzero(mask > 127)
    m = round(max(h, w) * 0.05)
    return (max(0, int(xs.min()) - m), max(0, int(ys.min()) - m),
            min(w, int(xs.max()) + m + 1), min(h, int(ys.max()) + m + 1))


def build_prompt(part_en: str, material: str, has_ref: bool) -> str:
    what = f"{material}, using the material shown in the second image as the reference" if has_ref else material
    return (f"Change the material of the {part_en} in this image to {what}. Keep exactly the same shape, silhouette, "
            "pose, size and position, and the same art style, linework and lighting direction. "
            "Do not change anything else in the image.")


def paste(src: np.ndarray, ai: np.ndarray, mask: np.ndarray, box: tuple[int, int, int, int]) -> np.ndarray:
    """AI 結果縮回裁切大小, 以遮罩(膨脹 2px、σ=1.5 羽化)貼回整張來源圖的複本。"""
    x0, y0, x1, y1 = box
    crop = src[y0:y1, x0:x1].astype(np.float32)
    ai = resize_to(ai[..., :3], x1 - x0, y1 - y0).astype(np.float32)
    k = (mask[y0:y1, x0:x1] > 127).astype(np.float32)
    k = cv2.GaussianBlur(cv2.dilate(k, np.ones((5, 5), np.uint8)), (0, 0), 1.5)[..., None]
    out = src.copy()
    out[y0:y1, x0:x1] = np.where(k > 0, np.clip(ai * k + crop * (1 - k), 0, 255).round(), crop).astype(np.uint8)
    return out
