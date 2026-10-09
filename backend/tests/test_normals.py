import numpy as np

from artstyle import normals


def _sphere(n=64):
    y, x = np.mgrid[0:n, 0:n].astype(np.float32)
    r2 = ((x - n / 2) / (n / 2)) ** 2 + ((y - n / 2) / (n / 2)) ** 2
    return np.sqrt(np.clip(1 - r2, 0, 1))


def test_sphere_normals_point_outward():
    nrm = normals.depth_to_normal(_sphere()).astype(int)
    c = 32
    assert abs(nrm[c, c, 0] - 128) < 8 and abs(nrm[c, c, 1] - 128) < 8 and nrm[c, c, 2] > 240
    assert nrm[c, 52, 0] > 160
    assert nrm[c, 12, 0] < 96
    assert nrm[12, c, 1] > 160
    assert nrm[52, c, 1] < 96


def test_flat_depth_faces_viewer():
    nrm = normals.depth_to_normal(np.full((16, 16), 0.5, np.float32))
    assert (abs(nrm[..., :2].astype(int) - 128) <= 1).all() and (nrm[..., 2] == 255).all()


def test_normalize_depth_flips_and_resizes():
    img = np.zeros((10, 20), np.uint8)
    img[:, 10:] = 255
    d = normals.normalize_depth(img, 40, 20, near_is_bright=False)
    assert d.shape == (20, 40) and d[0, 0] > 0.9 and d[0, 39] < 0.1
    d2 = normals.normalize_depth(np.stack([img] * 3, -1), 20, 10, near_is_bright=True)
    assert d2[0, 0] < 0.1 and d2[0, 19] > 0.9


def test_normalize_depth_constant_image():
    d = normals.normalize_depth(np.full((4, 4), 77, np.uint8), 4, 4, near_is_bright=True)
    assert np.isfinite(d).all()
