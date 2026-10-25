"""五種畫面架構的預設: 背景、地面格、灰盒擺設、遊戲類型描述(參照 2026-10-24 實驗的灰盒草稿, 不含 HUD)。"""


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

GRASS, WATER, ROAD = (t["label"] for t in TERRAINS[:3])

# (標籤, 類型, x, y, w, h)
_SIDE = [
    ("遠景山 far mountains", "背景", 0, 300, 1280, 260),
    ("雲 cloud", "景物", 150, 120, 160, 60),
    ("雲 cloud", "景物", 760, 90, 160, 60),
    ("地面 ground", "地形", 0, 592, 640, 128),
    ("地面 ground", "地形", 768, 592, 512, 128),
    ("平台 platform", "地形", 420, 400, 192, 32),
    ("平台 platform", "地形", 820, 330, 256, 32),
    ("樹 tree", "景物", 990, 372, 124, 220),
    ("障礙 obstacle", "景物", 300, 482, 80, 110),
    ("金幣 coins", "道具", 440, 350, 180, 28),
    ("敵人 enemy", "敵人", 500, 536, 60, 56),
    ("敵人 enemy", "敵人", 840, 274, 60, 56),
    ("主角 player", "角色", 150, 496, 56, 96),
]

_VERTICAL = [
    ("島嶼 island", "地形", 60, 300, 220, 160),
    ("島嶼 island", "地形", 460, 700, 200, 180),
    ("雲 cloud", "景物", 380, 160, 200, 70),
    ("雲 cloud", "景物", 80, 900, 180, 60),
    ("敵機 enemy plane", "敵人", 140, 180, 80, 80),
    ("敵機 enemy plane", "敵人", 320, 120, 80, 80),
    ("敵機 enemy plane", "敵人", 500, 240, 80, 80),
    ("子彈 bullets", "道具", 350, 760, 20, 240),
    ("主角戰機 player ship", "角色", 310, 1040, 100, 110),
]

_TOPDOWN = [
    ("房子 house", "建築", 832, 64, 192, 160),
    ("樹 tree", "景物", 128, 64, 64, 64),
    ("樹 tree", "景物", 1088, 256, 64, 64),
    ("樹 tree", "景物", 640, 512, 64, 64),
    ("寶箱 chest", "道具", 960, 512, 64, 64),
    ("敵人 enemy", "敵人", 320, 192, 64, 64),
    ("敵人 enemy", "敵人", 1152, 576, 64, 64),
    ("主角 player", "角色", 576, 320, 64, 64),
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

# (標籤, 類型, i, j, 寬, 深, 高)
_ISO = [
    ("房子 house", "建築", 1, 1, 2, 2, 90),
    ("工坊 workshop", "建築", 7, 1, 2, 3, 130),
    ("樹 tree", "景物", 2, 5, 1, 1, 60),
    ("樹 tree", "景物", 8, 6, 1, 1, 60),
    ("資源 resource", "道具", 6, 6, 1, 1, 40),
    ("主角 player", "角色", 4.3, 5.3, 0.4, 0.4, 56),
    ("村民 villager", "角色", 5.3, 2.3, 0.4, 0.4, 50),
    ("村民 villager", "角色", 3.3, 3.3, 0.4, 0.4, 50),
]

_BOXES = {"side": _SIDE, "vertical": _VERTICAL, "topdown": _TOPDOWN, "flat": _FLAT}


def _topdown_cell(c: int, r: int) -> str:
    if r >= 9 and c <= 2:
        return WATER
    return ROAD if r == 6 else GRASS


def _iso_cell(i: int, j: int) -> str:
    if j >= 7 and i <= 3:
        return WATER
    return ROAD if i == 5 or j == 4 else GRASS


def _ground(view: str) -> dict | None:
    if view == "topdown":
        cols, rows, cell = 20, 12, _topdown_cell
    elif view == "iso":
        cols, rows, cell = 10, 10, _iso_cell
    else:
        return None
    # 格索引 = 列 × cols + 行; 斜角俯瞰的行是 i、列是 j
    return {"cols": cols, "rows": rows, "cells": [cell(c, r) for r in range(rows) for c in range(cols)], "custom": []}


def _objects(view: str) -> list[dict]:
    out = []
    if view == "iso":
        for n, (label, kind, i, j, w, l, h) in enumerate(_ISO, 1):
            out.append({"id": f"o{n}", "kind": "block", "label": label, "color": DEFAULT_BOX_COLOR, "type": kind,
                        "i": i, "j": j, "w": w, "l": l, "h": h})
        return out
    for n, (label, kind, x, y, w, h) in enumerate(_BOXES[view], 1):
        out.append({"id": f"o{n}", "kind": "box", "label": label, "color": DEFAULT_BOX_COLOR, "type": kind,
                    "x": x, "y": y, "w": w, "h": h})
    return out


def preset_scene(view: str, empty: bool) -> dict:
    """新場景的內容; empty 時沒有物件, 背景與地面格照預設。"""
    return {"background": dict(DEFAULT_BG[view]), "ground": _ground(view),
            "objects": [] if empty else _objects(view),
            "style": {"text": "", "refs": [], "genre": GENRE[view]}}
