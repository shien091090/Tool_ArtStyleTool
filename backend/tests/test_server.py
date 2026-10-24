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


S = "/api/flows/流程/nodes/n2/style"


def _upload(client, data=None):
    """n1 圖片輸入 → n2 改風格, 以上游建立分層包"""
    client.post("/api/flows", json={"name": "流程"})
    client.put("/api/flows/流程/graph", json={"nodes": [{"id": "n1", "type": "input", "x": 0, "y": 0, "params": {}},
                                                       {"id": "n2", "type": "style", "x": 0, "y": 0, "params": {}}],
                                             "links": [{"from": "n1", "to": "n2"}]})
    client.post("/api/flows/流程/nodes/n1/output", files={"file": ("a.png", data or _png(_source()), "image/png")})
    return client.post(f"{S}/init")


def test_upload_decompose_and_fetch(client):
    r = _upload(client)
    assert r.status_code == 200 and r.json()["width"] == 80 + 32  # 四周補白邊
    assert client.post(f"{S}/decompose").status_code == 200
    r = client.get(f"{S}/files/normal.png")
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    assert r.headers["cache-control"] == "no-store"
    info = client.get(f"{S}/region", params={"x": 41, "y": 46}).json()
    assert info["id"] >= 1 and len(info["color"]) == 3
    r = client.put(f"{S}/regions/{info['id']}", json={"color": [1, 2, 3]})
    assert r.status_code == 200 and r.json()["regions"]["colors"][str(info["id"])] == [1, 2, 3]


def test_run_single_step_with_params(client):
    _upload(client)
    client.post(f"{S}/decompose")
    r = client.post(f"{S}/steps/regions", json={})
    assert r.status_code == 200, r.text
    assert r.json()["layers"]["regions"]["origin"] == "ai:gpt-image-2"
    assert r.json()["layers"]["flat"]["stale"]


def test_run_line_clean_step(client):
    _upload(client)
    client.post(f"{S}/decompose")
    r = client.post(f"{S}/steps/line_clean", json={"level": 3})
    assert r.status_code == 200, r.text
    assert r.json()["layers"]["line"]["level"] == 3


def test_replace_layer(client):
    _upload(client)
    client.post(f"{S}/decompose")
    r = client.put(f"{S}/layers/line", files={"file": ("l.png", _png(np.full((60, 80), 255, np.uint8)), "image/png")})
    assert r.status_code == 200 and r.json()["layers"]["line"]["origin"] == "user"
    r = client.put(f"{S}/layers/source", files={"file": ("l.png", _png(_source()), "image/png")})
    assert r.status_code == 400


def test_errors(client):
    _upload(client)
    assert client.get(f"{S}/files/meta.json").status_code == 404
    assert client.get(f"{S}/files/flat.png").status_code == 404
    r = client.post(f"{S}/steps/flat")
    assert r.status_code == 400 and "請先完成" in r.json()["detail"]
    assert client.post(f"{S}/steps/nope").status_code == 400
    assert client.get(f"{S}/region", params={"x": 999, "y": 0}).status_code == 400


def test_old_routes_removed(client):
    assert client.get("/api/packs").status_code == 404
    assert client.get("/api/proportion/works").status_code == 404
    assert client.get("/api/pixel/works").status_code == 404


def test_no_key_returns_503(tmp_path):
    c = TestClient(create_app(tmp_path, lambda: None), headers=HEADERS)
    assert c.get("/api/status").json() == {"fal": False}
    assert c.get("/api/fal/balance").status_code == 503
    _upload(c)
    r = c.post(f"{S}/steps/depth")
    assert r.status_code == 503 and "FAL_KEY" in r.json()["detail"]


def test_fal_failure_returns_502(tmp_path):
    c = TestClient(create_app(tmp_path, lambda: FakeFal(fail_on="depth")), headers=HEADERS)
    _upload(c)
    r = c.post(f"{S}/decompose")
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
    assert c.put("/api/recipes/x", json={"version": 1}).status_code == 403
    assert c.get("/api/recipes").status_code == 200


def test_lospec_endpoint_rejects_other_hosts(client):
    r = client.get("/api/lospec", params={"url": "https://evil.com/palette-list/x"})
    assert r.status_code == 400


@pytest.mark.parametrize("name", ["..", "a.b"])
def test_delete_recipe_rejects_bad_names(client, name):
    assert client.delete(f"/api/recipes/{name}").status_code in (400, 404)


def test_delete_recipe(client):
    client.put("/api/recipes/漫畫風", json={"version": 1})
    client.put("/api/recipes/水彩", json={"version": 1})
    assert client.delete("/api/recipes/漫畫風").status_code == 200
    assert client.get("/api/recipes").json() == ["水彩"]
    assert client.delete("/api/recipes/漫畫風").status_code == 404
