"""部位比例作品: 一個資料夾放主圖、素材圖、部位遮罩、生成結果與 meta.json。"""
import copy
import json
import math
import re
import shutil
from datetime import datetime
from pathlib import Path

import numpy as np

from .. import config
from ..imaging import limit_size, load_rgb, read_png, write_png
from ..names import validate_name

COLORS = ["#e5484d", "#30a46c", "#0090ff", "#f76b15", "#8e4ec6", "#12a594",
          "#e93d82", "#ffc53d", "#3e63dd", "#7ce2fe", "#bdee63", "#ad7f58"]
ANCHORS = ("top", "center", "bottom")
MAX_SCALE = 20
MAX_PAD = 4096
_FILE = re.compile(r"(images|masks|results)/[A-Za-z0-9_]+\.(png|json)")


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def identity_transform(z: int = 0) -> dict:
    return {"scaleX": 1.0, "scaleY": 1.0, "rotation": 0.0, "anchor": "bottom", "dx": 0.0, "dy": 0.0, "z": z, "hidden": False}


def mask_bbox(mask: np.ndarray) -> list[int]:
    ys, xs = np.nonzero(mask)
    return [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]


def _finite(v, what: str) -> float:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        raise ValueError(f"{what} 必須是有限數字")
    return float(v)


def _check_transform(t, pid: str) -> dict:
    if not isinstance(t, dict):
        raise ValueError(f"部位 {pid} 的變形格式錯誤")
    out = {}
    for k in ("scaleX", "scaleY"):
        v = _finite(t.get(k), f"部位 {pid} 的 {k}")
        if not 0 < v <= MAX_SCALE:
            raise ValueError(f"部位 {pid} 的 {k} 必須在 0~{MAX_SCALE} 之間(不含 0)")
        out[k] = v
    for k in ("rotation", "dx", "dy"):
        out[k] = _finite(t.get(k), f"部位 {pid} 的 {k}")
    if t.get("anchor") not in ANCHORS:
        raise ValueError(f"部位 {pid} 的錨點不合法: {t.get('anchor')!r}")
    out["anchor"] = t["anchor"]
    z = t.get("z")
    if isinstance(z, bool) or not isinstance(z, int):
        raise ValueError(f"部位 {pid} 的圖層順序必須是整數")
    out["z"] = z
    if not isinstance(t.get("hidden"), bool):
        raise ValueError(f"部位 {pid} 的隱藏必須是 true/false")
    out["hidden"] = t["hidden"]
    return out


def _check_place(p, pid: str):
    if p is None:
        return None
    if not isinstance(p, dict):
        raise ValueError(f"部位 {pid} 的放置變形格式錯誤")
    scale = _finite(p.get("scale"), f"部位 {pid} 的放置縮放")
    if not 0 < scale <= MAX_SCALE:
        raise ValueError(f"部位 {pid} 的放置縮放必須在 0~{MAX_SCALE} 之間(不含 0)")
    return {"scale": scale, "tx": _finite(p.get("tx"), f"部位 {pid} 的放置 tx"),
            "ty": _finite(p.get("ty"), f"部位 {pid} 的放置 ty")}


def check_pad(pad) -> dict:
    if not isinstance(pad, dict):
        raise ValueError("畫布擴大格式錯誤")
    out = {}
    for k in ("top", "right", "bottom", "left"):
        v = pad.get(k)
        if isinstance(v, bool) or not isinstance(v, int) or not 0 <= v <= MAX_PAD:
            raise ValueError(f"畫布擴大的 {k} 必須是 0~{MAX_PAD} 的整數")
        out[k] = v
    return out


