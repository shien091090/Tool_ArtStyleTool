import numpy as np

from artstyle import masks


def test_ao_dark_in_groove_zero_on_flat():
    d = np.full((80, 80), 0.8, np.float32)
    d[:, 38:42] = 0.6                         # 一條凹槽
    ao = masks.ambient_occlusion(d, np.ones((80, 80), bool))
    assert ao[40, 40] > 100 and ao[40, 10] < 10
    flat = masks.ambient_occlusion(np.full((40, 40), 0.5, np.float32), np.ones((40, 40), bool))
    assert (flat == 0).all()


def test_ao_only_inside_foreground():
    d = np.full((40, 40), 0.8, np.float32)
    d[:, 18:22] = 0.4
    fg = np.zeros((40, 40), bool)
    ao = masks.ambient_occlusion(d, fg)
    assert (ao == 0).all()


def test_foreground_from_depth():
    d = np.zeros((20, 20), np.float32)
    d[5:15, 5:15] = 0.7
    fg = masks.foreground(d, None)
    assert fg[10, 10] and not fg[0, 0]


def test_foreground_from_regions_when_no_depth():
    labels = np.ones((20, 20), np.int32)        # 1 = 背景(碰邊框且最大)
    labels[5:12, 5:12] = 2
    labels[0:3, 0:3] = 3                         # 也碰邊框但面積小
    fg = masks.foreground(None, labels)
    assert fg[8, 8] and fg[1, 1] and not fg[15, 15]


def test_foreground_fallback_all():
    assert masks.foreground(None, None, shape=(4, 5)).all()


def test_silhouette_sdf_sign():
    fg = np.zeros((40, 40), bool)
    fg[10:30, 10:30] = True
    sdf = masks.silhouette_sdf(fg).astype(int)
    assert sdf[20, 20] < 128 and sdf[2, 2] > 128


def test_foreground_intersects_depth_and_regions():
    d = np.zeros((40, 40), np.float32)
    d[5:35, 5:35] = 0.7                          # 深度主體偏大
    labels = np.ones((40, 40), np.int32)
    labels[10:30, 10:30] = 2                     # 畫出來的主體比較小
    fg = masks.foreground(d, labels)
    assert fg[20, 20] and not fg[7, 7] and not fg[0, 0]
