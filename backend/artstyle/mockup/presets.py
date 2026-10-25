"""五種畫面架構 × 一般/像素的預設: 背景、地面格、灰盒擺設、遊戲類型描述(參照 2026-10-24 實驗的灰盒草稿, 不含 HUD)。

擺設鋪滿整個世界(超遠鏡頭看得到的範圍), 五段鏡頭共用; 主角放在世界中心附近, 超近鏡頭也看得到。
一般場景的標準鏡頭畫面接近改版前的預設; 像素場景以遊戲像素擺, 主角 16×16、地形以 16 為單位。
"""
from .geometry import ground_size

TERRAINS = [
    {"label": "草地 grass", "color": "#96b978"},
    {"label": "水 water", "color": "#78a5cd"},
    {"label": "道路 road", "color": "#b9aa8c"},
    {"label": "沙地 sand", "color": "#e0cc95"},
    {"label": "石地 stone", "color": "#9b9b9b"},
    {"label": "牆 wall", "color": "#6e6258"},
]

DEFAULT_BG = {
    "side": {"label": "天空 sky", "color": "#cddeeb"},
    "vertical": {"label": "天空 sky", "color": "#cddeeb"},
    "topdown": {"label": "草地 grass", "color": "#96b978"},
    "iso": {"label": "虛空 void", "color": "#3c463c"},
    "flat": {"label": "桌面 table", "color": "#8b6a4a"},
}

GENRE = {
    "side": "side-scrolling platformer",
    "vertical": "vertical-scrolling shooter",
    "topdown": "top-down adventure",
    "iso": "isometric strategy / simulation",
    "flat": "card / board game",
}

DEFAULT_BOX_COLOR = "#9a9a9a"
DEFAULT_COLORS = 32

GRASS, WATER, ROAD = (t["label"] for t in TERRAINS[:3])

MOUNTAINS, CLOUD, GROUND, PLATFORM = "遠景山 far mountains", "雲 cloud", "地面 ground", "平台 platform"
TREE, OBSTACLE, COINS, ENEMY, PLAYER = "樹 tree", "障礙 obstacle", "金幣 coins", "敵人 enemy", "主角 player"
ISLAND, PLANE, BULLETS, SHIP, POWER = "島嶼 island", "敵機 enemy plane", "子彈 bullets", "主角戰機 player ship", "道具 power-up"
HOUSE, CHEST, WORKSHOP, RESOURCE, VILLAGER = "房子 house", "寶箱 chest", "工坊 workshop", "資源 resource", "村民 villager"

# ---- 一般場景: (標籤, 類型, x, y, w, h), 世界 (-640,-360)~(1920,1080), 標準鏡頭框 (0,0)~(1280,720) ----

_SIDE = [
    (MOUNTAINS, "背景", -640, 300, 2560, 260),
    *[(CLOUD, "景物", x, y, 160, 60) for x, y in ((-500, 60), (-150, -200), (300, -250), (900, -280), (1250, -150),
                                                  (150, 120), (760, 90), (1600, 100))],
    (GROUND, "地形", -640, 592, 520, 488),
    (GROUND, "地形", 0, 592, 640, 488),
    (GROUND, "地形", 768, 592, 640, 488),
    (GROUND, "地形", 1536, 592, 384, 488),
    (PLATFORM, "地形", 420, 400, 192, 32),
    (PLATFORM, "地形", 820, 330, 256, 32),
    (PLATFORM, "地形", -420, 420, 192, 32),
    (PLATFORM, "地形", -250, 250, 160, 32),
    (PLATFORM, "地形", 1450, 420, 224, 32),
    (PLATFORM, "地形", 1700, 260, 192, 32),
    (TREE, "景物", 990, 372, 124, 220),
    (TREE, "景物", -560, 372, 124, 220),
    (TREE, "景物", 1780, 372, 124, 220),
    (OBSTACLE, "景物", 300, 482, 80, 110),
    (OBSTACLE, "景物", 1250, 482, 80, 110),
    (COINS, "道具", 440, 350, 180, 28),
    (COINS, "道具", -400, 370, 160, 28),
    (COINS, "道具", 1460, 370, 180, 28),
    (ENEMY, "敵人", 420, 536, 60, 56),
    (ENEMY, "敵人", 840, 274, 60, 56),
    (ENEMY, "敵人", -300, 536, 60, 56),
    (ENEMY, "敵人", 1100, 536, 60, 56),
    (ENEMY, "敵人", 1720, 204, 60, 56),
    (ENEMY, "敵人", -230, 194, 60, 56),
    (PLAYER, "角色", 570, 496, 56, 96),
]

