"""遊戲示意的畫面架構幾何: 畫布尺寸、斜角俯瞰格點、物件外框與前後深度。"""

VIEWS = ("side", "vertical", "topdown", "iso", "flat")

ISO_TW, ISO_TH, ISO_N = 96, 48, 10
TILE = 64


def canvas_size(view: str) -> tuple[int, int]:
    """(寬, 高)"""
    if view not in VIEWS:
        raise ValueError(f"未知的畫面架構: {view!r}")
    return (720, 1280) if view == "vertical" else (1280, 720)


def iso_point(i: float, j: float, z: float = 0, view_w: int = 1280, view_h: int = 720) -> tuple[float, float]:
    """斜角俯瞰格座標(i, j)、離地高度 z → 畫布像素。"""
    ox, oy = view_w / 2, (view_h - ISO_N * ISO_TH) / 2
    return (ox + (i - j) * ISO_TW / 2, oy + (i + j) * ISO_TH / 2 - z)


def object_bbox(view: str, obj: dict) -> tuple[float, float, float, float]:
    """物件在畫布上的外框 (x0, y0, x1, y1); 斜角方塊含頂面與側面。"""
    if obj["kind"] == "block":
        i, j, w, l, h = obj["i"], obj["j"], obj["w"], obj["l"], obj["h"]
        pts = [iso_point(a, b, z) for a, b in ((i, j), (i + w, j), (i + w, j + l), (i, j + l)) for z in (0, h)]
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        return (min(xs), min(ys), max(xs), max(ys))
    return (obj["x"], obj["y"], obj["x"] + obj["w"], obj["y"] + obj["h"])


def iso_depth(obj: dict) -> float:
    """斜角俯瞰前後: 腳底越下面越前面。方塊取前下角, 素材取底邊。"""
    if obj["kind"] == "block":
        return iso_point(obj["i"] + obj["w"], obj["j"] + obj["l"])[1]
    return obj["y"] + obj["h"]


def ground_spec(view: str, ground: dict | None) -> dict | None:
    """地面格的位置: 方格回 tile/cols/rows/ox/oy, 斜角回 iso=True。"""
    if ground is None:
        return None
    if view == "iso":
        return {"iso": True, "cols": ISO_N, "rows": ISO_N}
    w, h = canvas_size(view)
    cols, rows = ground["cols"], ground["rows"]
    if view == "topdown":
        return {"tile": TILE, "cols": cols, "rows": rows, "ox": 0, "oy": 0}
    return {"tile": TILE, "cols": cols, "rows": rows, "ox": (w - cols * TILE) / 2, "oy": (h - rows * TILE) / 2}
