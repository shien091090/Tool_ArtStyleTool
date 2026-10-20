import numpy as np

from artstyle.aiflat import background, flat_regions


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