# 世界 (-360,-640)~(1080,1920), 標準鏡頭框 (0,0)~(720,1280)
_VERTICAL = [
    (ISLAND, "地形", 60, 300, 220, 160),
    (ISLAND, "地形", 460, 700, 200, 180),
    (ISLAND, "地形", -300, 200, 220, 160),
    (ISLAND, "地形", 780, 1100, 220, 160),
    (ISLAND, "地形", -320, 1500, 200, 160),
    (ISLAND, "地形", 450, 1650, 220, 180),
    (CLOUD, "景物", 380, 160, 200, 70),
    (CLOUD, "景物", 80, 900, 180, 60),
    (CLOUD, "景物", 820, 400, 200, 70),
    (CLOUD, "景物", -280, 900, 180, 60),
    (CLOUD, "景物", 100, 1400, 200, 70),
    (CLOUD, "景物", 800, 1700, 180, 60),
    *[(PLANE, "敵人", x, y, 80, 80) for x, y in ((140, 180), (320, 120), (500, 240), (-250, -400), (100, -300),
                                                 (450, -500), (800, -350))],
    (POWER, "道具", 600, 1350, 48, 48),
    (BULLETS, "道具", 350, 560, 20, 220),
    (SHIP, "角色", 310, 800, 100, 110),
]

# 地面 40×24 從 (-640,-384) 鋪起; 舊預設的 20×12 在第 10 行、第 6 列起
_TOPDOWN = [
    (HOUSE, "建築", 832, 64, 192, 160),
    (TREE, "景物", 128, 64, 64, 64),
    (TREE, "景物", 1088, 256, 64, 64),
    (TREE, "景物", 640, 512, 64, 64),
    (CHEST, "道具", 960, 512, 64, 64),
    (ENEMY, "敵人", 320, 192, 64, 64),
    (ENEMY, "敵人", 1152, 576, 64, 64),
    (HOUSE, "建築", -512, -256, 192, 160),
    (HOUSE, "建築", 1536, -256, 192, 160),
    (HOUSE, "建築", 1408, 832, 192, 160),
    *[(TREE, "景物", x, y, 64, 64) for x, y in ((-576, 64), (-192, -320), (1216, -320), (1728, 320), (1792, 960),
                                                (256, 896))],
    *[(ENEMY, "敵人", x, y, 64, 64) for x, y in ((-320, 320), (1600, 576), (896, 960), (128, -256))],
    (CHEST, "道具", -128, 384, 64, 64),
    (CHEST, "道具", 1792, -128, 64, 64),
    (PLAYER, "角色", 576, 320, 64, 64),
]

_FLAT = [
    ("對手頭像 opponent", "角色", 40, 40, 120, 120),
    *[("卡牌背面 card back", "道具", x, 20, 90, 120) for x in (370, 480, 590, 700, 810)],
    *[("場上卡牌 card", "道具", x, 200, 110, 150) for x in (440, 585, 730)],
    *[("場上卡牌 card", "道具", x, 380, 110, 150) for x in (440, 585, 730)],
    ("牌堆 deck", "道具", 1120, 200, 110, 150),
    ("牌堆 deck", "道具", 1120, 380, 110, 150),
    *[("手牌 card", "道具", x, 570, 100, 140) for x in (365, 480, 595, 710, 825)],
    ("我方頭像 player", "角色", 40, 560, 120, 120),
]

# (標籤, 類型, i, j, 寬, 深, 高); 格座標 -8~18, 舊預設的 10×10 是 0~10
_ISO = [
    (HOUSE, "建築", 1, 1, 2, 2, 90),
    (WORKSHOP, "建築", 7, 1, 2, 3, 130),
    (TREE, "景物", 2, 5, 1, 1, 60),
    (TREE, "景物", 8, 6, 1, 1, 60),
    (RESOURCE, "道具", 6, 6, 1, 1, 40),
    (PLAYER, "角色", 4.3, 5.3, 0.4, 0.4, 56),
    (VILLAGER, "角色", 5.3, 2.3, 0.4, 0.4, 50),
    (VILLAGER, "角色", 3.3, 3.3, 0.4, 0.4, 50),
    (HOUSE, "建築", -7, -6, 2, 2, 90),
    (HOUSE, "建築", 15, -1, 2, 2, 90),
    (HOUSE, "建築", 13, 14, 2, 2, 90),
    (WORKSHOP, "建築", 11, -7, 2, 3, 130),
    *[(TREE, "景物", i, j, 1, 1, 60) for i, j in ((-8, 6), (-5, -4), (17, 3), (16, 16), (12, 16), (6, -7), (-2, -8))],
    (RESOURCE, "道具", 15, 12, 1, 1, 40),
    (RESOURCE, "道具", -6, -1, 1, 1, 40),
    (VILLAGER, "角色", 14.3, 13.3, 0.4, 0.4, 50),
    (VILLAGER, "角色", -3.7, -3.3, 0.4, 0.4, 50),
    (VILLAGER, "角色", 16.3, 2.3, 0.4, 0.4, 50),
]

