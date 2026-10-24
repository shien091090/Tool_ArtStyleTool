"""遊戲示意場景: 每個場景一個資料夾 <名稱>/{scene.json, assets/<素材編號>.png, candidates/<候選編號>.png}。"""
import copy
import json
import math
import re
import shutil
import threading
from datetime import datetime
from pathlib import Path

import numpy as np

from ..imaging import read_png, write_png
from ..library.store import KINDS
from ..names import validate_name
from .geometry import VIEWS
from .presets import TERRAINS, preset_scene

LABEL_MAX = 60
REFS_MAX = 4
TEXT_MAX = 2000
_COLOR = re.compile(r"#[0-9a-fA-F]{6}")
_OBJ_ID = re.compile(r"o[0-9]{1,6}")
_ASSET_ID = re.compile(r"a[0-9]{1,6}")
_CAND_ID = re.compile(r"c[0-9]{1,6}")
_FILE = re.compile(r"(assets/a[0-9]{1,6}|candidates/c[0-9]{1,6}|cut)\.png")

_lock = threading.RLock()


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _num(v, what: str, positive: bool = False) -> float:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        raise ValueError(f"{what} 必須是數字")
    if positive and v <= 0:
        raise ValueError(f"{what} 必須大於 0")
    return v


def _label(v, what: str = "標籤") -> str:
    if not isinstance(v, str) or not v.strip():
        raise ValueError(f"{what}不能空白")
    if len(v) > LABEL_MAX:
        raise ValueError(f"{what}最長 {LABEL_MAX} 字")
    return v


def _color(v) -> str:
    if not isinstance(v, str) or not _COLOR.fullmatch(v):
        raise ValueError(f"顏色格式錯誤: {v!r}")
    return v.lower()


def _dict(v, what: str) -> dict:
    if not isinstance(v, dict):
        raise ValueError(f"{what}格式錯誤")
    return v


