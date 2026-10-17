import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from artstyle.server import create_app
from tests.test_flow import F, HEADERS, _flow, _graph, _node, _rgba_png, _upload
from tests.test_proportion_api import FakeFal

W = f"{F}/流程/nodes/n2/workshop"


@pytest.fixture
def fal():
    return FakeFal()


@pytest.fixture
def client(tmp_path, fal):
    return TestClient(create_app(tmp_path, lambda: fal), headers=HEADERS)


def _setup(client):
    """n1 圖片輸入 → n2 改部位"""
    _flow(client)
    r = _graph(client, [_node("n1", "input"), _node("n2", "workshop")], [{"from": "n1", "to": "n2"}])
    assert r.status_code == 200, r.text


def _upload_input(client, rev_shape=(80, 100)):
    rgba = np.zeros((*rev_shape, 4), np.uint8)
    rgba[10:70, 20:80] = (200, 40, 40, 255)
    assert _upload(client, "n1", _rgba_png(rgba)).status_code == 200


def meta_pad(client):
    return client.get(W).json()["pad"]


def test_init_needs_upstream(client):
    _setup(client)
    assert client.get(f"{W}/status").json() == {"exists": False, "inputRev": None}
    r = client.post(f"{W}/init")
    assert r.status_code == 400 and "上游還沒有輸出" in r.json()["detail"]
    assert client.get(W).status_code == 404


def test_init_crops_and_records_rev(client):
    _setup(client)
    _upload_input(client)
    r = client.post(f"{W}/init")
    assert r.status_code == 200, r.text
    meta = r.json()
    assert meta["inputRev"] == 1 and meta["images"][0]["w"] == 60 and meta["images"][0]["h"] == 60
    assert client.get(f"{W}/status").json() == {"exists": True, "inputRev": 1}
    img = cv2.imdecode(np.frombuffer(client.get(f"{W}/files/images/main.png").content, np.uint8), cv2.IMREAD_UNCHANGED)
    assert img.shape[:2] == (60, 60)
    # 不會出現在部位工坊的作品清單
    assert client.get("/api/proportion/works").json() == []


def test_shared_routes_and_reinit(client, fal):
    _setup(client)
    _upload_input(client)
    client.post(f"{W}/init")
    r = client.post(f"{W}/parts", json={"names": ["頭"]})
    assert r.status_code == 200, r.text
    assert [p["name"] for p in r.json()["meta"]["parts"]] == ["頭"]
    assert fal.segment_calls[0][0] == "head"
    part = r.json()["meta"]["parts"][0]
    part["transform"]["scaleX"] = 1.5
    layout = {"parts": [{k: part[k] for k in ("id", "placed", "place", "transform")}], "pad": meta_pad(client)}
    assert client.put(f"{W}/layout", json=layout).status_code == 200
    assert client.get(W).json()["parts"][0]["transform"]["scaleX"] == 1.5
    # 上游換圖後重建: 部位清空、版本更新
    _upload_input(client, (90, 120))
    meta = client.post(f"{W}/init").json()
    assert meta["parts"] == [] and meta["inputRev"] == 2


def test_wrong_node_type(client):
    _setup(client)
    assert client.get(f"{F}/流程/nodes/n1/workshop/status").status_code == 400
    assert client.get(f"{F}/流程/nodes/n1/workshop").status_code == 400


def test_delete_node_removes_work(client, tmp_path):
    _setup(client)
    _upload_input(client)
    client.post(f"{W}/init")
    assert (tmp_path / "flows" / "流程" / "nodes" / "n2" / "meta.json").is_file()
    assert _graph(client, [_node("n1", "input")], []).status_code == 200
    assert not (tmp_path / "flows" / "流程" / "nodes" / "n2").exists()


# ---- 素材線 ----

def _setup_materials(client):
    """n1 主圖 → n3 改部位; n2、n4 圖片輸入接到 n3 的素材接點"""
    _flow(client)
    nodes = [_node("n1", "input"), _node("n2", "input"), _node("n3", "workshop"), _node("n4", "input")]
    links = [{"from": "n1", "to": "n3"}, {"from": "n2", "to": "n3", "port": "material"},
             {"from": "n4", "to": "n3", "port": "material"}]
    r = _graph(client, nodes, links)
    assert r.status_code == 200, r.text
    assert r.json()["links"][1] == {"from": "n2", "to": "n3", "port": "material"}
    assert r.json()["links"][0] == {"from": "n1", "to": "n3"}
    for nid in ("n1", "n2"):
        rgba = np.zeros((80, 100, 4), np.uint8)
        rgba[10:70, 20:80] = (40, 200, 40, 255)
        assert _upload(client, nid, _rgba_png(rgba)).status_code == 200


M = f"{F}/流程/nodes/n3/workshop"


def _sync(client, names=None):
    r = client.post(f"{M}/materials/sync", json={"names": names or {"n2": "圖片輸入", "n4": "圖片輸入 2"}})
    assert r.status_code == 200, r.text
    return r.json()


def test_material_sync_adds_and_removes(client, fal):
    _setup_materials(client)
    assert client.post(f"{M}/init").json()["inputRev"] == 1  # 主圖只看主圖線
    meta = _sync(client)
    mats = [im for im in meta["images"] if im["id"] != "main"]
    assert [(im["name"], im["source"], im["inputRev"]) for im in mats] == [("素材：圖片輸入", "n2", 1)]  # n4 還沒輸出
    assert mats[0]["w"] == 60
    assert len(_sync(client)["images"]) == 2  # 再同步不會重複加
    sid = mats[0]["id"]
    client.post(f"{M}/parts", json={"image": "main", "names": ["頭"]})
    client.post(f"{M}/parts", json={"image": sid, "names": ["頭"]})
    # 拔掉素材線 → 素材圖與它的部位一起刪, 主圖部位留著
    _graph(client, [_node("n1", "input"), _node("n2", "input"), _node("n3", "workshop"), _node("n4", "input")],
           [{"from": "n1", "to": "n3"}])
    meta = _sync(client)
    assert [im["id"] for im in meta["images"]] == ["main"]
    assert [p["image"] for p in meta["parts"]] == ["main"]


def test_material_updated_upstream(client, fal):
    _setup_materials(client)
    client.post(f"{M}/init")
    sid = next(im["id"] for im in _sync(client)["images"] if im.get("source") == "n2")
    # 還沒切部位: 來源換圖時同步直接換新圖
    rgba = np.zeros((90, 120, 4), np.uint8)
    rgba[0:90, 0:50] = (40, 40, 200, 255)
    _upload(client, "n2", _rgba_png(rgba))
    im = next(im for im in _sync(client)["images"] if im.get("source") == "n2")
    assert im["inputRev"] == 2 and im["w"] == 50 and im["id"] != sid
    # 切了部位: 同步不動, 要按「改用新的素材圖」
    client.post(f"{M}/parts", json={"image": im["id"], "names": ["頭"]})
    client.post(f"{M}/parts", json={"image": "main", "names": ["頭"]})
    _upload(client, "n2", _rgba_png(rgba))
    meta = _sync(client)
    assert next(i for i in meta["images"] if i.get("source") == "n2")["inputRev"] == 2
    meta = client.post(f"{M}/materials/n2/refresh").json()
    new = next(i for i in meta["images"] if i.get("source") == "n2")
    assert new["inputRev"] == 3 and new["name"] == "素材：圖片輸入"
    assert [p["image"] for p in meta["parts"]] == ["main"]
    assert client.post(f"{M}/materials/n1/refresh").status_code == 404  # n1 是主圖不是素材
