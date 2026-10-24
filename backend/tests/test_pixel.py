import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from artstyle.fal import FalError
from artstyle.pixel import downscale, prompts, service, suggest
from artstyle.server import create_app

HEADERS = {"X-ArtStyle": "1"}
N = "/api/flows/流程/nodes/n2/pixel"


def _png(rgb):
    return cv2.imencode(".png", cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR))[1].tobytes()


def _sprite(w, h):
    """w×h 小精靈: 白底、橢圓形(四角是背景)、深色外框、紅色身體、中間一個被包住的白點。"""
    s = np.full((h, w, 3), 255, np.uint8)
    yy, xx = np.mgrid[0:h, 0:w]
    d = ((xx + 0.5 - w / 2) / (w / 2)) ** 2 + ((yy + 0.5 - h / 2) / (h / 2)) ** 2
    s[d <= 1] = (20, 20, 30)
    s[d <= 0.6] = (200, 40, 40)
    s[h // 2, w // 2] = (255, 255, 255)
    return s


def _ai_render(sprite, scale, margin=40):
    """模擬 AI 圖: 每格放大成方塊 + 白邊。"""
    big = cv2.resize(sprite, None, fx=scale, fy=scale, interpolation=cv2.INTER_NEAREST)
    return cv2.copyMakeBorder(big, margin, margin, margin, margin, cv2.BORDER_CONSTANT, value=(255, 255, 255))


# ---- 指令 ----

def test_default_colors():
    assert prompts.default_colors("auto") == 24
    assert prompts.default_colors("grid", 1, 2) == 8
    assert prompts.default_colors("grid", 2, 4) == 12
    assert prompts.default_colors("grid", 4, 8) == 16


def test_auto_prompt_and_note():
    src = np.full((100, 60, 3), 0, np.uint8)
    p = prompts.build_prompt(src, "auto", 24, " 劍要保留 ")
    assert "24-color" in p and "Additional instructions: 劍要保留" in p
    assert "pixels wide" not in p


def test_grid_prompt_icon_and_redesign():
    tall = np.full((200, 100, 3), 0, np.uint8)  # 主體 1:2
    p = prompts.build_prompt(tall, "grid", 8, "", 1, 2)
    assert "exactly 8 pixels wide and 16 pixels tall" in p and "Do NOT draw any grid lines" in p
    assert prompts.ICON_LINE in p and prompts.REDESIGN_LINE not in p
    p = prompts.build_prompt(tall, "grid", 8, "", 2, 2)  # 正方形 vs 1:2 → 重新設計
    assert prompts.REDESIGN_LINE in p
    p = prompts.build_prompt(tall, "grid", 16, "", 4, 8)  # 32×64 不加簡化
    assert prompts.ICON_LINE not in p and prompts.REDESIGN_LINE not in p


def test_redesign_threshold_ignores_white_margin():
    img = np.full((300, 300, 3), 255, np.uint8)
    img[50:250, 100:200] = 0  # 主體 100×200
    assert not prompts.needs_redesign(img, 1, 2)
    assert prompts.needs_redesign(img, 1, 1)


def test_prepare_canvas_aspect():
    src = np.full((300, 200, 3), 255, np.uint8)
    src[100:200, 50:150] = 0
    g = prompts.prepare(src, "grid", 1, 2)
    assert g.shape[:2] == (1024, 512)
    a = prompts.prepare(np.zeros((3000, 1000, 3), np.uint8), "auto")
    assert max(a.shape[:2]) == 1024


# ---- 縮小 ----

@pytest.mark.parametrize("method", ["dominant", "contrast", "adaptive"])
def test_grid_methods_exact_size_colors_and_background(method):
    W, H = 16, 32
    ai = _ai_render(_sprite(W, H), 13.5 / 1)  # 非整數倍, 模擬 AI 格數不準
    out = downscale.run(method, ai, 4, 2, 4)
    assert out.shape == (H, W, 4)
    opaque = out[out[..., 3] > 0][:, :3]
    assert len(np.unique(opaque, axis=0)) <= 4
    assert out[0, 0, 3] == 0 and out[-1, -1, 3] == 0  # 邊緣白去背
    assert out[H // 2, W // 2, 3] == 255  # 主體中間保留


def test_auto_respects_color_limit():
    out = downscale.run("auto", _ai_render(_sprite(20, 30), 8), 2)
    assert len(downscale.palette(out)) <= 2


def test_inner_white_kept_by_background_removal():
    rgb = np.full((10, 10, 3), 255, np.uint8)
    rgb[2:8, 2:8] = 0
    rgb[5, 5] = 255
    a = downscale.remove_background(rgb)[..., 3]
    assert a[0, 0] == 0 and a[5, 5] == 255 and a[3, 3] == 255


def test_auto_detects_grid():
    sprite = _sprite(20, 30)
    out = downscale.run("auto", _ai_render(sprite, 8), 8)
    assert abs(out.shape[1] - 20) <= 1 and abs(out.shape[0] - 30) <= 1


def test_all_white_fails():
    with pytest.raises(ValueError):
        downscale.run("dominant", np.full((50, 50, 3), 255, np.uint8), 8, 1, 1)


def test_palette_order():
    rgba = np.zeros((2, 3, 4), np.uint8)
    rgba[..., 3] = 255
    rgba[0, :, :3] = (255, 0, 0)
    rgba[1, 0, :3] = (0, 0, 255)
    rgba[1, 1:, 3] = 0
    assert downscale.palette(rgba) == ["#ff0000", "#0000ff"]


# ---- API ----

class FakeFal:
    def __init__(self, returned=None, fail=False, vision_reply='{"sizes": [{"w": 64, "h": 96, "colors": 24, "reason": "中"}, '
                 '{"w": 32, "h": 48, "colors": 16, "reason": "小"}]}'):
        self.returned = returned
        self.fail = fail
        self.vision_reply = vision_reply
        self.calls = []

    def vision(self, img, prompt):
        self.calls.append(("vision", img.shape, prompt))
        if self.fail:
            raise FalError("模擬失敗")
        return self.vision_reply

    def run_image(self, model, img, **params):
        self.calls.append(("run", model, img.shape, params.get("prompt")))
        if self.fail:
            raise FalError("模擬失敗")
        return _ai_render(_sprite(20, 30), 8)

    def edit(self, model_key, img, prompt, num_images, extra_images=()):
        self.calls.append(("edit", model_key, img.shape, prompt, num_images))
        if self.fail:
            raise FalError("模擬失敗")
        n = num_images if self.returned is None else self.returned
        return [_ai_render(_sprite(8, 16), 50) for _ in range(n)]


@pytest.fixture
def fal():
    return FakeFal()


@pytest.fixture
def client(tmp_path, fal):
    return TestClient(create_app(tmp_path, lambda: fal), headers=HEADERS)


def _create(client):
    """n1 圖片輸入(騎士) → n2 像素化"""
    assert client.post("/api/flows", json={"name": "流程"}).status_code == 200
    graph = {"nodes": [{"id": "n1", "type": "input", "x": 0, "y": 0, "params": {}},
                       {"id": "n2", "type": "pixel", "x": 0, "y": 0, "params": {}}],
             "links": [{"from": "n1", "to": "n2"}]}
    assert client.put("/api/flows/流程/graph", json=graph).status_code == 200
    r = client.post("/api/flows/流程/nodes/n1/output", files={"file": ("騎士.png", _png(_sprite(40, 80)), "image/png")})
    assert r.status_code == 200, r.text


def test_grid_candidates_and_pixelate(client, fal):
    _create(client)
    r = client.post(f"{N}/candidates", json={"mode": "grid", "cols": 1, "rows": 2, "count": 2, "note": "劍"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert [c["id"] for c in body["candidates"]] == ["c1", "c2"] and body["errors"] == []
    kind, model, shape, prompt, n = fal.calls[0]
    assert model == "gpt-image-2" and n == 2 and shape[:2] == (1024, 512) and "Additional instructions: 劍" in prompt
    assert body["candidates"][0]["colors"] == 8
    assert [i["method"] for i in body["candidates"][0]["previews"]["items"]] == ["dominant", "contrast", "adaptive"]
    r = client.post(f"{N}/candidates/c1/pixelate", json={"colors": 6})
    res = r.json()["results"]
    assert [x["method"] for x in res] == ["dominant", "contrast", "adaptive"]
    assert all(x["w"] == 8 and x["h"] == 16 and x["png"].startswith("data:image/png") for x in res)
    assert r.json()["colors"] == 6


def test_model_picked_by_size(client, fal):
    _create(client)
    assert service.pick_model(12, 12) == "gpt-image-2" and service.pick_model(13, 4) == "nano-banana-pro"
    r = client.post(f"{N}/candidates", json={"cols": 12, "rows": 13, "model": "kontext"})
    assert r.status_code == 200 and r.json()["candidates"][0]["model"] == "nano-banana-pro"
    assert fal.calls[-1][1] == "nano-banana-pro"
    client.post(f"{N}/candidates", json={"mode": "grid", "cols": 8, "rows": 12})
    assert fal.calls[-1][1] == "gpt-image-2"
    r = client.post(f"{N}/candidates", json={"mode": "auto", "model": "kontext"})
    assert r.status_code == 400 and "指定格數" in r.json()["detail"]


def test_suggest_sizes(client, fal):
    _create(client)
    r = client.post(f"{N}/suggest")
    assert r.status_code == 200, r.text
    assert r.json()["sizes"] == [{"cols": 4, "rows": 6, "colors": 16, "reason": "小"},
                                 {"cols": 8, "rows": 12, "colors": 24, "reason": "中"}]
    assert fal.calls[-1][0] == "vision" and fal.calls[-1][1][2] == 3


def test_suggest_bad_reply(tmp_path):
    c = TestClient(create_app(tmp_path, lambda: FakeFal(vision_reply="不知道")), headers=HEADERS)
    _create(c)
    r = c.post(f"{N}/suggest")
    assert r.status_code == 400 and "沒有給出尺寸建議" in r.json()["detail"]


def test_suggest_parse_snaps_and_dedupes():
    text = ('```json {"sizes": [{"w": 300, "h": 30, "colors": 99, "reason": "大"}, {"w": 33, "h": 47, "colors": 2}, '
            '{"w": 32, "h": 48}, {"w": "x", "h": 8}, {"w": 16, "h": 16, "colors": true}]} ```')
    assert suggest.parse(text) == [
        {"cols": 2, "rows": 2, "colors": 16, "reason": ""},
        {"cols": 4, "rows": 6, "colors": 4, "reason": ""},
        {"cols": 16, "rows": 4, "colors": 32, "reason": "大"},
    ]
    with pytest.raises(ValueError):
        suggest.parse('{"sizes": []}')


def test_candidate_delete_ids_not_reused(client):
    _create(client)
    client.post(f"{N}/candidates", json={"cols": 1, "rows": 2})
    assert client.delete(f"{N}/candidates/c1").json()["candidates"] == []
    assert client.get("/api/flows/流程/files/nodes/n2/ai/c1.png").status_code == 404
    r = client.post(f"{N}/candidates", json={"cols": 1, "rows": 2})
    assert r.json()["candidates"][0]["id"] == "c2"


@pytest.mark.parametrize("body", [
    {"mode": "x"},
    {"mode": "grid", "cols": 0, "rows": 2},
    {"mode": "grid", "cols": 1, "rows": 17},
    {"mode": "grid", "cols": 1.5, "rows": 2},
    {"mode": "auto", "model": "kontext"},
    {"cols": 1, "rows": 2, "colors": 1},
    {"cols": 1, "rows": 2, "count": 5},
    {"cols": 1, "rows": 2, "note": "x" * 201},
])
def test_settings_validation(client, body):
    _create(client)
    assert client.post(f"{N}/candidates", json=body).status_code == 400


def test_fal_failure_and_short_count(tmp_path):
    bad = TestClient(create_app(tmp_path, lambda: FakeFal(fail=True)), headers=HEADERS)
    _create(bad)
    assert bad.post(f"{N}/candidates", json={"cols": 1, "rows": 2}).status_code == 502
    assert bad.post(f"{N}/suggest").status_code == 502
    assert bad.get(N).json()["candidates"] == []
    short = TestClient(create_app(tmp_path, lambda: FakeFal(returned=1)), headers=HEADERS)
    r = short.post(f"{N}/candidates", json={"mode": "grid", "cols": 1, "rows": 2, "count": 3})
    assert len(r.json()["candidates"]) == 1 and "只回傳 1 張" in r.json()["errors"][0]


def test_no_fal_key(tmp_path):
    c = TestClient(create_app(tmp_path, lambda: None), headers=HEADERS)
    _create(c)
    assert c.post(f"{N}/candidates", json={"cols": 1, "rows": 2}).status_code == 503
    assert c.post(f"{N}/suggest").status_code == 503
