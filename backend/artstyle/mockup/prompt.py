"""組出送 GPT Image 2 的英文指令(骨架見規格附錄, 加上實驗後補的背景、斜角小角色、參考圖句)。"""
from .geometry import canvas_size, object_bbox
from .presets import DEFAULT_BOX_COLOR, TERRAINS


def position_word(bbox, w: float, h: float) -> str:
    """外框中心落在畫面九宮格的哪一格。"""
    cx, cy = (bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2
    v = ("top", "middle", "bottom")[min(2, int(cy / h * 3))]
    hz = ("left", "center", "right")[min(2, int(cx / w * 3))]
    return "center" if (v, hz) == ("middle", "center") else f"{v}-{hz}"


def _style_phrase(scene: dict, has_assets: bool) -> str | None:
    st = scene["style"]
    if st["text"].strip():
        return st["text"].strip()
    if st["refs"]:
        return "the art style of the reference images"
    if has_assets:
        return "the same style as the finished elements"
    return None


def _terrains(scene: dict) -> list[dict]:
    g = scene.get("ground")
    if not g:
        return []
    used = {c for c in g["cells"] if c}
    return [t for t in TERRAINS + g.get("custom", []) if t["label"] in used]


def build_prompt(scene: dict) -> str:
    view = scene["view"]
    w, h = canvas_size(view)
    game = " ".join(["2D", scene["style"]["genre"].strip(), "game"]).replace("  ", " ")
    objs = scene["objects"]
    assets = [o for o in objs if o["kind"] == "asset"]
    boxes = [o for o in objs if o["kind"] != "asset"]
    style = _style_phrase(scene, bool(assets))

    lines = []
    if assets:
        lines.append(f"This is a {game} screen mockup. Some elements are already finished art: "
                     "keep them exactly as they are.")
        names = ", ".join(f'"{a["name"]}"' for a in assets)
        lines.append(f"Already finished elements: {names}.")
        draw_in = f"drawn in exactly {style}" if style.startswith("the ") else f"drawn in exactly the same {style} style"
        lines.append("Every flat grey/colored labeled block is a placeholder for the object named in its label: "
                     f"replace each with a real, detailed version of that object {draw_in}, matching the palette, "
                     "outline and level of detail of the finished elements, so the whole screen looks like one "
                     "consistent game.")
    else:
        lines.append(f"This is a greybox layout mockup of a {game} screen. "
                     + (f"Repaint it as a polished, finished in-game screenshot in {style}"
                        + ("" if style.startswith("the ") else " style") + "." if style
                        else "Repaint it as a polished, finished in-game screenshot."))
        lines.append("Each block is a placeholder for the object named in its label: replace it with a real, "
                     "detailed version of that object.")
    lines.append("Keep the exact composition, camera angle, and the position and size of every element.")
    if boxes:
        lines.append("Placeholders:")
        for o in boxes:
            color = "grey" if o["color"].lower() == DEFAULT_BOX_COLOR else o["color"]
            lines.append(f'- "{o["label"]}" ({color} block, {position_word(object_bbox(view, o), w, h)})')
    terrains = _terrains(scene)
    if terrains:
        tiles = ", ".join(f'"{t["label"]}" ({t["color"]})' for t in terrains)
        lines.append(f"Ground tiles: {tiles}.")
    bg = scene["background"]["label"]
    lines.append(f"The flat {bg} background and any ground tiles are placeholders too: paint them fully as "
                 "finished art, never leave them flat.")
    if view == "iso":
        lines.append("Small characters are tall thin blocks: keep every small character clearly visible at its position.")
    if scene["style"]["refs"]:
        lines.append("The additional images are style references only: match their art style, palette and "
                     "rendering, not their content.")
    lines.append("Do not draw any label text, UI or HUD.")
    return "\n".join(lines)
