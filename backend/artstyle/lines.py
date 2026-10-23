import cv2
import numpy as np

from .imaging import resize_to, to_gray

NO_LINE_DISTANCE = 64.0
# 2026-10-23 使用者選定: 長邊 464px 時濾掉短於約 20px 的碎線、線寬 2px
CLEAN_DEFAULT_LEVEL = 5
CLEAN_MAX_LEVEL = 10
CLEAN_MIN_LEN_PER_LEVEL = 0.043 / CLEAN_DEFAULT_LEVEL   # 每一級濾掉的長度(長邊的比例)
CLEAN_WIDTH_RATIO = 1 / 232


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
    if mask.all():
        return np.full(mask.shape, -NO_LINE_DISTANCE, np.float32)
    outside = cv2.distanceTransform((~mask).astype(np.uint8), cv2.DIST_L2, 5)
    inside = cv2.distanceTransform(mask.astype(np.uint8), cv2.DIST_L2, 5)
    return np.where(mask, -(inside - 0.5), outside - 0.5).astype(np.float32)


def encode_sdf(sd: np.ndarray) -> np.ndarray:
    return np.clip(np.round(128 + sd * 8), 0, 255).astype(np.uint8)


def _thin_tables() -> tuple[np.ndarray, np.ndarray]:
    """Zhang-Suen 兩個子步驟的刪除表: 以 8 鄰居(P2..P9 順時針, P2 在上)編成 0~255 查表。"""
    tables = []
    for step in (0, 1):
        table = np.zeros(256, bool)
        for code in range(256):
            p = [(code >> i) & 1 for i in range(8)]  # p[0]=P2 ... p[7]=P9
            count = sum(p)
            turns = sum(p[i] == 0 and p[(i + 1) % 8] == 1 for i in range(8))
            p2, p4, p6, p8 = p[0], p[2], p[4], p[6]
            side = (p2 * p4 * p6 == 0 and p4 * p6 * p8 == 0) if step == 0 else (p2 * p4 * p8 == 0 and p2 * p6 * p8 == 0)
            table[code] = 2 <= count <= 6 and turns == 1 and side
        tables.append(table)
    return tables[0], tables[1]


_THIN_TABLES = _thin_tables()


def thin(mask: np.ndarray) -> np.ndarray:
    """Zhang-Suen 細化: 粗線變成 1px 骨架。"""
    img = mask.astype(np.uint8)
    while True:
        changed = False
        for table in _THIN_TABLES:
            p = np.pad(img, 1)
            ring = [p[:-2, 1:-1], p[:-2, 2:], p[1:-1, 2:], p[2:, 2:], p[2:, 1:-1], p[2:, :-2], p[1:-1, :-2], p[:-2, :-2]]
            code = np.zeros(img.shape, np.uint8)
            for i, r in enumerate(ring):
                code |= r << i
            drop = (img == 1) & table[code]
            if drop.any():
                img[drop] = 0
                changed = True
        if not changed:
            return img > 0


def clean_line(raw: np.ndarray, fg: np.ndarray, level: int = CLEAN_DEFAULT_LEVEL) -> np.ndarray:
    """線稿原稿 → 乾淨線稿(白底純黑灰階): 細化成單線, 濾掉短碎線, 加上主體外輪廓, 統一粗細重畫。
    level 0 不濾, 越大濾掉越長的線。"""
    h, w = fg.shape
    long_side = max(h, w)
    skel = thin(line_mask(raw) & fg)
    min_len = level * CLEAN_MIN_LEN_PER_LEVEL * long_side
    if min_len > 1:
        n, comp, stats, _ = cv2.connectedComponentsWithStats(skel.astype(np.uint8), connectivity=8)
        keep = np.zeros(n, bool)
        keep[1:] = stats[1:, cv2.CC_STAT_AREA] >= min_len
        skel = keep[comp]
    rim = cv2.morphologyEx(fg.astype(np.uint8), cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8)) > 0
    skel |= thin(rim)
    width = max(1, round(long_side * CLEAN_WIDTH_RATIO))
    brush = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (width, width))
    lines = cv2.dilate(skel.astype(np.uint8), brush) > 0
    return np.where(lines, 0, 255).astype(np.uint8)
