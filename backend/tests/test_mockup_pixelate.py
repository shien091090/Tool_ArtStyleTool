import numpy as np

from artstyle.mockup.pixelate import align_grid


def _blocks_uniform(img, s):
    h, w = img.shape[:2]
    b = img.reshape(h // s, s, w // s, s, 3)
    return bool((b == b[:, :1, :, :1]).all())


def test_align_blocks_uniform():
    rng = np.random.default_rng(0)
    img = rng.integers(0, 256, (720, 1280, 3), dtype=np.uint8)
    out = align_grid(img, 4, 16)
    assert out.shape == img.shape and out.dtype == np.uint8
    assert _blocks_uniform(out, 4)
    assert len(np.unique(out.reshape(-1, 3), axis=0)) <= 16


def test_align_vertical():
    rng = np.random.default_rng(1)
    img = rng.integers(0, 256, (1280, 720, 3), dtype=np.uint8)
    out = align_grid(img, 5, 24)
    assert out.shape == img.shape and _blocks_uniform(out, 5)
    assert len(np.unique(out.reshape(-1, 3), axis=0)) <= 24


def test_align_keeps_flat_regions():
    img = np.zeros((720, 1280, 3), np.uint8)
    img[:, 640:] = (200, 50, 10)
    out = align_grid(img, 8, 32)
    assert (out[:, :640] == 0).all() and (out[:, 640:] == (200, 50, 10)).all()