# ---- 像素場景: 世界 (0,0)~(640,360)(縱向 360×640), 遠鏡頭框 (160,90)~(480,270) ----

_PX_SIDE = [
    (MOUNTAINS, "背景", 0, 96, 640, 112),
    *[(CLOUD, "景物", x, y, 32, 16) for x, y in ((40, 24), (200, 40), (392, 16), (560, 48))],
    (GROUND, "地形", 0, 200, 224, 160),
    (GROUND, "地形", 256, 200, 192, 160),
    (GROUND, "地形", 480, 200, 160, 160),
    (PLATFORM, "地形", 96, 152, 64, 8),
    (PLATFORM, "地形", 352, 144, 64, 8),
    (PLATFORM, "地形", 528, 120, 64, 8),
    (PLATFORM, "地形", 176, 96, 48, 8),
    (TREE, "景物", 24, 152, 32, 48),
    (TREE, "景物", 584, 152, 32, 48),
    (OBSTACLE, "景物", 400, 176, 16, 24),
    (COINS, "道具", 104, 136, 48, 8),
    (COINS, "道具", 360, 128, 48, 8),
    *[(ENEMY, "敵人", x, y, 16, 16) for x, y in ((352, 184), (144, 184), (544, 104), (512, 184), (184, 80))],
    (PLAYER, "角色", 296, 184, 16, 16),
]

_PX_VERTICAL = [
    *[(ISLAND, "地形", x, y, 64, 48) for x, y in ((16, 200), (272, 336), (32, 456), (256, 568), (288, 200))],
    *[(CLOUD, "景物", x, y, 48, 16) for x, y in ((120, 100), (200, 216), (24, 376), (152, 520), (96, 600), (296, 440))],
    *[(PLANE, "敵人", x, y, 16, 16) for x, y in ((40, 40), (152, 24), (216, 72), (312, 32), (104, 168), (232, 176),
                                                 (176, 264))],
    (POWER, "道具", 120, 416, 16, 16),
    (BULLETS, "道具", 178, 296, 4, 40),
    (SHIP, "角色", 172, 344, 16, 16),
]

# 地面 40×23 一格 16, 從 (0,0) 鋪起
_PX_TOPDOWN = [
    *[(HOUSE, "建築", x, y, 48, 48) for x, y in ((64, 32), (480, 48), (448, 256))],
    *[(TREE, "景物", x, y, 16, 16) for x, y in ((32, 160), (208, 64), (400, 128), (560, 208), (224, 288), (600, 320),
                                                (256, 128))],
    *[(CHEST, "道具", x, y, 16, 16) for x, y in ((128, 96), (512, 304))],
    *[(ENEMY, "敵人", x, y, 16, 16) for x, y in ((160, 240), (560, 112), (352, 192), (96, 128))],
    (PLAYER, "角色", 304, 160, 16, 16),
]

# 斜角: 菱形 32×16, 20×20 格(0~20), 格 (10,10) 在世界中心
_PX_ISO = [
    (HOUSE, "建築", 2, 2, 2, 2, 32),
    (HOUSE, "建築", 16, 1, 2, 2, 32),
    (WORKSHOP, "建築", 3, 14, 2, 3, 40),
    *[(TREE, "景物", i, j, 1, 1, 24) for i, j in ((1, 6), (17, 17), (9, 0), (0, 9), (18, 8), (6, 18), (14, 17))],
    *[(RESOURCE, "道具", i, j, 1, 1, 12) for i, j in ((17, 13), (3, 5))],
    *[(VILLAGER, "角色", i, j, 0.5, 0.5, 14) for i, j in ((9, 11.5), (11.5, 9), (16, 14), (3, 12))],
    (PLAYER, "角色", 10, 10, 0.5, 0.5, 16),
]

