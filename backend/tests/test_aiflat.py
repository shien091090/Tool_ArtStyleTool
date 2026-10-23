import numpy as np

from artstyle.aiflat import background, fill_cells, flat_regions


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


def test_white_painted_inside_body_is_filled():
    ai = np.full((40, 40, 3), 255, np.uint8)
    ai[10:30, 10:30] = (200, 40, 40)
    ai[14:18, 14:18] = 255                      # AI 在主體裡畫了白色, 原圖那裡是紅的
    src = _src()
    labels, colors = flat_regions(ai, src)
    assert colors[labels[15, 15]] == colors[labels[25, 25]]


def test_fill_cells_puts_boundary_on_line():
    labels = np.ones((40, 40), np.int32)
    labels[:, 23:] = 2                          # AI 的交界畫在 x=23, 線稿在 x=19~20
    lines = np.zeros((40, 40), bool)
    lines[:, 19:21] = True
    fg = np.zeros((40, 40), bool)
    fg[5:35, 5:35] = True
    out = fill_cells(labels, lines, fg)
    assert (out[10, 5:19] == 1).all()
    assert (out[10, 21:35] == 2).all()          # 線右邊那格多數是 2, 整格變 2
    assert (out[~fg] == labels[~fg]).all()


def test_flat_regions_fills_cells_from_lines():
    ai = np.full((40, 40, 3), 255, np.uint8)
    ai[10:30, 10:30] = (200, 40, 40)
    ai[10:30, 22:30] = (40, 40, 200)            # AI 的藍色從 x=22 開始, 線稿在 x=19
    lines = np.zeros((40, 40), bool)
    lines[10:30, 19] = True
    src = np.full((40, 40, 3), 255, np.uint8)
    src[10:30, 10:30] = (120, 120, 120)
    labels, colors = flat_regions(ai, src, lines)
    assert colors[labels[20, 21]][2] > 150      # 線右邊整格都是藍色
    assert colors[labels[20, 17]][0] > 150
