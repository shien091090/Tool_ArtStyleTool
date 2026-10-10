import numpy as np

from artstyle import shade
from artstyle.colorseg import oklab


def _two_regions():
    labels = np.ones((60, 80), np.int32)
    labels[:, 40:] = 2
    flat = np.zeros((60, 80, 3), np.uint8)
    flat[:, :40] = (200, 60, 60)
    flat[:, 40:] = (60, 60, 200)
    return labels, flat


def test_shade_does_not_cross_region_boundary():
    labels, flat = _two_regions()
    src = flat.copy()
    src[:, 40:] = (20, 20, 90)                   # 右塊整片比平塗暗, 左塊跟平塗一樣
    s = shade.region_shade(src, flat, labels, None)
    assert abs(s[30, 39, 0]) < 1e-3              # 左塊緊貼邊界處不受右塊影響
    resid_r = (oklab(src) - oklab(flat))[30, 60, 0]
    assert abs(s[30, 41, 0] - resid_r) < 1e-3    # 右塊緊貼邊界處就是右塊自己的值


def test_shade_ignores_line_pixels():
    labels, flat = _two_regions()
    src = flat.copy()
    src[:, 10:12] = (0, 0, 0)                    # 左塊裡的一條黑線
    lines = np.zeros((60, 80), bool)
    lines[:, 10:12] = True
    s = shade.region_shade(src, flat, labels, lines)
    assert np.abs(s[:, :40, 0]).max() < 1e-3     # 線條不會被暈成髒污
    no_mask = shade.region_shade(src, flat, labels, None)
    assert np.abs(no_mask[:, :40, 0]).max() > 0.01


def test_encode_shade_range():
    lab = np.zeros((1, 3, 3), np.float32)
    lab[0, 1] = (1, 0.42, -0.42)
    lab[0, 2] = (-2, 0, 0)
    enc = shade.encode_shade(lab)
    assert enc[0, 0].tolist() == [128, 128, 128]
    assert enc[0, 1].tolist() == [255, 254, 2]
    assert enc[0, 2, 0] == 1


def test_bbox_without_padding_matches_reference():
    rng = np.random.default_rng(0)
    labels = np.ones((64, 64), np.int32)
    labels[20:40, 10:30] = 2
    flat = np.full((64, 64, 3), 120, np.uint8)
    src = rng.integers(0, 255, (64, 64, 3), dtype=np.uint8)
    got = shade.region_shade(src, flat, labels, None)
    # 參考: 整張圖做正規化卷積(不裁切)
    import cv2
    resid = (oklab(src) - oklab(flat)).astype(np.float32)
    sigma = max(1.0, 64 / 60)
    for rid in (1, 2):
        m = (labels == rid).astype(np.float32)
        den = cv2.GaussianBlur(m, (0, 0), sigma, borderType=cv2.BORDER_CONSTANT)
        num = cv2.GaussianBlur(resid[..., 0] * m, (0, 0), sigma, borderType=cv2.BORDER_CONSTANT)
        ref = num / np.maximum(den, 1e-6)
        assert np.allclose(got[..., 0][labels == rid], ref[labels == rid], atol=1e-4)
