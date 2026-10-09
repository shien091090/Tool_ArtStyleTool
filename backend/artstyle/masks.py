"""環境遮蔽與主體剪影: 給渲染端的凹處變暗、外輪廓、外框描邊、限制光照範圍使用。"""
import cv2
import numpy as np

from .lines import encode_sdf, signed_distance


def ambient_occlusion(depth01: np.ndarray, fg: np.ndarray) -> np.ndarray:
    """凹處(比周圍遠的地方)= 模糊後的深度減原深度取正。255 = 最暗的凹處, 平面為 0。"""
    h, w = depth01.shape
    d = depth01.astype(np.float32)
    cav = np.maximum(0.0, cv2.GaussianBlur(d, (0, 0), max(3.0, max(h, w) / 100)) - d) * fg
    top = np.percentile(cav[cav > 0], 99) if (cav > 0).any() else 0
    if top <= 1e-6:
        return np.zeros((h, w), np.uint8)
    return np.clip(cav / top * 255, 0, 255).astype(np.uint8)


def foreground(depth01: np.ndarray | None, labels: np.ndarray | None, shape=None) -> np.ndarray:
    """主體遮罩。深度: 深度 > 0(背景已在拆解時設為 0), 但輪廓會比畫出來的大一圈;
    區塊: 碰到圖片邊框且面積最大的區塊當背景, 邊界貼著顏色走。兩者都有時取交集。"""
    fg = np.ones(shape if shape is not None else (depth01 if depth01 is not None else labels).shape, bool)
    if depth01 is not None:
        fg &= depth01 > 0.001
    if labels is not None:
        border = set(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]).tolist())
        if depth01 is not None:
            # 角色碰到邊框時面積可能比背景碎塊大, 改看「深度為 0(背景)的像素」最多的那塊
            far = labels[depth01 <= 0.001]
            ids, counts = np.unique(far, return_counts=True)
            score = dict(zip(ids.tolist(), counts.tolist()))
        else:
            ids, counts = np.unique(labels, return_counts=True)
            score = dict(zip(ids.tolist(), counts.tolist()))
        bg = max(border, key=lambda i: score.get(i, 0))
        fg &= labels != bg
    return fg


def silhouette_sdf(fg: np.ndarray) -> np.ndarray:
    """主體剪影的有號距離場, 編碼同線條距離場(主體內 < 128、外 > 128)。"""
    return encode_sdf(signed_distance(fg))
