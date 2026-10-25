from artstyle.mockup.presets import preset_scene
from artstyle.mockup.prompt import build_prompt, position_word


def scene(view, empty=False, **style):
    s = {"name": "s", "view": view, **preset_scene(view, empty)}
    s["style"].update(style)
    return s


def test_greybox_only():
    p = build_prompt(scene("side"))
    assert "greybox layout mockup of a 2D side-scrolling platformer" in p
    assert '- "主角 player" (grey block, bottom-center)' in p
    assert "The flat 天空 sky background" in p and "paint them fully" in p
    assert "Do not draw any label text, UI or HUD." in p
    assert "style references" not in p and "already finished" not in p
    assert "in-game screenshot." in p  # 沒有風格時不寫風格字樣


def test_colored_box():
    s = scene("side")
    s["objects"][-1]["color"] = "#ff0000"
    assert '- "主角 player" (#ff0000 block, bottom-center)' in build_prompt(s)


def test_with_assets():
    s = scene("side")
    s["objects"].append({"id": "o99", "kind": "asset", "asset": "a1", "name": "大樹", "x": 0, "y": 0, "w": 50,
                         "h": 50, "flip": False})
    p = build_prompt(s)
    assert "already finished" in p and '"大樹"' in p
    assert "the same style as the finished elements" in p
    assert '"大樹" (' not in p  # 素材不列在佔位物件裡


def test_refs_and_text():
    p = build_prompt(scene("side", refs=["a1"]))
    assert "The additional images are style references only" in p
    assert "the art style of the reference images" in p
    p = build_prompt(scene("side", text="水彩繪本", refs=["a1"]))
    assert "水彩繪本" in p and "the art style of the reference images" not in p


def test_genre_override():
    assert "2D vertical platformer game" in build_prompt(scene("vertical", genre="vertical platformer"))


def test_iso_sentence():
    assert "keep every small character clearly visible" in build_prompt(scene("iso"))
    assert "keep every small character clearly visible" not in build_prompt(scene("side"))


def test_ground_terrains():
    p = build_prompt(scene("topdown"))
    assert '"草地 grass" (#96b978)' in p and '"水 water" (#78a5cd)' in p and "沙地" not in p


def test_position_word():
    w, h = 1280, 720
    assert position_word((0, 0, 10, 10), w, h) == "top-left"
    assert position_word((1270, 710, 1280, 720), w, h) == "bottom-right"
    assert position_word((630, 350, 650, 370), w, h) == "center"
    assert position_word((630, 0, 650, 10), w, h) == "top-center"
    assert position_word((0, 350, 10, 370), w, h) == "middle-left"


def _scene(view, empty=False, pixel=False):
    return {"name": "s", "view": view, "pixel": pixel, "camera": "far" if pixel else "std",
            **preset_scene(view, empty, pixel)}


def _box(oid, label, x, y, w, h):
    return {"id": oid, "kind": "box", "label": label, "color": "#9a9a9a", "type": None, "x": x, "y": y, "w": w, "h": h}


def test_only_visible_objects():
    s = _scene("side", empty=True)
    s["objects"] = [_box("o1", "遠方 far", 1700, 400, 100, 100), _box("o2", "近處 near", 600, 300, 100, 100)]
    p = build_prompt(s)
    assert "遠方 far" not in p and "近處 near" in p
    s["camera"] = "xfar"
    p = build_prompt(s)
    assert '- "遠方 far" (grey block, middle-right)' in p


def test_position_uses_frame():
    s = _scene("side", empty=True, pixel=True)
    s["objects"] = [_box("o1", "主角 player", 456, 246, 16, 16)]
    assert '- "主角 player" (grey block, bottom-right)' in build_prompt(s)


def test_camera_sentences():
    s = _scene("side")
    s["camera"] = "xfar"
    assert "very far away" in build_prompt(s)
    s["camera"] = "std"
    assert "camera is" not in build_prompt(s) and "close-up" not in build_prompt(s)
    s["camera"] = "xnear"
    assert "close-up" in build_prompt(s)


def test_pixel_sentence():
    s = _scene("side", pixel=True)
    p = build_prompt(s)
    assert "native resolution of 320×180" in p and "4×4" in p and "camera is" not in p
    assert "16×16 game pixels" in build_prompt(_scene("topdown", pixel=True))
    assert "32×16" in build_prompt(_scene("iso", pixel=True))
    v = _scene("vertical", pixel=True)
    v["camera"] = "xnear"
    assert "native resolution of 72×128" in build_prompt(v) and "10×10" in build_prompt(v)
