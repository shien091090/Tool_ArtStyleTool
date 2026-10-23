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


def test_signed_distance_all_inside_no_overflow():
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        sd = lines.signed_distance(np.ones((10, 10), bool))
        enc = lines.encode_sdf(sd)
    assert (sd <= -16).all() and (enc == 0).all()


def test_thin_makes_one_pixel_line():
    m = np.zeros((20, 40), bool)
    m[8:13, 5:35] = True                        # 5px 粗的橫線
    t = lines.thin(m)
    assert t[:, 10:30].sum(axis=0).max() == 1   # 每一欄只剩 1px


def test_clean_line_drops_short_strokes_and_unifies():
    raw = np.full((100, 100), 255, np.uint8)
    raw[20:23, 10:90] = 0                       # 長線
    raw[50, 40:43] = 0                          # 短碎線
    fg = np.ones((100, 100), bool)
    out = lines.clean_line(raw, fg, level=5)
    assert set(np.unique(out).tolist()) <= {0, 255}
    assert (out[18:25, 50] == 0).any()          # 長線留著, 變純黑
    assert (out[48:53, 38:45] == 255).all()     # 短線濾掉
    assert (lines.clean_line(raw, fg, level=0)[48:53, 38:45] == 0).any()  # 0 不濾


def test_clean_line_adds_silhouette():
    raw = np.full((60, 60), 255, np.uint8)
    fg = np.zeros((60, 60), bool)
    fg[10:50, 10:50] = True
    out = lines.clean_line(raw, fg)
    assert (out[8:12, 30] == 0).any() and (out[30, 30] == 255)
