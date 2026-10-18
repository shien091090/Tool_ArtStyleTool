import json

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from artstyle.flow.api import to_ai_source
from artstyle.server import create_app
from tests.test_pixel import FakeFal, _png, _sprite

HEADERS = {"X-ArtStyle": "1"}
F = "/api/flows"


def _rgba_png(rgba):
    return cv2.imencode(".png", cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA))[1].tobytes()


@pytest.fixture
def fal():
    return FakeFal()


@pytest.fixture
def client(tmp_path, fal):
    return TestClient(create_app(tmp_path, lambda: fal), headers=HEADERS)


def _node(nid, type_, x=0, y=0, params=None):
    return {"id": nid, "type": type_, "x": x, "y": y, "params": params or {}}


def _flow(client, name="流程"):
    r = client.post(F, json={"name": name})
    assert r.status_code == 200, r.text
    return r.json()


def _graph(client, nodes, links, name="流程"):
    return client.put(f"{F}/{name}/graph", json={"nodes": nodes, "links": links})


def _chain(client):
    """n1 圖片輸入 → n2 去除區塊 → n3 像素化"""
    _flow(client)
    r = _graph(client, [_node("n1", "input"), _node("n2", "cutout"), _node("n3", "pixel")],
               [{"from": "n1", "to": "n2"}, {"from": "n2", "to": "n3"}])
    assert r.status_code == 200, r.text


def _upload(client, nid, img, **form):
    data = {k: (json.dumps(v) if k == "params" else str(v)) for k, v in form.items()}
    return client.post(f"{F}/流程/nodes/{nid}/output", data=data, files={"file": ("a.png", img, "image/png")})


# ---- 流程 ----

def test_create_list_delete(client):
    _flow(client)
    assert client.post(F, json={"name": "流程"}).status_code == 409
    assert client.post(F, json={"name": "../x"}).status_code == 400
    assert [f["name"] for f in client.get(F).json()] == ["流程"]
    assert client.delete(f"{F}/流程").status_code == 200
    assert client.get(F).json() == []
    assert client.get(f"{F}/流程").status_code == 404


@pytest.mark.parametrize("nodes,links,msg", [
    ([_node("n1", "magic")], [], "未知的節點種類"),
    ([_node("n1", "input"), _node("n1", "cutout")], [], "重複"),
    ([_node("x1", "input")], [], "編號不合法"),
    ([_node("n1", "input"), _node("n2", "cutout")], [{"from": "n2", "to": "n1"}], "不能接輸入"),
    ([_node("n1", "input"), _node("n2", "input"), _node("n3", "cutout")],
     [{"from": "n1", "to": "n3"}, {"from": "n2", "to": "n3"}], "只能接一條"),
    ([_node("n1", "cutout"), _node("n2", "cutout")], [{"from": "n1", "to": "n2"}, {"from": "n2", "to": "n1"}], "迴圈"),
    ([_node("n1", "input")], [{"from": "n1", "to": "n9"}], "不存在"),
    ([_node("n1", "input"), _node("n2", "cutout")], [{"from": "n1", "to": "n2", "port": "material"}], "素材接點"),
    ([_node("n1", "input"), _node("n2", "workshop")],
     [{"from": "n1", "to": "n2"}, {"from": "n1", "to": "n2", "port": "material"}], "只能有一條"),
    ([_node("n1", "input"), _node("n2", "workshop")], [{"from": "n1", "to": "n2", "port": "x"}], "未知的接點"),
    ([{"id": "n1", "type": "input", "x": "a", "y": 0, "params": {}}], [], "座標"),
])
def test_graph_validation(client, nodes, links, msg):
    _flow(client)
    r = _graph(client, nodes, links)
    assert r.status_code == 400 and msg in r.json()["detail"]


def test_output_rev_and_graph_keeps_rev(client):
    _chain(client)
    m = _upload(client, "n1", _png(_sprite(20, 30))).json()
    n1 = m["nodes"][0]
    assert n1["rev"] == 1 and n1["inputRev"] is None
    m = _upload(client, "n2", _rgba_png(np.zeros((4, 4, 4), np.uint8)), inputRev=1, params={"ops": [1]}).json()
    n2 = m["nodes"][1]
    assert n2["rev"] == 1 and n2["inputRev"] == 1 and n2["params"] == {"ops": [1]}
    # 前端存圖結構(移動節點)帶舊的 rev 也不會蓋掉後端的
    nodes = [dict(_node("n1", "input", 50, 60), rev=99), _node("n2", "cutout"), _node("n3", "pixel")]
    m = _graph(client, nodes, [{"from": "n1", "to": "n2"}, {"from": "n2", "to": "n3"}]).json()
    assert m["nodes"][0]["rev"] == 1 and m["nodes"][0]["x"] == 50
    # 透明保留
    got = cv2.imdecode(np.frombuffer(client.get(f"{F}/流程/files/out/n2.png").content, np.uint8), cv2.IMREAD_UNCHANGED)
    assert got.shape == (4, 4, 4) and got[..., 3].max() == 0


