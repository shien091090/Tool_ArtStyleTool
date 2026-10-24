import json
import math

import cv2
import numpy as np
import pytest

from artstyle.proportion.work import Work


def _png(img):
    return cv2.imencode(".png", img)[1].tobytes()


def _img(w=80, h=60, v=200):
    return np.full((h, w, 3), v, np.uint8)


def _mask(h=60, w=80):
    m = np.zeros((h, w), np.uint8)
    m[10:20, 30:50] = 255
    return m


@pytest.fixture
def work(tmp_path):
    return Work.create(tmp_path, "作品", _png(_img()))


def test_create_open(tmp_path, work):
    assert work.meta["images"] == [{"id": "main", "name": "主圖", "w": 80, "h": 60}]
    assert (tmp_path / "作品" / "images" / "main.png").is_file()
    again = Work.open(tmp_path, "作品")
    assert again.meta == work.meta
    with pytest.raises(FileExistsError):
        Work.create(tmp_path, "作品", _png(_img()))
    with pytest.raises(FileNotFoundError):
        Work.open(tmp_path, "沒有")


def test_bad_image_leaves_no_folder(tmp_path):
    with pytest.raises(ValueError):
        Work.create(tmp_path, "壞", b"not an image")
    assert not (tmp_path / "壞").exists()


def test_add_image_and_parts(work):
    sid = work.add_image(_png(_img(40, 30)), "怪物")
    assert sid == "s1" and work.image("s1").shape == (30, 40, 3)
    assert work.add_image(_png(_img()), "龍") == "s2"
    p = work.add_part("頭", "main", _mask(), [{"x": 1, "y": 2, "label": 1}], None)
    assert p["id"] == "p1" and p["placed"] is True and p["place"] is None
    assert p["bbox"] == [30, 10, 49, 19] and p["transform"]["anchor"] == "bottom"
    q = work.add_part("翅膀", "s1", np.full((30, 40), 255, np.uint8), [], None)
    assert q["placed"] is False and q["color"] != p["color"]
    assert q["transform"]["z"] > p["transform"]["z"]
    assert work.mask("p1").max() == 255
    with pytest.raises(ValueError):
        work.add_part("空", "main", np.zeros((60, 80), np.uint8), [], None)
    with pytest.raises(ValueError):
        work.add_part("錯尺寸", "main", np.full((30, 40), 255, np.uint8), [], None)
    with pytest.raises(FileNotFoundError):
        work.add_part("x", "s9", _mask(), [], None)


def test_update_and_delete_part(work):
    work.add_part("頭", "main", _mask(), [], None)
    m = np.zeros((60, 80), np.uint8)
    m[0:5, 0:5] = 255
    work.update_part_mask("p1", m, [{"x": 1, "y": 1, "label": 1}], {"x_min": 0, "y_min": 0, "x_max": 5, "y_max": 5})
    p = work.part("p1")
    assert p["bbox"] == [0, 0, 4, 4] and p["box"]["x_max"] == 5
    work.delete_part("p1")
    assert work.meta["parts"] == [] and not (work.dir / "masks" / "p1.png").exists()
    with pytest.raises(FileNotFoundError):
        work.delete_part("p1")
    # 刪掉後新部位不重用編號
    assert work.add_part("頭", "main", _mask(), [], None)["id"] == "p2"


def _layout_entry(pid, **t):
    tr = {"scaleX": 1.5, "scaleY": 1.5, "rotation": 10, "anchor": "center", "dx": 0.1, "dy": -0.2, "z": 3, "hidden": False}
    tr.update(t)
    return {"id": pid, "placed": True, "place": None, "transform": tr}


def test_set_layout(work):
    work.add_part("頭", "main", _mask(), [], None)
    work.add_image(_png(_img(40, 30)), "怪物")
    work.add_part("頭", "s1", np.full((30, 40), 255, np.uint8), [], None)
    foreign = _layout_entry("p2")
    foreign["place"] = {"scale": 0.5, "tx": 10, "ty": 4}
    work.set_layout([_layout_entry("p1"), foreign], {"top": 0, "right": 5, "bottom": 0, "left": 0})
    again = Work.open(work.root, work.name)
    assert again.part("p1")["transform"]["scaleX"] == 1.5
    assert again.part("p2")["place"] == {"scale": 0.5, "tx": 10, "ty": 4}
    assert again.meta["pad"]["right"] == 5


