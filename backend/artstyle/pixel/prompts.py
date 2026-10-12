"""送 AI 前的畫布準備與指令組合(規格 4.3、4.4)。"""
import cv2
import numpy as np

CELL = 8
MAX_CELLS = 16
AI_SIDE = 1024
NEAR_WHITE = 235

AUTO_PROMPT = ("Convert this image into pixel art: a 2D pixel art game sprite in 16-bit SNES RPG style. "
               "Very low resolution (about 64 pixels tall, upscaled with big visible square pixels), limited {C}-color palette, "
               "no anti-aliasing, no gradients, 1-pixel dark outline, flat cel shading. Same subject, pose and colors. "
               "Plain white background.")
GRID_PROMPT = ("Redraw this image as a pixel art game sprite that is exactly {W} pixels wide and {H} pixels tall, "
               "shown enlarged so that each sprite pixel is one big flat square of equal size; the sprite fills the whole frame "
               "edge to edge. Do NOT draw any grid lines, borders or frame. Limited palette of about {C} colors, "
               "no anti-aliasing, no gradients, dark outline. Plain white background.")
ICON_LINE = ("At this tiny size simplify it like an icon: keep only the silhouette and the main color blocks, "
             "eyes at most 1 pixel each.")
REDESIGN_LINE = ("The frame's aspect ratio is different from the original image: redesign the proportions to fill the frame "
                 "(for example chibi proportions with a big head and short body for a square frame).")


def default_colors(mode: str, cols: int = 0, rows: int = 0) -> int:
    if mode == "auto":
        return 24
    side = max(cols, rows) * CELL
    return 8 if side <= 16 else 12 if side <= 32 else 16


def content_box(img: np.ndarray, threshold: int = NEAR_WHITE) -> tuple[int, int, int, int]:
    """非白(三通道最小值 ≤ 門檻)範圍 (x0, y0, x1, y1), 右下不含; 整張白回傳整張。"""
    ys, xs = np.nonzero(img[..., :3].min(axis=2) <= threshold)
    if not len(xs):
        return 0, 0, img.shape[1], img.shape[0]
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def crop_content(img: np.ndarray) -> np.ndarray:
    x0, y0, x1, y1 = content_box(img)
    return img[y0:y1, x0:x1]


def pad_to(img: np.ndarray, aspect: float, fill: int = 255) -> np.ndarray:
    """補白成 寬/高 = aspect, 原圖置中。"""
    h, w = img.shape[:2]
    if w / h < aspect:
        nw, nh = round(h * aspect), h
    else:
        nw, nh = w, round(w / aspect)
    out = np.full((nh, nw, img.shape[2]), fill, np.uint8)
    y, x = (nh - h) // 2, (nw - w) // 2
    out[y:y + h, x:x + w] = img
    return out


def _fit_long(img: np.ndarray, side: int) -> np.ndarray:
    h, w = img.shape[:2]
    s = side / max(h, w)
    if s >= 1:
        return img
    return cv2.resize(img, (max(1, round(w * s)), max(1, round(h * s))), interpolation=cv2.INTER_AREA)


def prepare(src: np.ndarray, mode: str, cols: int = 0, rows: int = 0) -> np.ndarray:
    """裁白邊加 6% 邊距; 指定格數再放進 W:H 白底畫布(主體佔 94%, 長邊 1024)。"""
    sub = crop_content(src)
    h, w = sub.shape[:2]
    m = max(1, round(max(h, w) * 0.06))
    sub = cv2.copyMakeBorder(sub, m, m, m, m, cv2.BORDER_CONSTANT, value=(255, 255, 255))
    if mode == "auto":
        return _fit_long(sub, AI_SIDE)
    W, H = cols * CELL, rows * CELL
    cw, ch = (AI_SIDE, round(AI_SIDE * H / W)) if W >= H else (round(AI_SIDE * W / H), AI_SIDE)
    core = crop_content(sub)
    s = min(cw * 0.94 / core.shape[1], ch * 0.94 / core.shape[0])
    core = cv2.resize(core, (max(1, round(core.shape[1] * s)), max(1, round(core.shape[0] * s))),
                      interpolation=cv2.INTER_AREA if s < 1 else cv2.INTER_CUBIC)
    out = np.full((ch, cw, 3), 255, np.uint8)
    y, x = (ch - core.shape[0]) // 2, (cw - core.shape[1]) // 2
    out[y:y + core.shape[0], x:x + core.shape[1]] = core
    return out


def needs_redesign(src: np.ndarray, cols: int, rows: int) -> bool:
    x0, y0, x1, y1 = content_box(src)
    a, t = (x1 - x0) / (y1 - y0), cols / rows
    return max(a, t) / min(a, t) - 1 > 0.25


def build_prompt(src: np.ndarray, mode: str, colors: int, note: str = "", cols: int = 0, rows: int = 0) -> str:
    if mode == "auto":
        parts = [AUTO_PROMPT.format(C=colors)]
    else:
        W, H = cols * CELL, rows * CELL
        parts = [GRID_PROMPT.format(W=W, H=H, C=colors)]
        if max(W, H) <= 16:
            parts.append(ICON_LINE)
        if needs_redesign(src, cols, rows):
            parts.append(REDESIGN_LINE)
    if note.strip():
        parts.append(f"Additional instructions: {note.strip()}")
    return " ".join(parts)
