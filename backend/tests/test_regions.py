import numpy as np
import pytest

from artstyle import regions


def _two_boxes(gap=0):
    m = np.zeros((60, 60), bool)
    m[0, :] = m[-1, :] = m[:, 0] = m[:, -1] = True
    m[:, 29:31] = True
    if gap:
        m[20:20 + gap, 29:31] = False
    return m


def test_two_closed_boxes():
    lab = regions.label_regions(_two_boxes(), gap_radius=0)
    assert lab.min() >= 1 and len(np.unique(lab)) == 2
    assert lab[30, 10] != lab[30, 50]


def test_gap_closed_by_radius():
    m = _two_boxes(gap=4)
    assert len(np.unique(regions.label_regions(m, gap_radius=0))) == 1
    lab = regions.label_regions(m, gap_radius=3)
    assert lab[30, 10] != lab[30, 50]


def test_every_pixel_labeled_including_lines():
    lab = regions.label_regions(_two_boxes(), gap_radius=2)
    assert (lab > 0).all()
    assert lab[30, 29] in (lab[30, 10], lab[30, 50])


def test_thin_enclosed_region_survives_large_radius():
    m = _two_boxes()
    m[45, 2:28] = True
    m[49, 2:28] = True
    m[45:50, 27] = True
    lab = regions.label_regions(m, gap_radius=4, min_area=12)
    assert lab[47, 10] not in (lab[20, 10], lab[30, 50])


def test_tiny_specks_are_absorbed():
    m = _two_boxes()
    m[10, 10] = True
    m[10, 12] = True
    m[12, 10] = True
    m[12, 12] = True
    m[11, 11] = True
    lab = regions.label_regions(m, gap_radius=0, min_area=12)
    assert len(np.unique(lab)) == 2


def test_blank_and_all_line():
    assert (regions.label_regions(np.zeros((8, 8), bool)) == 1).all()
    assert (regions.label_regions(np.ones((8, 8), bool)) == 1).all()


def test_encode_decode_roundtrip():
    lab = np.array([[1, 300], [65535, 2]], np.int32)
    rgba = regions.encode_labels(lab)
    assert rgba.shape == (2, 2, 4) and (rgba[..., 3] == 255).all()
    assert (regions.decode_labels(rgba) == lab).all()


def test_too_many_regions():
    with pytest.raises(ValueError):
        regions.encode_labels(np.array([[70000]], np.int32))
