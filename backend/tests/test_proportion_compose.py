import numpy as np

from artstyle.proportion import compose


def test_fill_holes_returns_rgb_without_holes():
    rgba = np.zeros((40, 40, 4), np.uint8)
    rgba[..., :3] = (10, 200, 30)
    rgba[..., 3] = 255
    rgba[15:25, 15:25, 3] = 0
    rgba[15:25, 15:25, :3] = 0
    out = compose.fill_holes(rgba)
    assert out.shape == (40, 40, 3)
    assert abs(int(out[20, 20, 1]) - 200) < 30   # 洞被周圍顏色補上
    assert (out[:10] == (10, 200, 30)).all()      # 非洞處不變


def test_feather_pad():
    assert compose.feather_pad(100, 100) == 8
    assert compose.feather_pad(400, 1000) == 30


def test_paste_back_keeps_outside_exact():
    base = np.random.default_rng(0).integers(0, 255, (100, 120, 3), dtype=np.uint8)
    ai = np.full((50, 70, 3), 7, np.uint8)               # 尺寸、長寬比都不同
    region = np.zeros((100, 120), np.uint8)
    region[40:60, 50:70] = 255
    out = compose.paste_back(ai, base, region)
    assert out.shape == base.shape
    pad = compose.feather_pad(120, 100)
    outside = np.ones((100, 120), bool)
    outside[40 - 2 * pad:60 + 2 * pad, 50 - 2 * pad:70 + 2 * pad] = False
    assert (out[outside] == base[outside]).all()          # 範圍外差值 0
    assert (out[50, 60] == 7).all()                        # 範圍中心完全用 AI


def test_build_prompt():
    p = compose.build_prompt(False, "")
    assert "proportion" in p and "another illustration" not in p
    p2 = compose.build_prompt(True, "接縫畫成毛皮")
    assert "another illustration" in p2 and p2.endswith("接縫畫成毛皮")
