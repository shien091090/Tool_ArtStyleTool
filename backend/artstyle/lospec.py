"""代抓 Lospec 色票(瀏覽器直接抓會被跨站限制擋)。只允許 lospec.com 的色票網址。"""
import re
from typing import Callable

import httpx

_SLUG = re.compile(r"(?:^|//|\b)(?:www\.)?lospec\.com/palette-list/([A-Za-z0-9-]+)/?(?:[?#].*)?$")
_HEX = re.compile(r"[0-9a-fA-F]{6}")


class LospecError(Exception):
    pass


def slug_from_url(url: str) -> str:
    m = _SLUG.search(url.strip())
    if not m:
        raise ValueError("只接受 Lospec 色票網址, 例如 https://lospec.com/palette-list/endesga-32")
    return m.group(1).lower()


def _http_get(url: str):
    try:
        r = httpx.get(url, timeout=20, follow_redirects=True)
    except httpx.HTTPError as e:
        raise LospecError(f"連不上 Lospec: {e}")
    try:
        return r.status_code, r.json()
    except ValueError:
        return r.status_code, None


def fetch_palette(url: str, get: Callable[[str], tuple[int, object]] = _http_get) -> dict:
    slug = slug_from_url(url)
    status, data = get(f"https://lospec.com/palette-list/{slug}.json")
    if status != 200 or not isinstance(data, dict):
        raise LospecError(f"Lospec 找不到色票「{slug}」(HTTP {status})")
    colors = [f"#{c.lower()}" for c in data.get("colors", []) if isinstance(c, str) and _HEX.fullmatch(c)]
    if not colors:
        raise LospecError(f"色票「{slug}」沒有可用的顏色")
    return {"name": str(data.get("name") or slug), "colors": colors}
