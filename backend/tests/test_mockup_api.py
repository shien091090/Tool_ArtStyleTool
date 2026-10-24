import json

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from artstyle.imaging import decode_any
from artstyle.server import create_app

HEADERS = {"X-ArtStyle": "1"}
M = "/api/mockups"


def png(arr):
    return cv2.imencode(".png", arr)[1].tobytes()


class FakeFal:
    def __init__(self):
        self.edit_calls = []
        self.segment_calls = []

    def edit(self, model_key, img, prompt, num_images, extra_images=()):
        self.edit_calls.append({"model": model_key, "shape": img.shape, "prompt": prompt, "n": num_images,
                                "extra": len(extra_images)})
        # 故意回不同尺寸, 後端要縮回畫布
        return [np.full((360, 640, 3), 80, np.uint8) for _ in range(num_images)]

    def segment(self, img, prompt, points, boxes):
        self.segment_calls.append((prompt, boxes))
        b = boxes[0]
        m = np.zeros(img.shape[:2], np.uint8)
        m[b["y_min"] + 2:b["y_max"] - 2, b["x_min"] + 2:b["x_max"] - 2] = 255
        return [(m, 0.9)]


@pytest.fixture
def fal():
    return FakeFal()


@pytest.fixture
def client(tmp_path, fal):
    return TestClient(create_app(tmp_path, lambda: fal), headers=HEADERS)


def _import(client, name, tags=None):
    img = np.zeros((20, 10, 3), np.uint8)
    img[:] = (0, 0, 255)
    data = {"tags": json.dumps(tags)} if tags else {}
    r = client.post("/api/library", data=data, files=[("files", (f"{name}.png", png(img), "image/png"))])
    return r.json()["added"][0]


def _new(client, name="場景", view="side", empty=False):
    r = client.post(M, json={"name": name, "view": view, "empty": empty})
    assert r.status_code == 200, r.text
    return r.json()


def _body(scene):
    return {k: scene[k] for k in ("background", "ground", "objects", "style")}


def test_crud(client):
    s = _new(client)
    assert s["view"] == "side" and s["objects"]
    assert client.get(M).json()[0]["name"] == "場景"
    body = _body(s)
    body["background"]["label"] = "夜空 night sky"
    r = client.put(f"{M}/場景", json=body)
    assert r.status_code == 200 and r.json()["background"]["label"] == "夜空 night sky"
    body["objects"][0]["w"] = -1
    assert client.put(f"{M}/場景", json=body).status_code == 400
    assert client.post(M, json={"name": "場景", "view": "side"}).status_code == 409
    assert client.delete(f"{M}/場景").status_code == 200
    assert client.get(f"{M}/場景").status_code == 404


def test_add_asset_tags_root(client):
    _import(client, "根")
    _new(client, "iso", "iso", empty=True)
    r = client.post(f"{M}/iso/assets", json={"asset": "a1"})
    assert r.status_code == 200, r.text
    assert r.json()["asset"]["tags"]["views"] == ["iso"]
    assert client.get(f"{M}/iso/files/assets/a1.png").status_code == 200
    # 根已經有視角就不改
    _new(client, "side", "side", empty=True)
    client.post(f"{M}/side/assets", json={"asset": "a1"})
    assert client.get("/api/library").json()[0]["tags"]["views"] == ["iso"]


def test_add_derived_asset_tags_root(client, tmp_path):
    from artstyle.library.store import Library
    _import(client, "根")
    lib = Library(tmp_path / "library")
    lib.add(np.zeros((5, 5, 3), np.uint8), "子", {"kind": "import", "file": "x.png"}, parent="a1")
    _new(client, "iso", "iso", empty=True)
    r = client.post(f"{M}/iso/assets", json={"asset": "a2"})
    assert r.status_code == 200, r.text
    assert [a["tags"]["views"] for a in client.get("/api/library").json()] == [["iso"], ["iso"]]


def _layers(w, h, asset_box=None):
    grey = np.full((h, w, 3), 150, np.uint8)
    layer = np.zeros((h, w, 4), np.uint8)
    if asset_box:
        x0, y0, x1, y1 = asset_box
        layer[y0:y1, x0:x1] = (0, 0, 255, 255)  # BGR 紅
    return png(grey), png(layer)


def _render(client, name, count=1, size=(1280, 720), asset_box=None):
    g, l = _layers(*size, asset_box)
    return client.post(f"{M}/{name}/render", data={"count": str(count)},
                       files={"greybox": ("g.png", g, "image/png"), "layer": ("l.png", l, "image/png")})


