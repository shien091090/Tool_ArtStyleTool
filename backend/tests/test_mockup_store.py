import copy
import json

import numpy as np
import pytest

from artstyle.mockup.store import Scene


def _img(color=(10, 20, 30)):
    img = np.zeros((8, 8, 3), np.uint8)
    img[:] = color
    return img


def _body(s: Scene) -> dict:
    return {k: copy.deepcopy(s.meta[k]) for k in ("background", "ground", "objects", "style")}


def test_create_open_list_delete(tmp_path):
    s = Scene.create(tmp_path, "關卡一", "side", empty=False)
    assert s.meta["view"] == "side" and s.meta["objects"] and s.meta["candidates"] == []
    assert Scene.open(tmp_path, "關卡一").meta["name"] == "關卡一"
    with pytest.raises(FileExistsError):
        Scene.create(tmp_path, "關卡一", "iso", empty=True)
    with pytest.raises(ValueError):
        Scene.create(tmp_path, "a/b", "side", empty=True)
    with pytest.raises(ValueError):
        Scene.create(tmp_path, "x", "3d", empty=True)
    assert [m["name"] for m in Scene.list(tmp_path)] == ["關卡一"]
    s.delete()
    assert Scene.list(tmp_path) == []
    with pytest.raises(FileNotFoundError):
        Scene.open(tmp_path, "關卡一")


def _bad(s, mutate):
    body = _body(s)
    mutate(body)
    before = (s.dir / "scene.json").read_text(encoding="utf-8")
    with pytest.raises(ValueError):
        s.save(body)
    assert (s.dir / "scene.json").read_text(encoding="utf-8") == before


def test_save_validates(tmp_path):
    side = Scene.create(tmp_path, "s", "side", empty=False)
    iso = Scene.create(tmp_path, "i", "iso", empty=False)
    flat = Scene.create(tmp_path, "f", "flat", empty=True)
    box = side.meta["objects"][0]
    _bad(iso, lambda b: b["objects"].append(dict(box, id="o99")))
    _bad(side, lambda b: b["objects"].append(dict(iso.meta["objects"][0], id="o99")))
    _bad(side, lambda b: b["objects"][0].update(x="10"))
    _bad(side, lambda b: b["objects"][0].update(w=0))
    _bad(side, lambda b: b["objects"][0].update(color="red"))
    _bad(side, lambda b: b["objects"][0].update(label="長" * 61))
    _bad(side, lambda b: b["objects"].append(dict(box)))  # 編號重複
    _bad(iso, lambda b: b["ground"]["cells"].pop())
    _bad(iso, lambda b: b["ground"]["cells"].__setitem__(0, "岩漿 lava"))
    _bad(side, lambda b: b["style"].update(refs=["a1", "a2", "a3", "a4", "a5"]))
    _bad(side, lambda b: b["objects"].append({"id": "o99", "kind": "asset", "asset": "a1", "name": "樹",
                                              "x": 0, "y": 0, "w": 10, "h": 10, "flip": False}))
    _bad(side, lambda b: b["style"].update(refs=["a1"]))
    _bad(flat, lambda b: b.update(ground={"cols": 21, "rows": 5, "cells": [None] * 105, "custom": []}))
    _bad(side, lambda b: b.update(ground={"cols": 2, "rows": 2, "cells": [None] * 4, "custom": []}))


def test_save_ok_and_custom_terrain(tmp_path):
    s = Scene.create(tmp_path, "t", "topdown", empty=True)
    s.add_asset("a1", _img())
    body = _body(s)
    body["ground"]["custom"] = [{"label": "岩漿 lava", "color": "#ff4400"}]
    body["ground"]["cells"][0] = "岩漿 lava"
    body["ground"]["cells"][1] = None
    body["objects"] = [{"id": "o1", "kind": "asset", "asset": "a1", "name": "樹", "x": 1.5, "y": 2,
                        "w": 30, "h": 40, "flip": True}]
    body["style"]["refs"] = ["a1"]
    s.save(body)
    again = Scene.open(tmp_path, "t").meta
    assert again["ground"]["cells"][:2] == ["岩漿 lava", None] and again["objects"][0]["flip"] is True


def test_save_keeps_candidates(tmp_path):
    s = Scene.create(tmp_path, "s", "side", empty=True)
    s.add_candidate(_img(), "p")
    body = _body(s)
    body.update(name="x", view="iso", candidates=[])
    s.save(body)
    m = Scene.open(tmp_path, "s").meta
    assert m["name"] == "s" and m["view"] == "side" and len(m["candidates"]) == 1


def test_candidate_snapshot(tmp_path):
    s = Scene.create(tmp_path, "s", "side", empty=False)
    c1 = s.add_candidate(_img(), "提示")
    assert c1["id"] == "c1" and c1["prompt"] == "提示" and c1["objects"] == s.meta["objects"]
    body = _body(s)
    body["objects"] = body["objects"][:1]
    s.save(body)
    assert len(s.meta["candidates"][0]["objects"]) > 1
    assert s.add_candidate(_img(), "p")["id"] == "c2"
    s.delete_candidate("c1")
    assert s.add_candidate(_img(), "p")["id"] == "c3"
    assert [c["id"] for c in s.meta["candidates"]] == ["c2", "c3"]
    assert s.candidate_image("c3").shape[:2] == (8, 8)
    with pytest.raises(FileNotFoundError):
        s.delete_candidate("c1")


def test_file_path_escape(tmp_path):
    s = Scene.create(tmp_path, "s", "side", empty=True)
    s.add_asset("a1", _img())
    assert s.file_path("assets/a1.png").is_file()
    for bad in ("../s/scene.json", "scene.json", "assets/../scene.json", "assets/a9.png"):
        with pytest.raises(FileNotFoundError):
            s.file_path(bad)
