import pytest

from artstyle.proportion import suggest


def test_parse_strips_fence_and_dedupes():
    text = '```json\n{"parts": [{"zh": "頭", "en": "head"}, {"zh": "頭", "en": "head"}, {"zh": "翅膀", "en": "wing!"}]}\n```'
    assert suggest.parse(text) == [{"name": "頭", "en": "head"}, {"name": "翅膀", "en": "wing"}]


def test_parse_finds_object_in_prose():
    assert suggest.parse('Sure: {"parts": [{"zh": "屋頂", "en": "roof"}]} done') == [{"name": "屋頂", "en": "roof"}]


def test_parse_skips_bad_items_and_caps():
    items = [{"zh": f"部位{i}", "en": "part"} for i in range(20)]
    items[0] = {"zh": "", "en": "x"}
    items[1] = {"zh": "尾巴", "en": "123"}
    items[2] = "頭"
    import json
    out = suggest.parse(json.dumps({"parts": items}))
    assert len(out) == 12 and all(p["name"].startswith("部位") for p in out)


@pytest.mark.parametrize("text", ["", "no json", '{"parts": []}', '{"parts": "頭"}', "{bad json}"])
def test_parse_errors(text):
    with pytest.raises(ValueError, match="AI 沒有列出部位"):
        suggest.parse(text)
