import pytest

from artstyle.library.store import KINDS
from artstyle.mockup.geometry import VIEWS, canvas_size, frame_rect, ground_size, iso_point, object_bbox, world_rect
from artstyle.mockup.presets import preset_scene

COMBOS = [(v, p) for v in VIEWS for p in (False, True)]


def _hits(a, b) -> bool:
    return min(a[2], b[2]) > max(a[0], b[0]) and min(a[3], b[3]) > max(a[1], b[1])


def _visible(s, view, pixel, camera):
    f = frame_rect(view, pixel, camera)
    return [o for o in s["objects"] if _hits(object_bbox(view, o, pixel), f)]


@pytest.mark.parametrize("view,pixel", COMBOS)
def test_presets_valid(view, pixel):
    s = preset_scene(view, empty=False, pixel=pixel)
    wx0, wy0, wx1, wy1 = world_rect(view, pixel)
    assert s["objects"]
    for o in s["objects"]:
        x0, y0, x1, y1 = object_bbox(view, o, pixel)
        assert wx0 <= x0 < x1 <= wx1 and wy0 <= y0 < y1 <= wy1, o
        assert 0 < len(o["label"]) <= 60 and o["type"] in KINDS
        assert o["kind"] == ("block" if view == "iso" else "box")
        if pixel:
            keys = ("i", "j", "w", "l") if view == "iso" else ("x", "y", "w", "h")
            unit = 0.5 if view == "iso" else 1
            assert all(o[k] / unit == round(o[k] / unit) for k in keys), o
            assert o["h"] == round(o["h"]), o
    assert len({o["id"] for o in s["objects"]}) == len(s["objects"])
    g, size = s["ground"], ground_size(view, pixel)
    if size:
        assert (g["cols"], g["rows"]) == size and len(g["cells"]) == g["cols"] * g["rows"]
    else:
        assert g is None
    assert s["style"]["colors"] == 32


@pytest.mark.parametrize("view,pixel", [(v, p) for v in ("side", "vertical") for p in (False, True)])
def test_presets_fill_xfar(view, pixel):
    """捲軸類: 超遠鏡頭切 4×4, 每格都有東西。"""
    s = preset_scene(view, empty=False, pixel=pixel)
    x0, y0, x1, y1 = frame_rect(view, pixel, "xfar")
    cw, ch = (x1 - x0) / 4, (y1 - y0) / 4
    boxes = [object_bbox(view, o, pixel) for o in s["objects"]]
    for r in range(4):
        for c in range(4):
            cell = (x0 + c * cw, y0 + r * ch, x0 + (c + 1) * cw, y0 + (r + 1) * ch)
            assert any(_hits(b, cell) for b in boxes), (r, c)


def _inside(s, view, pixel, camera):
    f = frame_rect(view, pixel, camera)
    return [o for o in s["objects"] if (lambda b: b[0] >= f[0] and b[1] >= f[1] and b[2] <= f[2] and b[3] <= f[3])(
        object_bbox(view, o, pixel))]


@pytest.mark.parametrize("view,pixel", [(v, p) for v in ("topdown", "iso") for p in (False, True)])
def test_presets_more_when_far(view, pixel):
    """超遠看到的完整物件至少是標準的 1.5 倍(一般斜角的 20×20 格在標準鏡頭就看得到大半, 所以不要求 2 倍)。"""
    s = preset_scene(view, empty=False, pixel=pixel)
    assert len(_inside(s, view, pixel, "xfar")) >= 1.5 * len(_inside(s, view, pixel, "std"))


@pytest.mark.parametrize("view,pixel", [c for c in COMBOS if c[0] != "flat"])
def test_presets_player_close_up(view, pixel):
    s = preset_scene(view, empty=False, pixel=pixel)
    close = _visible(s, view, pixel, "xnear")
    assert any("player" in o["label"] for o in close) and len(close) >= 2


@pytest.mark.parametrize("view", ["side", "vertical", "topdown", "iso"])
def test_pixel_player_16(view):
    s = preset_scene(view, empty=False, pixel=True)
    p = next(o for o in s["objects"] if "player" in o["label"])
    if view == "iso":
        assert p["w"] == p["l"] == 0.5
    else:
        assert p["w"] == p["h"] == 16


def test_normal_flat_unchanged():
    objs = preset_scene("flat", empty=False)["objects"]
    assert len(objs) == 20
    assert objs[0] == {"id": "o1", "kind": "box", "label": "對手頭像 opponent", "color": "#9a9a9a", "type": "角色",
                       "x": 40, "y": 40, "w": 120, "h": 120}
    assert objs[-1]["label"] == "我方頭像 player" and (objs[-1]["x"], objs[-1]["y"]) == (40, 560)


def test_normal_std_keeps_old_ground():
    """一般俯瞰標準鏡頭看到的地面 = 舊預設(第 6 列道路、左下水池)。"""
    g = preset_scene("topdown", empty=False)["ground"]
    old = lambda c, r: g["cells"][(r + 6) * 40 + c + 10]
    assert old(5, 6) == "道路 road" and old(0, 10) == "水 water" and old(5, 2) == "草地 grass"


def test_empty_preset():
    s = preset_scene("topdown", empty=True)
    assert s["objects"] == [] and s["ground"]["cols"] == 40 and s["background"]["label"] == "草地 grass"
    assert s["style"] == {"text": "", "refs": [], "genre": "top-down adventure", "colors": 32}
    assert preset_scene("iso", empty=True, pixel=True)["ground"]["cols"] == 20


def test_iso_point():
    assert iso_point(0, 0) == (640, 120)
    assert iso_point(10, 10) == (640, 600)
    assert iso_point(1, 0, 30) == (688, 114)


def test_canvas_size():
    assert canvas_size("vertical") == (720, 1280)
    assert canvas_size("side") == (1280, 720)
