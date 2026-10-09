import numpy as np


def _groups(labels: np.ndarray, keep: np.ndarray):
    """依區塊編號分組, 回傳 (編號, 該區塊被保留像素的扁平索引) 的迭代。"""
    flat_labels = labels.ravel()
    idx = np.flatnonzero(keep.ravel())
    order = idx[np.argsort(flat_labels[idx], kind="stable")]
    sorted_labels = flat_labels[order]
    ids, starts = np.unique(sorted_labels, return_index=True)
    for i, rid in enumerate(ids):
        end = starts[i + 1] if i + 1 < len(starts) else len(order)
        yield int(rid), order[starts[i]:end]


def region_colors(labels: np.ndarray, color_img: np.ndarray, exclude: np.ndarray | None = None,
                  trim: float = 0.2) -> dict[int, tuple[int, int, int]]:
    """每個區塊的代表色: 排除線條像素, 依亮度去掉最暗與最亮各 trim 比例後, 取各通道中位數。"""
    pixels = color_img.reshape(-1, 3).astype(np.float32)
    luma = pixels @ np.array([0.299, 0.587, 0.114], np.float32)
    keep = np.ones(labels.shape, bool) if exclude is None else ~exclude
    result: dict[int, tuple[int, int, int]] = {}
    for rid, members in _groups(labels, keep):
        result[rid] = _trimmed_median(pixels[members], luma[members], trim)
    for rid in np.unique(labels):  # 全被排除的區塊改用全部像素
        rid = int(rid)
        if rid not in result:
            members = np.flatnonzero(labels.ravel() == rid)
            result[rid] = _trimmed_median(pixels[members], luma[members], trim)
    return result


def _trimmed_median(px: np.ndarray, luma: np.ndarray, trim: float) -> tuple[int, int, int]:
    n = len(px)
    lo, hi = int(n * trim), n - int(n * trim)
    if hi - lo >= 1:
        px = px[np.argsort(luma, kind="stable")[lo:hi]]
    med = np.median(px, axis=0)
    return tuple(int(round(v)) for v in med)


def region_areas(labels: np.ndarray) -> dict[int, int]:
    ids, counts = np.unique(labels, return_counts=True)
    return {int(i): int(c) for i, c in zip(ids, counts)}


def paint(labels: np.ndarray, colors: dict[int, tuple[int, int, int]]) -> np.ndarray:
    lut = np.zeros((int(labels.max()) + 1, 3), np.uint8)
    for rid, col in colors.items():
        lut[int(rid)] = col
    return lut[labels]
