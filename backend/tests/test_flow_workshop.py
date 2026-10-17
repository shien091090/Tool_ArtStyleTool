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
