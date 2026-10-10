"""原圖光影: 原圖與平塗(取色)在 OKLab 的差, 只在同一個區塊內模糊、排除線條。
渲染端用它和即時算出的原圖紋理, 讓「不動參數 = 原圖」成立。"""
import cv2
import numpy as np

from .colorseg import oklab

L_SCALE, AB_SCALE = 127.0, 300.0


def region_shade(source: np.ndarray, flat_sampled: np.ndarray, labels: np.ndarray,
                 line_mask: np.ndarray | None) -> np.ndarray:
    """回傳 float32 (H,W,3) 的 OKLab 差, 每個區塊各自做正規化卷積, 光影不會跨區塊暈開。"""
    h, w = labels.shape
    resid = (oklab(source) - oklab(flat_sampled)).astype(np.float32)
    valid = np.ones((h, w), bool) if line_mask is None else ~line_mask
    sigma = max(1.0, max(h, w) / 60)
    pad = int(np.ceil(sigma * 3))
    out = np.zeros_like(resid)
    ids = np.unique(labels)
    # 各區塊的外框, 一次算好
    flat_l = labels.ravel()
    order = np.argsort(flat_l, kind="stable")
    starts = np.searchsorted(flat_l[order], ids)
    ends = np.append(starts[1:], len(order))
    for rid, a, b in zip(ids, starts, ends):
        idx = order[a:b]
        ry, rx = idx // w, idx % w
        y0, y1 = max(0, ry.min() - pad), min(h, ry.max() + pad + 1)
        x0, x1 = max(0, rx.min() - pad), min(w, rx.max() + pad + 1)
        region = labels[y0:y1, x0:x1] == rid
        m = (region & valid[y0:y1, x0:x1]).astype(np.float32)
        if m.sum() == 0:
            m = region.astype(np.float32)        # 整塊都是線: 退回不排除線條
        den = cv2.GaussianBlur(m, (0, 0), sigma, borderType=cv2.BORDER_CONSTANT)
        for c in range(3):
            num = cv2.GaussianBlur(resid[y0:y1, x0:x1, c] * m, (0, 0), sigma, borderType=cv2.BORDER_CONSTANT)
            val = np.where(den > 1e-6, num / np.maximum(den, 1e-6), 0)
            out[y0:y1, x0:x1, c][region] = val[region]
    return out


def encode_shade(lab: np.ndarray) -> np.ndarray:
    enc = np.empty(lab.shape, np.float32)
    enc[..., 0] = lab[..., 0] * L_SCALE + 128
    enc[..., 1:] = lab[..., 1:] * AB_SCALE + 128
    return np.clip(np.round(enc), 1, 255).astype(np.uint8)
