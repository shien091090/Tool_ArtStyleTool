"""AI 結果的後處理: 對齊畫布、貼回素材; 候選圖框選去背; 找框到的灰盒。"""
import math

import cv2
import numpy as np

from .geometry import object_bbox

RATIO_TOLERANCE = 0.02
EMPTY_CUT = "框內找不到物件, 換個框"


def fit_to_canvas(img: np.ndarray, w: int, h: int) -> np.ndarray:
    """比例差超過 2% 先置中裁成畫布比例, 再縮放到畫布尺寸; 回傳 RGB。"""
    if img.ndim == 2:
        img = np.repeat(img[..., None], 3, axis=2)
    img = img[..., :3]
    ih, iw = img.shape[:2]
    target = w / h
    if abs((iw / ih) / target - 1) > RATIO_TOLERANCE:
        if iw / ih > target:
            nw = round(ih * target)
            x0 = (iw - nw) // 2
            img = img[:, x0:x0 + nw]
        else:
            nh = round(iw / target)
            y0 = (ih - nh) // 2
            img = img[y0:y0 + nh]
    if img.shape[:2] == (h, w):
        return np.ascontiguousarray(img)
    shrink = img.shape[1] > w
    return cv2.resize(img, (w, h), interpolation=cv2.INTER_AREA if shrink else cv2.INTER_CUBIC)


def paste_layer(img: np.ndarray, layer: np.ndarray) -> np.ndarray:
    """素材層(RGBA, 同尺寸)不透明處(alpha > 127)蓋回結果圖。"""
    out = img[..., :3].copy()
    keep = layer[..., 3] > 127
    out[keep] = layer[..., :3][keep]
    return out


def cut_object(client, img: np.ndarray, box, prompt: str) -> np.ndarray:
    """SAM 依框去背: 挑框內面積最大的遮罩、框外清空, 裁到不透明範圍(RGBA)。"""
    h, w = img.shape[:2]
    x0, y0 = max(0, math.floor(box[0])), max(0, math.floor(box[1]))
    x1, y1 = min(w, math.ceil(box[2])), min(h, math.ceil(box[3]))
    if x1 - x0 < 2 or y1 - y0 < 2:
        raise ValueError(EMPTY_CUT)
    rgb = np.ascontiguousarray(img[..., :3])
    masks = client.segment(rgb, prompt, [], [{"x_min": x0, "y_min": y0, "x_max": x1, "y_max": y1}])
    best, area = None, 0
    for m, _score in masks:
        a = int((m[y0:y1, x0:x1] > 0).sum())
        if a > area:
            best, area = m, a
    if best is None:
        raise ValueError(EMPTY_CUT)
    alpha = np.zeros((h, w), np.uint8)
    alpha[y0:y1, x0:x1] = np.where(best[y0:y1, x0:x1] > 0, 255, 0)
    ys, xs = np.nonzero(alpha)
    rgba = np.dstack([rgb, alpha])
    return rgba[ys.min():ys.max() + 1, xs.min():xs.max() + 1]


def overlap_suggest(objects: list[dict], view: str, box) -> dict | None:
    """和框重疊面積最大的灰盒(不看素材); 都沒重疊回 None。"""
    best, area = None, 0.0
    for o in objects:
        if o["kind"] == "asset":
            continue
        bx0, by0, bx1, by1 = object_bbox(view, o)
        a = max(0.0, min(bx1, box[2]) - max(bx0, box[0])) * max(0.0, min(by1, box[3]) - max(by0, box[1]))
        if a > area:
            best, area = o, a
    return best
