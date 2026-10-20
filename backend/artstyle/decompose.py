"""拆解各步驟的協調。每步完成就存檔, 後面的步驟失敗時前面的結果保留。"""
import numpy as np

from . import config
from .aiflat import FLAT_MODEL, FLAT_PROMPT, flat_regions
from .fal import DEPTH_MODEL, LINE_MODELS, FalClient
from .flat import paint, region_areas
from .imaging import load_rgb, resize_to
from .shade import encode_shade, region_shade
from .masks import ambient_occlusion, foreground, silhouette_sdf
from .lines import encode_sdf, line_mask, normalize_line, signed_distance
from .normals import depth_to_normal, detail_normal, focus_foreground, normalize_depth
from .pack import Pack
from .proportion.compose import letterbox, unbox
from .regions import decode_labels, encode_labels

STEPS = ["depth", "normal", "normal_detail", "line", "line_sdf", "regions", "flat", "shade", "ao", "silhouette_sdf"]
STEP_NAMES = {"depth": "深度", "normal": "法線", "normal_detail": "細部法線", "line": "線稿",
              "line_sdf": "線條距離場", "regions": "AI 平塗", "flat": "平塗", "ao": "環境遮蔽",
              "silhouette_sdf": "主體剪影", "shade": "原圖光影", "source": "原圖"}
DEFAULT_LINE_MODEL = "lineart"
REPLACEABLE = ["line", "normal"]


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
    elif step == "regions":
        # AI 畫平塗, 整理成色塊; 區塊與顏色都取自它
        _require(pack, "source")
        src = pack.read("source")
        sent, box = letterbox(src)
        ai = unbox(_client(client).edit(FLAT_MODEL, sent, FLAT_PROMPT, 1)[0], sent.shape[:2], box)
        labels, colors = flat_regions(resize_to(ai[..., :3], w, h), src)
        pack.write_layer("regions", encode_labels(labels), f"ai:{FLAT_MODEL}")
        pack.set_regions_meta(colors, region_areas(labels))
        if pack.has("silhouette_sdf"):
            run_step(pack, "silhouette_sdf", None)  # 剪影取自區塊, 區塊變了就要跟著重算
    elif step == "flat":
        _require(pack, "regions")
        labels = decode_labels(pack.read("regions"))
        colors = {int(k): v for k, v in pack.meta["regions"]["colors"].items()}
        pack.write_layer("flat", paint(labels, colors), pack.meta["layers"]["regions"]["origin"])
        run_step(pack, "shade", None)  # 原圖光影以 AI 平塗的顏色為準, 一起重算
    elif step == "shade":
        _require(pack, "regions")
        labels = decode_labels(pack.read("regions"))
        regions_meta = pack.meta["regions"]
        if not regions_meta.get("sampled"):
            regions_meta["sampled"] = {k: list(v) for k, v in regions_meta["colors"].items()}
            pack.save_meta()
        sampled = regions_meta["sampled"]
        flat_sampled = paint(labels, {int(k): v for k, v in sampled.items()})
        lines = line_mask(pack.read("line")) if pack.has("line") else None
        pack.write_layer("shade", encode_shade(region_shade(pack.read("source"), flat_sampled, labels, lines)), "computed")
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


REQUIRED_AI = {"depth", "line", "regions"}   # 沒有就無法渲染
PREREQS = {"normal": ["depth"], "line_sdf": ["line"], "flat": ["regions"], "shade": ["regions", "flat"], "ao": ["depth"]}


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
        if step in REQUIRED_AI and client is None:
            skipped.append(STEP_NAMES[step])
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
    else:
        pack.write_layer("normal", resize_to(img, w, h), "user")


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
