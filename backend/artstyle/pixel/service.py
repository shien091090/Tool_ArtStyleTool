"""像素素材共用流程: AI 產生候選、縮小候選。像素素材頁與流程的像素化節點都用這份。"""
from concurrent.futures import ThreadPoolExecutor

from ..fal import KONTEXT_MODEL, FalClient, FalError
from ..imaging import to_data_uri
from . import downscale, prompts
from .work import PixelWork

MODELS = ("kontext", "nano-banana-pro")
MAX_NOTE = 200


def _int(v, lo: int, hi: int, what: str) -> int:
    if isinstance(v, bool) or not isinstance(v, int) or not lo <= v <= hi:
        raise ValueError(f"{what}必須是 {lo}~{hi} 的整數")
    return v


def check_settings(body) -> dict:
    if not isinstance(body, dict):
        raise ValueError("設定格式錯誤")
    mode = body.get("mode")
    if mode not in ("auto", "grid"):
        raise ValueError("尺寸模式必須是 auto 或 grid")
    if mode == "grid":
        model = "nano-banana-pro"  # 只有 Pro 會照格數畫
        cols = _int(body.get("cols"), 1, prompts.MAX_CELLS, "寬格數")
        rows = _int(body.get("rows"), 1, prompts.MAX_CELLS, "高格數")
    else:
        model, cols, rows = body.get("model"), 0, 0
        if model not in MODELS:
            raise ValueError(f"不支援的模型: {model!r}")
    colors = body.get("colors")
    colors = prompts.default_colors(mode, cols, rows) if colors is None else _int(colors, 2, 64, "色數")
    note = body.get("note") or ""
    if not isinstance(note, str) or len(note) > MAX_NOTE:
        raise ValueError(f"補充描述必須是 {MAX_NOTE} 字以內的文字")
    count = _int(body.get("count", 1), 1, 4, "候選張數")
    return {"mode": mode, "model": model, "cols": cols, "rows": rows, "colors": colors, "note": note.strip(), "count": count}


def generate(work: PixelWork, body, c: FalClient, extra: dict | None = None) -> dict:
    """以作品的來源圖叫 AI 重畫, 存成候選; extra 會一併記進每張候選。"""
    s = check_settings(body)
    src = work.source()
    img = prompts.prepare(src, s["mode"], s["cols"], s["rows"])
    prompt = prompts.build_prompt(src, s["mode"], s["colors"], s["note"], s["cols"], s["rows"])
    errors: list[str] = []
    if s["model"] == "kontext":
        # Kontext 一次一張, 平行呼叫
        with ThreadPoolExecutor(s["count"]) as pool:
            futures = [pool.submit(c.run_image, KONTEXT_MODEL, img, prompt=prompt) for _ in range(s["count"])]
        images = []
        for f in futures:
            try:
                images.append(f.result())
            except FalError as e:
                errors.append(str(e))
        if not images:
            raise FalError(errors[0])
    else:
        images = c.edit("nano-banana-pro", img, prompt, s["count"])
    settings = {k: s[k] for k in ("mode", "model", "cols", "rows", "colors", "note")} | (extra or {})
    added = [work.add_candidate(im, settings) for im in images[:s["count"]]]
    if len(added) < s["count"] and not errors:
        errors.append(f"要求 {s['count']} 張, AI 只回傳 {len(added)} 張")
    return {"meta": work.meta, "candidates": added, "errors": errors}


def pixelate(work: PixelWork, cid: str, body) -> dict:
    cand = work.candidate(cid)
    img = work.candidate_image(cid)
    colors = (body or {}).get("colors")
    colors = cand["colors"] if colors is None else _int(colors, 2, 64, "色數")
    methods = ["auto"] if cand["mode"] == "auto" else ["dominant", "contrast", "adaptive"]
    results = []
    for m in methods:
        entry = {"method": m, "label": downscale.METHODS[m]}
        try:
            out = downscale.run(m, img, colors, cand["cols"], cand["rows"])
            entry.update(png=to_data_uri(out), w=int(out.shape[1]), h=int(out.shape[0]),
                         palette=downscale.palette(out))
        except Exception as e:  # 單一方法失敗不影響其他方法
            entry["error"] = f"縮小失敗: {e}"
        results.append(entry)
    return {"results": results, "colors": colors}
