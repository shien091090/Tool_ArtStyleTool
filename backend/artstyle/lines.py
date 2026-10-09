import cv2
import numpy as np

from .imaging import resize_to, to_gray

NO_LINE_DISTANCE = 64.0


def normalize_line(img: np.ndarray, width: int, height: int) -> np.ndarray:
    """fal 回傳的線稿 → 指定尺寸、白底黑線的灰階圖。線條稀疏, 全圖中位數就是底色; 不看邊框, 帶外框的線稿才不會被反相。"""
    gray = to_gray(img)
    if np.median(gray) < 128:
        gray = 255 - gray
    return resize_to(gray, width, height)


def line_mask(line: np.ndarray) -> np.ndarray:
    """白底黑線 → 線條像素為 True。Otsu 門檻, 但至少要暗於 200 才算線。"""
    gray = to_gray(line)
    if gray.min() >= 200:
        return np.zeros(gray.shape, bool)
    otsu, _ = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return gray < min(max(otsu, 1), 200)


def signed_distance(mask: np.ndarray) -> np.ndarray:
    """有號距離場(像素): 線內為負、線外為正, 邊界約在 0。"""
    if not mask.any():
        return np.full(mask.shape, NO_LINE_DISTANCE, np.float32)
    outside = cv2.distanceTransform((~mask).astype(np.uint8), cv2.DIST_L2, 5)
    inside = cv2.distanceTransform(mask.astype(np.uint8), cv2.DIST_L2, 5)
    return np.where(mask, -(inside - 0.5), outside - 0.5).astype(np.float32)


def encode_sdf(sd: np.ndarray) -> np.ndarray:
    return np.clip(np.round(128 + sd * 8), 0, 255).astype(np.uint8)
