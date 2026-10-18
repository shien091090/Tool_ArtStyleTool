import base64
import json

import cv2
import httpx
import numpy as np
import pytest

from artstyle.fal import EDIT_MODELS, SAM_MODEL, VISION_ENDPOINT, VISION_MODEL, FalError, HttpFalClient


def _png_uri(img):
    return "data:image/png;base64," + base64.b64encode(cv2.imencode(".png", img)[1].tobytes()).decode()


def _client(handler):
    return HttpFalClient("k", transport=httpx.MockTransport(handler))


def test_segment_parses_masks_and_scores():
    m1 = np.zeros((30, 40), np.uint8); m1[:10] = 255           # 一半尺寸的灰階遮罩
    m2 = np.zeros((30, 40, 4), np.uint8); m2[20:, :, 3] = 255  # RGBA 遮罩取 alpha
    sent = {}

    def handler(req):
        sent["url"] = str(req.url)
        sent["body"] = json.loads(req.content)
        return httpx.Response(200, json={"masks": [{"url": _png_uri(m1)}, {"url": _png_uri(m2)}], "scores": [0.9, 0.2]})

    img = np.zeros((60, 80, 3), np.uint8)
    out = _client(handler).segment(img, "head", [{"x": 1, "y": 2, "label": 1}], [{"x_min": 0, "y_min": 0, "x_max": 5, "y_max": 5}])
    assert sent["url"].endswith(SAM_MODEL)
    body = sent["body"]
    assert body["prompt"] == "head" and body["apply_mask"] is False and body["return_multiple_masks"] is True
    assert body["point_prompts"] == [{"x": 1, "y": 2, "label": 1}] and len(body["box_prompts"]) == 1
    assert [s for _, s in out] == [0.9, 0.2]
    a, b = out[0][0], out[1][0]
    assert a.shape == (60, 80) and a[:20].min() == 255 and a[20:].max() == 0
    assert b[40:].min() == 255 and b[:40].max() == 0


def test_segment_no_masks_returns_empty():
    assert _client(lambda r: httpx.Response(200, json={"masks": None})).segment(np.zeros((4, 4, 3), np.uint8), "x", [], []) == []


def test_edit_payload_per_model():
    sent = []
    res = np.full((10, 12, 3), 200, np.uint8)

    def handler(req):
        if req.method == "GET":
            return httpx.Response(200, content=cv2.imencode(".png", res)[1].tobytes())
        sent.append((str(req.url), json.loads(req.content)))
        return httpx.Response(200, json={"images": [{"url": "https://x/a.png"}, {"url": "https://x/b.png"}]})

    c = _client(handler)
    img = np.zeros((20, 30, 3), np.uint8)
    out = c.edit("nano-banana", img, "fix", 2)
    assert len(out) == 2 and out[0].shape == (10, 12, 3)
    url, body = sent[0]
    assert url.endswith(EDIT_MODELS["nano-banana"]) and "image_urls" in body and body["num_images"] == 2
    c.edit("qwen", img, "fix", 1)
    url, body = sent[1]
    assert url.endswith(EDIT_MODELS["qwen"]) and "image_url" in body and body["image_size"] == {"width": 30, "height": 20}
    c.edit("nano-banana-pro", img, "fix", 1)
    url, body = sent[2]
    assert url.endswith("fal-ai/nano-banana-pro/edit") and len(body["image_urls"]) == 1
    c.edit("gpt-image-2", img, "fix", 1)
    url, body = sent[3]
    assert url.endswith("openai/gpt-image-2/edit") and len(body["image_urls"]) == 1 and body["quality"] == "medium"


def test_edit_unknown_model_and_http_error():
    c = _client(lambda r: httpx.Response(400, text="bad"))
    with pytest.raises(ValueError):
        c.edit("kontext", np.zeros((4, 4, 3), np.uint8), "x", 1)
    with pytest.raises(FalError):
        c.edit("qwen", np.zeros((4, 4, 3), np.uint8), "x", 1)


def test_vision_returns_output_text():
    sent = {}

    def handler(req):
        sent["url"] = str(req.url)
        sent["body"] = json.loads(req.content)
        return httpx.Response(200, json={"output": "hello"})

    out = _client(handler).vision(np.zeros((8, 8, 3), np.uint8), "list parts")
    assert out == "hello"
    assert sent["url"].endswith(VISION_ENDPOINT)
    assert sent["body"]["model"] == VISION_MODEL and sent["body"]["prompt"] == "list parts"
    assert len(sent["body"]["image_urls"]) == 1


def test_vision_bad_payload_raises():
    with pytest.raises(FalError):
        _client(lambda r: httpx.Response(200, json={"nope": 1})).vision(np.zeros((4, 4, 3), np.uint8), "x")


def test_edit_extra_images():
    sent = []
    res = np.full((10, 12, 3), 200, np.uint8)

    def handler(req):
        if req.method == "GET":
            return httpx.Response(200, content=cv2.imencode(".png", res)[1].tobytes())
        sent.append(json.loads(req.content))
        return httpx.Response(200, json={"images": [{"url": "https://x/a.png"}]})

    c = _client(handler)
    img = np.zeros((20, 30, 3), np.uint8)
    c.edit("nano-banana", img, "fix", 1, [np.zeros((5, 5, 3), np.uint8)])
    assert len(sent[0]["image_urls"]) == 2
    with pytest.raises(ValueError):
        c.edit("qwen", img, "fix", 1, [np.zeros((5, 5, 3), np.uint8)])


def test_balance():
    sent = {}

    def handler(req):
        sent["url"] = str(req.url)
        sent["auth"] = req.headers.get("authorization")
        return httpx.Response(200, json={"username": "u", "credits": {"current_balance": 4.73, "currency": "USD"}})

    assert _client(handler).balance() == {"balance": 4.73, "currency": "USD"}
    assert sent["url"].startswith("https://api.fal.ai/v1/account/billing") and "expand=credits" in sent["url"]
    assert sent["auth"].startswith("Key ")
    with pytest.raises(FalError, match="查不到"):
        _client(lambda r: httpx.Response(403, text="no")).balance()
    with pytest.raises(FalError, match="格式不符"):
        _client(lambda r: httpx.Response(200, json={"x": 1})).balance()


def test_content_policy_error_is_readable():
    def handler(req):
        return httpx.Response(422, json={"detail": [{"loc": ["body"], "msg": "flagged by a content checker.",
                                                     "type": "content_policy_violation"}]})

    with pytest.raises(FalError) as e:
        _client(handler).edit("qwen", np.zeros((8, 8, 3), np.uint8), "p", 1)
    assert "內容審查" in str(e.value) and "換其他模型" in str(e.value) and "HTTP" not in str(e.value)
