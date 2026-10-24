"""分層包: 一張圖一個資料夾, 存各層 PNG 與 meta.json。"""
import json
import shutil
from datetime import datetime
from pathlib import Path

import numpy as np

from . import config
from .imaging import limit_size, load_rgb, read_png, write_png
from .names import validate_name

LAYERS = ["source", "depth", "normal", "normal_detail", "line_ai", "line", "line_sdf", "delight", "regions", "flat", "user_flat", "flat_ai", "flat_seg", "ao", "silhouette_sdf", "shade"]
DEPENDENTS = {
    "source": ["depth", "normal_detail", "line", "regions", "flat", "shade"],
    "depth": ["normal", "normal_detail", "ao", "silhouette_sdf"],
    "line_ai": ["line"],
    "line": ["line_sdf", "shade", "regions"],
    "flat_ai": ["flat_seg", "regions"],
    "regions": ["flat", "silhouette_sdf", "shade"],
}


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


class Pack:
    def __init__(self, root: Path, name: str, meta: dict):
        self.root = Path(root)
        self.name = name
        self.dir = self.root / name
        self.meta = meta

    @classmethod
    def create(cls, root, name: str, image_bytes: bytes) -> "Pack":
        validate_name(name)
        root = Path(root)
        if (root / name).exists():
            raise FileExistsError(f"分層包「{name}」已存在")
        img = limit_size(load_rgb(image_bytes), config.MAX_SIDE)  # 先解碼, 壞圖不留下空資料夾
        (root / name).mkdir(parents=True)
        h, w = img.shape[:2]
        pack = cls(root, name, {"name": name, "width": w, "height": h, "created": _now(),
                                "layers": {}, "regions": {"count": 0, "colors": {}, "areas": {}}})
        try:
            pack.write_layer("source", img, "user")
        except Exception:
            shutil.rmtree(pack.dir, ignore_errors=True)
            raise
        return pack

    @classmethod
    def open(cls, root, name: str) -> "Pack":
        validate_name(name)
        meta_path = Path(root) / name / "meta.json"
        if not meta_path.is_file():
            raise FileNotFoundError(f"找不到分層包「{name}」")
        return cls(root, name, json.loads(meta_path.read_text(encoding="utf-8")))

    def path(self, layer: str) -> Path:
        if layer not in LAYERS:
            raise ValueError(f"未知的圖層: {layer}")
        return self.dir / f"{layer}.png"

    def has(self, layer: str) -> bool:
        return self.path(layer).is_file()

    def read(self, layer: str) -> np.ndarray:
        if not self.has(layer):
            raise ValueError(f"分層包「{self.name}」還沒有「{layer}」層")
        return read_png(self.path(layer))

    def is_stale(self, layer: str) -> bool:
        return bool(self.meta["layers"].get(layer, {}).get("stale"))

    def write_layer(self, layer: str, img: np.ndarray, origin: str, **extra) -> None:
        write_png(self.path(layer), img)
        entry = {**self.meta["layers"].get(layer, {}), **extra,
                 "origin": origin, "updated": _now(), "stale": False}
        self.meta["layers"][layer] = entry
        self._mark_stale(layer)
        self.save_meta()

    def update_layer_info(self, layer: str, **extra) -> None:
        self.meta["layers"].setdefault(layer, {}).update(extra)
        self.save_meta()

    def _mark_stale(self, layer: str) -> None:
        for child in DEPENDENTS.get(layer, []):
            if child in self.meta["layers"]:
                self.meta["layers"][child]["stale"] = True
            self._mark_stale(child)

    def set_regions_meta(self, colors: dict, areas: dict) -> None:
        """colors 是拆解當下取出的顏色: 同時存成可編輯的 colors 與不會被改的 sampled(算原圖細節用)。"""
        packed = {str(k): [int(c) for c in v] for k, v in colors.items()}
        self.meta["regions"] = {
            "count": len(colors),
            "colors": packed,
            "sampled": {k: list(v) for k, v in packed.items()},
            "areas": {str(k): int(v) for k, v in areas.items()},
        }
        self.save_meta()

    def save_meta(self) -> None:
        tmp = self.dir / "meta.json.tmp"
        tmp.write_text(json.dumps(self.meta, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(self.dir / "meta.json")
