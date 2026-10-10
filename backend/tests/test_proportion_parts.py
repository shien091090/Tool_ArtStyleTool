import numpy as np
import pytest

from artstyle.proportion import parts


def test_to_prompt():
    assert parts.to_prompt("頭") == "head"
    assert parts.to_prompt(" 翅膀 ") == "wing"
    assert parts.to_prompt("lantern") == "lantern"
    assert parts.to_prompt("燈室") == "燈室"
    assert parts.to_prompt("翅膀(左)") == "wing"


def test_split_names():
    assert parts.split_names("頭、翅膀, 尾巴，  ,腳") == ["頭", "翅膀", "尾巴", "腳"]
    assert parts.split_names("頭、頭") == ["頭"]


def _m(y0, y1, x0, x1, shape=(20, 30)):
    m = np.zeros(shape, np.uint8)
    m[y0:y1, x0:x1] = 255
    return m


def test_merge_masks_filters_low_scores():
    out = parts.merge_masks([(_m(0, 5, 0, 5), 0.9), (_m(10, 15, 10, 15), 0.2), (_m(0, 5, 20, 25), 0.5)], (20, 30))
    assert out[2, 2] == 255 and out[12, 12] == 0 and out[2, 22] == 255
    assert out.dtype == np.uint8 and set(np.unique(out)) <= {0, 255}


def test_merge_masks_all_low_is_empty():
    assert not parts.merge_masks([(_m(0, 5, 0, 5), 0.1)], (20, 30)).any()
    assert not parts.merge_masks([], (20, 30)).any()


def test_split_left_right():
    m = _m(5, 10, 2, 6) | _m(5, 10, 20, 26) | _m(0, 2, 8, 10)   # 左邊兩塊、右邊一塊
    left, right = parts.split_left_right(m)
    assert left[6, 3] == 255 and left[1, 9] == 255 and left[6, 22] == 0
    assert right[6, 22] == 255 and right[6, 3] == 0


def test_split_single_blob_errors():
    with pytest.raises(ValueError):
        parts.split_left_right(_m(5, 10, 2, 26))


def test_to_prompt_prefers_aliases():
    assert parts.to_prompt("燈室(左)", {"燈室": "lantern room"}) == "lantern room"
    assert parts.to_prompt("頭", {"燈室": "x"}) == "head"
    assert parts.to_prompt("頭") == "head"
