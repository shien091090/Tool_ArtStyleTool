"""像素素材共用流程: AI 產生候選、直接轉換、縮小候選。像素素材頁與流程的像素化節點都用這份。"""
import numpy as np

from ..fal import VISION_MODEL, FalClient
from ..imaging import to_data_uri
from . import convert as converter
from . import downscale, prompts, suggest
from .work import PixelWork

MAX_NOTE = 200
MAX_EYES = 4
# 依長邊自動選模型(2026-10-17 實驗): 96px 以下 GPT Image 2 最照格數, 再大用 Nano Banana Pro
GPT_MAX_SIDE = 96
CONVERT_METHODS = {"convert": "直接轉換", "convert_lines": "直接轉換 + 內線"}


def _int(v, lo: int, hi: int, what: str) -> int:
    if isinstance(v, bool) or not isinstance(v, int) or not lo <= v <= hi:
        raise ValueError(f"{what}必須是 {lo}~{hi} 的整數")
    return v


def pick_model(cols: int, rows: int) -> str:
    return "gpt-image-2" if max(cols, rows) * prompts.CELL <= GPT_MAX_SIDE else "nano-banana-pro"


def check_settings(body) -> dict:
    if not isinstance(body, dict):
        raise ValueError("設定格式錯誤")
    mode = body.get("mode", "grid")
    if mode != "grid":
        raise ValueError("AI 重畫只支援指定格數(自動尺寸請先讓 AI 建議尺寸)")
    cols = _int(body.get("cols"), 1, prompts.MAX_CELLS, "寬格數")
    rows = _int(body.get("rows"), 1, prompts.MAX_CELLS, "高格數")
    model = pick_model(cols, rows)
    colors = body.get("colors")
    colors = prompts.default_colors(mode, cols, rows) if colors is None else _int(colors, 2, 64, "色數")
    note = body.get("note") or ""
    if not isinstance(note, str) or len(note) > MAX_NOTE:
        raise ValueError(f"補充描述必須是 {MAX_NOTE} 字以內的文字")
    count = _int(body.get("count", 1), 1, 4, "候選張數")
    return {"mode": mode, "model": model, "cols": cols, "rows": rows, "colors": colors, "note": note.strip(), "count": count}


def _num(v, lo: float, hi: float, what: str) -> float:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not lo <= v <= hi:
        raise ValueError(f"{what}必須是 {lo}~{hi} 的數字")
    return float(v)


def check_convert(body) -> dict:
    if not isinstance(body, dict):
        raise ValueError("設定格式錯誤")
    cols = _int(body.get("cols"), 1, prompts.MAX_CELLS, "寬格數")
    rows = _int(body.get("rows"), 1, prompts.MAX_CELLS, "高格數")
    colors = body.get("colors")
    colors = converter.default_colors(cols * prompts.CELL, rows * prompts.CELL) if colors is None else _int(colors, 2, 64, "色數")
    outline = body.get("outline", True)
    if not isinstance(outline, bool):
        raise ValueError("外框必須是 true 或 false")
    eyes = body.get("eyes")
    if eyes is None:
        eyes = [body["eye"]] if body.get("eye") is not None else []  # 舊格式: 單一眼睛
    if not isinstance(eyes, list) or len(eyes) > MAX_EYES:
        raise ValueError(f"眼睛標記最多 {MAX_EYES} 個")
    out = []
    for eye in eyes:
        if not isinstance(eye, dict):
            raise ValueError("眼睛標記格式錯誤")
        out.append({"x": _num(eye.get("x"), 0, 1, "眼睛位置"), "y": _num(eye.get("y"), 0, 1, "眼睛位置"),
                    "r": _num(eye.get("r"), 0.002, 0.5, "眼睛半徑")})
    return {"mode": "convert", "model": "", "cols": cols, "rows": rows, "colors": colors, "note": "",
            "outline": outline, "eyes": out}


def candidate_eyes(cand: dict) -> list[dict]:
    if cand.get("eyes") is not None:
        return cand["eyes"]
    return [cand["eye"]] if cand.get("eye") else []


def suggest_sizes(img: np.ndarray, c: FalClient) -> dict:
    """看圖建議 2~3 個尺寸(img 為 RGB 白底)。"""
    return {"sizes": suggest.parse(c.vision(img, suggest.PROMPT)), "model": VISION_MODEL}


def convert(work: PixelWork, body, src: np.ndarray, extra: dict | None = None) -> dict:
    """直接轉換: 存一張候選(圖是來源快照, 保留透明), 縮小時才真的轉。"""
    s = check_convert(body)
    entry = work.add_candidate(src, s | (extra or {}), keep_alpha=True)
    pixelate(work, entry["id"], None)  # 先存預覽, 候選縮圖直接看得到結果
    return {"meta": work.meta, "candidate": entry}


def generate(work: PixelWork, body, c: FalClient, extra: dict | None = None) -> dict:
    """以作品的來源圖叫 AI 重畫, 存成候選; extra 會一併記進每張候選。"""
    s = check_settings(body)
    src = work.source()
    img = prompts.prepare(src, s["mode"], s["cols"], s["rows"])
    prompt = prompts.build_prompt(src, s["mode"], s["colors"], s["note"], s["cols"], s["rows"])
    errors: list[str] = []
    images = c.edit(s["model"], img, prompt, s["count"])
    settings = {k: s[k] for k in ("mode", "model", "cols", "rows", "colors", "note")} | (extra or {})
    added = [work.add_candidate(im, settings) for im in images[:s["count"]]]
    for cand in added:
        pixelate(work, cand["id"], None)
    if len(added) < s["count"] and not errors:
        errors.append(f"要求 {s['count']} 張, AI 只回傳 {len(added)} 張")
    return {"meta": work.meta, "candidates": added, "errors": errors}


def pixelate(work: PixelWork, cid: str, body) -> dict:
    cand = work.candidate(cid)
    img = work.candidate_image(cid)
    colors = (body or {}).get("colors")
    colors = cand["colors"] if colors is None else _int(colors, 2, 64, "色數")
    if cand["mode"] == "convert":
        methods = ["convert", "convert_lines"]
    else:
        methods = ["auto"] if cand["mode"] == "auto" else ["dominant", "contrast", "adaptive"]
    results, previews = [], []
    for m in methods:
        entry = {"method": m, "label": CONVERT_METHODS.get(m) or downscale.METHODS[m]}
        try:
            if m in CONVERT_METHODS:
                out = converter.convert(img, cand["cols"] * prompts.CELL, cand["rows"] * prompts.CELL, colors,
                                        lines=m == "convert_lines", outline=cand.get("outline", True),
                                        eyes=candidate_eyes(cand))
            else:
                out = downscale.run(m, img, colors, cand["cols"], cand["rows"])
            entry.update(png=to_data_uri(out), w=int(out.shape[1]), h=int(out.shape[0]),
                         palette=downscale.palette(out))
            previews.append((m, entry["label"], out))
        except Exception as e:  # 單一方法失敗不影響其他方法
            entry["error"] = f"縮小失敗: {e}"
        results.append(entry)
    work.save_previews(cid, colors, previews)
    return {"results": results, "colors": colors}
