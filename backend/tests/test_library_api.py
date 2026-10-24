import json

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from artstyle.server import create_app

HEADERS = {"X-ArtStyle": "1"}
L = "/api/library"


def png(color=(200, 100, 50)):
    img = np.zeros((8, 8, 3), np.uint8)
    img[:] = color
    return cv2.imencode(".png", img)[1].tobytes()


@pytest.fixture
def client(tmp_path):
    return TestClient(create_app(tmp_path, lambda: None), headers=HEADERS)


def _import(client, files, tags=None):
    data = {"tags": json.dumps(tags)} if tags is not None else {}
    return client.post(L, data=data, files=[("files", (n, b, "image/png")) for n, b in files])


def test_import_list_patch_delete(client):
    r = _import(client, [("tree.png", png()), ("rock.png", png((9, 9, 9)))], {"views": ["side"]})
    assert r.status_code == 200, r.text
    added = r.json()["added"]
    assert [a["name"] for a in added] == ["tree", "rock"]
    assert added[0]["tags"] == {"views": ["side"], "type": None}
    assert added[0]["source"] == {"kind": "import", "file": "tree.png"}
    assert len(client.get(L).json()) == 2
    r = client.patch(f"{L}/a1", json={"name": "大樹"})
    assert r.status_code == 200 and r.json()["name"] == "大樹"
    assert client.delete(f"{L}/a1").status_code == 200
    assert [a["id"] for a in client.get(L).json()] == ["a2"]


def test_import_bad_file(client, tmp_path):
    r = _import(client, [("ok.png", png()), ("bad.png", b"not png")])
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["added"]) == 1 and [e["file"] for e in body["errors"]] == ["bad.png"]
    assert sorted(p.name for p in (tmp_path / "library").iterdir() if p.is_dir()) == ["a1"]


def test_image_route(client):
    _import(client, [("tree.png", png())])
    r = client.get(f"{L}/a1/image")
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    assert client.get(f"{L}/a9/image").status_code == 404


def test_bad_tags_400(client):
    _import(client, [("tree.png", png())])
    assert client.patch(f"{L}/a1", json={"tags": {"views": ["3d"]}}).status_code == 400
    assert _import(client, [("x.png", png())], {"type": "魔法"}).status_code == 400


def test_import_bad_name_does_not_abort_batch(client):
    long = "長" * 70 + ".png"
    r = _import(client, [("ok.png", png()), (long, png()), (" .png", png()), ("z.png", png())])
    assert r.status_code == 200, r.text
    names = [a["name"] for a in r.json()["added"]]
    assert names[0] == "ok" and len(names[1]) == 60 and names[2] == "未命名" and names[3] == "z"
