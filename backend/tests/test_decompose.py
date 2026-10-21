import cv2
import numpy as np
import pytest

from artstyle import decompose
from artstyle.fal import FalError
from artstyle.pack import Pack


def _png(img):
    return cv2.imencode(".png", img)[1].tobytes()


def _source():
    img = np.full((60, 80, 3), 255, np.uint8)
    cv2.rectangle(img, (10, 10), (70, 50), (40, 40, 40), 2)
    img[12:49, 12:39] = (60, 60, 200)    # 左半紅(BGR)
    img[12:49, 41:69] = (200, 60, 60)    # 右半藍
    img[10:51, 39:41] = (40, 40, 40)     # 中線
    return img


class FakeFal:
    def __init__(self, fail_on=None):
        self.calls = []
        self.edit_sizes = []
        self.fail_on = fail_on

    def edit(self, model, img, prompt, num_images, extra_images=()):
        self.calls.append(model)
        self.edit_sizes.append(img.shape[:2])
        # AI 平塗: 去掉線條, 右上角故意畫出原圖主體外
        out = img.copy()
        gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
        out[gray < 50] = (230, 230, 230)
        return [cv2.resize(out, (out.shape[1] * 2, out.shape[0] * 2), interpolation=cv2.INTER_NEAREST)]

    def run_image(self, model, img, **params):
        self.calls.append(model)
        if self.fail_on and self.fail_on in model:
            raise FalError("模擬失敗")
        if "depth" in model:
            return np.full((30, 40), 128, np.uint8)  # 故意給一半尺寸
        gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
        return 255 - np.where(gray < 50, 0, 255).astype(np.uint8)  # 黑底白線


@pytest.fixture
def pack(tmp_path):
    return Pack.create(tmp_path, "測試", _png(_source()))


def test_run_all_produces_aligned_layers(pack):
    decompose.run_all(pack, FakeFal())
    for layer in ["depth", "normal", "normal_detail", "line", "line_sdf", "regions", "flat"]:
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
    assert layers["line_sdf"]["stale"] and layers["shade"]["stale"]
    assert not layers["normal"]["stale"] and not layers["regions"]["stale"]   # 平塗不靠線稿, 不用重畫
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




def test_replace_line_marks_downstream(pack):
    decompose.run_all(pack, FakeFal())
    line = np.full((60, 80), 255, np.uint8)
    decompose.replace_layer(pack, "line", _png(line))
    assert pack.meta["layers"]["line"]["origin"] == "user"
    assert pack.meta["layers"]["line_sdf"]["stale"] and not pack.meta["layers"]["regions"]["stale"]


def test_replace_unknown_layer(pack):
    with pytest.raises(ValueError):
        decompose.replace_layer(pack, "source", _png(_source()))


def _line_png():
    line = np.full((60, 80), 255, np.uint8)
    cv2.rectangle(line, (10, 10), (70, 50), 0, 2)
    line[10:51, 39:41] = 0
    return _png(line)




def test_run_all_skips_depth_when_user_normal_exists(pack):
    decompose.replace_layer(pack, "normal", _png(np.full((60, 80, 3), (255, 128, 128), np.uint8)))
    calls = FakeFal()
    decompose.run_all(pack, calls)
    assert not any("depth" in c for c in calls.calls)
    assert pack.meta["layers"]["normal"]["origin"] == "user"




def test_only_lineart_model():
    from artstyle.fal import LINE_MODELS
    assert list(LINE_MODELS) == ["lineart"] and decompose.DEFAULT_LINE_MODEL == "lineart"












def test_run_all_produces_ao_and_silhouette(pack):
    decompose.run_all(pack, FakeFal())
    assert pack.read("ao").shape == (60, 80) and pack.read("silhouette_sdf").shape == (60, 80)




def test_recut_regions_refreshes_silhouette(pack):
    decompose.run_all(pack, FakeFal())
    decompose.run_step(pack, "regions", FakeFal())
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
    decompose.run_step(pack, "regions", FakeFal())
    decompose.run_step(pack, "flat", None)
    assert not pack.is_stale("shade")




def test_old_pack_gets_sampled_backfilled(pack):
    decompose.run_all(pack, FakeFal())
    del pack.meta["regions"]["sampled"]                          # 模擬舊分層包
    pack.save_meta()
    decompose.run_step(pack, "shade", None)
    assert pack.meta["regions"]["sampled"] == pack.meta["regions"]["colors"]


def test_ai_flat_regions_from_gpt(pack):
    calls = FakeFal()
    decompose.run_all(pack, calls)
    assert "gpt-image-2" in calls.calls
    h, w = calls.edit_sizes[0]
    assert abs(w / h - 1.5) < 0.01                  # 補白成 GPT 支援的比例才送
    assert pack.meta["layers"]["regions"]["origin"] == "ai:gpt-image-2"
    assert pack.read("flat_ai").shape[:2] == pack.read("source").shape[:2]  # AI 原圖留著
    assert pack.meta["layers"]["flat"]["origin"] == "ai:gpt-image-2"
    flat = pack.read("flat")
    assert flat[0, 0].tolist() == [255, 255, 255]   # 原圖主體外是背景
    assert flat[30, 25, 0] > 150 and flat[30, 55, 2] > 150
    assert flat[30, 39].tolist() != [230, 230, 230]  # AI 漏畫的中線(原圖主體內)用旁邊的色塊補


def test_flat_rerun_keeps_edited_colors(pack):
    decompose.run_all(pack, FakeFal())
    rid = decompose.region_at(pack, 30, 25)
    decompose.set_region_color(pack, rid, (0, 255, 0))
    decompose.run_step(pack, "flat", None)
    assert pack.read("flat")[30, 25].tolist() == [0, 255, 0]


def test_ai_flat_needs_key(pack):
    with pytest.raises(decompose.NoClientError):
        decompose.run_step(pack, "regions", None)


def test_no_key_runs_local_steps_then_reports(pack):
    decompose.replace_layer(pack, "line", _line_png())
    decompose.replace_layer(pack, "normal", _png(np.full((60, 80, 3), (255, 128, 128), np.uint8)))
    with pytest.raises(decompose.NoClientError, match="AI 平塗"):
        decompose.run_all(pack, None)
    assert pack.has("line_sdf") and not pack.has("regions")


def test_flat_not_replaceable(pack):
    with pytest.raises(ValueError):
        decompose.replace_layer(pack, "flat", _png(_source()))
