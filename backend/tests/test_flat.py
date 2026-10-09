import numpy as np

from artstyle import flat


def test_median_ignores_highlight_and_shadow():
    labels = np.ones((10, 10), np.int32)
    img = np.full((10, 10, 3), 100, np.uint8)
    img[0, :] = 255
    img[1, :] = 0
    assert flat.region_colors(labels, img)[1] == (100, 100, 100)


def test_excludes_line_pixels():
    labels = np.ones((4, 4), np.int32)
    labels[:, 2:] = 2
    img = np.zeros((4, 4, 3), np.uint8)
    img[:, :2] = (200, 0, 0)
    img[:, 2:] = (0, 0, 200)
    exclude = np.zeros((4, 4), bool)
    exclude[:, 1] = True
    img[:, 1] = (0, 0, 0)
    cols = flat.region_colors(labels, img, exclude)
    assert cols[1] == (200, 0, 0) and cols[2] == (0, 0, 200)


def test_region_fully_excluded_falls_back():
    labels = np.ones((2, 2), np.int32)
    img = np.full((2, 2, 3), 50, np.uint8)
    assert flat.region_colors(labels, img, np.ones((2, 2), bool))[1] == (50, 50, 50)


def test_values_are_plain_ints():
    labels = np.ones((2, 2), np.int32)
    col = flat.region_colors(labels, np.full((2, 2, 3), 7, np.uint8))[1]
    assert all(type(v) is int for v in col)


def test_paint_and_areas():
    labels = np.array([[1, 2], [2, 2]], np.int32)
    out = flat.paint(labels, {1: (1, 2, 3), 2: (4, 5, 6)})
    assert out[0, 0].tolist() == [1, 2, 3] and out[1, 1].tolist() == [4, 5, 6]
    assert flat.region_areas(labels) == {1: 1, 2: 3}
