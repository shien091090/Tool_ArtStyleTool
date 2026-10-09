import pytest

from artstyle import lospec


def test_slug_from_url():
    assert lospec.slug_from_url("https://lospec.com/palette-list/endesga-32") == "endesga-32"
    assert lospec.slug_from_url("lospec.com/palette-list/Endesga-32/") == "endesga-32"
    for bad in ["https://evil.com/palette-list/x", "https://lospec.com/other/x", "endesga-32"]:
        with pytest.raises(ValueError):
            lospec.slug_from_url(bad)


def test_fetch_palette_normalizes_colors():
    seen = []

    def fake_get(url):
        seen.append(url)
        return 200, {"name": "Endesga 32", "colors": ["be4a2f", "D77643", "bad", 5]}

    result = lospec.fetch_palette("https://lospec.com/palette-list/endesga-32", get=fake_get)
    assert seen == ["https://lospec.com/palette-list/endesga-32.json"]
    assert result == {"name": "Endesga 32", "colors": ["#be4a2f", "#d77643"]}


def test_fetch_palette_errors():
    with pytest.raises(lospec.LospecError):
        lospec.fetch_palette("lospec.com/palette-list/nope", get=lambda url: (404, None))
    with pytest.raises(lospec.LospecError):
        lospec.fetch_palette("lospec.com/palette-list/x", get=lambda url: (200, {"colors": []}))
