import cv2
import numpy as np
import pytest

from artstyle.pack import Pack


def _png(h, w):
    return cv2.imencode(".png", np.zeros((h, w, 3), np.uint8))[1].tobytes()


def test_create_limits_size(tmp_path):
    p = Pack.create(tmp_path, "big", _png(100, 4096))
    assert (p.meta["width"], p.meta["height"]) == (2048, 50)
    assert p.read("source").shape == (50, 2048, 3)


def test_open_reads_meta(tmp_path):
    Pack.create(tmp_path, "騎士", _png(4, 4))
    assert Pack.open(tmp_path, "騎士").meta["layers"]["source"]["origin"] == "user"


def test_duplicate_and_bad_names(tmp_path):
    Pack.create(tmp_path, "a", _png(4, 4))
    with pytest.raises(FileExistsError):
        Pack.create(tmp_path, "a", _png(4, 4))
    with pytest.raises(ValueError):
        Pack.create(tmp_path, "../x", _png(4, 4))
    with pytest.raises(FileNotFoundError):
        Pack.open(tmp_path, "nope")


def test_bad_image_bytes_leaves_nothing(tmp_path):
    with pytest.raises(ValueError):
        Pack.create(tmp_path, "x", b"not an image")
    assert not (tmp_path / "x").exists()


def test_write_layer_marks_downstream_stale(tmp_path):
    p = Pack.create(tmp_path, "a", _png(4, 4))
    for layer in ["line", "line_sdf", "regions", "flat"]:
        p.write_layer(layer, np.zeros((4, 4), np.uint8), "computed")
    p.write_layer("line", np.zeros((4, 4), np.uint8), "user")
    layers = Pack.open(tmp_path, "a").meta["layers"]
    assert not layers["line"]["stale"]
    assert layers["line_sdf"]["stale"] and layers["regions"]["stale"] and layers["flat"]["stale"]  # 平塗照線稿分格
