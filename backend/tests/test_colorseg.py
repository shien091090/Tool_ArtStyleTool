import numpy as np

from artstyle import colorseg


def _blocks(noise=6, seed=0):
    rng = np.random.default_rng(seed)
    img = np.zeros((60, 90, 3), np.float32)
    img[:, :30] = (200, 40, 40)
    img[:, 30:60] = (40, 160, 60)
    img[:, 60:] = (50, 60, 200)
    img += rng.normal(0, noise, img.shape)
    return np.clip(img, 0, 255).astype(np.uint8)


def test_color_segments_follow_color_blocks():
    lab = colorseg.color_segments(_blocks(), k=3, min_area=20)
    assert lab.min() == 1 and len(np.unique(lab)) == 3
    assert lab[30, 10] != lab[30, 45] != lab[30, 80]


def test_same_color_disconnected_areas_are_separate_regions():
    img = np.full((40, 60, 3), 230, np.uint8)
    img[5:15, 5:15] = (200, 30, 30)
    img[25:35, 40:50] = (200, 30, 30)
    lab = colorseg.color_segments(img, k=2, min_area=10)
    assert lab[10, 10] != lab[30, 45]
    assert len(np.unique(lab)) == 3


def test_tiny_specks_absorbed():
    img = np.full((40, 40, 3), 230, np.uint8)
    img[20, 20] = (0, 0, 0)
    img[5:25, 25:38] = (30, 30, 200)
    lab = colorseg.color_segments(img, k=3, min_area=10)
    assert len(np.unique(lab)) == 2


def test_merge_similar_adjacent_only():
    labels = np.array([[1, 1, 2, 2, 3, 3, 4, 4]] * 4, np.int32)
    colors = {1: (200, 40, 40), 2: (205, 45, 42), 3: (40, 40, 200), 4: (200, 40, 40)}
    areas = {i: 8 for i in colors}
    merged, cols = colorseg.merge_similar(labels, colors, areas, threshold=0.05)
    assert merged[0, 0] == merged[0, 2]          # 1、2 相近且相鄰 → 合併
    assert merged[0, 4] != merged[0, 2]          # 3 顏色差很多
    assert merged[0, 6] != merged[0, 0]          # 4 跟 1 同色但不相鄰
    assert set(np.unique(merged)) == set(cols) and len(cols) == 3


def test_merge_threshold_zero_keeps_everything():
    labels = np.array([[1, 2]], np.int32)
    merged, cols = colorseg.merge_similar(labels, {1: (1, 1, 1), 2: (1, 1, 1)}, {1: 1, 2: 1}, threshold=0)
    assert len(cols) == 2