@pytest.mark.parametrize("bad", [
    {"scaleX": 0}, {"scaleY": -1}, {"scaleX": math.nan}, {"rotation": math.inf}, {"anchor": "left"},
    {"z": 1.5}, {"hidden": "yes"}, {"scaleX": 25},
])
def test_set_layout_rejects_bad_transform(work, bad):
    work.add_part("頭", "main", _mask(), [], None)
    before = json.dumps(work.meta)
    with pytest.raises(ValueError):
        work.set_layout([_layout_entry("p1", **bad)], {"top": 0, "right": 0, "bottom": 0, "left": 0})
    assert json.dumps(Work.open(work.root, work.name).meta) == before


def test_set_layout_rejects_bad_pad_and_place(work):
    work.add_part("頭", "main", _mask(), [], None)
    with pytest.raises(ValueError):
        work.set_layout([_layout_entry("p1")], {"top": -1, "right": 0, "bottom": 0, "left": 0})
    e = _layout_entry("p1")
    e["place"] = {"scale": 1, "tx": 0, "ty": 0}  # 主圖部位不能有放置變形
    with pytest.raises(ValueError):
        work.set_layout([e], {"top": 0, "right": 0, "bottom": 0, "left": 0})
    with pytest.raises(FileNotFoundError):
        work.set_layout([_layout_entry("p9")], {"top": 0, "right": 0, "bottom": 0, "left": 0})


def test_results_and_file_path(work):
    r = work.add_result(_img(10, 10), {"model": "nano-banana", "count": 1})
    assert r["id"] == "r1" and r["model"] == "nano-banana"
    assert work.file_path("results/r1.png").is_file()
    assert json.loads(work.file_path("results/r1.json").read_text(encoding="utf-8"))["count"] == 1
    for bad in ["../meta.json", "results/../meta.json", "meta.json", "images/main.txt", "results\\r1.png"]:
        with pytest.raises(FileNotFoundError):
            work.file_path(bad)


def _apply(t, place, bbox, x, y):
    """與前端 partMatrix 相同的正向變形, 用來驗證 rebase 前後位置不變。"""
    from artstyle.proportion.work import _anchor, _edges
    s = place["scale"] if place else 1.0
    px, py = x * s + (place["tx"] if place else 0), y * s + (place["ty"] if place else 0)
    e = _edges(bbox, place)
    ax, ay = _anchor(e, t["anchor"])
    r = math.radians(t["rotation"])
    vx, vy = (px - ax) * t["scaleX"], (py - ay) * t["scaleY"]
    return (ax + t["dx"] * (e[2] - e[0]) + vx * math.cos(r) - vy * math.sin(r),
            ay + t["dy"] * (e[3] - e[1]) + vx * math.sin(r) + vy * math.cos(r))


@pytest.mark.parametrize("anchor", ["top", "center", "bottom"])
@pytest.mark.parametrize("place", [None, {"scale": 0.6, "tx": 30, "ty": -12}])
def test_rebase_keeps_rendered_position(anchor, place):
    from artstyle.proportion.work import rebase_transform
    t = {"scaleX": 1.5, "scaleY": 0.8, "rotation": 25, "anchor": anchor, "dx": 0.1, "dy": -0.3, "z": 1, "hidden": False}
    old, new = [10, 20, 69, 59], [40, 25, 69, 50]
    t2 = rebase_transform(t, place, old, new)
    for x, y in [(45, 30), (60, 50), (40, 25)]:
        a = _apply(t, place, old, x, y)
        b = _apply(t2, place, new, x, y)
        assert a == pytest.approx(b, abs=1e-6)


