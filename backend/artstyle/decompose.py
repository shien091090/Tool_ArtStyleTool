"""拆解各步驟的協調。每步完成就存檔, 後面的步驟失敗時前面的結果保留。"""
import numpy as np

from . import config
from .fal import DEPTH_MODEL, LINE_MODELS, FalClient
from .flat import paint, region_areas, region_colors
from .imaging import load_rgb, resize_to
from .lines import encode_sdf, line_mask, normalize_line, signed_distance
from .normals import depth_to_normal, focus_foreground, normalize_depth
from .pack import Pack
from .regions import decode_labels, encode_labels, label_regions

STEPS = ["depth", "normal", "line", "line_sdf", "regions", "flat"]
STEP_NAMES = {"depth": "深度", "normal": "法線", "line": "線稿", "line_sdf": "線條距離場",
              "regions": "區塊", "flat": "平塗", "source": "原圖"}
DEFAULT_LINE_MODEL = "teed"
REPLACEABLE = ["line", "normal", "flat"]


class NoClientError(Exception):
    pass


def _require(pack: Pack, *layers: str) -> None:
    for layer in layers:
        if not pack.has(layer):
            raise ValueError(f"請先完成「{STEP_NAMES[layer]}」")


def _client(client: FalClient | None) -> FalClient:
    if client is None:
        raise NoClientError("沒有設定 FAL_KEY 環境變數, 無法呼叫 fal.ai")
    return client


def _size(pack: Pack) -> tuple[int, int]:
    return pack.meta["width"], pack.meta["height"]


def run_step(pack: Pack, step: str, client: FalClient | None, **params) -> None:
    w, h = _size(pack)
    if step == "depth":
        _require(pack, "source")
        raw = _client(client).run_image(DEPTH_MODEL, pack.read("source"))
        d = focus_foreground(normalize_depth(raw, w, h, config.DEPTH_NEAR_IS_BRIGHT))
        pack.write_layer("depth", np.round(d * 65535).astype(np.uint16), f"ai:{DEPTH_MODEL}")
    elif step == "normal":
        _require(pack, "depth")
        raw = pack.read("depth")
        d = raw.astype(np.float32) / (65535 if raw.dtype == np.uint16 else 255)
        pack.write_layer("normal", depth_to_normal(d), "computed")
    elif step == "line":
        _require(pack, "source")
        key = params.get("model", DEFAULT_LINE_MODEL)
        if key not in LINE_MODELS:
            raise ValueError(f"未知的線稿模型: {key}(可用: {', '.join(LINE_MODELS)})")
        raw = _client(client).run_image(LINE_MODELS[key], pack.read("source"))
        pack.write_layer("line", normalize_line(raw, w, h), f"ai:{LINE_MODELS[key]}")
    elif step == "line_sdf":
        _require(pack, "line")
        pack.write_layer("line_sdf", encode_sdf(signed_distance(line_mask(pack.read("line")))), "computed")
    elif step == "regions":
        _require(pack, "line")
        stored = pack.meta["layers"].get("regions", {}).get("params", {})
        gap = int(np.clip(int(params.get("gap_radius", stored.get("gap_radius", 3))), 0, 16))
        area = int(np.clip(int(params.get("min_area", stored.get("min_area", 12))), 1, 100000))
        labels = label_regions(line_mask(pack.read("line")), gap_radius=gap, min_area=area)
        pack.write_layer("regions", encode_labels(labels), "computed",
                         params={"gap_radius": gap, "min_area": area})
    elif step == "flat":
        _require(pack, "regions", "line")
        source = pack.meta.get("flat_color_source") or pack.meta["layers"].get("flat", {}).get("color_source", "source")
        color_img = pack.read("user_flat" if source == "user_flat" else "source")
        labels = decode_labels(pack.read("regions"))
        colors = region_colors(labels, color_img, exclude=line_mask(pack.read("line")))
        pack.write_layer("flat", paint(labels, colors), "computed", color_source=source)
        pack.set_regions_meta(colors, region_areas(labels))
    else:
        raise ValueError(f"未知的步驟: {step}")


AI_STEPS = {"depth", "line"}
PREREQS = {"normal": ["depth"], "line_sdf": ["line"], "regions": ["line"], "flat": ["regions", "line"]}


def _fresh(pack: Pack, layer: str) -> bool:
    return pack.has(layer) and not pack.is_stale(layer)


def run_all(pack: Pack, client: FalClient | None) -> None:
    """依序跑「不存在或已過期」的步驟。沒有金鑰時跳過 AI 步驟、照樣跑完本機能算的, 最後再回報缺什麼。"""
    skipped = []
    for step in STEPS:
        if _fresh(pack, step):
            continue
        if step == "depth" and _fresh(pack, "normal"):
            continue  # 已有(使用者上傳的)法線, 不必再花錢推深度
        if step in AI_STEPS and client is None:
            skipped.append(STEP_NAMES[step])
            continue
        if not all(pack.has(p) for p in PREREQS.get(step, [])):
            continue
        run_step(pack, step, client)
    if skipped:
        raise NoClientError(f"沒有設定 FAL_KEY 環境變數, 無法產生「{'、'.join(skipped)}」。"
                            "本機能算的步驟已完成, 也可以改上傳自己的線稿或法線圖")


def replace_layer(pack: Pack, layer: str, image_bytes: bytes) -> None:
    if layer not in REPLACEABLE:
        raise ValueError(f"「{layer}」不能替換(可替換: {', '.join(REPLACEABLE)})")
    w, h = _size(pack)
    img = load_rgb(image_bytes)
    if layer == "line":
        pack.write_layer("line", normalize_line(img, w, h), "user")
    elif layer == "normal":
        pack.write_layer("normal", resize_to(img, w, h), "user")
    else:
        pack.write_layer("user_flat", resize_to(img, w, h, nearest=True), "user")
        pack.meta["flat_color_source"] = "user_flat"
        pack.save_meta()
        if pack.has("regions") and pack.has("line"):
            run_step(pack, "flat", None)


def region_at(pack: Pack, y: int, x: int) -> int:
    labels = decode_labels(pack.read("regions"))
    if not (0 <= y < labels.shape[0] and 0 <= x < labels.shape[1]):
        raise ValueError(f"座標超出圖片範圍: ({x}, {y})")
    return int(labels[y, x])


def set_region_color(pack: Pack, region_id: int, rgb) -> None:
    rgb = [int(v) for v in rgb]
    if len(rgb) != 3 or not all(0 <= v <= 255 for v in rgb):
        raise ValueError("顏色必須是三個 0~255 的整數")
    colors = pack.meta["regions"]["colors"]
    if str(region_id) not in colors:
        raise ValueError(f"沒有編號 {region_id} 的區塊")
    colors[str(region_id)] = rgb
    labels = decode_labels(pack.read("regions"))
    flat = paint(labels, {int(k): v for k, v in colors.items()})
    entry = pack.meta["layers"].get("flat", {})
    pack.write_layer("flat", flat, entry.get("origin", "computed"))