class Scene:
    def __init__(self, root: Path, name: str, meta: dict):
        self.root = Path(root)
        self.name = name
        self.dir = self.root / name
        self.meta = meta

    # ---- 場景本身 ----

    @classmethod
    def create(cls, root, name: str, view: str, empty: bool) -> "Scene":
        validate_name(name)
        if view not in VIEWS:
            raise ValueError(f"未知的畫面架構: {view!r}")
        d = Path(root) / name
        with _lock:
            if d.exists():
                raise FileExistsError(f"場景「{name}」已存在")
            now = _now()
            meta = {"version": 1, "name": name, "view": view, "created": now, "updated": now,
                    **preset_scene(view, bool(empty)), "candidates": [], "nextCandidate": 1}
            (d / "assets").mkdir(parents=True)
            (d / "candidates").mkdir()
            s = cls(root, name, meta)
            s._save()
            return s

    @classmethod
    def open(cls, root, name: str) -> "Scene":
        validate_name(name)
        p = Path(root) / name / "scene.json"
        if not p.is_file():
            raise FileNotFoundError(f"找不到場景「{name}」")
        return cls(root, name, json.loads(p.read_text(encoding="utf-8")))

    @classmethod
    def list(cls, root) -> list[dict]:
        root = Path(root)
        if not root.is_dir():
            return []
        out = []
        for d in sorted(root.iterdir()):
            p = d / "scene.json"
            if not p.is_file():
                continue
            try:
                m = json.loads(p.read_text(encoding="utf-8"))
                out.append({"name": m["name"], "view": m["view"], "updated": m.get("updated"),
                            "candidates": len(m.get("candidates", []))})
            except (ValueError, KeyError, TypeError):
                continue
        return out

    def delete(self) -> None:
        shutil.rmtree(self.dir)

    def _save(self) -> None:
        self.meta["updated"] = _now()
        tmp = self.dir / "scene.json.tmp"
        tmp.write_text(json.dumps(self.meta, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(self.dir / "scene.json")

    def _reload(self) -> None:
        self.meta = json.loads((self.dir / "scene.json").read_text(encoding="utf-8"))

    # ---- 編輯內容 ----

    def _has_asset(self, aid) -> bool:
        return isinstance(aid, str) and bool(_ASSET_ID.fullmatch(aid)) and (self.dir / "assets" / f"{aid}.png").is_file()

    def _check_ground(self, g) -> dict | None:
        view = self.meta["view"]
        if g is None:
            if view in ("topdown", "iso"):
                raise ValueError("這個畫面架構一定要有地面格")
            return None
        if view in ("side", "vertical"):
            raise ValueError("橫向、縱向卷軸沒有地面格")
        g = _dict(g, "地面格")
        cols, rows = g.get("cols"), g.get("rows")
        fixed = {"topdown": (20, 12), "iso": (10, 10)}.get(view)
        if fixed:
            if (cols, rows) != fixed:
                raise ValueError(f"地面格大小必須是 {fixed[0]}×{fixed[1]}")
        elif not (isinstance(cols, int) and isinstance(rows, int) and 2 <= cols <= 20 and 2 <= rows <= 11):
            raise ValueError("棋盤格行數 2~20、列數 2~11")
        custom = g.get("custom", [])
        if not isinstance(custom, list) or len(custom) > 20:
            raise ValueError("自訂地形格式錯誤")
        custom = [{"label": _label(_dict(t, "自訂地形").get("label"), "地形名稱"), "color": _color(t.get("color"))}
                  for t in custom]
        known = {t["label"] for t in TERRAINS} | {t["label"] for t in custom}
        cells = g.get("cells")
        if not isinstance(cells, list) or len(cells) != cols * rows:
            raise ValueError("地面格數量不符")
        for c in cells:
            if c is not None and c not in known:
                raise ValueError(f"未知的地形: {c!r}")
        return {"cols": cols, "rows": rows, "cells": list(cells), "custom": custom}

    def _check_object(self, o) -> dict:
        o = _dict(o, "物件")
        oid = o.get("id")
        if not isinstance(oid, str) or not _OBJ_ID.fullmatch(oid):
            raise ValueError(f"物件編號錯誤: {oid!r}")
        kind = o.get("kind")
        iso = self.meta["view"] == "iso"
        if kind == "asset":
            if not self._has_asset(o.get("asset")):
                raise ValueError(f"場景裡沒有素材圖 {o.get('asset')!r}")
            out = {"id": oid, "kind": kind, "asset": o["asset"], "name": _label(o.get("name"), "素材名稱"),
                   "flip": bool(o.get("flip", False))}
            keys = (("x", False), ("y", False), ("w", True), ("h", True))
        elif kind == ("block" if iso else "box"):
            t = o.get("type")
            if t is not None and t not in KINDS:
                raise ValueError(f"未知的類型: {t!r}")
            out = {"id": oid, "kind": kind, "label": _label(o.get("label")), "color": _color(o.get("color")), "type": t}
            keys = ((("i", False), ("j", False), ("w", True), ("l", True), ("h", True)) if iso
                    else (("x", False), ("y", False), ("w", True), ("h", True)))
        else:
            raise ValueError(f"這個畫面架構不能放「{kind}」物件")
        for k, positive in keys:
            out[k] = _num(o.get(k), f"物件 {oid} 的 {k}", positive)
        return out

    def _check_style(self, st) -> dict:
        st = _dict(st, "風格設定")
        text, genre, refs = st.get("text", ""), st.get("genre", ""), st.get("refs", [])
        if not isinstance(text, str) or len(text) > TEXT_MAX:
            raise ValueError(f"風格描述最長 {TEXT_MAX} 字")
        if not isinstance(genre, str) or len(genre) > 200:
            raise ValueError("遊戲類型描述最長 200 字")
        if not isinstance(refs, list) or len(refs) > REFS_MAX:
            raise ValueError(f"參考圖最多 {REFS_MAX} 張")
        for a in refs:
            if not self._has_asset(a):
                raise ValueError(f"場景裡沒有參考圖 {a!r}")
        return {"text": text, "refs": list(dict.fromkeys(refs)), "genre": genre}

    def save(self, body: dict) -> dict:
        """存背景、地面格、物件、風格; 名稱、架構、候選不由這裡改。"""
        body = _dict(body, "場景")
        with _lock:
            self._reload()
            bg = _dict(body.get("background"), "背景")
            background = {"label": _label(bg.get("label"), "背景標籤"), "color": _color(bg.get("color"))}
            ground = self._check_ground(body.get("ground"))
            objs = body.get("objects")
            if not isinstance(objs, list) or len(objs) > 500:
                raise ValueError("物件格式錯誤")
            objects = [self._check_object(o) for o in objs]
            if len({o["id"] for o in objects}) != len(objects):
                raise ValueError("物件編號重複")
            style = self._check_style(body.get("style"))
            self.meta.update(background=background, ground=ground, objects=objects, style=style)
            self._save()
            return self.meta

    # ---- 圖檔 ----

    def add_asset(self, aid: str, img: np.ndarray) -> str:
        if not isinstance(aid, str) or not _ASSET_ID.fullmatch(aid):
            raise ValueError(f"素材編號錯誤: {aid!r}")
        rel = f"assets/{aid}.png"
        write_png(self.dir / rel, img)
        return rel

    def add_candidate(self, img: np.ndarray, prompt: str) -> dict:
        with _lock:
            self._reload()
            n = self.meta.get("nextCandidate", 1)
            cid = f"c{n}"
            write_png(self.dir / "candidates" / f"{cid}.png", img)
            c = {"id": cid, "created": _now(), "prompt": prompt, "style": copy.deepcopy(self.meta["style"]),
                 "objects": copy.deepcopy(self.meta["objects"])}
            self.meta["candidates"].append(c)
            self.meta["nextCandidate"] = n + 1
            self._save()
            return c

    def candidate(self, cid: str) -> dict:
        for c in self.meta["candidates"]:
            if c["id"] == cid:
                return c
        raise FileNotFoundError(f"找不到候選 {cid}")

    def delete_candidate(self, cid: str) -> dict:
        with _lock:
            self._reload()
            self.candidate(cid)
            self.meta["candidates"] = [c for c in self.meta["candidates"] if c["id"] != cid]
            (self.dir / "candidates" / f"{cid}.png").unlink(missing_ok=True)
            self._save()
            return self.meta

    def candidate_image(self, cid: str) -> np.ndarray:
        if not isinstance(cid, str) or not _CAND_ID.fullmatch(cid):
            raise FileNotFoundError(f"找不到候選 {cid}")
        self.candidate(cid)
        return read_png(self.dir / "candidates" / f"{cid}.png")

    def file_path(self, rel: str) -> Path:
        if not _FILE.fullmatch(rel or "") or not (self.dir / rel).is_file():
            raise FileNotFoundError(f"找不到檔案 {rel}")
        return self.dir / rel
