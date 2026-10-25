"""遊戲示意的畫面架構幾何: 輸出尺寸、世界與鏡頭輸出框、斜角俯瞰格點、地面格位置、物件外框與前後深度。

物件存在世界座標裡; 鏡頭段數決定倍率 s(一個世界單位 = s 個輸出像素), 輸出框以世界中心為中心。
一般場景的世界單位 = 標準鏡頭下的輸出像素(舊場景座標不用轉換); 像素場景的世界單位 = 遊戲像素。
"""

VIEWS = ("side", "vertical", "topdown", "iso", "flat")
LEVELS = ("xfar", "far", "std", "near", "xnear")

_SCALE_NORMAL = {"xfar": 0.5, "far": 0.7, "std": 1, "near": 1.4, "xnear": 2}
_SCALE_PIXEL = {"xfar": 2, "far": 4, "std": 5, "near": 8, "xnear": 10}

# 斜角俯瞰: (格寬, 格高, 格點 (0,0) 的世界座標); 一般場景沿用舊原點, 新的 20×20 格從 i, j = -5 開始
_ISO = {False: (96, 48, 640, 120), True: (32, 16, 320, 20)}
ISO_N = 20
ISO_OFFSET = {False: 5, True: 0}

TILE = {False: 64, True: 16}
# 俯瞰地面格起點(世界座標): 一般場景讓舊的 20×12 格落在原位(上方超出世界 24, 不顯示)
_TOPDOWN_ORIGIN = {False: (-640, -384), True: (0, 0)}


def canvas_size(view: str) -> tuple[int, int]:
    """輸出圖 (寬, 高)"""
    if view not in VIEWS:
        raise ValueError(f"未知的畫面架構: {view!r}")
    return (720, 1280) if view == "vertical" else (1280, 720)


def scale(pixel: bool, camera: str) -> float:
    table = _SCALE_PIXEL if pixel else _SCALE_NORMAL
    if camera not in table:
        raise ValueError(f"未知的鏡頭: {camera!r}")
    return table[camera]


def world_rect(view: str, pixel: bool) -> tuple[float, float, float, float]:
    w, h = canvas_size(view)
    if pixel:
        return (0, 0, w / 2, h / 2)
    if view == "flat":
        return (0, 0, w, h)
    return (-w / 2, -h / 2, w * 1.5, h * 1.5)


def frame_rect(view: str, pixel: bool, camera: str) -> tuple[float, float, float, float]:
    """鏡頭的輸出框(世界座標)。"""
    x0, y0, x1, y1 = world_rect(view, pixel)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    w, h = canvas_size(view)
    s = scale(pixel, camera)
    hw, hh = w / s / 2, h / s / 2
    return (cx - hw, cy - hh, cx + hw, cy + hh)


def to_screen(view: str, pixel: bool, camera: str, x: float, y: float) -> tuple[float, float]:
    """世界座標 → 輸出像素。"""
    fx, fy, _, _ = frame_rect(view, pixel, camera)
    s = scale(pixel, camera)
    return ((x - fx) * s, (y - fy) * s)


def iso_point(i: float, j: float, z: float = 0, pixel: bool = False) -> tuple[float, float]:
    """斜角俯瞰格座標(i, j)、離地高度 z → 世界座標。"""
    tw, th, ox, oy = _ISO[pixel]
    return (ox + (i - j) * tw / 2, oy + (i + j) * th / 2 - z)


def object_bbox(view: str, obj: dict, pixel: bool = False) -> tuple[float, float, float, float]:
    """物件的外框 (x0, y0, x1, y1), 世界座標; 斜角方塊含頂面與側面。"""
    if obj["kind"] == "block":
        i, j, w, l, h = obj["i"], obj["j"], obj["w"], obj["l"], obj["h"]
        pts = [iso_point(a, b, z, pixel) for a, b in ((i, j), (i + w, j), (i + w, j + l), (i, j + l)) for z in (0, h)]
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        return (min(xs), min(ys), max(xs), max(ys))
    return (obj["x"], obj["y"], obj["x"] + obj["w"], obj["y"] + obj["h"])


def iso_depth(obj: dict, pixel: bool = False) -> float:
    """斜角俯瞰前後: 腳底越下面越前面。方塊取前下角, 素材取底邊。"""
    if obj["kind"] == "block":
        return iso_point(obj["i"] + obj["w"], obj["j"] + obj["l"], 0, pixel)[1]
    return obj["y"] + obj["h"]


def ground_size(view: str, pixel: bool) -> tuple[int, int] | None:
    """俯瞰、斜角的固定地面格大小 (行, 列); 其他架構沒有固定大小。"""
    if view == "topdown":
        return (40, 23) if pixel else (40, 24)
    if view == "iso":
        return (ISO_N, ISO_N)
    return None


def ground_spec(view: str, ground: dict | None, pixel: bool = False) -> dict | None:
    """地面格的位置: 方格回 tile/cols/rows/ox/oy(世界座標), 斜角回 iso/cols/rows/offset(格索引 c → i = c - offset)。"""
    if ground is None:
        return None
    cols, rows = ground["cols"], ground["rows"]
    if view == "iso":
        return {"iso": True, "cols": cols, "rows": rows, "offset": ISO_OFFSET[pixel]}
    tile = TILE[pixel]
    if view == "topdown":
        ox, oy = _TOPDOWN_ORIGIN[pixel]
        return {"tile": tile, "cols": cols, "rows": rows, "ox": ox, "oy": oy}
    x0, y0, x1, y1 = world_rect(view, pixel)
    return {"tile": tile, "cols": cols, "rows": rows,
            "ox": (x0 + x1 - cols * tile) / 2, "oy": (y0 + y1 - rows * tile) / 2}
