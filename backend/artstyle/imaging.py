import base64
from pathlib import Path

import cv2
import numpy as np


def load_rgb(data: bytes) -> np.ndarray:
    """任意圖檔位元組 → RGB uint8。透明處鋪白, 灰階與 16bit 一律轉成 8bit RGB。"""
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_UNCHANGED)
    if img is None:
        raise ValueError("無法讀取圖片")
    if img.dtype == np.uint16:
        img = (img / 257).round().astype(np.uint8)
    elif img.dtype != np.uint8:
        img = cv2.normalize(img, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
    if img.ndim == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    elif img.shape[2] == 4:
        alpha = img[..., 3:4].astype(np.float32) / 255
        img = (img[..., :3] * alpha + 255 * (1 - alpha)).round().astype(np.uint8)
    return cv2.cvtColor(img, cv2.COLOR_BGR2RGB)


def limit_size(img: np.ndarray, max_side: int) -> np.ndarray:
    h, w = img.shape[:2]
    if max(h, w) <= max_side:
        return img
    scale = max_side / max(h, w)
    return cv2.resize(img, (max(1, round(w * scale)), max(1, round(h * scale))), interpolation=cv2.INTER_AREA)


def resize_to(img: np.ndarray, width: int, height: int, nearest: bool = False) -> np.ndarray:
    if img.shape[1] == width and img.shape[0] == height:
        return img
    if nearest:
        interp = cv2.INTER_NEAREST
    elif img.shape[1] > width:
        interp = cv2.INTER_AREA
    else:
        interp = cv2.INTER_LINEAR
    return cv2.resize(img, (width, height), interpolation=interp)


def _to_bgr(img: np.ndarray) -> np.ndarray:
    if img.ndim == 2:
        return img
    if img.shape[2] == 4:
        return cv2.cvtColor(img, cv2.COLOR_RGBA2BGRA)
    return cv2.cvtColor(img, cv2.COLOR_RGB2BGR)


def encode_png(img: np.ndarray) -> bytes:
    ok, buf = cv2.imencode(".png", _to_bgr(img))
    if not ok:
        raise ValueError("PNG 編碼失敗")
    return buf.tobytes()


def write_png(path, img: np.ndarray) -> None:
    Path(path).write_bytes(encode_png(img))


def decode_any(data: bytes) -> np.ndarray:
    """解碼成灰階(2D)或 RGB/RGBA, 不做其他轉換。"""
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_UNCHANGED)
    if img is None:
        raise ValueError("無法讀取圖片")
    if img.ndim == 2:
        return img
    if img.shape[2] == 4:
        return cv2.cvtColor(img, cv2.COLOR_BGRA2RGBA)
    return cv2.cvtColor(img, cv2.COLOR_BGR2RGB)


def read_png(path) -> np.ndarray:
    return decode_any(Path(path).read_bytes())


def to_gray(img: np.ndarray) -> np.ndarray:
    if img.ndim == 2:
        return img
    if img.shape[2] == 4:
        return cv2.cvtColor(img, cv2.COLOR_RGBA2GRAY)
    return cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)


def to_data_uri(img: np.ndarray) -> str:
    return "data:image/png;base64," + base64.b64encode(encode_png(img)).decode("ascii")


def load_rgba(data: bytes) -> np.ndarray:
    """任意圖檔位元組 → RGBA uint8, 保留透明; 沒有透明的圖 alpha 全 255。"""
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_UNCHANGED)
    if img is None:
        raise ValueError("無法讀取圖片")
    if img.dtype == np.uint16:
        img = (img / 257).round().astype(np.uint8)
    elif img.dtype != np.uint8:
        img = cv2.normalize(img, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
    if img.ndim == 2:
        return cv2.cvtColor(img, cv2.COLOR_GRAY2RGBA)
    if img.shape[2] == 4:
        return cv2.cvtColor(img, cv2.COLOR_BGRA2RGBA)
    return cv2.cvtColor(img, cv2.COLOR_BGR2RGBA)
