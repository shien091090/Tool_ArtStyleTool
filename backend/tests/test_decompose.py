import cv2
import numpy as np
import pytest

from artstyle import decompose
from artstyle.fal import FalError
from artstyle.pack import Pack


def _png(img):
    return cv2.imencode(".png", img)[1].tobytes()


def _source():
    img = np.full((60, 80, 3), 230, np.uint8)
    cv2.rectangle(img, (10, 10), (70, 50), (40, 40, 40), 2)
    img[12:49, 12:39] = (60, 60, 200)    # 左半紅(BGR)
    img[12:49, 41:69] = (200, 60, 60)    # 右半藍
    img[10:51, 39:41] = (40, 40, 40)     # 中線
    return img


class FakeFal:
    def __init__(self, fail_on=None):
        self.calls = []
        self.fail_on = fail_on

    def run_image(self, model, img, **params):
        self.calls.append(model)
        if self.fail_on and self.fail_on in model:
            raise FalError("模擬失敗")
        if "depth" in model:
            return np.full((30, 40), 128, np.uint8)  # 故意給一半尺寸
        if "kontext" in model:
            return cv2.resize(img, (88, 66))         # 去光影: 故意給不同尺寸
        gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
        return 255 - np.where(gray < 50, 0, 255).astype(np.uint8)  # 黑底白線


@pytest.fixture
def pack(tmp_path):
    return Pack.create(tmp_path, "測試", _png(_source()))


def test_run_all_produces_aligned_layers(pack):
    decompose.run_all(pack, FakeFal())
    for layer in ["depth", "normal", "normal_detail", "line", "line_sdf", "delight", "regions", "flat"]:
        assert pack.read(layer).shape[:2] == (60, 80)
    flat = pack.read("flat")
    assert flat[30, 25, 0] > 150 and flat[30, 55, 2] > 150
    assert pack.meta["regions"]["count"] >= 3


def test_failure_keeps_completed_steps(pack):
    with pytest.raises(FalError):
        decompose.run_all(pack, FakeFal(fail_on="image-preprocessors"))
    assert pack.has("depth") and pack.has("normal") and not pack.has("line")


def test_rerun_line_marks_downstream_stale(pack):
    decompose.run_all(pack, FakeFal())
    decompose.run_step(pack, "line", FakeFal())
    layers = pack.meta["layers"]
    assert layers["line"]["origin"] == "ai:fal-ai/image-preprocessors/lineart"
    assert layers["regions"]["stale"] and layers["flat"]["stale"] and layers["line_sdf"]["stale"]
    assert not layers["normal"]["stale"]
    calls = FakeFal()
    decompose.run_all(pack, calls)
    assert calls.calls == []
    assert not pack.meta["layers"]["flat"]["stale"]


def test_unknown_line_model(pack):
    with pytest.raises(ValueError):
        decompose.run_step(pack, "line", FakeFal(), model="nope")


def test_missing_prerequisite(pack):
    with pytest.raises(ValueError, match="請先完成"):
        decompose.run_step(pack, "flat", None)


def test_ai_step_without_client(pack):
    with pytest.raises(decompose.NoClientError):
        decompose.run_step(pack, "depth", None)


def test_regions_params_recorded(pack):
    decompose.run_all(pack, FakeFal())
    decompose.run_step(pack, "regions", None, method="line", gap_radius=5, min_area=30, merge=0.1)
    params = pack.meta["layers"]["regions"]["params"]
    assert params["method"] == "line" and params["gap_radius"] == 5 and params["min_area"] == 30 and params["merge"] == 0.1
    assert pack.meta["layers"]["flat"]["stale"]


def test_set_region_color_updates_flat(pack):
    decompose.run_all(pack, FakeFal())
    rid = decompose.region_at(pack, 30, 25)
    decompose.set_region_color(pack, rid, (0, 255, 0))
    assert pack.read("flat")[30, 25].tolist() == [0, 255, 0]
    assert pack.meta["regions"]["colors"][str(rid)] == [0, 255, 0]
    assert not pack.meta["layers"]["flat"]["stale"]


def test_region_at_out_of_bounds(pack):
    decompose.run_all(pack, FakeFal())
    with pytest.raises(ValueError):
        decompose.region_at(pack, 999, 0)


def test_replace_flat_resamples_from_user_image(pack):
    decompose.run_all(pack, FakeFal())
    user = np.zeros((30, 40, 3), np.uint8)
    user[:] = (0, 200, 0)                     # BGR 綠, 故意給不同尺寸
    decompose.replace_layer(pack, "flat", _png(user))
    assert pack.read("flat")[30, 25].tolist() == [0, 200, 0]
    assert pack.meta["layers"]["flat"]["color_source"] == "user_flat"


def test_replace_line_marks_downstream(pack):
    decompose.run_all(pack, FakeFal())
    line = np.full((60, 80), 255, np.uint8)
    decompose.replace_layer(pack, "line", _png(line))
    assert pack.meta["layers"]["line"]["origin"] == "user"
    assert pack.meta["layers"]["regions"]["stale"]


def test_replace_unknown_layer(pack):
    with pytest.raises(ValueError):
        decompose.replace_layer(pack, "source", _png(_source()))


def _line_png():
    line = np.full((60, 80), 255, np.uint8)
    cv2.rectangle(line, (10, 10), (70, 50), 0, 2)
    line[10:51, 39:41] = 0
    return _png(line)


