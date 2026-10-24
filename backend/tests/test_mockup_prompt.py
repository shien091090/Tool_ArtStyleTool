from artstyle.mockup.presets import preset_scene
from artstyle.mockup.prompt import build_prompt, position_word


def scene(view, empty=False, **style):
    s = {"name": "s", "view": view, **preset_scene(view, empty)}
    s["style"].update(style)
    return s


def test_greybox_only():
    p = build_prompt(scene("side"))
    assert "greybox layout mockup of a 2D side-scrolling platformer" in p
    assert '- "主角 player" (grey block, bottom-left)' in p
    assert "The flat 天空 sky background" in p and "paint them fully" in p
    assert "Do not draw any label text, UI or HUD." in p
    assert "style references" not in p and "already finished" not in p
    assert "in-game screenshot." in p  # 沒有風格時不寫風格字樣


def test_colored_box():
    s = scene("side")
    s["objects"][-1]["color"] = "#ff0000"
    assert '- "主角 player" (#ff0000 block, bottom-left)' in build_prompt(s)


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
