import json

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from artstyle.server import create_app

HEADERS = {"X-ArtStyle": "1"}
F = "/api/flows/流程"


def png(color=(200, 100, 50)):
    img = np.zeros((8, 8, 3), np.uint8)
    img[:] = color
    return cv2.imencode(".png", img)[1].tobytes()


@pytest.fixture
def client(tmp_path):
    return TestClient(create_app(tmp_path, lambda: None), headers=HEADERS)


def _node(nid, type_):
    return {"id": nid, "type": type_, "x": 0, "y": 0, "params": {}}


def _setup(client, nodes, links, assets=(("樹", {"views": ["side"], "type": "景物"}),)):
    for name, tags in assets:
        r = client.post("/api/library", data={"tags": json.dumps(tags)},
                        files=[("files", (f"{name}.png", png(), "image/png"))])
        assert r.status_code == 200, r.text
    assert client.post("/api/flows", json={"name": "流程"}).status_code == 200
    r = client.put(f"{F}/graph", json={"nodes": [_node(*n) for n in nodes], "links": links})
    assert r.status_code == 200, r.text


def _upload(client, nid, input_rev=None):
    data = {"inputRev": str(input_rev)} if input_rev is not None else {}
    r = client.post(f"{F}/nodes/{nid}/output", data=data, files={"file": ("a.png", png((1, 2, 3)), "image/png")})
    assert r.status_code == 200, r.text
    return r.json()


def _pick(client, nid, aid="a1"):
    return client.post(f"{F}/nodes/{nid}/output", data={"asset": aid})


def _save(client, nid, name="存"):
    return client.post(f"{F}/nodes/{nid}/to-library", json={"name": name})


def test_input_from_library(client, tmp_path):
    _setup(client, [("n1", "input")], [])
    r = _pick(client, "n1")
    assert r.status_code == 200, r.text
    n1 = r.json()["nodes"][0]
    assert n1["rev"] == 1 and n1["params"] == {"source": "樹", "asset": "a1"}
    out = (tmp_path / "flows" / "流程" / "out" / "n1.png").read_bytes()
    assert cv2.imdecode(np.frombuffer(out, np.uint8), cv2.IMREAD_UNCHANGED)[0, 0, :3].tolist() == [200, 100, 50]  # 讀回是 BGR, 與寫入的 png() 相同


def test_asset_only_for_input(client):
    _setup(client, [("n1", "input"), ("n2", "cutout")], [{"from": "n1", "to": "n2"}])
    r = _pick(client, "n2")
    assert r.status_code == 400 and "只有圖片輸入節點" in r.json()["detail"]


def test_to_library_derived(client):
    _setup(client, [("n1", "input"), ("n2", "cutout")], [{"from": "n1", "to": "n2"}])
    _pick(client, "n1")
    _upload(client, "n2", input_rev=1)
    r = _save(client, "n2", "去背的樹")
    assert r.status_code == 200, r.text
    a = r.json()
    assert a["id"] == "a2" and a["name"] == "去背的樹" and a["parent"] == "a1"
    assert a["tags"] == {"views": ["side"], "type": "景物"}
    assert a["source"] == {"kind": "flow", "flow": "流程", "node": "n2", "rev": 1}


def test_to_library_upload_source(client):
    _setup(client, [("n1", "input"), ("n2", "cutout")], [{"from": "n1", "to": "n2"}])
    _upload(client, "n1")
    _upload(client, "n2", input_rev=1)
    a = _save(client, "n2").json()
    assert a["parent"] is None and a["tags"] == {"views": [], "type": None}


def test_to_library_stale(client):
    _setup(client, [("n1", "input"), ("n2", "cutout"), ("n3", "pixel")],
           [{"from": "n1", "to": "n2"}, {"from": "n2", "to": "n3"}])
    _pick(client, "n1")
    _upload(client, "n2", input_rev=1)
    _upload(client, "n3", input_rev=1)
    _upload(client, "n1")  # n1 變第 2 版, n2 還是用第 1 版做的
    r = _save(client, "n3")
    assert r.status_code == 400 and "上游改過了" in r.json()["detail"]


def test_to_library_ignores_material_link(client):
    _setup(client, [("n1", "input"), ("n3", "input"), ("n2", "workshop")],
           [{"from": "n1", "to": "n2", "port": "material"}, {"from": "n3", "to": "n2"}])
    _pick(client, "n1")
    _upload(client, "n3")
    _upload(client, "n2", input_rev=1)
    assert _save(client, "n2").json()["parent"] is None


def test_to_library_parent_deleted(client):
    _setup(client, [("n1", "input")], [])
    _pick(client, "n1")
    assert client.delete("/api/library/a1").status_code == 200
    r = _save(client, "n1")
    assert r.status_code == 200, r.text
    assert r.json()["parent"] is None


def test_to_library_no_output(client):
    _setup(client, [("n1", "input")], [])
    r = _save(client, "n1")
    assert r.status_code == 400 and "還沒有輸出" in r.json()["detail"]


def test_to_library_rewired_is_stale(client):
    # n2 的輸出是用 n1 做的; 改接到 n5(版本號碰巧也是 1)後不能存, 不然會記成 n5 素材的派生
    _setup(client, [("n1", "input"), ("n5", "input"), ("n2", "cutout")], [{"from": "n1", "to": "n2"}],
           assets=(("樹", {"views": ["side"]}), ("石", {"views": ["iso"]})))
    _pick(client, "n1", "a1")
    _pick(client, "n5", "a2")
    _upload(client, "n2", input_rev=1)
    r = client.put(f"{F}/graph", json={"nodes": [_node("n1", "input"), _node("n5", "input"), _node("n2", "cutout")],
                                       "links": [{"from": "n5", "to": "n2"}]})
    assert r.status_code == 200, r.text
    r = _save(client, "n2")
    assert r.status_code == 400 and "上游改過了" in r.json()["detail"]


def test_to_library_disconnected_is_stale(client):
    _setup(client, [("n1", "input"), ("n2", "cutout")], [{"from": "n1", "to": "n2"}])
    _pick(client, "n1")
    _upload(client, "n2", input_rev=1)
    client.put(f"{F}/graph", json={"nodes": [_node("n1", "input"), _node("n2", "cutout")], "links": []})
    assert _save(client, "n2").status_code == 400


def test_save_uploaded_input_links_it(client):
    """上傳的圖片輸入存進素材庫後, 節點改指向新素材, 之後下游存的圖就算它的派生"""
    _setup(client, [("n1", "input"), ("n2", "cutout")], [{"from": "n1", "to": "n2"}], assets=())
    _upload(client, "n1")
    _upload(client, "n2", input_rev=1)
    a = _save(client, "n1", "怪物").json()
    assert a["parent"] is None
    n1 = client.get(F).json()["nodes"][0]
    assert n1["params"] == {"source": "怪物", "asset": a["id"]} and n1["rev"] == 1
    b = _save(client, "n2").json()
    assert b["parent"] == a["id"]
