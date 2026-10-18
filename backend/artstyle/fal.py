"""fal.ai 客戶端。拆解段(深度、線稿、去光影)與部位比例(切部位、修圖)。"""
import base64
from typing import Protocol

import httpx
import numpy as np

from .imaging import decode_any, resize_to, to_data_uri, to_gray

DEPTH_MODEL = "fal-ai/imageutils/marigold-depth"
DELIGHT_MODEL = "fal-ai/flux-pro/kontext"
DELIGHT_PROMPT = ("Remove only the lighting from this illustration: no shadows, no highlights, no shading gradients, "
                  "no reflections. Keep every material's original hue and saturation exactly, just as evenly lit flat "
                  "base colors. Keep composition, outlines, proportions, framing and all details identical.")
# 使用者實測 lineart 效果最好, 只保留這一種
LINE_MODELS = {"lineart": "fal-ai/image-preprocessors/lineart"}
SAM_MODEL = "fal-ai/sam-3/image"
# 實驗(2026-10-10): Nano Banana 最忠實, Qwen 次之; Kontext 會整張改色, 不提供
EDIT_MODELS = {"nano-banana": "fal-ai/nano-banana/edit", "qwen": "fal-ai/qwen-image-edit",
               # 像素素材: 指定格數只有 Pro 會照做(2026-10-12 實驗), 約 US$0.15/張
               "nano-banana-pro": "fal-ai/nano-banana-pro/edit",
               # 像素素材長邊 ≤ 96px: 最接近要求格數(2026-10-17 實驗), medium 約 US$0.06/張
               "gpt-image-2": "openai/gpt-image-2/edit"}
# 像素素材自動尺寸: 遊戲感強、會改色, 約 US$0.04/張
KONTEXT_MODEL = "fal-ai/flux-pro/kontext"
# 看圖回文字(列部位): 實測約 2.6 秒、每次 < US$0.001
VISION_ENDPOINT = "openrouter/router/vision"
VISION_MODEL = "google/gemini-2.5-flash"
# 帳號餘額(Platform API, 不花錢)
BALANCE_URL = "https://api.fal.ai/v1/account/billing?expand=credits"


class FalError(Exception):
    pass


class FalClient(Protocol):
    def run_image(self, model: str, img: np.ndarray, **params) -> np.ndarray: ...

    def segment(self, img: np.ndarray, prompt: str, points: list[dict], boxes: list[dict]) -> list[tuple[np.ndarray, float]]: ...

    def edit(self, model_key: str, img: np.ndarray, prompt: str, num_images: int,
             extra_images: list[np.ndarray] = ()) -> list[np.ndarray]: ...

    def vision(self, img: np.ndarray, prompt: str) -> str: ...

    def balance(self) -> dict: ...


