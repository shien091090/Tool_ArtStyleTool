import pytest

from artstyle.mockup.geometry import VIEWS, canvas_size, iso_point, object_bbox
from artstyle.mockup.presets import preset_scene


@pytest.mark.parametrize("view", VIEWS)
def test_presets_valid(view):
    s = preset_scene(view, empty=False)
    w, h = canvas_size(view)
    assert s["objects"]
    for o in s["objects"]:
        x0, y0, x1, y1 = object_bbox(view, o)
        assert 0 <= x0 < x1 <= w and 0 <= y0 < y1 <= h, o
        assert 0 < len(o["label"]) <= 60
        assert o["kind"] == ("block" if view == "iso" else "box")
    assert len({o["id"] for o in s["objects"]}) == len(s["objects"])
    g = s["ground"]
    if view in ("topdown", "iso"):
        assert len(g["cells"]) == g["cols"] * g["rows"]
    else:
        assert g is None


def test_empty_preset():
    s = preset_scene("topdown", empty=True)
    assert s["objects"] == [] and s["ground"]["cols"] == 40 and s["background"]["label"] == "草地 grass"
    assert s["style"] == {"text": "", "refs": [], "genre": "top-down adventure", "colors": 32}


def test_iso_point():
    assert iso_point(0, 0) == (640, 120)
    assert iso_point(10, 10) == (640, 600)
    assert iso_point(1, 0, 30) == (688, 114)


def test_canvas_size():
    assert canvas_size("vertical") == (720, 1280)
    assert canvas_size("side") == (1280, 720)
