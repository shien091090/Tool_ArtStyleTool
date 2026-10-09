import numpy as np

from artstyle import lines


def _white_with_black_bar():
    img = np.full((40, 40), 255, np.uint8)
    img[:, 18:22] = 0
    return img


def test_normalize_keeps_white_background():
    out = lines.normalize_line(_white_with_black_bar(), 40, 40)
    assert out[0, 0] == 255 and out[0, 20] == 0


def test_normalize_inverts_black_background_and_rgb():
    inv = 255 - _white_with_black_bar()
    rgb = np.stack([inv] * 3, -1)
    out = lines.normalize_line(rgb, 40, 40)
    assert out[0, 0] == 255 and out[0, 20] == 0


def test_normalize_resizes_to_source():
    out = lines.normalize_line(_white_with_black_bar(), 80, 60)
    assert out.shape == (60, 80)


def test_line_mask_blank_is_empty():
    assert not lines.line_mask(np.full((10, 10), 255, np.uint8)).any()


def test_line_mask_finds_lines():
    m = lines.line_mask(_white_with_black_bar())
    assert m[5, 20] and not m[5, 5]


def test_signed_distance_signs():
    mask = np.zeros((40, 40), bool)
    mask[:, 18:22] = True
    sd = lines.signed_distance(mask)
    assert sd[20, 20] < 0 and sd[20, 0] > 10
    assert abs(sd[20, 23] - 1.5) < 1.0


def test_signed_distance_no_lines_is_far():
    sd = lines.signed_distance(np.zeros((10, 10), bool))
    assert (sd >= 16).all()


def test_encode_sdf_range():
    enc = lines.encode_sdf(np.array([[-100, 0, 100]], np.float32))
    assert enc.tolist() == [[0, 128, 255]]


def test_normalize_keeps_framed_line_art():
    img = np.full((60, 60), 255, np.uint8)
    img[:2, :] = img[-2:, :] = img[:, :2] = img[:, -2:] = 0   # 漫畫格框
    img[:, 29:31] = 0
    out = lines.normalize_line(img, 60, 60)
    assert out[30, 15] == 255 and out[30, 30] == 0
