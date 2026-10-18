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
from ..imaging import flatten_white, limit_size, load_rgb, load_rgba, read_png, write_png
from ..names import validate_name

COLORS = ["#e5484d", "#30a46c", "#0090ff", "#f76b15", "#8e4ec6", "#12a594",
          "#e93d82", "#ffc53d", "#3e63dd", "#7ce2fe", "#bdee63", "#ad7f58"]
ANCHORS = ("top", "center", "bottom")
MAX_SCALE = 20
MAX_PAD = 4096
# 每個部位保留幾版之前的切法(遮罩), 給「復原上一次切法」用
MASK_HISTORY = 10
_FILE = re.compile(r"(images|masks|results|materials)/[A-Za-z0-9_]+\.(png|json)")


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def identity_transform(z: int = 0) -> dict:
    return {"scaleX": 1.0, "scaleY": 1.0, "rotation": 0.0, "anchor": "bottom", "dx": 0.0, "dy": 0.0, "z": z, "hidden": False}


def mask_bbox(mask: np.ndarray) -> list[int]:
    ys, xs = np.nonzero(mask)
    return [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]


def _edges(bbox: list[int], place) -> tuple[float, float, float, float]:
    """放到主圖後的外框邊緣(右下 +1), 與前端 placedEdges 相同。"""
    s = place["scale"] if place else 1.0
    tx = place["tx"] if place else 0.0
    ty = place["ty"] if place else 0.0
    return bbox[0] * s + tx, bbox[1] * s + ty, (bbox[2] + 1) * s + tx, (bbox[3] + 1) * s + ty


def _anchor(edges, anchor: str) -> tuple[float, float]:
    x0, y0, x1, y1 = edges
    y = y0 if anchor == "top" else y1 if anchor == "bottom" else (y0 + y1) / 2
    return (x0 + x1) / 2, y