def test_render(client, fal):
    _import(client, "參考")
    s = _new(client)
    client.post(f"{M}/場景/assets", json={"asset": "a1"})
    body = _body(s)
    body["style"]["refs"] = ["a1"]
    client.put(f"{M}/場景", json=body)
    r = _render(client, "場景", count=2, asset_box=(10, 10, 50, 50))
    assert r.status_code == 200, r.text
    cands = r.json()["candidates"]
    assert [c["id"] for c in cands] == ["c1", "c2"]
    assert fal.edit_calls[0]["model"] == "gpt-image-2" and fal.edit_calls[0]["n"] == 2
    assert fal.edit_calls[0]["extra"] == 1 and fal.edit_calls[0]["shape"][:2] == (720, 1280)
    assert "Do not draw any label text" in cands[0]["prompt"]
    img = decode_any(client.get(f"{M}/場景/files/candidates/c1.png").content)
    assert img.shape[:2] == (720, 1280)
    a, b = img[30, 30, :3].tolist(), img[300, 300, :3].tolist()
    assert a != b and b == [80, 80, 80]


def test_render_size_mismatch(client):
    _new(client)
    assert _render(client, "場景", size=(640, 360)).status_code == 400


def test_render_count_range(client):
    _new(client)
    assert _render(client, "場景", count=0).status_code == 400
    assert _render(client, "場景", count=5).status_code == 400


def test_cut_and_save(client, fal):
    s = _new(client)
    _render(client, "場景")
    player = next(o for o in s["objects"] if o["label"] == "主角 player")
    box = [player["x"], player["y"], player["x"] + player["w"], player["y"] + player["h"]]
    r = client.post(f"{M}/場景/candidates/c1/cut", json={"box": box})
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "主角 player" and r.json()["type"] == "角色"
    assert fal.segment_calls[0][0] == "player"
    assert client.get(f"{M}/場景/files/cut.png").status_code == 200
    r = client.post(f"{M}/場景/candidates/c1/cut/save", json={"name": "主角", "tags": {"views": ["side"], "type": "角色"}})
    assert r.status_code == 200, r.text
    a = r.json()
    assert a["source"] == {"kind": "mockup", "scene": "場景", "candidate": "c1"} and a["parent"] is None
    assert a["tags"] == {"views": ["side"], "type": "角色"}


def test_cut_default_name(client):
    _new(client, empty=True)
    _render(client, "場景")
    r = client.post(f"{M}/場景/candidates/c1/cut", json={"box": [10, 10, 60, 60]})
    assert r.json()["name"] == "場景 截圖" and r.json()["type"] is None


def test_save_without_cut(client):
    _new(client)
    _render(client, "場景")
    _render(client, "場景")
    r = client.post(f"{M}/場景/candidates/c1/cut/save", json={"name": "x", "tags": None})
    assert r.status_code == 400 and "先做去背預覽" in r.json()["detail"]
    client.post(f"{M}/場景/candidates/c1/cut", json={"box": [10, 10, 60, 60]})
    r = client.post(f"{M}/場景/candidates/c2/cut/save", json={"name": "x", "tags": None})
    assert r.status_code == 400


def test_delete_candidate(client):
    _new(client)
    _render(client, "場景")
    r = client.delete(f"{M}/場景/candidates/c1")
    assert r.status_code == 200 and r.json()["candidates"] == []


def test_no_client(tmp_path):
    c = TestClient(create_app(tmp_path, lambda: None), headers=HEADERS)
    _new(c)
    assert _render(c, "場景").status_code == 503


def test_render_snapshot_is_layout_at_start(client, fal, tmp_path):
    """AI 畫圖期間場景又被存檔修改, 候選記的仍是送出時的配置"""
    from artstyle.mockup.store import Scene
    s = _new(client)
    orig_edit = fal.edit

    def edit_and_change(*a, **k):
        sc = Scene.open(tmp_path / "mockups", "場景")
        body = {key: sc.meta[key] for key in ("background", "ground", "objects", "style")}
        body["objects"] = body["objects"][:1]
        body["style"]["text"] = "改過"
        sc.save(body)
        return orig_edit(*a, **k)

    fal.edit = edit_and_change
    c = _render(client, "場景").json()["candidates"][0]
    assert len(c["objects"]) == len(s["objects"]) and c["style"]["text"] == ""
