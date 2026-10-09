import cv2
import numpy as np

from .imaging import resize_to, to_gray


def normalize_depth(img: np.ndarray, width: int, height: int, near_is_bright: bool) -> np.ndarray:
    """深度圖 → 指定尺寸的 float32 0..1, 1 = 近。以 1%/99% 分位數拉伸。"""
    gray = to_gray(img).astype(np.float32)
    gray = resize_to(gray, width, height)
    lo, hi = np.percentile(gray, [1, 99])
    if hi - lo < 1e-6:
        d = np.full(gray.shape, 0.5, np.float32)
    else:
        d = np.clip((gray - lo) / (hi - lo), 0, 1)
    return d if near_is_bright else 1 - d


def depth_to_normal(depth: np.ndarray, strength: float = 25.0, blur: float = 1.5) -> np.ndarray:
    """深度(1 = 近)→ RGB 編碼法線, OpenGL 慣例: +X 右、+Y 上、+Z 朝觀看者。
    strength: 深度 0..1 對應的高度, 單位是長邊的百分比。"""
    h, w = depth.shape
    height = depth.astype(np.float32)
    if blur > 0:
        height = cv2.GaussianBlur(height, (0, 0), blur)
    height *= strength * max(h, w) / 100
    dx = cv2.Sobel(height, cv2.CV_32F, 1, 0, ksize=3) / 8
    dy = cv2.Sobel(height, cv2.CV_32F, 0, 1, ksize=3) / 8
    n = np.dstack([-dx, dy, np.ones_like(dx)])  # 影像 y 向下, 往下變高代表表面朝上
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return np.clip(np.round((n * 0.5 + 0.5) * 255), 0, 255).astype(np.uint8)
