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


def _write_old(tmp_path, name, view, ground):
    d = tmp_path / name
    (d / "assets").mkdir(parents=True)
    (d / "candidates").mkdir()
    meta = {"version": 1, "name": name, "view": view, "created": "2026-10-25T00:00:00", "updated": "2026-10-25T00:00:00",
            "background": {"label": "草地 grass", "color": "#96b978"}, "ground": ground, "objects": [],
            "style": {"text": "", "refs": [], "genre": "g"},
            "candidates": [{"id": "c1", "created": "x", "prompt": "p", "style": {"text": "", "refs": [], "genre": "g"},
                            "objects": []}], "nextCandidate": 2}
    (d / "scene.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")


def test_upgrade_old_topdown(tmp_path):
    cells = ["道路 road"] * 240
    cells[0] = "水 water"
    _write_old(tmp_path, "舊", "topdown", {"cols": 20, "rows": 12, "cells": cells, "custom": []})
    m = Scene.open(tmp_path, "舊").meta
    g = m["ground"]
    assert (g["cols"], g["rows"]) == (40, 24) and len(g["cells"]) == 960
    assert g["cells"][6 * 40 + 10] == "水 water" and g["cells"][6 * 40 + 11] == "道路 road"
    assert g["cells"][0] == "草地 grass"
    assert m["pixel"] is False and m["camera"] == "std" and m["style"]["colors"] == 32
    assert m["candidates"][0]["camera"] == "std"
    assert Scene.open(tmp_path, "舊").meta == m  # 冪等
    s = Scene.open(tmp_path, "舊")
    s.save(_body(s))
    raw = json.loads((tmp_path / "舊" / "scene.json").read_text(encoding="utf-8"))
    assert raw["ground"]["cols"] == 40 and raw["camera"] == "std"


def test_upgrade_old_iso(tmp_path):
    cells = [None] * 100
    cells[0] = "道路 road"
    _write_old(tmp_path, "舊", "iso", {"cols": 10, "rows": 10, "cells": cells, "custom": []})
    g = Scene.open(tmp_path, "舊").meta["ground"]
    assert (g["cols"], g["rows"]) == (20, 20)
    assert g["cells"][5 * 20 + 5] == "道路 road" and g["cells"][5 * 20 + 6] is None and g["cells"][0] == "草地 grass"


def test_save_camera_rules(tmp_path):
    side = Scene.create(tmp_path, "s", "side", empty=True)
    body = _body(side)
    body["camera"] = "xfar"
    assert side.save(body)["camera"] == "xfar"
    _bad(side, lambda b: b.update(camera="zoom"))
    flat = Scene.create(tmp_path, "f", "flat", empty=True)
    _bad(flat, lambda b: b.update(camera="far"))
    body = _body(side)
    body["pixel"] = True
    assert side.save(body)["pixel"] is False


def test_create_pixel_defaults(tmp_path):
    s = Scene.create(tmp_path, "p", "side", empty=True, pixel=True)
    assert s.meta["pixel"] is True and s.meta["camera"] == "far" and s.meta["style"]["colors"] == 32
    assert Scene.create(tmp_path, "n", "side", empty=True).meta["camera"] == "std"
    assert Scene.create(tmp_path, "q", "flat", empty=True, pixel=True, camera="near").meta["camera"] == "near"
    with pytest.raises(ValueError):
        Scene.create(tmp_path, "r", "flat", empty=True, camera="far")


def test_pixel_integer_rules(tmp_path):
    s = Scene.create(tmp_path, "p", "side", empty=True, pixel=True)
    box = {"id": "o1", "kind": "box", "label": "主角 player", "color": "#9a9a9a", "type": None,
           "x": 10, "y": 10, "w": 16, "h": 16}
    body = _body(s)
    body["objects"] = [box]
    s.save(body)
    _bad(s, lambda b: b["objects"][0].update(x=1.5))
    iso = Scene.create(tmp_path, "i", "iso", empty=True, pixel=True)
    blk = {"id": "o1", "kind": "block", "label": "樹 tree", "color": "#9a9a9a", "type": None,
           "i": 0.5, "j": 1, "w": 1, "l": 1, "h": 10}
    body = _body(iso)
    body["objects"] = [blk]
    iso.save(body)
    _bad(iso, lambda b: b["objects"][0].update(i=0.25))
    _bad(iso, lambda b: b["objects"][0].update(h=10.5))


def test_ground_sizes_by_pixel(tmp_path):
    td = Scene.create(tmp_path, "t", "topdown", empty=True, pixel=True)
    assert (td.meta["ground"]["cols"], td.meta["ground"]["rows"]) == (40, 23)
    _bad(td, lambda b: b.update(ground={"cols": 40, "rows": 24, "cells": [None] * 960, "custom": []}))
    flat = Scene.create(tmp_path, "f", "flat", empty=True, pixel=True)
    body = _body(flat)
    body["ground"] = {"cols": 40, "rows": 22, "cells": [None] * 880, "custom": []}
    flat.save(body)
    _bad(flat, lambda b: b.update(ground={"cols": 41, "rows": 22, "cells": [None] * 902, "custom": []}))
    n = Scene.create(tmp_path, "n", "topdown", empty=True)
    assert (n.meta["ground"]["cols"], n.meta["ground"]["rows"]) == (40, 24)


def test_style_colors(tmp_path):
    s = Scene.create(tmp_path, "p", "side", empty=True, pixel=True)
    body = _body(s)
    body["style"]["colors"] = 24
    assert s.save(body)["style"]["colors"] == 24
    _bad(s, lambda b: b["style"].update(colors=20))


def test_candidate_camera_and_raw(tmp_path):
    s = Scene.create(tmp_path, "p", "side", empty=True, pixel=True)
    c = s.add_candidate(_img(), "p", camera="near", raw=_img((1, 2, 3)))
    assert c["camera"] == "near" and c["raw"] == "candidates/c1_raw.png"
    assert s.file_path("candidates/c1_raw.png").is_file()
    assert "raw" not in s.add_candidate(_img(), "p")
    s.delete_candidate("c1")
    assert not (s.dir / "candidates" / "c1_raw.png").exists()
