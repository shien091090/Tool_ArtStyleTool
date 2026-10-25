import pytest

from artstyle.mockup.geometry import (LEVELS, frame_rect, ground_size, ground_spec, iso_point, scale, to_screen,
                                      world_rect)


def test_levels():
    assert LEVELS == ("xfar", "far", "std", "near", "xnear")


def test_scale():
    assert scale(False, "xfar") == 0.5
    assert scale(False, "near") == 1.4
    assert scale(True, "far") == 4
    assert scale(True, "xnear") == 10
    with pytest.raises(ValueError):
        scale(False, "zoom")


def test_world_rect():
    assert world_rect("side", False) == (-640, -360, 1920, 1080)
    assert world_rect("vertical", False) == (-360, -640, 1080, 1920)
    assert world_rect("flat", False) == (0, 0, 1280, 720)
    assert world_rect("side", True) == (0, 0, 640, 360)
    assert world_rect("vertical", True) == (0, 0, 360, 640)


def test_frame_rect():
    assert frame_rect("side", False, "std") == (0, 0, 1280, 720)  # 舊座標就是世界座標
    assert frame_rect("side", False, "xfar") == world_rect("side", False)
    assert frame_rect("side", True, "far") == (160, 90, 480, 270)
    assert frame_rect("vertical", True, "xnear") == (144, 256, 216, 384)
    assert frame_rect("side", True, "xfar") == world_rect("side", True)


def test_to_screen():
    assert to_screen("side", True, "far", 160, 90) == (0, 0)
    assert to_screen("side", True, "far", 480, 270) == (1280, 720)
    assert to_screen("side", False, "xfar", -640, -360) == (0, 0)
    assert to_screen("side", False, "std", 100, 50) == (100, 50)


def test_iso_point_pixel():
    assert iso_point(0, 0) == (640, 120)
    assert iso_point(0, 0, pixel=True) == (320, 20)
    assert iso_point(20, 20, pixel=True)[1] == 340
    assert iso_point(1, 0, pixel=True) == (336, 28)


def test_ground_size():
    assert ground_size("topdown", False) == (40, 24)
    assert ground_size("topdown", True) == (40, 23)
    assert ground_size("iso", False) == (26, 26)
    assert ground_size("iso", True) == (20, 20)
    assert ground_size("side", False) is None


def test_ground_spec():
    g = ground_spec("topdown", {"cols": 40, "rows": 24}, False)
    assert (g["tile"], g["ox"], g["oy"]) == (64, -640, -384)
    g = ground_spec("topdown", {"cols": 40, "rows": 23}, True)
    assert (g["tile"], g["ox"], g["oy"]) == (16, 0, 0)
    assert ground_spec("iso", {"cols": 26, "rows": 26}, False) == {"iso": True, "cols": 26, "rows": 26, "offset": 8}
    assert ground_spec("iso", {"cols": 20, "rows": 20}, True)["offset"] == 0
    g = ground_spec("flat", {"cols": 8, "rows": 8}, True)
    assert (g["tile"], g["ox"], g["oy"]) == (16, 256, 116)
    g = ground_spec("flat", {"cols": 8, "rows": 8}, False)
    assert (g["tile"], g["ox"], g["oy"]) == (64, 384, 104)
