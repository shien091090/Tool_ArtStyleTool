import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from artstyle.server import create_app
from tests.test_decompose import FakeFal, _source


HEADERS = {"X-ArtStyle": "1"}


def _png(img):
    return cv2.imencode(".png", img)[1].tobytes()


@pytest.fixture
def client(tmp_path):
    return TestClient(create_app(tmp_path, lambda: FakeFal()), headers=HEADERS)


def _upload(client, name="騎士", data=None):
    return client.post("/api/packs", data={"name": name},
                       files={"file": ("a.png", data or _png(_source()), "image/png")})


def test_upload_decompose_and_fetch(client):
    r = _upload(client)
    assert r.status_code == 200 and r.json()["width"] == 80
    assert client.post("/api/packs/騎士/decompose").status_code == 200
    assert [m["name"] for m in client.get("/api/packs").json()] == ["騎士"]
    r = client.get("/api/packs/騎士/files/normal.png")
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    assert r.headers["cache-control"] == "no-store"
    info = client.get("/api/packs/騎士/region", params={"x": 25, "y": 30}).json()
    assert info["id"] >= 1 and len(info["color"]) == 3
    r = client.put(f"/api/packs/騎士/regions/{info['id']}", json={"color": [1, 2, 3]})
    assert r.status_code == 200 and r.json()["regions"]["colors"][str(info["id"])] == [1, 2, 3]


def test_run_single_step_with_params(client):
    _upload(client)
    client.post("/api/packs/騎士/decompose")
    r = client.post("/api/packs/騎士/steps/regions", json={"gap_radius": 1, "min_area": 5})
    assert r.status_code == 200
    assert r.json()["layers"]["regions"]["params"] == {"gap_radius": 1, "min_area": 5}
    assert r.json()["layers"]["flat"]["stale"]


def test_replace_layer(client):
    _upload(client)
    client.post("/api/packs/騎士/decompose")
    r = client.put("/api/packs/騎士/layers/line",
                   files={"file": ("l.png", _png(np.full((60, 80), 255, np.uint8)), "image/png")})
    assert r.status_code == 200 and r.json()["layers"]["line"]["origin"] == "user"
    r = client.put("/api/packs/騎士/layers/source",
                   files={"file": ("l.png", _png(_source()), "image/png")})
    assert r.status_code == 400


def test_errors(client):
    assert _upload(client, "../x").status_code == 400
    assert _upload(client, "壞圖", data=b"garbage").status_code == 400
    _upload(client)
    assert _upload(client).status_code == 409
    assert client.get("/api/packs/none").status_code == 404
    assert client.get("/api/packs/騎士/files/meta.json").status_code == 404
    assert client.get("/api/packs/騎士/files/flat.png").status_code == 404
    r = client.post("/api/packs/騎士/steps/regions")
    assert r.status_code == 400 and "請先完成" in r.json()["detail"]
    assert client.post("/api/packs/騎士/steps/nope").status_code == 400
    assert client.get("/api/packs/騎士/region", params={"x": 999, "y": 0}).status_code == 400


def test_no_key_returns_503(tmp_path):
    c = TestClient(create_app(tmp_path, lambda: None), headers=HEADERS)
    assert c.get("/api/status").json() == {"fal": False}
    _upload(c)
    r = c.post("/api/packs/騎士/steps/depth")
    assert r.status_code == 503 and "FAL_KEY" in r.json()["detail"]


def test_fal_failure_returns_502(tmp_path):
    c = TestClient(create_app(tmp_path, lambda: FakeFal(fail_on="depth")), headers=HEADERS)
    _upload(c)
    r = c.post("/api/packs/騎士/decompose")
    assert r.status_code == 502 and "模擬失敗" in r.json()["detail"]


def test_recipes_roundtrip(client):
    assert client.get("/api/recipes").json() == []
    assert client.put("/api/recipes/漫畫風", json={"version": 1}).status_code == 200
    assert client.get("/api/recipes").json() == ["漫畫風"]
    assert client.get("/api/recipes/漫畫風").json() == {"version": 1}
    assert client.get("/api/recipes/沒有").status_code == 404
    assert client.put("/api/recipes/..%2Fx", json={}).status_code in (400, 404)
    assert client.put("/api/recipes/x", json=[1, 2]).status_code == 400


def test_mutations_require_app_header(tmp_path):
    c = TestClient(create_app(tmp_path, lambda: FakeFal()))
    r = c.post("/api/packs", data={"name": "x"}, files={"file": ("a.png", _png(_source()), "image/png")})
    assert r.status_code == 403
    assert c.get("/api/packs").status_code == 200
