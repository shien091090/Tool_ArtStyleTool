"""像素素材作品: 資料夾放來源圖、AI 候選與 meta.json。"""
import json
import re
import shutil
from datetime import datetime
from pathlib import Path

import numpy as np

from .. import config
from ..imaging import limit_size, load_rgb, read_png, write_png
from ..names import validate_name

_FILE = re.compile(r"source\.png|ai/c[0-9]+\.png")


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


class PixelWork:
    def __init__(self, root: Path, name: str, meta: dict):
        self.root = Path(root)
        self.name = name
        self.dir = self.root / name
        self.meta = meta

    @classmethod
    def create(cls, root, name: str, image_bytes: bytes, source: str) -> "PixelWork":
        validate_name(name)
        root = Path(root)
        if (root / name).exists():
            raise FileExistsError(f"作品「{name}」已存在")
        img = limit_size(load_rgb(image_bytes), config.MAX_SIDE)  # 先解碼, 壞圖不留下空資料夾
        return cls.create_from_image(root, name, img, source)

    @classmethod
    def create_from_image(cls, root, name: str, img: np.ndarray, source: str) -> "PixelWork":
        root = Path(root)
        now = _now()
        work = cls(root, name, {"version": 1, "name": name, "created": now, "updated": now, "source": source,
                                "candidates": [], "counters": {"candidate": 0}})
        try:
            (work.dir / "ai").mkdir(parents=True)
            write_png(work.dir / "source.png", img)
            work.save_meta()
        except Exception:
            shutil.rmtree(work.dir, ignore_errors=True)
            raise
        return work

    @classmethod
    def open(cls, root, name: str) -> "PixelWork":
        validate_name(name)
        p = Path(root) / name / "meta.json"
        if not p.is_file():
            raise FileNotFoundError(f"找不到作品「{name}」")
        return cls(root, name, json.loads(p.read_text(encoding="utf-8")))

    @classmethod
    def list(cls, root) -> list[dict]:
        root = Path(root)
        if not root.is_dir():
            return []
        out = []
        for d in sorted(root.iterdir()):
            p = d / "meta.json"
            if not p.is_file():
                continue
            try:
                m = json.loads(p.read_text(encoding="utf-8"))
                out.append({"name": m["name"], "updated": m.get("updated"), "candidates": len(m.get("candidates", []))})
            except (ValueError, KeyError, TypeError):
                continue  # 壞掉的作品不拖累整份清單
        return out

    def delete(self) -> None:
        """整個資料夾從硬碟刪掉, 無法復原。"""
        shutil.rmtree(self.dir)

    def save_meta(self) -> None:
        self.meta["updated"] = _now()
        tmp = self.dir / "meta.json.tmp"
        tmp.write_text(json.dumps(self.meta, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(self.dir / "meta.json")

    def set_source(self, img: np.ndarray, source: str) -> None:
        write_png(self.dir / "source.png", img)
        self.meta["source"] = source
        self.save_meta()

    def source(self) -> np.ndarray:
        return read_png(self.dir / "source.png")

    def candidate(self, cid: str) -> dict:
        for c in self.meta["candidates"]:
            if c["id"] == cid:
                return c
        raise FileNotFoundError(f"找不到候選 {cid}")

    def candidate_image(self, cid: str) -> np.ndarray:
        self.candidate(cid)
        return read_png(self.dir / "ai" / f"{cid}.png")

    def add_candidate(self, img: np.ndarray, settings: dict) -> dict:
        self.meta["counters"]["candidate"] += 1
        cid = f"c{self.meta['counters']['candidate']}"
        write_png(self.dir / "ai" / f"{cid}.png", img[..., :3])
        entry = {"id": cid, "created": _now(), **settings}
        self.meta["candidates"].append(entry)
        self.save_meta()
        return entry

    def delete_candidate(self, cid: str) -> None:
        self.candidate(cid)
        (self.dir / "ai" / f"{cid}.png").unlink(missing_ok=True)
        self.meta["candidates"] = [c for c in self.meta["candidates"] if c["id"] != cid]
        self.save_meta()

    def file_path(self, rel: str) -> Path:
        if not _FILE.fullmatch(rel):
            raise FileNotFoundError("找不到檔案")
        p = self.dir / rel
        if not p.is_file():
            raise FileNotFoundError("找不到檔案")
        return p
