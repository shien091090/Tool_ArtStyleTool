import numpy as np

from artstyle.aiflat import align_to_source, background, flat_regions


def _src():
    img = np.full((40, 40, 3), 255, np.uint8)
    img[10:30, 10:30] = (200, 40, 40)
    img[18:22, 10:30] = (20, 20, 20)        # 線條
    return img


def test_background_is_border_white_only():
    img = _src()
    img[14:16, 14:16] = 255                 # 主體內的白點不是背景
    bg = background(img)
    assert bg[0, 0] and not bg[15, 15] and not bg[20, 20]


def test_flat_regions_aligns_to_source():
    ai = np.full((40, 40, 3), 255, np.uint8)
    ai[12:32, 10:34] = (200, 40, 40)        # AI 畫偏了: 往下往右多畫, 上面少畫
    labels, colors = flat_regions(ai, _src())
    bg = labels[0, 0]
    assert colors[bg] == (255, 255, 255)
    assert labels[31, 31] == bg              # 原圖主體外: 背景
    assert labels[10, 10] != bg              # 原圖主體內 AI 沒畫到: 補最近的色塊
    assert colors[labels[10, 10]] == colors[labels[20, 20]]
    assert set(np.unique(labels).tolist()) == set(colors)


def test_align_moves_ai_edges_onto_source_lines():
    src = np.full((60, 60, 3), 255, np.uint8)
    src[10:50, 10:50] = (200, 40, 40)
    src[10:50, 30:50] = (40, 40, 200)
    lines = np.zeros((60, 60), bool)
    lines[10:50, 30] = True                     # 兩色交界的線稿
    ai = np.full((60, 60, 3), 255, np.uint8)
    ai[12:52, 12:52] = (200, 40, 40)
    ai[12:52, 33:52] = (40, 40, 200)            # AI 整塊往右下偏 2~3px
    out = align_to_source(ai, src, lines)
    blue = (out[30] == (40, 40, 200)).all(axis=1).nonzero()[0]
    assert abs(blue[0] - 30) < abs(33 - 30)     # 交界比原本更貼近線稿
