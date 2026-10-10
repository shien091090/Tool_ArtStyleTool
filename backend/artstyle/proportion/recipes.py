"""比例配方: 只記「部位名稱 → 變形」, 可套到別張圖。與渲染的風格配方分開存放。"""
import math

from .work import ANCHORS, MAX_SCALE

VERSION = 1


def _num(v) -> bool:
    return not isinstance(v, bool) and isinstance(v, (int, float)) and math.isfinite(v)


def validate(data) -> dict:
    """格式錯一律報錯指出位置, 不靜默修正。"""
    if not isinstance(data, dict):
        raise ValueError("比例配方必須是 JSON 物件")
    v = data.get("version")
    if isinstance(v, bool) or v != VERSION or not isinstance(v, int):
        raise ValueError(f"比例配方版本不支援: {v!r}(目前只支援 {VERSION})")
    parts = data.get("parts")
    if not isinstance(parts, list) or not parts:
        raise ValueError("比例配方沒有任何部位")
    out = []
    for i, p in enumerate(parts, 1):
        if not isinstance(p, dict):
            raise ValueError(f"第 {i} 個部位格式錯誤")
        name = p.get("name")
        if not isinstance(name, str) or not name.strip():
            raise ValueError(f"第 {i} 個部位缺少名稱")
        where = f"部位「{name}」"
        for k in ("scaleX", "scaleY"):
            if not _num(p.get(k)) or not 0 < p[k] <= MAX_SCALE:
                raise ValueError(f"{where} 的 {k} 必須在 0~{MAX_SCALE} 之間(不含 0)")
        for k in ("rotation", "dx", "dy"):
            if not _num(p.get(k)):
                raise ValueError(f"{where} 的 {k} 必須是數字")
        if p.get("anchor") not in ANCHORS:
            raise ValueError(f"{where} 的 anchor 不合法: {p.get('anchor')!r}")
        z = p.get("z")
        if isinstance(z, bool) or not isinstance(z, int):
            raise ValueError(f"{where} 的 z 必須是整數")
        out.append({"name": name.strip(), **{k: float(p[k]) for k in ("scaleX", "scaleY", "rotation", "dx", "dy")},
                    "anchor": p["anchor"], "z": z})
    return {"version": VERSION, "parts": out}