def test_refine_keeps_position_and_bumps_rev(work):
    work.add_part("頭", "main", _mask(), [], None)
    work.set_layout([_layout_entry("p1")], {"top": 0, "right": 0, "bottom": 0, "left": 0})
    t = dict(work.part("p1")["transform"])
    m = np.zeros((60, 80), np.uint8)
    m[10:30, 30:45] = 255
    work.update_part_mask("p1", m, [], None)
    p = work.part("p1")
    assert p["rev"] == 1
    assert _apply(t, None, [30, 10, 49, 19], 35, 15) == pytest.approx(_apply(p["transform"], None, p["bbox"], 35, 15))


@pytest.mark.parametrize("entry", ["p1", ["p1"], {"id": ["p1"]}, {"id": 1}])
def test_set_layout_rejects_malformed_entries(work, entry):
    work.add_part("頭", "main", _mask(), [], None)
    with pytest.raises(ValueError):
        work.set_layout([entry], {"top": 0, "right": 0, "bottom": 0, "left": 0})


# ---- 材質 ----
def _var(v=50):
    return _img(v=v)


def test_old_work_without_material_fields(work):
    p = work.add_part("頭", "main", _mask(), [], None)
    p.pop("material", None)
    work.meta["counters"].pop("material", None)
    work.meta.pop("aliases", None)
    work.save_meta()
    again = Work.open(work.root, work.name)
    assert again.part_material("p1") == {"current": None, "variants": []}
    assert (again.material_image("p1") == again.image("main")).all()
    v = again.add_material_variant("p1", _var(), "金屬", None)
    assert v["id"] == "m1"


def test_material_variants_lifecycle(work):
    work.add_part("頭", "main", _mask(), [], None)
    v1 = work.add_material_variant("p1", _var(50), "金屬", None)
    assert work.part_material("p1")["current"] == "m1"  # 原本材質時自動套用第一張
    v2 = work.add_material_variant("p1", _var(60), "木頭", _img(10, 10, 9))
    assert v2["ref"] is True and work.part_material("p1")["current"] == "m1"
    assert work.file_path("materials/m2.png").is_file() and work.file_path("materials/m2_ref.png").is_file()
    assert work.material_image("p1")[0, 0, 0] == 50
    work.set_material("p1", "m2")
    assert work.material_image("p1")[0, 0, 0] == 60
    work.set_material("p1", None)
    assert work.material_image("p1")[0, 0, 0] == 200
    with pytest.raises(FileNotFoundError):
        work.set_material("p1", "m9")
    work.set_material("p1", "m2")
    work.delete_material("p1", "m2")  # 刪套用中 → 切回原本
    m = work.part_material("p1")
    assert m["current"] is None and [x["id"] for x in m["variants"]] == ["m1"]
    assert not (work.dir / "materials" / "m2.png").exists() and not (work.dir / "materials" / "m2_ref.png").exists()
    assert work.add_material_variant("p1", _var(), "石頭", None)["id"] == "m3"  # 編號不重用
    with pytest.raises(ValueError):
        work.add_material_variant("p1", _img(10, 10), "錯尺寸", None)


def test_copy_materials_and_delete_part(work):
    work.add_part("翅膀", "main", _mask(), [], None)
    work.add_part("翅膀2", "main", _mask(), [], None)
    work.add_material_variant("p1", _var(50), "金屬", _img(10, 10, 9))
    work.add_material_variant("p1", _var(60), "木頭", None)
    work.set_material("p1", "m2")
    work.copy_materials("p1", "p2")
    m2 = work.part_material("p2")
    assert [x["id"] for x in m2["variants"]] == ["m3", "m4"] and m2["current"] == "m4"
    assert work.file_path("materials/m3_ref.png").is_file()
    work.delete_part("p1")
    assert not (work.dir / "materials" / "m1.png").exists()
    assert (work.material_image("p2")[0, 0, 0]) == 60


def test_aliases(work):
    assert work.aliases() == {}
    work.set_alias("燈室", "lantern room")
    assert Work.open(work.root, work.name).aliases() == {"燈室": "lantern room"}
