"""切部位: 中文名稱轉 SAM 提示詞、合併遮罩、拆左右。"""
import re

import cv2
import numpy as np

MIN_SCORE = 0.3

# SAM 3 只吃英文; 不在表內的名稱原樣送出(使用者可直接打英文)
NAMES = {
    "頭": "head", "臉": "face", "頭髮": "hair", "帽子": "hat", "眼睛": "eye", "耳朵": "ear", "嘴": "mouth",
    "角": "horn", "脖子": "neck", "身體": "body", "軀幹": "torso", "胸": "chest", "手": "hand", "手臂": "arm",
    "腳": "foot", "腿": "leg", "翅膀": "wing", "尾巴": "tail", "爪子": "claw", "武器": "weapon", "劍": "sword",
    "盾": "shield", "衣服": "clothes", "裙子": "skirt", "褲子": "pants", "鞋子": "shoe", "披風": "cape",
    "屋頂": "roof", "門": "door", "窗": "window", "窗戶": "window", "牆": "wall", "塔": "tower",
    "煙囪": "chimney", "柱子": "pillar", "樓梯": "stairs", "輪子": "wheel", "樹": "tree",
}


def to_display_name(name: str) -> str:
    """去掉拆左右加上的「(左)」「(右)」。"""
    return re.sub(r"\((左|右)\)$", "", name.strip()).strip()


def to_prompt(name: str, aliases: dict | None = None) -> str:
    """部位名稱 → 切部位用的英文提示。作品別名(AI 列部位時記下的)優先, 再查內建對照表。"""
    name = to_display_name(name)  # 拆左右後重切時用原名
    return (aliases or {}).get(name) or NAMES.get(name, name)


def split_names(text: str) -> list[str]:
    out = []
    for n in re.split(r"[、,，;；\n]", text):
        n = n.strip()
        if n and n not in out:
            out.append(n)
    return out


def merge_masks(results: list[tuple[np.ndarray, float]], shape: tuple[int, int]) -> np.ndarray:
    """分數低於門檻的丟掉, 其餘聯集(同名多塊合成一個部位)。"""
    out = np.zeros(shape, np.uint8)
    for mask, score in results:
        if score >= MIN_SCORE:
            out |= np.where(mask > 127, 255, 0).astype(np.uint8)
    return out


def split_left_right(mask: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """依連通塊重心 x 分左右(重心在整體重心左側的算左)。"""
    binary = (mask > 127).astype(np.uint8)
    n, labels, stats, centroids = cv2.connectedComponentsWithStats(binary, connectivity=8)
    if n - 1 < 2:
        raise ValueError("這個部位只有一塊, 無法拆成左右")
    ys, xs = np.nonzero(binary)
    cx = xs.mean()
    left = np.zeros_like(binary)
    right = np.zeros_like(binary)
    for i in range(1, n):
        target = left if centroids[i][0] < cx else right
        target[labels == i] = 255
    if not left.any() or not right.any():
        raise ValueError("這個部位無法分出左右兩邊")
    return left, right
