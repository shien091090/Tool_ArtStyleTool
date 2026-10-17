"""自動尺寸: 叫看圖 AI 建議 2~3 個像素尺寸(規格 2026-10-18-pixel-ui-redesign-design 第 6 節)。"""
import json
import re

from .prompts import CELL, MAX_CELLS

PROMPT = ("I want to turn this character illustration into a 2D pixel art game sprite. Suggest 3 different sprite sizes "
          "that would suit this subject, from small to large. Width and height must each be a multiple of 8 and between "
          "16 and 128 pixels; keep the subject's proportions in mind (it may be taller than wide). For each size also "
          "suggest a palette color count (4 to 32), and give a one-sentence reason in Traditional Chinese (what detail "
          "survives or gets lost at that size). Reply with JSON only, no prose: "
          "{\"sizes\": [{\"w\": 32, \"h\": 48, \"colors\": 16, \"reason\": \"...\"}]}")

ERROR = "AI 沒有給出尺寸建議, 請改用指定格數"
MIN_COLORS, MAX_COLORS = 4, 32
MAX_REASON = 120


def _cells(v) -> int:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        raise ValueError
    return min(MAX_CELLS, max(1, round(v / CELL)))


def parse(text: str) -> list[dict]:
    """模型回覆 → [{cols, rows, colors, reason}], 依面積小到大; 對齊 8 的倍數、去重。壞格式或空 → ValueError。"""
    m = re.search(r"\{.*\}", text or "", re.S)
    if not m:
        raise ValueError(ERROR)
    try:
        items = json.loads(m.group(0)).get("sizes")
    except (ValueError, AttributeError):
        raise ValueError(ERROR)
    if not isinstance(items, list):
        raise ValueError(ERROR)
    out, seen = [], set()
    for it in items:
        try:
            cols, rows = _cells(it["w"]), _cells(it["h"])
        except (ValueError, KeyError, TypeError):
            continue
        if (cols, rows) in seen:
            continue
        seen.add((cols, rows))
        colors = it.get("colors")
        colors = 16 if isinstance(colors, bool) or not isinstance(colors, (int, float)) else int(colors)
        reason = it.get("reason") if isinstance(it.get("reason"), str) else ""
        out.append({"cols": cols, "rows": rows, "colors": min(MAX_COLORS, max(MIN_COLORS, colors)),
                    "reason": reason.strip()[:MAX_REASON]})
    if not out:
        raise ValueError(ERROR)
    return sorted(out, key=lambda s: s["cols"] * s["rows"])[:3]