def rebase_transform(t: dict, place, old_bbox: list[int], new_bbox: list[int]) -> dict:
    """遮罩外框變了(重切、拆左右)時改 dx/dy, 讓同一個變形畫出來的位置不跳動。
    p' = A + off + RS(p − A); 新錨點 A' 時 off' = A + off − A' + RS(A' − A)。"""
    e0 = _edges(old_bbox, place)
    e1 = _edges(new_bbox, place)
    ax, ay = _anchor(e0, t["anchor"])
    bx, by = _anchor(e1, t["anchor"])
    off_x = t["dx"] * (e0[2] - e0[0])
    off_y = t["dy"] * (e0[3] - e0[1])
    r = math.radians(t["rotation"])
    vx, vy = (bx - ax) * t["scaleX"], (by - ay) * t["scaleY"]
    rx, ry = vx * math.cos(r) - vy * math.sin(r), vx * math.sin(r) + vy * math.cos(r)
    nx = ax + off_x - bx + rx
    ny = ay + off_y - by + ry
    return {**t, "dx": nx / (e1[2] - e1[0]), "dy": ny / (e1[3] - e1[1])}


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
        # 主圖保留透明(去背過的圖), 部位才能放到主圖後面; 先解碼, 壞圖不留下空資料夾
        img = limit_size(load_rgba(image_bytes), config.MAX_SIDE)
        now = _now()
        work = cls(root, name, {"version": 1, "name": name, "created": now, "updated": now,
                                "images": [], "parts": [], "pad": {"top": 0, "right": 0, "bottom": 0, "left": 0},
                                "results": [], "counters": {"image": 0, "part": 0, "result": 0}})
        try:
            for sub in ("images", "masks", "results", "materials"):
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

    def delete(self) -> None:
        """整個資料夾從硬碟刪掉, 無法復原。"""
        shutil.rmtree(self.dir)

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
                out.append({"name": m["name"], "updated": m.get("updated"), "results": len(m.get("results", []))})
            except (ValueError, KeyError, TypeError):
                continue  # 壞掉的作品不拖累整份清單
        return out

    def save_meta(self) -> None:
        self.meta["updated"] = _now()
        tmp = self.dir / "meta.json.tmp"
        tmp.write_text(json.dumps(self.meta, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(self.dir / "meta.json")

    def _next(self, kind: str) -> int:
        self.meta["counters"].setdefault(kind, 0)  # 舊作品沒有後來加的計數器
        self.meta["counters"][kind] += 1
        return self.meta["counters"][kind]

    # ---- 圖 ----
    def _write_image(self, image_id: str, name: str, img: np.ndarray) -> None:
        write_png(self.dir / "images" / f"{image_id}.png", img)
        h, w = img.shape[:2]
        self.meta["images"].append({"id": image_id, "name": name, "w": w, "h": h})

    def add_image(self, image_bytes: bytes, name: str) -> str:
        return self.add_image_rgb(load_rgb(image_bytes), name)

    def add_image_rgb(self, img: np.ndarray, name: str, **extra) -> str:
        """加入素材圖; extra 是額外記在圖片資訊上的欄位(例如流程的來源節點與版本)。"""
        img = limit_size(img, config.MAX_SIDE)
        image_id = f"s{self._next('image')}"
        self._write_image(image_id, name or image_id, img)
        self.meta["images"][-1].update(extra)
        self.save_meta()
        return image_id

    def remove_image(self, image_id: str) -> None:
        """刪素材圖, 連同從它切出的部位與材質候選。"""
        if image_id == "main":
            raise ValueError("主圖不能刪")
        info = self.image_info(image_id)
        for p in [p for p in self.meta["parts"] if p["image"] == image_id]:
            self.delete_part(p["id"])
        self.meta["images"].remove(info)
        (self.dir / "images" / f"{image_id}.png").unlink(missing_ok=True)
        self.save_meta()

    def image_info(self, image_id: str) -> dict:
        for im in self.meta["images"]:
            if im["id"] == image_id:
                return im
        raise FileNotFoundError(f"找不到圖片 {image_id}")

    def image(self, image_id: str) -> np.ndarray:
        self.image_info(image_id)
        return read_png(self.dir / "images" / f"{image_id}.png")

    def image_rgb(self, image_id: str) -> np.ndarray:
        """送 AI 用: 透明處鋪白。"""
        return flatten_white(self.image(image_id))

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
        # 主圖的圖層是 0, 新部位一律疊在主圖與所有部位上面
        z = max(max((p["transform"]["z"] for p in self.meta["parts"]), default=0) + 1, 1)
        part = {"id": f"p{n}", "name": name, "image": image_id, "color": COLORS[(n - 1) % len(COLORS)],
                "points": list(points), "box": box, "placed": image_id == "main", "place": None,
                "transform": identity_transform(z), "bbox": mask_bbox(mask)}
        write_png(self.dir / "masks" / f"{part['id']}.png", mask)
        self.meta["parts"].append(part)
        self.save_meta()
        return part

    def update_part_mask(self, part_id: str, mask: np.ndarray, points: list, box, record: bool = True) -> dict:
        """換部位遮罩; record 時先把上一版存進歷史, 可以復原。"""
        part = self.part(part_id)
        mask = self._check_mask(part["image"], mask)
        if record:
            hid = f"{part_id}_h{self._next('mask')}"
            shutil.copyfile(self.dir / "masks" / f"{part_id}.png", self.dir / "masks" / f"{hid}.png")
            hist = part.setdefault("history", [])
            hist.append({"file": hid, "points": part["points"], "box": part["box"], "bbox": part["bbox"],
                         "transform": dict(part["transform"])})
            while len(hist) > MASK_HISTORY:
                (self.dir / "masks" / f"{hist.pop(0)['file']}.png").unlink(missing_ok=True)
        write_png(self.dir / "masks" / f"{part_id}.png", mask)
        bbox = mask_bbox(mask)
        part.update(points=list(points), box=box, bbox=bbox, rev=part.get("rev", 0) + 1,
                    transform=rebase_transform(part["transform"], part["place"], part["bbox"], bbox))
        self.save_meta()
        return part

    def undo_mask(self, part_id: str) -> dict:
        """切法退回上一版(遮罩、點、框、變形一起退)。"""
        part = self.part(part_id)
        hist = part.get("history") or []
        if not hist:
            raise ValueError("這個部位沒有可以復原的切法")
        h = hist.pop()
        src = self.dir / "masks" / f"{h['file']}.png"
        shutil.copyfile(src, self.dir / "masks" / f"{part_id}.png")
        src.unlink(missing_ok=True)
        part.update(points=h["points"], box=h["box"], bbox=h["bbox"], transform=h["transform"],
                    rev=part.get("rev", 0) + 1)
        self.save_meta()
        return part

    def delete_part(self, part_id: str) -> None:
        part = self.part(part_id)
        for h in part.get("history") or []:
            (self.dir / "masks" / f"{h['file']}.png").unlink(missing_ok=True)
        for v in self.part_material(part_id)["variants"]:
            self._delete_variant_files(v["id"])
        self.meta["parts"].remove(part)
        (self.dir / "masks" / f"{part_id}.png").unlink(missing_ok=True)
        self.save_meta()

    # ---- 材質 ----
    def part_material(self, part_id: str) -> dict:
        """部位的材質候選; 舊作品沒有這欄時補上預設(只在記憶體, 下次存檔才寫入)。"""
        return self.part(part_id).setdefault("material", {"current": None, "variants": []})

    def _material_path(self, vid: str, ref: bool = False) -> Path:
        return self.dir / "materials" / (f"{vid}_ref.png" if ref else f"{vid}.png")

    def _delete_variant_files(self, vid: str) -> None:
        self._material_path(vid).unlink(missing_ok=True)
        self._material_path(vid, True).unlink(missing_ok=True)

    def add_material_variant(self, part_id: str, img: np.ndarray, material: str, ref: np.ndarray | None) -> dict:
        """新增候選(整張來源圖大小); 部位目前是原本材質時自動套用。"""
        part = self.part(part_id)
        info = self.image_info(part["image"])
        if img.shape[:2] != (info["h"], info["w"]):
            raise ValueError("材質圖尺寸與來源圖不符")
        mat = self.part_material(part_id)
        vid = f"m{self._next('material')}"
        (self.dir / "materials").mkdir(exist_ok=True)
        write_png(self._material_path(vid), img)
        if ref is not None:
            write_png(self._material_path(vid, True), ref)
        v = {"id": vid, "material": material, "ref": ref is not None, "created": _now()}
        mat["variants"].append(v)
        if mat["current"] is None:
            mat["current"] = vid
        self.save_meta()
        return v

    def set_material(self, part_id: str, vid: str | None) -> None:
        mat = self.part_material(part_id)
        if vid is not None and vid not in [v["id"] for v in mat["variants"]]:
            raise FileNotFoundError(f"找不到材質候選 {vid}")
        mat["current"] = vid
        self.save_meta()

    def delete_material(self, part_id: str, vid: str) -> None:
        mat = self.part_material(part_id)
        v = next((v for v in mat["variants"] if v["id"] == vid), None)
        if v is None:
            raise FileNotFoundError(f"找不到材質候選 {vid}")
        mat["variants"].remove(v)
        if mat["current"] == vid:
            mat["current"] = None
        self._delete_variant_files(vid)
        self.save_meta()

    def material_image(self, part_id: str) -> np.ndarray:
        """部位目前的像素來源: 套用中的候選, 否則來源圖。"""
        part = self.part(part_id)
        cur = self.part_material(part_id)["current"]
        return read_png(self._material_path(cur)) if cur else self.image(part["image"])

    def copy_materials(self, src_id: str, dst_id: str) -> None:
        """拆左右用: 候選檔複製一份(新編號), 套用中的對應過去。"""
        src = self.part_material(src_id)
        dst = self.part_material(dst_id)
        for v in src["variants"]:
            nid = f"m{self._next('material')}"
            shutil.copyfile(self._material_path(v["id"]), self._material_path(nid))
            if v["ref"]:
                shutil.copyfile(self._material_path(v["id"], True), self._material_path(nid, True))
            dst["variants"].append({**v, "id": nid})
            if src["current"] == v["id"]:
                dst["current"] = nid
        self.save_meta()

    # ---- 別名(AI 列部位時記下的中文名 → 英文) ----
    def aliases(self) -> dict:
        return dict(self.meta.get("aliases") or {})

    def set_alias(self, zh: str, en: str) -> None:
        self.meta.setdefault("aliases", {})[zh] = en
        self.save_meta()

    def set_layout(self, parts: list, pad) -> None:
        """整包驗證通過才寫入; 任何一筆錯誤都不改動。"""
        if not isinstance(parts, list):
            raise ValueError("部位清單格式錯誤")
        staged = copy.deepcopy(self.meta)
        by_id = {p["id"]: p for p in staged["parts"]}
        for entry in parts:
            if not isinstance(entry, dict) or not isinstance(entry.get("id"), str):
                raise ValueError("部位清單格式錯誤")
            pid = entry["id"]
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
