"""拆解各步驟的協調。每步完成就存檔, 後面的步驟失敗時前面的結果保留。"""
import numpy as np

from . import config
from .colorseg import color_segments, merge_similar
from .fal import DELIGHT_MODEL, DELIGHT_PROMPT, DEPTH_MODEL, LINE_MODELS, FalClient
from .flat import paint, region_areas, region_colors
from .imaging import load_rgb, resize_to
from .masks import ambient_occlusion, foreground, silhouette_sdf
from .lines import encode_sdf, line_mask, normalize_line, signed_distance
from .normals import depth_to_normal, detail_normal, focus_foreground, normalize_depth
from .pack import Pack
from .regions import decode_labels, encode_labels, label_regions

STEPS = ["depth", "normal", "normal_detail", "line", "line_sdf", "delight", "regions", "flat", "ao", "silhouette_sdf"]
STEP_NAMES = {"depth": "深度", "normal": "法線", "normal_detail": "細部法線", "line": "線稿",
              "line_sdf": "線條距離場", "delight": "AI 去光影", "regions": "區塊", "flat": "平塗", "ao": "環境遮蔽",
              "silhouette_sdf": "主體剪影", "source": "原圖"}
DEFAULT_LINE_MODEL = "lineart"
REPLACEABLE = ["line", "normal", "flat"]

# 區塊參數: (預設值, 最小, 最大)
REGION_DEFAULTS = {"method": "color", "color_source": "delight", "colors": 12, "min_area": 30,
                   "gap_radius": 3, "merge": 0.06}
REGION_LIMITS = {"colors": (2, 64), "min_area": (1, 100000), "gap_radius": (0, 16), "merge": (0.0, 0.5)}


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


def _region_params(pack: Pack, params: dict) -> dict:
    stored = {**REGION_DEFAULTS, **pack.meta["layers"].get("regions", {}).get("params", {})}
    p = {**stored, **{k: v for k, v in params.items() if k in REGION_DEFAULTS}}
    if p["method"] not in ("color", "line"):
        raise ValueError(f"未知的切法: {p['method']}(可用: color、line)")
    if p["color_source"] not in ("delight", "source"):
        raise ValueError(f"未知的取色來源: {p['color_source']}(可用: delight、source)")
    for key, (lo, hi) in REGION_LIMITS.items():
        try:
            v = float(p[key])
        except (TypeError, ValueError):
            raise ValueError(f"「{key}」必須是數字")
        v = min(hi, max(lo, v))
        p[key] = v if key == "merge" else int(round(v))
    return p


def _color_image(pack: Pack, params: dict) -> np.ndarray:
    """取色(與依顏色切區塊)用的圖: 使用者上傳的平塗 > AI 去光影(有且被選用) > 原圖。"""
    if pack.meta.get("flat_color_source") == "user_flat" and pack.has("user_flat"):
        return pack.read("user_flat")
    if params["color_source"] == "delight" and pack.has("delight"):
        return pack.read("delight")
    return pack.read("source")


def _depth01(pack: Pack) -> np.ndarray:
    raw = pack.read("depth")
    return raw.astype(np.float32) / (65535 if raw.dtype == np.uint16 else 255)


def run_step(pack: Pack, step: str, client: FalClient | None, **params) -> None:
    w, h = _size(pack)
    if step == "depth":
        _require(pack, "source")
        raw = _client(client).run_image(DEPTH_MODEL, pack.read("source"))
        d = focus_foreground(normalize_depth(raw, w, h, config.DEPTH_NEAR_IS_BRIGHT))
        pack.write_layer("depth", np.round(d * 65535).astype(np.uint16), f"ai:{DEPTH_MODEL}")
    elif step == "normal":
        _require(pack, "depth")
        pack.write_layer("normal", depth_to_normal(_depth01(pack)), "computed")
    elif step == "normal_detail":
        _require(pack, "source")
        # 只在主體上算細部; 沒有深度(例如使用者上傳法線)就整張都算
        mask = _depth01(pack) > 0.001 if pack.has("depth") else np.ones((h, w), bool)
        pack.write_layer("normal_detail", detail_normal(pack.read("source"), mask), "computed")
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
    elif step == "delight":
        _require(pack, "source")
        raw = _client(client).run_image(DELIGHT_MODEL, pack.read("source"), prompt=DELIGHT_PROMPT, output_format="png")
        img = raw if raw.ndim == 3 else np.dstack([raw] * 3)
        pack.write_layer("delight", resize_to(img[..., :3], w, h), f"ai:{DELIGHT_MODEL}")
    elif step == "regions":
        p = _region_params(pack, params)
        if p["method"] == "color":
            labels = color_segments(_color_image(pack, p), k=p["colors"], min_area=p["min_area"])
        else:
            _require(pack, "line")
            mask = line_mask(pack.read("line"))
            labels = label_regions(mask, gap_radius=p["gap_radius"], min_area=p["min_area"])
            if p["merge"] > 0:
                colors = region_colors(labels, _color_image(pack, p), exclude=mask)
                labels, _ = merge_similar(labels, colors, region_areas(labels), p["merge"])
                _, inv = np.unique(labels, return_inverse=True)
                labels = (inv.reshape(labels.shape) + 1).astype(np.int32)
        pack.write_layer("regions", encode_labels(labels), "computed", params=p)
    elif step == "flat":
        _require(pack, "regions")
        p = _region_params(pack, {})
        labels = decode_labels(pack.read("regions"))
        exclude = line_mask(pack.read("line")) if pack.has("line") else None
        colors = region_colors(labels, _color_image(pack, p), exclude=exclude)
        source = "user_flat" if pack.meta.get("flat_color_source") == "user_flat" else p["color_source"]
        pack.write_layer("flat", paint(labels, colors), "computed", color_source=source)
        pack.set_regions_meta(colors, region_areas(labels))
    elif step == "ao":
        _require(pack, "depth")
        d = _depth01(pack)
        pack.write_layer("ao", ambient_occlusion(d, foreground(d, None)), "computed")
    elif step == "silhouette_sdf":
        if not (pack.has("depth") or pack.has("regions")):
            raise ValueError("請先完成「深度」或「區塊」")
        d = _depth01(pack) if pack.has("depth") else None
        labels = decode_labels(pack.read("regions")) if pack.has("regions") else None
        pack.write_layer("silhouette_sdf", silhouette_sdf(foreground(d, labels, (h, w))), "computed")
    else:
        raise ValueError(f"未知的步驟: {step}")


REQUIRED_AI = {"depth", "line"}   # 沒有就無法渲染
OPTIONAL_AI = {"delight"}         # 沒有就退回原圖取色
PREREQS = {"normal": ["depth"], "line_sdf": ["line"], "flat": ["regions"], "ao": ["depth"]}


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
        if step in REQUIRED_AI | OPTIONAL_AI and client is None:
            if step in REQUIRED_AI:
                skipped.append(STEP_NAMES[step])
            continue
        if step == "regions" and _region_params(pack, {})["method"] == "line" and not pack.has("line"):
            continue
        if step == "silhouette_sdf" and not (pack.has("depth") or pack.has("regions")):
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
        if pack.has("regions"):
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
