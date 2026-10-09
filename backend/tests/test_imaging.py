import cv2
import numpy as np

from artstyle import imaging


def _encode(img, ext=".png"):
    ok, buf = cv2.imencode(ext, img)
    assert ok
    return buf.tobytes()


def test_load_rgb_flattens_alpha_onto_white():
    bgra = np.zeros((4, 4, 4), np.uint8)
    bgra[..., 2] = 255  # 紅色但全透明
    out = imaging.load_rgb(_encode(bgra))
    assert out.shape == (4, 4, 3) and (out == 255).all()


def test_load_rgb_converts_gray_and_keeps_channel_order():
    gray = np.full((3, 5), 100, np.uint8)
    assert (imaging.load_rgb(_encode(gray)) == 100).all()
    bgr = np.zeros((8, 8, 3), np.uint8)
    bgr[..., 2] = 255  # BGR 的紅
    out = imaging.load_rgb(_encode(bgr, ".jpg"))
    assert out[0, 0, 0] > 200 and out[0, 0, 2] < 60  # RGB 的紅


def test_load_rgb_handles_16bit():
    g16 = np.full((2, 2), 65535, np.uint16)
    assert (imaging.load_rgb(_encode(g16)) == 255).all()


def test_load_rgb_rejects_garbage():
    import pytest

    with pytest.raises(ValueError):
        imaging.load_rgb(b"not an image")


def test_limit_size_keeps_aspect():
    img = np.zeros((1000, 4000, 3), np.uint8)
    assert imaging.limit_size(img, 2048).shape == (512, 2048, 3)
    assert imaging.limit_size(np.zeros((10, 20, 3), np.uint8), 2048).shape == (10, 20, 3)


def test_png_roundtrip_rgb_and_gray(tmp_path):
    img = np.random.default_rng(0).integers(0, 255, (5, 6, 3), dtype=np.uint8)
    imaging.write_png(tmp_path / "a.png", img)
    assert (imaging.read_png(tmp_path / "a.png") == img).all()
    gray = img[..., 0].copy()
    imaging.write_png(tmp_path / "g.png", gray)
    assert (imaging.read_png(tmp_path / "g.png") == gray).all()


def test_resize_to():
    img = np.zeros((10, 20), np.uint8)
    assert imaging.resize_to(img, 40, 30).shape == (30, 40)
    assert imaging.resize_to(np.zeros((10, 20, 3), np.uint8), 5, 5, nearest=True).shape == (5, 5, 3)


def test_data_uri_is_png():
    uri = imaging.to_data_uri(np.zeros((2, 2, 3), np.uint8))
    assert uri.startswith("data:image/png;base64,")
