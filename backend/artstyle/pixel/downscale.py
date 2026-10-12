"""AI 圖 → 精確像素解析度(規格 4.5)。輸入輸出皆 RGB 順序; 結果為 RGBA。"""
import asyncio

import cv2
import numpy as np

from .prompts import CELL, crop_content, pad_to

BG_WHITE = 225
CONTRAST = 40
NEAR = 20
SHARE = 0.10
AUTO_MAX = 256

METHODS = {"dominant": "每格取最多色", "contrast": "明暗保留", "adaptive": "內容自適應", "auto": "自動偵測格子"}


def fit(img: np.ndarray, W: int, H: int) -> np.ndarray:
    """裁掉白邊, 補白成 W:H。"""
    return pad_to(crop_content(img[..., :3]), W / H)


def _kmeans(pixels: np.ndarray, k: int) -> tuple[np.ndarray, np.ndarray]:
    """pixels (N,3) → (labels (N,), centers (k',3) uint8)。顏色比 k 少時直接用原色。"""
    uniq, inv = np.unique(pixels.reshape(-1, 3), axis=0, return_inverse=True)
    if len(uniq) <= k:
        return inv.reshape(-1), uniq.astype(np.uint8)
    crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.5)
    cv2.setRNGSeed(1)
    _, lab, cen = cv2.kmeans(pixels.reshape(-1, 3).astype(np.float32), k, None, crit, 4, cv2.KMEANS_PP_CENTERS)
    return lab.reshape(-1), cen.clip(0, 255).round().astype(np.uint8)


def quantize(rgb: np.ndarray, colors: int) -> np.ndarray:
    lab, cen = _kmeans(rgb, colors + 1)  # 多一群給白背景
    return cen[lab].reshape(rgb.shape)


def remove_background(rgb: np.ndarray) -> np.ndarray:
    """接近白且與圖邊 4 連通 → 透明; 主體內的白保留。"""
    bg = (rgb.min(axis=2) > BG_WHITE).astype(np.uint8)
    _, cc = cv2.connectedComponents(bg, connectivity=4)
    edge = np.unique(np.concatenate([cc[0], cc[-1], cc[:, 0], cc[:, -1]]))
    edge = edge[edge != 0]
    alpha = np.where(np.isin(cc, edge) & (bg > 0), 0, 255).astype(np.uint8)
    return np.dstack([rgb, alpha])


def dominant(img: np.ndarray, W: int, H: int, colors: int) -> np.ndarray:
    k = 16
    a = cv2.resize(fit(img, W, H), (W * k, H * k), interpolation=cv2.INTER_AREA)
    lab, cen = _kmeans(a, colors + 1)
    blocks = lab.reshape(H, k, W, k).transpose(0, 2, 1, 3).reshape(H, W, k * k)
    n = len(cen)
    counts = (blocks[..., None] == np.arange(n)).sum(axis=2)
    return remove_background(cen[counts.argmax(axis=2)])


def _luma(rgb: np.ndarray) -> np.ndarray:
    return rgb[..., 0] * 0.299 + rgb[..., 1] * 0.587 + rgb[..., 2] * 0.114


def contrast(img: np.ndarray, W: int, H: int, colors: int) -> np.ndarray:
    k = CELL
    a = cv2.resize(fit(img, W, H), (W * k, H * k), interpolation=cv2.INTER_AREA).astype(np.float32)
    blocks = a.reshape(H, k, W, k, 3).transpose(0, 2, 1, 3, 4).reshape(H, W, k * k, 3)
    out = np.zeros((H, W, 3), np.float32)
    for y in range(H):
        for x in range(W):
            px = blocks[y, x]
            L = _luma(px)
            lo, hi, med = L.min(), L.max(), np.median(L)
            dark = L <= lo + NEAR
            bright = L >= hi - NEAR
            if med - lo > CONTRAST and dark.mean() >= SHARE:
                out[y, x] = px[dark].mean(axis=0)
            elif hi - med > CONTRAST and bright.mean() >= SHARE:
                out[y, x] = px[bright].mean(axis=0)
            else:
                out[y, x] = px[np.abs(L - med).argmin()]
    return remove_background(quantize(out.round().astype(np.uint8), colors))


def adaptive(img: np.ndarray, W: int, H: int, colors: int) -> np.ndarray:
    from unfake import content_adaptive_downscale
    f = fit(img, W, H)
    rgba = np.dstack([f, np.full(f.shape[:2], 255, np.uint8)])
    out = np.asarray(content_adaptive_downscale(rgba, W, H))[..., :3].clip(0, 255).astype(np.uint8)
    return remove_background(quantize(out, colors))


def auto(img: np.ndarray, colors: int) -> np.ndarray:
    from unfake import process_image
    res = asyncio.run(process_image(np.ascontiguousarray(img[..., :3]), max_colors=colors + 1, detect_method="auto",
                                    downscale_method="dominant", cleanup={"morph": False, "jaggy": True}))
    rgb = np.asarray(res["image_array"])[..., :3].astype(np.uint8)
    if max(rgb.shape[:2]) > AUTO_MAX:
        raise ValueError("偵測不到像素格子")
    rgba = remove_background(rgb)
    ys, xs = np.nonzero(rgba[..., 3])
    if not len(xs):
        raise ValueError("縮小後沒有主體")
    return rgba[ys.min():ys.max() + 1, xs.min():xs.max() + 1]


def limit_colors(rgba: np.ndarray, colors: int) -> np.ndarray:
    """不透明像素超過色數時再減一次(背景白那一群可能落在主體上)。"""
    opaque = rgba[..., 3] > 0
    px = rgba[opaque][:, :3]
    if len(np.unique(px, axis=0)) <= colors:
        return rgba
    lab, cen = _kmeans(px, colors)
    out = rgba.copy()
    out[opaque, :3] = cen[lab]
    return out


def palette(rgba: np.ndarray) -> list[str]:
    """不透明像素的顏色, 依出現次數多到少。"""
    px = rgba[rgba[..., 3] > 0][:, :3]
    if not len(px):
        return []
    uniq, cnt = np.unique(px, axis=0, return_counts=True)
    return ["#%02x%02x%02x" % tuple(int(v) for v in uniq[i]) for i in np.argsort(-cnt, kind="stable")]


def run(method: str, img: np.ndarray, colors: int, cols: int = 0, rows: int = 0) -> np.ndarray:
    if img[..., :3].min() > BG_WHITE:
        raise ValueError("AI 圖整張是白的")
    if method == "auto":
        return limit_colors(auto(img, colors), colors)
    fn = {"dominant": dominant, "contrast": contrast, "adaptive": adaptive}[method]
    return limit_colors(fn(img, cols * CELL, rows * CELL, colors), colors)
