import numpy as np

from artstyle.proportion import compose


def test_fill_holes_uses_flat_background():
    rgba = np.zeros((40, 40, 4), np.uint8)
    rgba[..., :3] = (10, 200, 30)
    rgba[..., 3] = 255
    rgba[15:25, 15:25, 3] = 0
    rgba[15:25, 15:25, :3] = 0
    out = compose.fill_holes(rgba, (250, 240, 230))
    assert out.shape == (40, 40, 3)
    # 洞一律補背景色, 不從周圍抹色(大洞抹出來會變成原圖的殘影)
    assert (out[15:25, 15:25] == (250, 240, 230)).all()
    assert (out[:10] == (10, 200, 30)).all()


def test_background_color_from_border():
    img = np.full((30, 30, 3), (200, 210, 220), np.uint8)
    img[10:20, 10:20] = 0
    img[0, :5] = 0  # 少數雜點不影響
    assert compose.background_color(img) == (200, 210, 220)


def test_background_color_transparent_border_is_white():
    img = np.zeros((30, 30, 4), np.uint8)
    img[10:20, 10:20] = (5, 5, 5, 255)
    assert compose.background_color(img) == (255, 255, 255)


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


def test_paste_back_behind_does_not_touch_protected():
    base = np.full((40, 40, 3), 100, np.uint8)
    ai = np.full((40, 40, 3), 9, np.uint8)
    region = np.zeros((40, 40), np.uint8)
    behind = np.zeros((40, 40), np.uint8)
    behind[:, :20] = 255
    protect = np.zeros((40, 40), np.uint8)
    protect[:, 20:] = 255
    out = compose.paste_back(ai, base, region, behind, protect)
    assert (out[:, :20] == 9).all()            # 後面部位的範圍用 AI
    assert (out[:, 20:] == 100).all()          # 主圖保護的地方漸層也不蓋上去
    out = compose.paste_back(ai, base, behind)  # 同樣範圍當一般改動: 漸層會蓋到右邊
    assert (out[:, 21] != 100).all()


def test_prompt_keeps_added_parts():
    p = compose.build_prompt(True, "", ["wings"], ["wings"])
    assert "added parts: wings" in p and "MUST remain" in p and "behind the body" in p
    assert "added parts" not in compose.build_prompt(True, "")


def test_letterbox_roundtrip():
    img = np.zeros((100, 300, 3), np.uint8)  # 3:1 → 補成 3:2
    out, box = compose.letterbox(img)
    assert out.shape[:2] == (200, 300) and box == (0, 50, 300, 100)
    assert (out[0, 0] == 255).all() and (out[60, 10] == 0).all()
    ai = np.full((1024, 1536, 3), 7, np.uint8)
    back = compose.unbox(ai, out.shape[:2], box)
    assert back.shape == (100, 300, 3) and (back == 7).all()
