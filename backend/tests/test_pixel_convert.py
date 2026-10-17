import cv2
import numpy as np
import pytest

from artstyle.pixel import convert as cv
from artstyle.pixel.convert import INK
from tests.test_flow import F, _chain, _rgba_png, _upload
from tests.test_flow import client, fal  # noqa: F401  共用 fixture
from tests.test_pixel import P, _create, _png, _sprite


def _monster(w=200, h=240):
    """白紙上的插畫: 灰色地面陰影、深色線稿外框、紅色身體、身體中間的白色反光、身上一條墨線、黃色眼睛。"""
    img = np.full((h, w, 3), 255, np.uint8)
    cv2.ellipse(img, (w // 2, h - 20), (w // 3, 10), 0, 0, 360, (190, 190, 190), -1)
    cv2.ellipse(img, (w // 2, h // 2), (w // 3, h // 3), 0, 0, 360, (200, 40, 40), -1)
    cv2.ellipse(img, (w // 2, h // 2), (w // 3, h // 3), 0, 0, 360, (25, 20, 30), 4)
    cv2.circle(img, (w // 2 + 20, h // 2 + 30), 6, (255, 255, 255), -1)
    cv2.line(img, (w // 2 - 40, h // 2 + 50), (w // 2 + 40, h // 2 + 50), (25, 20, 30), 4)
    cv2.circle(img, (w // 2 - 25, h // 2 - 30), 14, (230, 190, 40), -1)
    return img


def test_size_colors_and_background():
    out = cv.convert(_monster(), 32, 32, 8)
    assert out.shape == (32, 32, 4)
    assert (out[0, 0, 3], out[-1, -1, 3]) == (0, 0)  # 白紙和地面陰影是背景
    opaque = out[out[..., 3] > 0][:, :3]
    assert len(np.unique(opaque, axis=0)) <= 8 + 1  # 色數 + 外框墨色
    assert out[16, 16, 3] == 255


def test_outline_is_ink_and_optional():
    out = cv.convert(_monster(), 32, 32, 8)
    a = out[..., 3] > 0
    edge = a & ~cv2.erode(a.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
    assert (out[edge][:, :3] == INK).all(axis=1).mean() > 0.6
    bare = cv.convert(_monster(), 32, 32, 8, outline=False)
    assert not (bare[..., 3] > 0).sum() == 0 and bare[0, :, 3].max() == 0


def test_enclosed_white_kept():
    rgb, fg = cv.subject_mask(_monster())
    assert fg[240 // 2 + 30, 200 // 2 + 20]  # 被包住的反光
    assert not fg[0, 0] and not fg[240 - 20, 200 // 2]  # 圖邊白紙、地面陰影


def test_alpha_source_uses_alpha():
    rgba = np.zeros((100, 80, 4), np.uint8)
    rgba[10:90, 20:60] = (250, 250, 250, 255)  # 很白的主體, 靠 alpha 才不會被當背景
    out = cv.convert(rgba, 16, 32, 4)
    assert (out[..., 3] > 0).sum() > 100


def test_inner_lines_darken():
    plain = cv.convert(_monster(), 64, 64, 16)
    lined = cv.convert(_monster(), 64, 64, 16, lines=True)
    lum = lambda im: (im[..., :3].astype(int) @ [299, 587, 114])[im[..., 3] > 0].mean()
    assert lum(lined) < lum(plain)


def test_eye_marker_draws_pupil():
    img = _monster()
    eye = {"x": (100 - 25) / 200, "y": (120 - 30) / 240, "r": 14 / 240}
    out = cv.convert(img, 64, 64, 16, eyes=[eye])
    iris = cv.eye_color(img, 75, 90, 14)
    assert iris[0] > 200 and iris[2] < 100  # 取到黃色
    pupil = cv._mix(iris, INK, 0.8)
    assert (out[..., :3] == pupil).all(axis=2).sum() >= 3


def test_all_background_fails():
    with pytest.raises(ValueError, match="找不到主體"):
        cv.convert(np.full((50, 50, 3), 255, np.uint8), 16, 16, 4)


# ---- API ----

def test_work_convert_and_pixelate(client):  # noqa: F811
    _create(client)
    r = client.post(f"{P}/works/像素/convert", json={"cols": 4, "rows": 4})
    assert r.status_code == 200, r.text
    cand = r.json()["candidate"]
    assert cand["mode"] == "convert" and cand["colors"] == 16 and cand["outline"] is True and cand["eyes"] == []
    res = client.post(f"{P}/works/像素/candidates/{cand['id']}/pixelate", json={"colors": 6}).json()
    assert [x["method"] for x in res["results"]] == ["convert", "convert_lines"]
    assert all(x["w"] == 32 and x["h"] == 32 for x in res["results"])


@pytest.mark.parametrize("body, msg", [
    ({"cols": 0, "rows": 4}, "寬格數"),
    ({"cols": 4, "rows": 4, "colors": 1}, "色數"),
    ({"cols": 4, "rows": 4, "outline": "yes"}, "外框"),
    ({"cols": 4, "rows": 4, "eye": {"x": 2, "y": 0.5, "r": 0.1}}, "眼睛位置"),
    ({"cols": 4, "rows": 4, "eye": {"x": 0.5, "y": 0.5, "r": 0}}, "眼睛半徑"),
    ({"cols": 4, "rows": 4, "eyes": [{"x": 0.5, "y": 0.5, "r": 0.1}] * 5}, "最多 4 個"),
    ({"cols": 4, "rows": 4, "eyes": ["x"]}, "格式錯誤"),
])
def test_convert_validation(client, body, msg):  # noqa: F811
    _create(client)
    r = client.post(f"{P}/works/像素/convert", json=body)
    assert r.status_code == 400 and msg in r.json()["detail"]


def test_flow_convert_keeps_alpha_and_input_rev(client):  # noqa: F811
    _chain(client)
    r = client.post(f"{F}/流程/nodes/n3/pixel/convert", json={"cols": 2, "rows": 4})
    assert r.status_code == 400 and "上游還沒有輸出" in r.json()["detail"]
    _upload(client, "n1", _png(_sprite(20, 30)))
    rgba = np.zeros((100, 100, 4), np.uint8)
    rgba[20:80, 30:60] = (200, 40, 40, 255)
    _upload(client, "n2", _rgba_png(rgba), inputRev=1)
    r = client.post(f"{F}/流程/nodes/n3/pixel/convert", json={"cols": 2, "rows": 4})
    assert r.status_code == 200, r.text
    cand = r.json()["candidate"]
    assert cand["inputRev"] == 1
    snap = cv2.imdecode(np.frombuffer(client.get(f"{F}/流程/files/nodes/n3/ai/{cand['id']}.png").content, np.uint8),
                        cv2.IMREAD_UNCHANGED)
    assert snap.shape == (100, 100, 4) and snap[0, 0, 3] == 0
    res = client.post(f"{F}/流程/nodes/n3/pixel/candidates/{cand['id']}/pixelate", json={}).json()
    assert [(x["w"], x["h"]) for x in res["results"]] == [(16, 32), (16, 32)]


def test_two_eyes_and_legacy_eye(client):  # noqa: F811
    _create(client)
    two = [{"x": 0.4, "y": 0.3, "r": 0.05}, {"x": 0.6, "y": 0.3, "r": 0.05}]
    cand = client.post(f"{P}/works/像素/convert", json={"cols": 8, "rows": 8, "eyes": two}).json()["candidate"]
    assert cand["eyes"] == two
    legacy = client.post(f"{P}/works/像素/convert", json={"cols": 8, "rows": 8, "eye": two[0]}).json()["candidate"]
    assert legacy["eyes"] == [two[0]]
    from artstyle.pixel.service import candidate_eyes
    assert candidate_eyes({"eye": two[0]}) == [two[0]] and candidate_eyes({}) == []
    res = client.post(f"{P}/works/像素/candidates/{cand['id']}/pixelate", json={}).json()["results"]
    assert all("error" not in x for x in res)


def test_flow_suggest(client, fal):  # noqa: F811
    _chain(client)
    assert client.post(f"{F}/流程/nodes/n3/pixel/suggest").status_code == 400
    _upload(client, "n1", _png(_sprite(20, 30)))
    rgba = np.zeros((100, 100, 4), np.uint8)
    rgba[20:80, 30:60] = (200, 40, 40, 255)
    _upload(client, "n2", _rgba_png(rgba), inputRev=1)
    r = client.post(f"{F}/流程/nodes/n3/pixel/suggest")
    assert r.status_code == 200 and len(r.json()["sizes"]) == 2
    assert fal.calls[-1][1][:2] == (60, 30)  # 裁到不透明範圍再送
