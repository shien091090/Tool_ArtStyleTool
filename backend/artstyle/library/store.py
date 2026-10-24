"""素材庫: 每張素材一個資料夾 <編號>/{image.png, asset.json}; counter.json 記下一個編號(刪除後不重複使用)。"""
import json
import re
import shutil
import threading
from datetime import datetime
from pathlib import Path

import numpy as np

from .. import config
from ..imaging import limit_size, write_png

VIEWS = ("side", "vertical", "topdown", "iso", "flat")
KINDS = ("地形", "背景", "角色", "敵人", "道具", "建築", "景物", "其他")
NAME_MAX = 60
_ID = re.compile(r"a[0-9]{1,6}")

# 編號配發與子素材改掛都是讀改寫, 一律在這把鎖裡
_lock = threading.RLock()


def check_tags(tags) -> dict:
    """遊戲示意標籤: 視角可多選(去重保序), 類型單選或 None。"""
    if tags is None:
        return {"views": [], "type": None}
    if not isinstance(tags, dict):
        raise ValueError("標籤格式錯誤")
    views = tags.get("views", [])
    if not isinstance(views, list) or any(v not in VIEWS for v in views):
        raise ValueError(f"未知的視角: {views!r}")
    kind = tags.get("type")
    if kind is not None and kind not in KINDS:
        raise ValueError(f"未知的類型: {kind!r}")
    return {"views": list(dict.fromkeys(views)), "type": kind}


def check_name(name) -> str:
    if not isinstance(name, str) or not name.strip():
        raise ValueError("名稱不能空白")
    name = name.strip()
    if len(name) > NAME_MAX:
        raise ValueError(f"名稱最長 {NAME_MAX} 字")
    return name


def _write_json(path: Path, data: dict) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


class Library:
    def __init__(self, root: Path):
        self.root = Path(root)

    def _dir(self, aid: str) -> Path:
        if not isinstance(aid, str) or not _ID.fullmatch(aid):
            raise FileNotFoundError("找不到素材")
        d = self.root / aid
        if not (d / "asset.json").is_file():
            raise FileNotFoundError(f"找不到素材 {aid}")
        return d

    def _next_id(self) -> str:
        p = self.root / "counter.json"
        n = json.loads(p.read_text(encoding="utf-8"))["next"] if p.is_file() else 1
        _write_json(p, {"next": n + 1})
        return f"a{n}"

    def add(self, img: np.ndarray, name: str, source: dict, parent: str | None = None,
            tags: dict | None = None) -> dict:
        name = check_name(name)
        tags = check_tags(tags)
        with _lock:
            self.root.mkdir(parents=True, exist_ok=True)
            if parent is not None and not (self.root / str(parent) / "asset.json").is_file():
                parent = None
            if parent is not None:  # 派生圖的視角與類型一律沿用原圖
                tags = self.get(parent)["tags"]
            aid = self._next_id()
            d = self.root / aid
            d.mkdir()
            write_png(d / "image.png", limit_size(img, config.MAX_SIDE))
            meta = {"id": aid, "name": name, "created": datetime.now().isoformat(timespec="seconds"),
                    "parent": parent, "source": source, "tags": tags}
            _write_json(d / "asset.json", meta)
            return meta

    def list(self) -> list[dict]:
        if not self.root.is_dir():
            return []
        out = []
        for d in self.root.iterdir():
            p = d / "asset.json"
            if _ID.fullmatch(d.name) and p.is_file():
                out.append(json.loads(p.read_text(encoding="utf-8")))
        return sorted(out, key=lambda a: (a["created"], int(a["id"][1:])))

    def get(self, aid: str) -> dict:
        return json.loads((self._dir(aid) / "asset.json").read_text(encoding="utf-8"))

    def root_of(self, aid: str) -> str:
        """沿原圖一路往上到組的根; 原圖不存在就停在那裡。"""
        cur = self.get(aid)
        seen = {cur["id"]}
        while cur["parent"] and cur["parent"] not in seen:
            try:
                cur = self.get(cur["parent"])
            except FileNotFoundError:
                break
            seen.add(cur["id"])
        return cur["id"]

    def image_path(self, aid: str) -> Path:
        return self._dir(aid) / "image.png"

    def update(self, aid: str, name: str | None, tags: dict | None) -> dict:
        with _lock:
            meta = self.get(aid)
            if name is not None:
                meta["name"] = check_name(name)
            if tags is not None:
                if meta["parent"] is not None:
                    raise ValueError("派生圖沿用原圖的視角與類型, 要改請到原圖改")
                meta["tags"] = check_tags(tags)
                self._spread_tags(aid, meta["tags"])
            _write_json(self._dir(aid) / "asset.json", meta)
            return meta

    def _spread_tags(self, aid: str, tags: dict) -> None:
        """原圖改了標籤, 一路帶到所有派生。"""
        everything = self.list()
        todo = [aid]
        while todo:
            cur = todo.pop()
            for child in everything:
                if child["parent"] == cur:
                    child["tags"] = tags
                    _write_json(self.root / child["id"] / "asset.json", child)
                    todo.append(child["id"])

    def delete(self, aid: str) -> None:
        """只刪這一張; 它的子素材改掛到它的原圖(沒有就變成根)。"""
        with _lock:
            meta = self.get(aid)
            for child in self.list():
                if child["parent"] == aid:
                    child["parent"] = meta["parent"]
                    _write_json(self.root / child["id"] / "asset.json", child)
            shutil.rmtree(self.root / aid)
