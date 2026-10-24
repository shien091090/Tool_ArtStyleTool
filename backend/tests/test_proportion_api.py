import json

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from artstyle.fal import FalError
from artstyle.server import create_app
from tests.test_decompose import _source

HEADERS = {"X-ArtStyle": "1"}
W = "/api/flows/流程/nodes/n2/workshop"


def _png(img):
    return cv2.imencode(".png", img)[1].tobytes()


class FakeFal:
    """head → 上方矩形; wing → 左右兩塊; 其他名稱切不到; 空提示詞(只靠位置)→ 點附近一塊。"""

    def __init__(self, returned=None, fail=False):
        self.returned = returned
        self.fail = fail
        self.segment_calls = []
        self.edit_calls = []

    def run_image(self, model, img, **params):
        raise AssertionError("不該呼叫")

    def segment(self, img, prompt, points, boxes):
        self.segment_calls.append((prompt, points, boxes))
        h, w = img.shape[:2]
        m = np.zeros((h, w), np.uint8)
        if prompt == "head":
            m[5:20, 20:40] = 255
            if points:
                m[25:30, 20:40] = 255
            return [(m, 0.9)]
        if prompt == "wing":
            a = m.copy(); a[30:40, 2:12] = 255
            b = m.copy(); b[30:40, 60:70] = 255
            return [(a, 0.8), (b, 0.7), (np.full((h, w), 255, np.uint8), 0.1)]
        if prompt == "" and (points or boxes):
            m[40:50, 40:50] = 255
            return [(m, 0.6)]
        return []

    vision_reply = '{"parts": [{"zh": "頭", "en": "head"}, {"zh": "燈室", "en": "lantern room"}]}'

    def vision(self, img, prompt):
        self.vision_calls = getattr(self, "vision_calls", []) + [img.shape]
        if self.fail:
            raise FalError("模擬失敗")
        return self.vision_reply

    def edit(self, model_key, img, prompt, num_images, extra_images=()):
        self.edit_calls.append((model_key, img.shape, prompt, num_images))
        self.edit_extra = list(extra_images)
        if self.fail:
            raise FalError("模擬失敗")
        n = num_images if self.returned is None else self.returned
        return [np.full((img.shape[0] // 2, img.shape[1] // 2, 3), 9, np.uint8) for _ in range(n)]


@pytest.fixture
def fal():
    return FakeFal()


@pytest.fixture
def client(tmp_path, fal):
    return TestClient(create_app(tmp_path, lambda: fal), headers=HEADERS)


def _create(client, data=None):
    """n1 圖片輸入 → n2 改部位, 以上游建立作品"""
    assert client.post("/api/flows", json={"name": "流程"}).status_code == 200
    graph = {"nodes": [{"id": "n1", "type": "input", "x": 0, "y": 0, "params": {}},
                       {"id": "n2", "type": "workshop", "x": 0, "y": 0, "params": {}}],
             "links": [{"from": "n1", "to": "n2"}]}
    assert client.put("/api/flows/流程/graph", json=graph).status_code == 200
    r = client.post("/api/flows/流程/nodes/n1/output", files={"file": ("角色.png", data or _png(_source()), "image/png")})
    assert r.status_code == 200, r.text
    r = client.post(f"{W}/init")
    assert r.status_code == 200, r.text
    return r.json()


def _layout(meta, **changes):
    parts = []
    for p in meta["parts"]:
        e = {"id": p["id"], "placed": p["placed"], "place": p["place"], "transform": dict(p["transform"])}
        if p["id"] in changes:
            for k, v in changes[p["id"]].items():
                if k in ("placed", "place"):
                    e[k] = v
                else:
                    e["transform"][k] = v
        parts.append(e)
    return {"parts": parts, "pad": meta["pad"]}


def test_create_from_upstream(client):
    meta = _create(client)
    assert meta["images"][0] == {"id": "main", "name": "上游 第 1 版", "w": 80, "h": 60}


def test_segment_parts_and_missing(client, fal):
    _create(client)
    r = client.post(f"{W}/parts", json={"image": "main", "names": ["頭、翅膀", "燈室"]})
    body = r.json()
    assert r.status_code == 200 and body["missing"] == ["燈室"]
    names = [p["name"] for p in body["meta"]["parts"]]
    assert names == ["頭", "翅膀"]
    assert [c[0] for c in fal.segment_calls] == ["head", "wing", "燈室"]
    assert client.get(f"{W}/files/masks/p2.png").status_code == 200
    assert client.post(f"{W}/parts", json={"names": []}).status_code == 400


def test_refine_split_delete(client, fal):
    _create(client)
    client.post(f"{W}/parts", json={"names": ["頭", "翅膀"]})
    add = {"x": 45, "y": 45, "label": 1}
    r = client.post(f"{W}/parts/p1/refine", json={"points": [add], "box": None})
    assert r.status_code == 200 and r.json()["parts"][0]["bbox"] == [20, 5, 49, 49]   # 頭 ∪ 點到的物件
    assert fal.segment_calls[-1][0] == ""                                              # 點選不帶名稱
    remove = {"x": 44, "y": 44, "label": 0}
    r = client.post(f"{W}/parts/p1/refine", json={"points": [add, remove], "box": None})
    assert r.json()["parts"][0]["bbox"] == [20, 5, 39, 19] and len(r.json()["parts"][0]["points"]) == 2
    assert client.post(f"{W}/parts/p1/refine", json={"points": [add, remove], "box": None}).status_code == 400
    assert client.post(f"{W}/parts/p1/refine", json={"points": [{"x": 999, "y": 0, "label": 1}]}).status_code == 400
    r = client.post(f"{W}/parts/p2/split")
    names = [p["name"] for p in r.json()["parts"]]
    assert names == ["頭", "翅膀(左)", "翅膀(右)"]
    assert client.post(f"{W}/parts/p1/split").status_code == 400  # 頭只有一塊
    assert client.delete(f"{W}/parts/p3").status_code == 200
    assert client.delete(f"{W}/parts/p3").status_code == 404


def test_refine_falls_back_to_position_only(client, fal):
    _create(client)
    client.post(f"{W}/parts", json={"names": ["頭"]})
    original = fal.segment
    # 模擬名稱這次認不得: 帶名稱的呼叫回空, 只靠位置的呼叫才有結果
    fal.segment = lambda img, prompt, points, boxes: [] if prompt else original(img, prompt, points, boxes)
    r = client.post(f"{W}/parts/p1/refine", json={"box": {"x_min": 35, "y_min": 35, "x_max": 55, "y_max": 55}})
    assert r.status_code == 200, r.text
    p = r.json()["parts"][0]
    assert p["bbox"] == [40, 40, 49, 49] and p["box"] == {"x_min": 35, "y_min": 35, "x_max": 55, "y_max": 55}
    # 沒有點也沒有框時不走退路
    fal.segment_calls.clear()
    fal.segment = original
    assert client.post(f"{W}/parts", json={"names": ["燈室"]}).json()["missing"] == ["燈室"]
    assert [c[0] for c in fal.segment_calls] == ["燈室"]


def test_add_part_by_box(client, fal):
    _create(client)
    box = {"x_min": 35, "y_min": 35, "x_max": 55, "y_max": 55}
    r = client.post(f"{W}/parts", json={"names": ["燈室"], "box": box})
    assert r.status_code == 200 and r.json()["missing"] == []
    p = r.json()["meta"]["parts"][0]
    assert p["name"] == "燈室" and p["bbox"] == [40, 40, 49, 49] and p["box"] == box
    assert [c[0] for c in fal.segment_calls] == ["燈室", ""]
    r = client.post(f"{W}/parts", json={"names": ["頭", "手"], "box": box})
    assert r.status_code == 400


def test_refine_empty_keeps_previous(client, fal, tmp_path):
    _create(client)
    client.post(f"{W}/parts", json={"names": ["頭"]})
    fal.segment = lambda img, prompt, points, boxes: []
    r = client.post(f"{W}/parts/p1/refine", json={"points": [{"x": 1, "y": 1, "label": 0}]})
    assert r.status_code == 400 and "保留上一版" in r.json()["detail"]
    assert client.get(f"{W}").json()["parts"][0]["bbox"] == [20, 5, 39, 19]


def test_layout_and_validation(client):
    meta = _create(client)
    client.post(f"{W}/parts", json={"names": ["頭"]})
    meta = client.get(f"{W}").json()
    body = _layout(meta, p1={"scaleX": 1.5, "scaleY": 1.5})
    body["pad"] = {"top": 10, "right": 0, "bottom": 0, "left": 0}
    r = client.put(f"{W}/layout", json=body)
    assert r.status_code == 200 and r.json()["parts"][0]["transform"]["scaleX"] == 1.5
    bad = _layout(r.json(), p1={"scaleX": 0})
    assert client.put(f"{W}/layout", json=bad).status_code == 400


def _png_rgba(img):
    return cv2.imencode(".png", cv2.cvtColor(img, cv2.COLOR_RGBA2BGRA))[1].tobytes()


def _generate(client, w=80, h=60, region_rect=(10, 10, 30, 30), options=None, alpha_hole=True):
    col = np.zeros((h, w, 4), np.uint8)
    col[..., :3] = 200
    col[..., 3] = 255
    if alpha_hole:
        col[40:50, 40:50, 3] = 0
    reg = np.zeros((h, w), np.uint8)
    if region_rect:
        x0, y0, x1, y1 = region_rect
        reg[y0:y1, x0:x1] = 255
    opts = options or {"model": "nano-banana", "count": 2, "extra": "", "paste": True}
    return client.post(f"{W}/generate",
                       files={"collage": ("c.png", _png(col), "image/png"), "region": ("r.png", _png(reg), "image/png")},
                       data={"options": json.dumps(opts)})


def test_generate_success(client, fal):
    _create(client)
    r = _generate(client)
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["results"]) == 2 and body["errors"] == []
    assert fal.edit_calls[0][0] == "nano-banana" and fal.edit_calls[0][3] == 2
    assert "another illustration" not in fal.edit_calls[0][2]
    img = cv2.imdecode(np.frombuffer(client.get(f"{W}/files/results/r1.png").content, np.uint8), cv2.IMREAD_COLOR)
    assert img.shape == (60, 80, 3) and (img[20, 20] == 9).all() and (img[55, 5] == 200).all()
    snap = client.get(f"{W}/files/results/r1.json").json()
    assert snap["model"] == "nano-banana" and "prompt" in snap


def test_generate_foreign_prompt_and_pad(client, fal):
    _create(client)
    client.post(f"{W}/images", files={"file": ("怪物.png", _png(_source()), "image/png")})
    client.post(f"{W}/parts", json={"image": "s1", "names": ["頭"]})
    meta = client.get(f"{W}").json()
    body = _layout(meta, p1={"placed": True, "place": {"scale": 1, "tx": 0, "ty": 0}})
    body["pad"] = {"top": 10, "right": 0, "bottom": 0, "left": 5}
    assert client.put(f"{W}/layout", json=body).status_code == 200
    assert _generate(client).status_code == 400                      # 尺寸沒算進 pad
    r = _generate(client, w=85, h=70, options={"model": "qwen", "count": 1, "extra": "接縫畫成毛皮"})
    assert r.status_code == 200, r.text
    prompt = fal.edit_calls[-1][2]
    assert "another illustration" in prompt and prompt.endswith("接縫畫成毛皮")


def test_generate_partial_and_total_failure(client, fal):
    _create(client)
    fal.returned = 1
    r = _generate(client, options={"model": "nano-banana", "count": 3, "extra": ""})
    assert r.status_code == 200 and len(r.json()["results"]) == 1 and r.json()["errors"]
    fal.fail = True
    r = _generate(client)
    assert r.status_code == 502 and "模擬失敗" in r.json()["detail"]


@pytest.mark.parametrize("opts", [
    {"model": "kontext", "count": 1}, {"model": "qwen", "count": 0}, {"model": "qwen", "count": 5},
    {"model": "qwen", "count": True}, {"model": "qwen", "count": 1, "extra": "x" * 501},
])
def test_generate_rejects_bad_options(client, opts):
    _create(client)
    assert _generate(client, options=opts).status_code == 400


def test_generate_empty_region(client):
    _create(client)
    r = _generate(client, region_rect=None, alpha_hole=False)
    assert r.status_code == 400 and "沒有任何改動" in r.json()["detail"]


def test_generate_only_region_goes_to_ai(client):
    _create(client)
    r = _generate(client, region_rect=None)  # 只有透明處(40~50), 沒有改動範圍 → 不需要生成
    assert r.status_code == 400 and "沒有任何改動" in r.json()["detail"]
    r = _generate(client)  # 透明處在改動範圍外: 鋪背景色, 不用 AI 的
    assert r.status_code == 200
    img = cv2.imdecode(np.frombuffer(client.get(f"{W}/files/results/r1.png").content, np.uint8), cv2.IMREAD_COLOR)
    assert (img[20, 20] == 9).all() and not (img[45, 45] == 9).all()


def test_main_keeps_alpha_and_ai_gets_white(client, fal):
    rgba = np.zeros((60, 80, 4), np.uint8)
    rgba[10:50, 20:60] = (40, 60, 200, 255)
    rgba[20:25, 30:35, 3] = 0  # 主體內的透明洞; 四周透明會被裁掉
    _create(client, _png_rgba(rgba))
    main = cv2.imdecode(np.frombuffer(client.get(f"{W}/files/images/main.png").content, np.uint8), cv2.IMREAD_UNCHANGED)
    assert main.shape == (40, 40, 4) and main[12, 12, 3] == 0 and main[0, 0, 3] == 255
    client.post(f"{W}/parts", json={"names": ["頭"]})
    assert fal.segment_calls[-1][0] == "head"
    # 主圖是圖層 0, 新部位疊在上面
    meta = client.get(f"{W}").json()
    assert all(p["transform"]["z"] >= 1 for p in meta["parts"])


def test_no_client(tmp_path):
    c = TestClient(create_app(tmp_path, lambda: None), headers=HEADERS)
    _create(c)
    assert c.post(f"{W}/parts", json={"names": ["頭"]}).status_code == 503


def test_file_access_rejects_traversal(client):
    _create(client)
    assert client.get(f"{W}/files/images/main.png").status_code == 200
    assert client.get(f"{W}/files/..%2F/meta.json").status_code == 404


# ---- AI 列部位 ----
def test_suggest_parts_records_aliases(client, fal):
    _create(client)
    r = client.post(f"{W}/suggest-parts", json={"image": "main"})
    assert r.status_code == 200, r.text
    assert r.json()["parts"] == [{"name": "頭", "en": "head"}, {"name": "燈室", "en": "lantern room"}]
    assert r.json()["meta"]["aliases"] == {"燈室": "lantern room"}  # 內建對照表有的不記
    client.post(f"{W}/parts", json={"image": "main", "names": ["燈室"]})
    assert fal.segment_calls[-1][0] == "lantern room"


def test_suggest_parts_bad_reply(client, fal):
    _create(client)
    fal.vision_reply = "抱歉我看不出來"
    r = client.post(f"{W}/suggest-parts", json={"image": "main"})
    assert r.status_code == 400 and "AI 沒有列出部位" in r.json()["detail"]
    assert client.post(f"{W}/suggest-parts", json={"image": "s9"}).status_code == 404


# ---- 材質 ----
def _with_head(client):
    _create(client)
    return client.post(f"{W}/parts", json={"image": "main", "names": ["頭"]}).json()["meta"]


def test_material_variants_api(client, fal):
    _with_head(client)
    src = cv2.imdecode(np.frombuffer(client.get(f"{W}/files/images/main.png").content, np.uint8), 1)
    r = client.post(f"{W}/parts/p1/materials", data={"material": "生鏽金屬", "count": "2"})
    assert r.status_code == 200, r.text
    part = r.json()["meta"]["parts"][0]
    assert [v["id"] for v in part["material"]["variants"]] == ["m1", "m2"] and part["material"]["current"] == "m1"
    assert "rust" not in fal.edit_calls[-1][2] and "生鏽金屬" in fal.edit_calls[-1][2] and "head" in fal.edit_calls[-1][2]
    # 只送部位外框 + 邊距的裁切
    h, w = src.shape[:2]
    assert fal.edit_calls[-1][1][0] < h and fal.edit_calls[-1][1][1] < w
    out = cv2.imdecode(np.frombuffer(client.get(f"{W}/files/materials/m1.png").content, np.uint8), 1)
    assert out.shape == src.shape
    assert (out[45:] == src[45:]).all()  # 部位(5~20 列)遠處完全不動
    assert (out[10, 30] == 9).all()        # 部位內換成 AI 結果
    r = client.put(f"{W}/parts/p1/material", json={"variant": "m2"})
    assert r.json()["parts"][0]["material"]["current"] == "m2"
    r = client.delete(f"{W}/parts/p1/materials/m2")
    assert r.json()["parts"][0]["material"]["current"] is None
    assert client.put(f"{W}/parts/p1/material", json={"variant": "m9"}).status_code == 404


def test_material_reference_and_short_count(client, fal):
    _with_head(client)
    fal.returned = 1
    r = client.post(f"{W}/parts/p1/materials", data={"material": "木頭", "count": "3"},
                    files={"reference": ("wood.png", _png(np.full((8, 8, 3), 77, np.uint8)), "image/png")})
    assert r.status_code == 200, r.text
    assert len(fal.edit_extra) == 1 and "second image" in fal.edit_calls[-1][2]
    assert r.json()["errors"] and len(r.json()["meta"]["parts"][0]["material"]["variants"]) == 1
    assert r.json()["meta"]["parts"][0]["material"]["variants"][0]["ref"] is True


@pytest.mark.parametrize("data", [{"material": " ", "count": "1"}, {"material": "x" * 201, "count": "1"},
                                  {"material": "金屬", "count": "5"}, {"material": "金屬", "count": "a"}])
def test_material_validation(client, fal, data):
    _with_head(client)
    assert client.post(f"{W}/parts/p1/materials", data=data).status_code == 400
    assert fal.edit_calls == []


def test_material_bad_reference(client, fal):
    _with_head(client)
    r = client.post(f"{W}/parts/p1/materials", data={"material": "金屬", "count": "1"},
                    files={"reference": ("x.png", b"not image", "image/png")})
    assert r.status_code == 400


def test_material_fal_error_keeps_part(client, fal):
    _with_head(client)
    fal.fail = True
    r = client.post(f"{W}/parts/p1/materials", data={"material": "金屬", "count": "1"})
    assert r.status_code >= 400
    assert client.get(f"{W}").json()["parts"][0].get("material", {"variants": []})["variants"] == []


def test_split_inherits_materials(client, fal):
    _create(client)
    client.post(f"{W}/parts", json={"image": "main", "names": ["翅膀"]})
    client.post(f"{W}/parts/p1/materials", data={"material": "羽毛", "count": "1"})
    meta = client.post(f"{W}/parts/p1/split").json()
    left, right = meta["parts"]
    assert left["material"]["current"] == "m1" and right["material"]["current"] == "m2"
    assert client.get(f"{W}/files/materials/m2.png").status_code == 200


def test_undo_mask(client, fal, tmp_path):
    _create(client)
    client.post(f"{W}/parts", json={"names": ["頭"]})
    assert client.post(f"{W}/parts/p1/undo-mask").status_code == 400  # 還沒改過
    first = client.get(f"{W}").json()["parts"][0]
    add = {"x": 45, "y": 45, "label": 1}
    client.post(f"{W}/parts/p1/refine", json={"points": [add], "box": None})
    client.post(f"{W}/parts/p1/refine", json={"points": [add, {"x": 44, "y": 44, "label": 0}], "box": None})
    meta = client.post(f"{W}/parts/p1/undo-mask").json()
    assert meta["parts"][0]["bbox"] == [20, 5, 49, 49] and len(meta["parts"][0]["points"]) == 1
    meta = client.post(f"{W}/parts/p1/undo-mask").json()
    p = meta["parts"][0]
    assert p["bbox"] == first["bbox"] and p["points"] == [] and p["history"] == []
    masks = tmp_path / "flows" / "流程" / "nodes" / "n2" / "masks"
    assert sorted(f.name for f in masks.iterdir()) == ["p1.png"]  # 歷史檔用完就刪
    client.post(f"{W}/parts/p1/refine", json={"points": [add], "box": None})
    client.delete(f"{W}/parts/p1")
    assert list(masks.iterdir()) == []


def test_undo_split_merges_back(client, fal):
    _create(client)
    client.post(f"{W}/parts", json={"names": ["翅膀"]})
    before = client.get(f"{W}").json()["parts"][0]
    meta = client.post(f"{W}/parts/p1/split").json()
    assert [p["name"] for p in meta["parts"]] == ["翅膀(左)", "翅膀(右)"]
    meta = client.post(f"{W}/parts/p1/undo-mask").json()
    assert [p["name"] for p in meta["parts"]] == ["翅膀"]
    assert meta["parts"][0]["bbox"] == before["bbox"]


def test_generate_saves_raw_ai_and_gpt_letterbox(client, fal):
    _create(client)
    r = _generate(client, options={"model": "gpt-image-2", "count": 1, "extra": "", "paste": True})
    assert r.status_code == 200, r.text
    assert fal.edit_calls[-1][1][:2] in ((60, 90), (80, 80), (120, 80))  # 80x60 補成接近的比例才送
    rid = r.json()["results"][0]["id"]
    raw = client.get(f"{W}/files/results/{rid}_ai.png")
    assert raw.status_code == 200
    assert cv2.imdecode(np.frombuffer(raw.content, np.uint8), cv2.IMREAD_COLOR).shape == (60, 80, 3)
    assert client.get(f"{W}").json()["results"][0]["raw"] is True


def test_generate_whole_ai_by_default(client, fal):
    _create(client)
    r = _generate(client, options={"model": "nano-banana", "count": 1, "extra": ""})
    assert r.status_code == 200, r.text
    img = cv2.imdecode(np.frombuffer(client.get(f"{W}/files/results/r1.png").content, np.uint8), cv2.IMREAD_COLOR)
    assert img.shape == (60, 80, 3) and (img == 9).all()  # 整張都是 AI 的, 範圍外也是
    assert not client.get(f"{W}").json()["results"][0].get("raw")
    assert _generate(client, options={"model": "nano-banana", "count": 1, "extra": "", "paste": "y"}).status_code == 400
