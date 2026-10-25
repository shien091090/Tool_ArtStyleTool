"""像素場景: AI 結果整張對齊遊戲像素格子(每 s×s 方塊單色)並限制色數。"""
import cv2
import numpy as np

_SAMPLE = 20000
_CHUNK = 200000


def _palette(pixels: np.ndarray, colors: int) -> np.ndarray:
    """取樣做 k-means 得到最多 colors 色的色盤(float32, k×3)。"""
    rng = np.random.default_rng(0)
    sample = pixels[rng.choice(len(pixels), min(_SAMPLE, len(pixels)), replace=False)].astype(np.float32)
    k = min(colors, len(np.unique(sample, axis=0)))
    if k <= 1:
        return sample[:1]
    crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 0.5)
    _, _, centers = cv2.kmeans(sample, k, None, crit, 3, cv2.KMEANS_PP_CENTERS)
    return centers


def _nearest(pixels: np.ndarray, centers: np.ndarray) -> np.ndarray:
    out = np.empty(len(pixels), np.int32)
    c = centers[None].astype(np.float32)
    for i in range(0, len(pixels), _CHUNK):
        p = pixels[i:i + _CHUNK, None].astype(np.float32)
        out[i:i + _CHUNK] = ((p - c) ** 2).sum(axis=2).argmin(axis=1)
    return out


def align_grid(rgb: np.ndarray, s: int, colors: int) -> np.ndarray:
    """切成 s×s 方塊, 先量化到 colors 色, 每塊取出現最多的顏色, 再放大回原尺寸(不去背)。"""
    rgb = np.ascontiguousarray(rgb[..., :3])
    h, w = rgb.shape[:2]
    if h % s or w % s:
        raise ValueError(f"圖片尺寸 {w}×{h} 不能被 {s} 整除")
    pixels = rgb.reshape(-1, 3)
    centers = _palette(pixels, colors)
    labels = _nearest(pixels, centers).reshape(h // s, s, w // s, s)
    k = len(centers)
    block = np.arange((h // s) * (w // s)).reshape(h // s, 1, w // s, 1)
    counts = np.bincount((np.broadcast_to(block, labels.shape) * k + labels).ravel(),
                         minlength=(h // s) * (w // s) * k).reshape(-1, k)
    small = np.clip(np.rint(centers), 0, 255).astype(np.uint8)[counts.argmax(axis=1)].reshape(h // s, w // s, 3)
    return np.repeat(np.repeat(small, s, axis=0), s, axis=1)