class HttpFalClient:
    def __init__(self, key: str, timeout: float = 180, transport: httpx.BaseTransport | None = None):
        self._key = key
        self._timeout = timeout
        self._transport = transport

    def _http(self) -> httpx.Client:
        return httpx.Client(timeout=self._timeout, transport=self._transport)

    def _post(self, http: httpx.Client, model: str, body: dict) -> dict:
        r = http.post(f"https://fal.run/{model}", json=body, headers={"Authorization": f"Key {self._key}"})
        if r.status_code >= 400:
            if "content_policy_violation" in r.text:
                raise FalError(f"{model} 的內容審查擋下了這張圖(可能判定為血腥或暴力), 請換其他模型再試; "
                               "被擋下的請求 fal.ai 通常不收費")
            raise FalError(f"fal.ai 呼叫 {model} 失敗(HTTP {r.status_code}): {r.text[:300]}")
        try:
            return r.json()
        except ValueError:
            raise FalError(f"fal.ai 回傳格式不符({model}): {r.text[:300]}")

    def _download(self, http: httpx.Client, url: str, model: str) -> np.ndarray:
        if url.startswith("data:"):
            raw = base64.b64decode(url.split(",", 1)[1])
        else:
            resp = http.get(url)
            if resp.status_code >= 400:
                raise FalError(f"下載 fal.ai 結果失敗(HTTP {resp.status_code})")
            raw = resp.content
        try:
            return decode_any(raw)
        except ValueError:
            raise FalError(f"fal.ai 回傳的圖片無法解碼({model})")

    def _call(self, model: str, fn):
        try:
            with self._http() as http:
                return fn(http)
        except httpx.TimeoutException:
            raise FalError(f"fal.ai 呼叫 {model} 逾時({self._timeout:.0f} 秒)")
        except httpx.HTTPError as e:
            raise FalError(f"連不上 fal.ai: {e}")

    def run_image(self, model: str, img: np.ndarray, **params) -> np.ndarray:
        def fn(http):
            data = self._post(http, model, {"image_url": to_data_uri(img), **params})
            try:
                url = data["image"]["url"] if "image" in data else data["images"][0]["url"]
            except (KeyError, TypeError, IndexError):
                raise FalError(f"fal.ai 回傳格式不符({model}): {str(data)[:300]}")
            return self._download(http, url, model)
        return self._call(model, fn)

    def segment(self, img, prompt, points, boxes):
        h, w = img.shape[:2]

        def fn(http):
            data = self._post(http, SAM_MODEL, {
                "image_url": to_data_uri(img), "prompt": prompt, "point_prompts": points, "box_prompts": boxes,
                "apply_mask": False, "return_multiple_masks": True, "max_masks": 6, "include_scores": True})
            masks = data.get("masks") or []
            scores = data.get("scores") or [m.get("score") for m in data.get("metadata") or []]
            out = []
            for i, m in enumerate(masks):
                try:
                    url = m["url"]
                except (KeyError, TypeError):
                    raise FalError(f"fal.ai 回傳格式不符({SAM_MODEL}): {str(data)[:300]}")
                mk = self._download(http, url, SAM_MODEL)
                if mk.ndim == 3:
                    mk = mk[..., 3] if mk.shape[2] == 4 else to_gray(mk)
                mk = resize_to(mk, w, h, nearest=True)
                score = scores[i] if i < len(scores) and scores[i] is not None else 1.0
                out.append((np.where(mk > 127, 255, 0).astype(np.uint8), float(score)))
            return out
        return self._call(SAM_MODEL, fn)

    def balance(self):
        """回傳 {balance, currency}。"""
        def fn(http):
            r = http.get(BALANCE_URL, headers={"Authorization": f"Key {self._key}", "Accept": "application/json"})
            if r.status_code >= 400:
                raise FalError(f"查不到 fal.ai 餘額(HTTP {r.status_code}): {r.text[:200]}")
            try:
                credits = r.json()["credits"]
                return {"balance": float(credits["current_balance"]), "currency": str(credits.get("currency") or "USD")}
            except (ValueError, KeyError, TypeError):
                raise FalError(f"fal.ai 餘額格式不符: {r.text[:200]}")
        return self._call("billing", fn)

    def vision(self, img, prompt):
        body = {"model": VISION_MODEL, "prompt": prompt, "image_urls": [to_data_uri(img)]}

        def fn(http):
            data = self._post(http, VISION_ENDPOINT, body)
            out = data.get("output") if isinstance(data, dict) else None
            if not isinstance(out, str):
                raise FalError(f"fal.ai 回傳格式不符({VISION_ENDPOINT}): {str(data)[:300]}")
            return out
        return self._call(VISION_ENDPOINT, fn)

    def edit(self, model_key, img, prompt, num_images, extra_images=()):
        if model_key not in EDIT_MODELS:
            raise ValueError(f"不支援的修圖模型: {model_key}")
        model = EDIT_MODELS[model_key]
        h, w = img.shape[:2]
        body = {"prompt": prompt, "num_images": int(num_images)}
        if model_key.startswith("nano-banana") or model_key == "gpt-image-2":
            body["image_urls"] = [to_data_uri(img)] + [to_data_uri(x) for x in extra_images]
            if model_key == "gpt-image-2":
                body["quality"] = "medium"
        elif extra_images:
            raise ValueError(f"{model_key} 不支援多張輸入圖")
        else:
            body["image_url"] = to_data_uri(img)
            body["image_size"] = {"width": w, "height": h}

        def fn(http):
            data = self._post(http, model, body)
            try:
                urls = [im["url"] for im in data["images"]]
            except (KeyError, TypeError):
                raise FalError(f"fal.ai 回傳格式不符({model}): {str(data)[:300]}")
            if not urls:
                raise FalError(f"fal.ai 沒有回傳圖片({model})")
            return [self._download(http, u, model) for u in urls]
        return self._call(model, fn)