def test_delete_node_removes_files(client, tmp_path):
    _chain(client)
    _upload(client, "n1", _png(_sprite(20, 30)))
    assert (tmp_path / "flows/流程/out/n1.png").is_file()
    _graph(client, [_node("n2", "cutout")], [])
    assert not (tmp_path / "flows/流程/out/n1.png").exists()
    # 同編號換種類也算新節點
    _upload(client, "n2", _png(_sprite(20, 30)), inputRev=0)
    m = _graph(client, [_node("n2", "pixel")], []).json()
    assert m["nodes"][0]["rev"] == 0 and not (tmp_path / "flows/流程/out/n2.png").exists()


def test_pack_source_only_for_input(client):
    _chain(client)
    r = client.post(f"{F}/流程/nodes/n2/output", data={"pack": "x"})
    assert r.status_code == 400


def test_files_whitelist(client):
    _chain(client)
    assert client.get(f"{F}/流程/files/flow.json").status_code == 404
    assert client.get(f"{F}/流程/files/out/n1.png").status_code == 404  # 還沒輸出


# ---- 像素化節點 ----

SETTINGS = {"mode": "grid", "cols": 1, "rows": 2, "colors": 8, "count": 1}


def test_pixel_needs_upstream_output(client):
    _chain(client)
    r = client.post(f"{F}/流程/nodes/n3/pixel/candidates", json=SETTINGS)
    assert r.status_code == 400 and "上游還沒有輸出" in r.json()["detail"]
    assert client.get(f"{F}/流程/nodes/n3/pixel").json()["candidates"] == []
    r = client.post(f"{F}/流程/nodes/n2/pixel/candidates", json=SETTINGS)
    assert r.status_code == 400 and "不是像素化" in r.json()["detail"]


def test_pixel_uses_upstream_and_pixelates(client, fal):
    _chain(client)
    _upload(client, "n1", _png(_sprite(20, 30)))
    rgba = np.zeros((100, 100, 4), np.uint8)
    rgba[20:60, 30:50] = (200, 40, 40, 255)
    _upload(client, "n2", _rgba_png(rgba), inputRev=1)
    r = client.post(f"{F}/流程/nodes/n3/pixel/candidates", json=SETTINGS)
    assert r.status_code == 200, r.text
    cand = r.json()["candidates"][0]
    assert cand["inputRev"] == 1 and cand["cols"] == 1
    src = cv2.imdecode(np.frombuffer(client.get(f"{F}/流程/files/nodes/n3/source.png").content, np.uint8), cv2.IMREAD_COLOR)
    assert src.shape[:2] == (40, 20)  # 裁到不透明範圍
    assert client.get(f"{F}/流程/files/nodes/n3/ai/{cand['id']}.png").status_code == 200
    res = client.post(f"{F}/流程/nodes/n3/pixel/candidates/{cand['id']}/pixelate", json={"colors": 8}).json()
    assert [x["w"] for x in res["results"]] == [8, 8, 8]
    assert client.delete(f"{F}/流程/nodes/n3/pixel/candidates/{cand['id']}").json()["candidates"] == []


def test_to_ai_source_composites_white():
    rgba = np.zeros((10, 10, 4), np.uint8)
    rgba[2:5, 3:7] = (0, 0, 0, 128)
    out = to_ai_source(rgba)
    assert out.shape == (3, 4, 3) and out[0, 0, 0] == 127
    with pytest.raises(ValueError):
        to_ai_source(np.zeros((3, 3, 4), np.uint8))


class _MatteFal:
    """去背: 回傳左半透明、右半不透明的 RGBA(故意給一半尺寸)"""

    def __init__(self):
        self.calls = []

    def run_image(self, model, img, **params):
        self.calls.append((model, img.shape))
        h, w = img.shape[:2]
        out = np.zeros((h // 2, w // 2, 4), np.uint8)
        out[:, w // 4:, 3] = 255
        return out


def test_cutout_matte(tmp_path):
    fal = _MatteFal()
    client = TestClient(create_app(tmp_path, lambda: fal), headers=HEADERS)
    _chain(client)
    r = client.post(f"{F}/流程/nodes/n2/cutout/matte")
    assert r.status_code == 400 and "上游還沒有輸出" in r.json()["detail"]
    rgba = np.zeros((40, 60, 4), np.uint8)
    rgba[..., 3] = 255
    assert _upload(client, "n1", _rgba_png(rgba)).status_code == 200
    r = client.post(f"{F}/流程/nodes/n2/cutout/matte")
    assert r.status_code == 200 and r.json() == {"rev": 1}
    assert fal.calls[0][0] == "fal-ai/birefnet/v2" and fal.calls[0][1] == (40, 60, 3)
    m = cv2.imdecode(np.frombuffer(client.get(f"{F}/流程/files/nodes/n2/matte.png").content, np.uint8), cv2.IMREAD_UNCHANGED)
    assert m.shape == (40, 60) and m[:, :10].max() == 0 and m[:, 40:].min() == 255
    assert client.post(f"{F}/流程/nodes/n3/cutout/matte").status_code == 400  # 像素化節點不行
