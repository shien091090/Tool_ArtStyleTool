import numpy as np
import pytest
from fastapi.testclient import TestClient

from artstyle.server import create_app
from tests.test_decompose import FakeFal, _source
from tests.test_flow import F, HEADERS, _flow, _graph, _node, _rgba_png, _upload

S = f"{F}/流程/nodes/n2/style"


@pytest.fixture
def client(tmp_path):
    return TestClient(create_app(tmp_path, lambda: FakeFal()), headers=HEADERS)


def _setup(client):
    """n1 圖片輸入 → n2 改風格"""
    _flow(client)
    r = _graph(client, [_node("n1", "input"), _node("n2", "style")], [{"from": "n1", "to": "n2"}])
    assert r.status_code == 200, r.text


def _upload_input(client):
    src = _source()
    rgba = np.dstack([src, np.full(src.shape[:2], 255, np.uint8)])
    rgba[:, :5, 3] = 0  # 左邊透明會被裁掉
    assert _upload(client, "n1", _rgba_png(rgba)).status_code == 200
    return src.shape


def test_style_init_and_shared_routes(client, tmp_path):
    _setup(client)
    assert client.get(f"{S}/status").json() == {"exists": False, "inputRev": None}
    r = client.post(f"{S}/init")
    assert r.status_code == 400 and "上游還沒有輸出" in r.json()["detail"]
    h, w = _upload_input(client)[:2]
    meta = client.post(f"{S}/init").json()
    m = max(16, round(max(h, w - 5) * 0.05))  # 裁掉透明後四周補白邊
    assert meta["inputRev"] == 1 and meta["width"] == w - 5 + 2 * m and meta["height"] == h + 2 * m
    assert client.get(f"{S}/status").json() == {"exists": True, "inputRev": 1}
    # 不會出現在分層包清單
    assert client.get("/api/packs").json() == []
    # 共用路由: 拆解、讀檔、區塊改色
    assert client.post(f"{S}/decompose").status_code == 200
    assert client.get(f"{S}/files/normal.png").status_code == 200
    info = client.get(f"{S}/region", params={"x": 25, "y": 30}).json()
    r = client.put(f"{S}/regions/{info['id']}", json={"color": [1, 2, 3]})
    assert r.json()["regions"]["colors"][str(info["id"])] == [1, 2, 3]
    assert client.post(f"{S}/steps/flat").status_code == 200
    # 上游換圖後重建: 圖層清空、版本更新
    _upload_input(client)
    meta = client.post(f"{S}/init").json()
    assert meta["inputRev"] == 2 and list(meta["layers"]) == ["source"]
    # 刪節點連帶刪分層包
    assert _graph(client, [_node("n1", "input")], []).status_code == 200
    assert not (tmp_path / "flows" / "流程" / "nodes" / "n2").exists()


def test_style_wrong_node_type(client):
    _setup(client)
    assert client.get(f"{F}/流程/nodes/n1/style/status").status_code == 400
    assert client.get(f"{F}/流程/nodes/n1/style").status_code == 400
