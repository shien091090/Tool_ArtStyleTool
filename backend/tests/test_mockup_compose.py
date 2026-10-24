import numpy as np
import pytest

from artstyle.mockup.compose import cut_object, fit_to_canvas, overlap_suggest, paste_layer


class FakeSeg:
    def __init__(self, masks):
        self.masks = masks
        self.calls = []

    def segment(self, img, prompt, points, boxes):
        self.calls.append((prompt, points, boxes))
        return self.masks


def test_fit_same_ratio():
    img = np.random.default_rng(1).integers(0, 255, (720, 1280, 3), np.uint8)
    out = fit_to_canvas(img, 1280, 720)
    assert out.shape == (720, 1280, 3) and (out == img).all()


def test_fit_crops_ratio():
    img = np.zeros((1536, 1024, 3), np.uint8)
    img[:] = (0, 200, 0)
    img[:, :80] = (200, 0, 0)
    img[:, 944:] = (0, 0, 200)
    out = fit_to_canvas(img, 720, 1280)
    assert out.shape == (1280, 720, 3)
    assert abs(int(out[640, 2, 1]) - 200) < 10 and out[640, 2, 0] < 10 and out[640, 717, 2] < 10


def test_fit_drops_alpha():
    assert fit_to_canvas(np.zeros((72, 128, 4), np.uint8), 128, 72).shape == (72, 128, 3)


def test_paste_layer():
    img = np.zeros((4, 4, 3), np.uint8)
    layer = np.zeros((4, 4, 4), np.uint8)
    layer[0, 0] = (255, 0, 0, 200)
    layer[1, 1] = (0, 255, 0, 50)
    out = paste_layer(img, layer)
    assert out[0, 0].tolist() == [255, 0, 0] and out[1, 1].tolist() == [0, 0, 0]


def _mask(y0, y1, x0, x1, shape=(100, 100)):
    m = np.zeros(shape, np.uint8)
    m[y0:y1, x0:x1] = 255
    return m


def test_cut_picks_largest_inside():
    img = np.full((100, 100, 3), 50, np.uint8)
    seg = FakeSeg([(_mask(70, 95, 70, 95), 0.9), (_mask(20, 40, 25, 35), 0.3)])
    out = cut_object(seg, img, [10, 10, 50, 50], "tree")
    assert out.shape == (20, 10, 4) and (out[..., 3] == 255).all()
    assert seg.calls[0] == ("tree", [], [{"x_min": 10, "y_min": 10, "x_max": 50, "y_max": 50}])


def test_cut_mask_spilling_outside_is_clipped():
    img = np.full((100, 100, 3), 50, np.uint8)
    out = cut_object(FakeSeg([(_mask(0, 100, 0, 100), 0.9)]), img, [10, 10, 30, 40], "x")
    assert out.shape == (30, 20, 4)


def test_cut_empty():
    img = np.full((100, 100, 3), 50, np.uint8)
    with pytest.raises(ValueError, match="框內找不到物件"):
        cut_object(FakeSeg([(_mask(70, 95, 70, 95), 0.9)]), img, [10, 10, 50, 50], "x")
    with pytest.raises(ValueError, match="框內找不到物件"):
        cut_object(FakeSeg([]), img, [10, 10, 50, 50], "x")


def test_cut_clamps_box():
    img = np.full((100, 100, 3), 50, np.uint8)
    seg = FakeSeg([(_mask(0, 20, 0, 20), 0.9)])
    cut_object(seg, img, [-50, -50, 30, 30], "x")
    assert seg.calls[0][2] == [{"x_min": 0, "y_min": 0, "x_max": 30, "y_max": 30}]
    with pytest.raises(ValueError, match="框內找不到物件"):
        cut_object(seg, img, [200, 200, 300, 300], "x")


def test_overlap_suggest():
    a = {"id": "o1", "kind": "box", "label": "樹", "x": 0, "y": 0, "w": 100, "h": 100}
    b = {"id": "o2", "kind": "box", "label": "主角", "x": 100, "y": 0, "w": 100, "h": 100}
    asset = {"id": "o3", "kind": "asset", "x": 400, "y": 0, "w": 100, "h": 100}
    assert overlap_suggest([a, b, asset], "side", [80, 0, 180, 50])["id"] == "o2"
    assert overlap_suggest([a, b, asset], "side", [410, 10, 450, 50]) is None
