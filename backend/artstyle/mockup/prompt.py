"""組出送 GPT Image 2 的英文指令(骨架見規格附錄, 加上實驗後補的背景、斜角小角色、參考圖句、鏡頭與像素句)。"""
from .geometry import canvas_size, frame_rect, object_bbox, scale, to_screen
from .presets import DEFAULT_BOX_COLOR, TERRAINS

CAMERA_SENTENCE = {
    "xfar": "The camera is very far away: every character and object is small. "
            "Keep all of them clearly visible at their small size.",
    "far": "The camera is far away: characters and objects are fairly small.",
    "std": None,
    "near": "The camera is close: characters and objects are large and detailed.",
    "xnear": "This is a close-up view: characters and objects are very large and highly detailed.",
}


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


def _screen_bbox(view: str, pixel: bool, camera: str, obj: dict):
    x0, y0, x1, y1 = object_bbox(view, obj, pixel)
    return (*to_screen(view, pixel, camera, x0, y0), *to_screen(view, pixel, camera, x1, y1))


def _pixel_sentence(view: str, camera: str) -> str:
    w, h = canvas_size(view)
    s = int(scale(True, camera))
    line = (f"This is a pixel art game with a native resolution of {w // s}×{h // s}; every game pixel is shown "
            f"as a {s}×{s} square. Draw everything — characters, objects, background and ground — as crisp pixel "
            f"art with the same {s}×{s} pixel size, hard edges, no anti-aliasing, no blur and a limited palette.")
    if view == "topdown":
        line += " Ground tiles are 16×16 game pixels."
    elif view == "iso":
        line += " Ground tiles are 32×16 game pixel diamonds."
    return line


def build_prompt(scene: dict) -> str:
    view = scene["view"]
    pixel, camera = scene.get("pixel", False), scene.get("camera", "std")
    w, h = canvas_size(view)
    game = " ".join(["2D", scene["style"]["genre"].strip(), "game"]).replace("  ", " ")
    fx0, fy0, fx1, fy1 = frame_rect(view, pixel, camera)

    def in_frame(o):
        x0, y0, x1, y1 = object_bbox(view, o, pixel)
        return min(x1, fx1) > max(x0, fx0) and min(y1, fy1) > max(y0, fy0)

    objs = [o for o in scene["objects"] if in_frame(o)]
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
    if pixel:
        lines.append(_pixel_sentence(view, camera))
    elif CAMERA_SENTENCE[camera]:
        lines.append(CAMERA_SENTENCE[camera])
    if boxes:
        lines.append("Placeholders:")
        for o in boxes:
            color = "grey" if o["color"].lower() == DEFAULT_BOX_COLOR else o["color"]
            lines.append(f'- "{o["label"]}" ({color} block, {position_word(_screen_bbox(view, pixel, camera, o), w, h)})')
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
