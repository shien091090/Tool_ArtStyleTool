"""fal.ai 客戶端。只用在拆解段: 深度圖與線稿。"""
from typing import Protocol

import httpx
import numpy as np

from .imaging import decode_any, to_data_uri

DEPTH_MODEL = "fal-ai/imageutils/marigold-depth"
DELIGHT_MODEL = "fal-ai/flux-pro/kontext"
DELIGHT_PROMPT = ("Remove only the lighting from this illustration: no shadows, no highlights, no shading gradients, "
                  "no reflections. Keep every material's original hue and saturation exactly, just as evenly lit flat "
                  "base colors. Keep composition, outlines, proportions, framing and all details identical.")
# 使用者實測 lineart 效果最好, 只保留這一種
LINE_MODELS = {"lineart": "fal-ai/image-preprocessors/lineart"}


class FalError(Exception):
    pass


class FalClient(Protocol):
    def run_image(self, model: str, img: np.ndarray, **params) -> np.ndarray: ...


class HttpFalClient:
    def __init__(self, key: str, timeout: float = 180):
        self._key = key
        self._timeout = timeout

    def run_image(self, model: str, img: np.ndarray, **params) -> np.ndarray:
        body = {"image_url": to_data_uri(img), **params}
        try:
            with httpx.Client(timeout=self._timeout) as http:
                r = http.post(f"https://fal.run/{model}", json=body,
                              headers={"Authorization": f"Key {self._key}"})
                if r.status_code >= 400:
                    raise FalError(f"fal.ai 呼叫 {model} 失敗(HTTP {r.status_code}): {r.text[:300]}")
                try:
                    data = r.json()
                    url = data["image"]["url"] if "image" in data else data["images"][0]["url"]
                except (ValueError, KeyError, TypeError):
                    raise FalError(f"fal.ai 回傳格式不符({model}): {r.text[:300]}")
                img_resp = http.get(url)
                if img_resp.status_code >= 400:
                    raise FalError(f"下載 fal.ai 結果失敗(HTTP {img_resp.status_code})")
        except httpx.TimeoutException:
            raise FalError(f"fal.ai 呼叫 {model} 逾時({self._timeout:.0f} 秒)")
        except httpx.HTTPError as e:
            raise FalError(f"連不上 fal.ai: {e}")
        try:
            return decode_any(img_resp.content)
        except ValueError:
            raise FalError(f"fal.ai 回傳的圖片無法解碼({model})")
