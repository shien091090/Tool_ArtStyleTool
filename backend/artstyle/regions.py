"""用線稿圍出區塊。LineFiller trapped-ball 填色的簡化版: 由大到小的半徑膨脹線條補縫, 再把剩下的像素歸給最近的區塊。"""
import cv2
import numpy as np

MAX_REGIONS = 65535
_CROSS = cv2.getStructuringElement(cv2.MORPH_CROSS, (3, 3))


def label_regions(mask: np.ndarray, gap_radius: int = 3, min_area: int = 12) -> np.ndarray:
    """mask: 線條像素為 True。回傳 int32 區塊編號 1..N, 每個像素(含線條)都有編號。"""
    labels = np.zeros(mask.shape, np.int32)
    next_id = 1
    line = mask.astype(np.uint8)
    for r in range(max(0, int(gap_radius)), -1, -1):
        if r:
            ball = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
            closed = cv2.dilate(line, ball) > 0
        else:
            closed = mask
        free = (~closed) & (labels == 0)
        n, comp, stats, _ = cv2.connectedComponentsWithStats(free.astype(np.uint8), connectivity=4)
        if n <= 1:
            continue
        # 碰到既有區塊的是被膨脹削掉的邊緣, 不是新區塊
        near_existing = cv2.dilate((labels > 0).astype(np.uint8), _CROSS) > 0
        touching = np.unique(comp[near_existing & (comp > 0)])
        ok = stats[:, cv2.CC_STAT_AREA] >= min_area
        ok[0] = False
        ok[touching] = False
        new_ids = np.flatnonzero(ok)
        if new_ids.size == 0:
            continue
        lut = np.zeros(n, np.int32)
        lut[new_ids] = np.arange(next_id, next_id + new_ids.size)
        next_id += new_ids.size
        hit = lut[comp]
        labels = np.where(hit > 0, hit, labels)

    if labels.max() == 0:
        return np.ones(mask.shape, np.int32)

    unlabeled = labels == 0
    if unlabeled.any():
        _, nearest = cv2.distanceTransformWithLabels(
            unlabeled.astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
        lut = np.zeros(int(nearest.max()) + 1, np.int32)
        lut[nearest[~unlabeled]] = labels[~unlabeled]
        labels = lut[nearest]

    _, inverse = np.unique(labels, return_inverse=True)
    labels = (inverse.reshape(labels.shape) + 1).astype(np.int32)
    if labels.max() > MAX_REGIONS:
        raise ValueError(f"區塊過多({labels.max()}), 請調大最小面積或補線縫半徑")
    return labels


def encode_labels(labels: np.ndarray) -> np.ndarray:
    if labels.max() > MAX_REGIONS:
        raise ValueError("區塊過多")
    out = np.zeros(labels.shape + (4,), np.uint8)
    out[..., 0] = labels & 0xFF
    out[..., 1] = (labels >> 8) & 0xFF
    out[..., 3] = 255
    return out


def decode_labels(rgba: np.ndarray) -> np.ndarray:
    return rgba[..., 0].astype(np.int32) + rgba[..., 1].astype(np.int32) * 256