_PX_FLAT = [
    ("對手頭像 opponent", "角色", 16, 16, 32, 32),
    *[("卡牌背面 card back", "道具", x, 8, 32, 48) for x in (224, 264, 304, 344, 384)],
    *[("場上卡牌 card", "道具", x, y, 32, 48) for y in (104, 160) for x in (264, 304, 344)],
    ("牌堆 deck", "道具", 560, 104, 32, 48),
    ("牌堆 deck", "道具", 560, 160, 32, 48),
    *[("手牌 card", "道具", x, 296, 32, 48) for x in (224, 264, 304, 344, 384)],
    ("我方頭像 player", "角色", 16, 312, 32, 32),
]

_BOXES = {False: {"side": _SIDE, "vertical": _VERTICAL, "topdown": _TOPDOWN, "flat": _FLAT},
          True: {"side": _PX_SIDE, "vertical": _PX_VERTICAL, "topdown": _PX_TOPDOWN, "flat": _PX_FLAT}}
_BLOCKS = {False: _ISO, True: _PX_ISO}


def _topdown_cell(c: int, r: int) -> str:
    """一般俯瞰 40×24: 舊預設在第 10 行、第 6 列起(道路第 12 列、左下水池), 往外延伸。"""
    if (r >= 15 and c <= 12) or (r <= 3 and c >= 33):
        return WATER
    return ROAD if r == 12 or c in (5, 34) else GRASS


def _iso_cell(i: int, j: int) -> str:
    """一般斜角, 格座標 -8~18(舊預設 0~10 的規則往外延伸)。"""
    if (j >= 7 and i <= 3) or (i >= 14 and j <= -3):
        return WATER
    return ROAD if i == 5 or j == 4 else GRASS


def _px_topdown_cell(c: int, r: int) -> str:
    if r >= 15 and c <= 9:
        return WATER
    return ROAD if r == 11 or c == 20 else GRASS


def _px_iso_cell(i: int, j: int) -> str:
    if j >= 15 and i <= 5:
        return WATER
    return ROAD if i == 11 or j == 6 else GRASS


def _ground(view: str, pixel: bool) -> dict | None:
    size = ground_size(view, pixel)
    if size is None:
        return None
    cols, rows = size
    if view == "topdown":
        cell = _px_topdown_cell if pixel else _topdown_cell
    else:
        cell = _px_iso_cell if pixel else (lambda c, r: _iso_cell(c - 8, r - 8))
    # 格索引 = 列 × cols + 行; 斜角俯瞰的行是 i、列是 j
    return {"cols": cols, "rows": rows, "cells": [cell(c, r) for r in range(rows) for c in range(cols)], "custom": []}


def _objects(view: str, pixel: bool) -> list[dict]:
    out = []
    if view == "iso":
        for n, (label, kind, i, j, w, l, h) in enumerate(_BLOCKS[pixel], 1):
            out.append({"id": f"o{n}", "kind": "block", "label": label, "color": DEFAULT_BOX_COLOR, "type": kind,
                        "i": i, "j": j, "w": w, "l": l, "h": h})
        return out
    for n, (label, kind, x, y, w, h) in enumerate(_BOXES[pixel][view], 1):
        out.append({"id": f"o{n}", "kind": "box", "label": label, "color": DEFAULT_BOX_COLOR, "type": kind,
                    "x": x, "y": y, "w": w, "h": h})
    return out


def expand_ground(g: dict, cols: int, rows: int, dc: int, dr: int, fill: str | None = GRASS) -> dict:
    """把地面格放進較大的格子(舊格子左上角移到第 dc 行、第 dr 列), 多出來的格子填 fill。"""
    cells = [fill] * (cols * rows)
    for r in range(g["rows"]):
        for c in range(g["cols"]):
            cells[(r + dr) * cols + c + dc] = g["cells"][r * g["cols"] + c]
    return {**g, "cols": cols, "rows": rows, "cells": cells}


def preset_scene(view: str, empty: bool, pixel: bool = False) -> dict:
    """新場景的內容; empty 時沒有物件, 背景與地面格照預設。"""
    return {"background": dict(DEFAULT_BG[view]), "ground": _ground(view, pixel),
            "objects": [] if empty else _objects(view, pixel),
            "style": {"text": "", "refs": [], "genre": GENRE[view], "colors": DEFAULT_COLORS}}
