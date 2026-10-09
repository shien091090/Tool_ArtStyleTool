"""依顏色切區塊(不靠線稿), 以及相鄰相近色區塊合併。"""
import cv2
import numpy as np

from .imaging import resize_to

_M1 = np.array([[0.4122214708, 0.5363325363, 0.0514459929],
                [0.2119034982, 0.6806995451, 0.1073969566],
                [0.0883024619, 0.2817188376, 0.6299787005]], np.float32)
_M2 = np.array([[0.2104542553, 0.793617785, -0.0040720468],
                [1.9779984951, -2.428592205, 0.4505937099],
                [0.0259040371, 0.7827717662, -0.808675766]], np.float32)


def oklab(rgb: np.ndarray) -> np.ndarray:
    c = rgb.astype(np.float32) / 255
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return np.cbrt(c @ _M1.T) @ _M2.T


def _smooth(img: np.ndarray) -> np.ndarray:
    """保邊平滑(mean shift)。大圖先縮到長邊 1024 再放回, 不然太慢。"""
    h, w = img.shape[:2]
    scale = min(1.0, 1024 / max(h, w))
    small = resize_to(img, max(1, round(w * scale)), max(1, round(h * scale)))
    bgr = cv2.cvtColor(small, cv2.COLOR_RGB2BGR)
    sm = cv2.cvtColor(cv2.pyrMeanShiftFiltering(bgr, 8, 24), cv2.COLOR_BGR2RGB)
    return resize_to(sm, w, h)


def color_segments(img: np.ndarray, k: int = 12, min_area: int = 40) -> np.ndarray:
    """RGB → 區塊編號 1..N: 保邊平滑 → OKLab k-means 分 k 色 → 同色且相連的像素為一塊 → 小碎塊併入最近的大塊。"""
    h, w = img.shape[:2]
    smooth = _smooth(img)
    lab = oklab(smooth).reshape(-1, 3).astype(np.float32)
    k = int(max(1, min(k, len(np.unique(smooth.reshape(-1, 3), axis=0)))))
    cv2.setRNGSeed(0)
    _, cls, _ = cv2.kmeans(lab, k, None, (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 1e-4),
                           2, cv2.KMEANS_PP_CENTERS)
    cls = cls.reshape(h, w)

    labels = np.zeros((h, w), np.int32)
    areas = []
    next_id = 1
    for c in range(k):
        n, comp, stats, _ = cv2.connectedComponentsWithStats((cls == c).astype(np.uint8), connectivity=4)
        if n <= 1:
            continue
        lut = np.zeros(n, np.int32)
        lut[1:] = np.arange(next_id, next_id + n - 1)
        labels = np.where(comp > 0, lut[comp], labels)
        areas.extend(stats[1:, cv2.CC_STAT_AREA].tolist())
        next_id += n - 1
    areas = np.array([0] + areas)

    # 細條(顏色交界的過渡色帶)也要併掉: 區塊內離邊界最遠的距離 < 2px 就算細條
    edge = np.zeros((h, w), bool)
    edge[:, 1:] |= labels[:, 1:] != labels[:, :-1]
    edge[:, :-1] |= labels[:, 1:] != labels[:, :-1]
    edge[1:, :] |= labels[1:, :] != labels[:-1, :]
    edge[:-1, :] |= labels[1:, :] != labels[:-1, :]
    inner = cv2.distanceTransform((~edge).astype(np.uint8), cv2.DIST_L2, 3)
    thickness = np.zeros(next_id, np.float32)
    np.maximum.at(thickness, labels.ravel(), inner.ravel())
    small = (areas[labels] < min_area) | (thickness[labels] < 2)
    if small.all():
        small = labels != np.argmax(areas)
    if small.any():
        _, nearest = cv2.distanceTransformWithLabels(small.astype(np.uint8), cv2.DIST_L2, 5,
                                                     labelType=cv2.DIST_LABEL_PIXEL)
        lut = np.zeros(int(nearest.max()) + 1, np.int32)
        lut[nearest[~small]] = labels[~small]
        labels = lut[nearest]
    _, inv = np.unique(labels, return_inverse=True)
    return (inv.reshape(h, w) + 1).astype(np.int32)


def merge_similar(labels: np.ndarray, colors: dict, areas: dict, threshold: float):
    """相鄰且 OKLab 距離 < threshold 的區塊合併, 從最像的一對開始, 顏色取面積加權平均。
    回傳 (新的區塊編號圖, {編號: 顏色})。"""
    parent = {int(k): int(k) for k in colors}
    rgb = {int(k): np.array(v, np.float64) for k, v in colors.items()}
    lab = {k: oklab(np.array([v]))[0] for k, v in rgb.items()}
    area = {int(k): float(v) for k, v in areas.items()}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    pairs = set()
    for a, b in ((labels[:, :-1], labels[:, 1:]), (labels[:-1, :], labels[1:, :])):
        diff = a != b
        pairs.update(zip(np.minimum(a, b)[diff].tolist(), np.maximum(a, b)[diff].tolist()))

    changed = True
    while changed:
        changed = False
        cand = sorted((float(np.linalg.norm(lab[find(a)] - lab[find(b)])), a, b) for a, b in pairs
                      if find(a) != find(b))
        for _, a, b in cand:
            ra, rb = find(a), find(b)
            if ra == rb or np.linalg.norm(lab[ra] - lab[rb]) >= threshold:
                continue
            wa, wb = area[ra], area[rb]
            rgb[ra] = (rgb[ra] * wa + rgb[rb] * wb) / (wa + wb)
            lab[ra] = oklab(np.array([rgb[ra]]))[0]
            area[ra] = wa + wb
            parent[rb] = ra
            changed = True

    lut = np.zeros(int(labels.max()) + 1, np.int32)
    for k in parent:
        lut[k] = find(k)
    merged = lut[labels]
    roots = sorted(set(np.unique(merged).tolist()))
    return merged, {r: tuple(int(round(v)) for v in rgb[r]) for r in roots}
