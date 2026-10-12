import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from artstyle.fal import KONTEXT_MODEL, FalError
from artstyle.pixel import downscale, prompts
from artstyle.server import create_app

HEADERS = {"X-ArtStyle": "1"}
P = "/api/pixel"


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
    assert len(np.unique(opaque, axis=0)) <= 5
    assert out[0, 0, 3] == 0 and out[-1, -1, 3] == 0  # 邊緣白去背
    assert out[H // 2, W // 2, 3] == 255  # 主體中間保留


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
    def __init__(self, returned=None, fail=False):
        self.returned = returned
        self.fail = fail
        self.calls = []

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


def _create(client, name="像素"):
    r = client.post(f"{P}/works", data={"name": name}, files={"file": ("騎士.png", _png(_sprite(40, 80)), "image/png")})
    assert r.status_code == 200, r.text
    return r.json()


def test_create_list_delete(client):
    meta = _create(client)
    assert meta["source"] == "騎士" and meta["candidates"] == []
    assert client.get(f"{P}/works").json()[0]["name"] == "像素"
    assert client.get(f"{P}/works/像素/files/source.png").status_code == 200
    assert client.post(f"{P}/works", data={"name": "像素"}, files={"file": ("a.png", _png(_sprite(4, 4)), "image/png")}).status_code == 409
    assert client.delete(f"{P}/works/像素").status_code == 200
    assert client.get(f"{P}/works/像素").status_code == 404


def test_bad_names_and_files(client):
    _create(client)
    assert client.get(f"{P}/works/..").status_code in (400, 404)
    assert client.delete(f"{P}/works/..%2F..").status_code in (400, 404)
    assert client.get(f"{P}/works/像素/files/meta.json").status_code == 404
    assert client.get(f"{P}/works/像素/files/../meta.json").status_code == 404
    assert client.post(f"{P}/works", data={"name": "沒來源"}).status_code == 400


def test_create_from_workshop_result(client, tmp_path):
    from artstyle.proportion.work import Work
    w = Work.create(tmp_path / "proportion", "工坊", _png(_sprite(40, 80)))
    w.add_result(_sprite(40, 80), {"model": "nano-banana"})
    assert client.get(f"{P}/workshop-results").json() == [{"work": "工坊", "id": "r1"}]
    r = client.post(f"{P}/works", data={"name": "從工坊", "workshop": "工坊/r1"})
    assert r.status_code == 200 and r.json()["source"] == "部位工坊 工坊 r1"
    assert client.post(f"{P}/works", data={"name": "壞", "workshop": "工坊/../x"}).status_code in (400, 404)


def test_grid_candidates_and_pixelate(client, fal):
    _create(client)
    r = client.post(f"{P}/works/像素/candidates", json={"mode": "grid", "cols": 1, "rows": 2, "count": 2, "note": "劍"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert [c["id"] for c in body["candidates"]] == ["c1", "c2"] and body["errors"] == []
    kind, model, shape, prompt, n = fal.calls[0]
    assert model == "nano-banana-pro" and n == 2 and shape[:2] == (1024, 512) and "Additional instructions: 劍" in prompt
    assert body["candidates"][0]["colors"] == 8
    r = client.post(f"{P}/works/像素/candidates/c1/pixelate", json={"colors": 6})
    res = r.json()["results"]
    assert [x["method"] for x in res] == ["dominant", "contrast", "adaptive"]
    assert all(x["w"] == 8 and x["h"] == 16 and x["png"].startswith("data:image/png") for x in res)
    assert r.json()["colors"] == 6


def test_auto_kontext_parallel(client, fal):
    _create(client)
    r = client.post(f"{P}/works/像素/candidates", json={"mode": "auto", "model": "kontext", "count": 2})
    assert r.status_code == 200 and len(r.json()["candidates"]) == 2
    assert all(c[0] == "run" and c[1] == KONTEXT_MODEL for c in fal.calls)
    res = client.post(f"{P}/works/像素/candidates/c1/pixelate").json()["results"]
    assert len(res) == 1 and res[0]["method"] == "auto" and "error" not in res[0]
    assert abs(res[0]["w"] - 20) <= 1


def test_candidate_delete_ids_not_reused(client):
    _create(client)
    client.post(f"{P}/works/像素/candidates", json={"mode": "auto", "model": "nano-banana-pro"})
    assert client.delete(f"{P}/works/像素/candidates/c1").json()["candidates"] == []
    assert client.get(f"{P}/works/像素/files/ai/c1.png").status_code == 404
    r = client.post(f"{P}/works/像素/candidates", json={"mode": "auto", "model": "nano-banana-pro"})
    assert r.json()["candidates"][0]["id"] == "c2"


@pytest.mark.parametrize("body", [
    {"mode": "x"},
    {"mode": "grid", "cols": 0, "rows": 2},
    {"mode": "grid", "cols": 1, "rows": 17},
    {"mode": "grid", "cols": 1.5, "rows": 2},
    {"mode": "auto", "model": "qwen"},
    {"mode": "auto", "model": "kontext", "colors": 1},
    {"mode": "auto", "model": "kontext", "count": 5},
    {"mode": "auto", "model": "kontext", "note": "x" * 201},
])
def test_settings_validation(client, body):
    _create(client)
    assert client.post(f"{P}/works/像素/candidates", json=body).status_code == 400


def test_fal_failure_and_short_count(tmp_path):
    bad = TestClient(create_app(tmp_path, lambda: FakeFal(fail=True)), headers=HEADERS)
    _create(bad)
    assert bad.post(f"{P}/works/像素/candidates", json={"mode": "auto", "model": "kontext"}).status_code == 502
    assert bad.get(f"{P}/works/像素").json()["candidates"] == []
    short = TestClient(create_app(tmp_path, lambda: FakeFal(returned=1)), headers=HEADERS)
    r = short.post(f"{P}/works/像素/candidates", json={"mode": "grid", "cols": 1, "rows": 2, "count": 3})
    assert len(r.json()["candidates"]) == 1 and "只回傳 1 張" in r.json()["errors"][0]


def test_no_fal_key(tmp_path):
    c = TestClient(create_app(tmp_path, lambda: None), headers=HEADERS)
    _create(c)
    assert c.post(f"{P}/works/像素/candidates", json={"mode": "auto", "model": "kontext"}).status_code == 503