def test_no_key_with_user_layers_reaches_renderable(pack):
    decompose.replace_layer(pack, "line", _line_png())
    decompose.replace_layer(pack, "normal", _png(np.full((60, 80, 3), (255, 128, 128), np.uint8)))
    decompose.run_all(pack, None)
    for layer in ["line_sdf", "regions", "flat"]:
        assert pack.has(layer)
    assert not pack.has("depth")


def test_run_all_skips_depth_when_user_normal_exists(pack):
    decompose.replace_layer(pack, "normal", _png(np.full((60, 80, 3), (255, 128, 128), np.uint8)))
    calls = FakeFal()
    decompose.run_all(pack, calls)
    assert not any("depth" in c for c in calls.calls)
    assert pack.meta["layers"]["normal"]["origin"] == "user"


def test_no_key_still_runs_local_steps_then_reports(pack):
    decompose.replace_layer(pack, "line", _line_png())
    with pytest.raises(decompose.NoClientError):
        decompose.run_all(pack, None)          # 缺法線又沒金鑰
    assert pack.has("regions") and pack.has("flat")


def test_upload_flat_before_regions_does_not_fake_flat_layer(pack):
    decompose.replace_layer(pack, "flat", _png(np.full((60, 80, 3), (0, 200, 0), np.uint8)))
    assert "flat" not in pack.meta["layers"]
    decompose.replace_layer(pack, "line", _line_png())
    decompose.run_all(pack, FakeFal())
    assert pack.read("flat")[30, 25].tolist() == [0, 200, 0]


def test_only_lineart_model():
    from artstyle.fal import LINE_MODELS
    assert list(LINE_MODELS) == ["lineart"] and decompose.DEFAULT_LINE_MODEL == "lineart"


def test_default_regions_cut_by_color_from_delight(pack):
    calls = FakeFal()
    decompose.run_all(pack, calls)
    assert any("kontext" in c for c in calls.calls)
    params = pack.meta["layers"]["regions"]["params"]
    assert params["method"] == "color" and params["color_source"] == "delight"
    assert pack.read("delight").shape[:2] == (60, 80)


def test_no_key_skips_delight_and_uses_source(pack):
    decompose.replace_layer(pack, "line", _line_png())
    decompose.replace_layer(pack, "normal", _png(np.full((60, 80, 3), (255, 128, 128), np.uint8)))
    decompose.run_all(pack, None)
    assert not pack.has("delight") and pack.has("flat")
    assert pack.read("flat")[30, 25, 0] > 150                # 左半紅, 取自原圖


def test_color_source_param_source(pack):
    decompose.run_all(pack, FakeFal())
    decompose.run_step(pack, "regions", None, color_source="source", colors=4)
    p = pack.meta["layers"]["regions"]["params"]
    assert p["color_source"] == "source" and p["colors"] == 4


def test_line_method_merge_reduces_regions(pack):
    decompose.run_all(pack, FakeFal())
    decompose.run_step(pack, "regions", None, method="line", merge=0.0)
    decompose.run_step(pack, "flat", None)
    before = pack.meta["regions"]["count"]
    decompose.run_step(pack, "regions", None, method="line", merge=0.5)
    decompose.run_step(pack, "flat", None)
    assert pack.meta["regions"]["count"] < before


def test_bad_region_params(pack):
    with pytest.raises(ValueError):
        decompose.run_step(pack, "regions", None, method="nope")


def test_run_all_produces_ao_and_silhouette(pack):
    decompose.run_all(pack, FakeFal())
    assert pack.read("ao").shape == (60, 80) and pack.read("silhouette_sdf").shape == (60, 80)


def test_silhouette_without_depth_uses_regions(pack):
    decompose.replace_layer(pack, "line", _line_png())
    decompose.replace_layer(pack, "normal", _png(np.full((60, 80, 3), (255, 128, 128), np.uint8)))
    decompose.run_all(pack, None)
    assert pack.has("silhouette_sdf") and not pack.has("ao")


def test_recut_regions_refreshes_silhouette(pack):
    decompose.run_all(pack, FakeFal())
    decompose.run_step(pack, "regions", None, colors=4)
    assert pack.has("silhouette_sdf") and not pack.is_stale("silhouette_sdf")


def test_shade_layer_and_sampled_colors(pack):
    decompose.run_all(pack, FakeFal())
    assert pack.read("shade").shape == (60, 80, 3)
    sampled = dict(pack.meta["regions"]["sampled"])
    rid = decompose.region_at(pack, 30, 25)
    decompose.set_region_color(pack, rid, (0, 255, 0))
    assert pack.meta["regions"]["sampled"] == sampled          # 取色不受編輯影響
    assert pack.meta["regions"]["colors"][str(rid)] == [0, 255, 0]


def test_recut_regions_and_flat_refresh_shade(pack):
    decompose.run_all(pack, FakeFal())
    decompose.run_step(pack, "regions", None, colors=4)
    decompose.run_step(pack, "flat", None)
    assert not pack.is_stale("shade")


def test_user_flat_refreshes_shade(pack):
    decompose.run_all(pack, FakeFal())
    before = pack.read("shade").copy()
    decompose.replace_layer(pack, "flat", _png(np.full((60, 80, 3), (0, 200, 0), np.uint8)))
    assert not pack.is_stale("shade")
    assert not np.array_equal(pack.read("shade"), before)      # 取色變了, 原圖光影跟著重算


def test_old_pack_gets_sampled_backfilled(pack):
    decompose.run_all(pack, FakeFal())
    del pack.meta["regions"]["sampled"]                          # 模擬舊分層包
    pack.save_meta()
    decompose.run_step(pack, "shade", None)
    assert pack.meta["regions"]["sampled"] == pack.meta["regions"]["colors"]