class Work:
    def __init__(self, root: Path, name: str, meta: dict):
        self.root = Path(root)
        self.name = name
        self.dir = self.root / name
        self.meta = meta

    # ---- 建立與讀取 ----
    @classmethod
    def create(cls, root, name: str, image_bytes: bytes, image_name: str = "主圖") -> "Work":
        validate_name(name)
        root = Path(root)
        if (root / name).exists():
            raise FileExistsError(f"作品「{name}」已存在")
        img = limit_size(load_rgb(image_bytes), config.MAX_SIDE)  # 先解碼, 壞圖不留下空資料夾
        now = _now()
        work = cls(root, name, {"version": 1, "name": name, "created": now, "updated": now,
                                "images": [], "parts": [], "pad": {"top": 0, "right": 0, "bottom": 0, "left": 0},
                                "results": [], "counters": {"image": 0, "part": 0, "result": 0}})
        try:
            for sub in ("images", "masks", "results"):
                (work.dir / sub).mkdir(parents=True)
            work._write_image("main", image_name, img)
            work.save_meta()
        except Exception:
            shutil.rmtree(work.dir, ignore_errors=True)
            raise
        return work

    @classmethod
    def open(cls, root, name: str) -> "Work":
        validate_name(name)
        meta_path = Path(root) / name / "meta.json"
        if not meta_path.is_file():
            raise FileNotFoundError(f"找不到作品「{name}」")
        return cls(root, name, json.loads(meta_path.read_text(encoding="utf-8")))

    @classmethod
    def list(cls, root) -> list[dict]:
        root = Path(root)
        if not root.is_dir():
            return []
        out = []
        for d in sorted(root.iterdir()):
            p = d / "meta.json"
            if p.is_file():
                m = json.loads(p.read_text(encoding="utf-8"))
                out.append({"name": m["name"], "updated": m.get("updated"), "results": len(m.get("results", []))})
        return out

    def save_meta(self) -> None:
        self.meta["updated"] = _now()
        tmp = self.dir / "meta.json.tmp"
        tmp.write_text(json.dumps(self.meta, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(self.dir / "meta.json")

    def _next(self, kind: str) -> int:
        self.meta["counters"][kind] += 1
        return self.meta["counters"][kind]

    # ---- 圖 ----
    def _write_image(self, image_id: str, name: str, img: np.ndarray) -> None:
        write_png(self.dir / "images" / f"{image_id}.png", img)
        h, w = img.shape[:2]
        self.meta["images"].append({"id": image_id, "name": name, "w": w, "h": h})

    def add_image(self, image_bytes: bytes, name: str) -> str:
        img = limit_size(load_rgb(image_bytes), config.MAX_SIDE)
        image_id = f"s{self._next('image')}"
        self._write_image(image_id, name or image_id, img)
        self.save_meta()
        return image_id

    def image_info(self, image_id: str) -> dict:
        for im in self.meta["images"]:
            if im["id"] == image_id:
                return im
        raise FileNotFoundError(f"找不到圖片 {image_id}")

    def image(self, image_id: str) -> np.ndarray:
        self.image_info(image_id)
        return read_png(self.dir / "images" / f"{image_id}.png")

    # ---- 部位 ----
    def part(self, part_id: str) -> dict:
        for p in self.meta["parts"]:
            if p["id"] == part_id:
                return p
        raise FileNotFoundError(f"找不到部位 {part_id}")

    def mask(self, part_id: str) -> np.ndarray:
        self.part(part_id)
        return read_png(self.dir / "masks" / f"{part_id}.png")

    def _check_mask(self, image_id: str, mask: np.ndarray) -> np.ndarray:
        info = self.image_info(image_id)
        if mask.shape[:2] != (info["h"], info["w"]):
            raise ValueError("遮罩尺寸與圖片不符")
        mask = np.where(mask > 127, 255, 0).astype(np.uint8)
        if not mask.any():
            raise ValueError("遮罩是空的")
        return mask

    def add_part(self, name: str, image_id: str, mask: np.ndarray, points: list, box) -> dict:
        mask = self._check_mask(image_id, mask)
        n = self._next("part")
        z = max((p["transform"]["z"] for p in self.meta["parts"]), default=0) + 1
        part = {"id": f"p{n}", "name": name, "image": image_id, "color": COLORS[(n - 1) % len(COLORS)],
                "points": list(points), "box": box, "placed": image_id == "main", "place": None,
                "transform": identity_transform(z), "bbox": mask_bbox(mask)}
        write_png(self.dir / "masks" / f"{part['id']}.png", mask)
        self.meta["parts"].append(part)
        self.save_meta()
        return part

    def update_part_mask(self, part_id: str, mask: np.ndarray, points: list, box) -> dict:
        part = self.part(part_id)
        mask = self._check_mask(part["image"], mask)
        write_png(self.dir / "masks" / f"{part_id}.png", mask)
        part.update(points=list(points), box=box, bbox=mask_bbox(mask))
        self.save_meta()
        return part

    def delete_part(self, part_id: str) -> None:
        part = self.part(part_id)
        self.meta["parts"].remove(part)
        (self.dir / "masks" / f"{part_id}.png").unlink(missing_ok=True)
        self.save_meta()

    def set_layout(self, parts: list, pad) -> None:
        """整包驗證通過才寫入; 任何一筆錯誤都不改動。"""
        if not isinstance(parts, list):
            raise ValueError("部位清單格式錯誤")
        staged = copy.deepcopy(self.meta)
        by_id = {p["id"]: p for p in staged["parts"]}
        for entry in parts:
            pid = entry.get("id") if isinstance(entry, dict) else entry
            if pid not in by_id:
                raise FileNotFoundError(f"找不到部位 {pid}")
            target = by_id[pid]
            transform = _check_transform(entry.get("transform"), pid)
            place = _check_place(entry.get("place"), pid)
            placed = entry.get("placed")
            if not isinstance(placed, bool):
                raise ValueError(f"部位 {pid} 的 placed 必須是 true/false")
            if target["image"] == "main":
                if place is not None or not placed:
                    raise ValueError(f"主圖部位 {pid} 不能有放置變形, 且必須在主圖上")
            elif placed and place is None:
                raise ValueError(f"外來部位 {pid} 放到主圖時必須有放置變形")
            target.update(transform=transform, place=place, placed=placed)
        staged["pad"] = check_pad(pad)
        self.meta = staged
        self.save_meta()

    # ---- 結果 ----
    def add_result(self, img: np.ndarray, params: dict) -> dict:
        rid = f"r{self._next('result')}"
        write_png(self.dir / "results" / f"{rid}.png", img)
        (self.dir / "results" / f"{rid}.json").write_text(json.dumps(params, ensure_ascii=False, indent=2), encoding="utf-8")
        entry = {"id": rid, "created": _now(), "model": params.get("model")}
        self.meta["results"].append(entry)
        self.save_meta()
        return entry

    def file_path(self, rel: str) -> Path:
        if not _FILE.fullmatch(rel):
            raise FileNotFoundError("找不到檔案")
        p = self.dir / rel
        if not p.is_file():
            raise FileNotFoundError("找不到檔案")
        return p
