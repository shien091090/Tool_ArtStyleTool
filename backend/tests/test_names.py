import pytest

from artstyle.names import validate_name


@pytest.mark.parametrize("ok", ["knight", "騎士_01", "my-pack 2"])
def test_valid(ok):
    assert validate_name(ok) == ok


@pytest.mark.parametrize("bad", ["", "..", "a/b", "a\b", "../x", " ", "x" * 65, "a:b"])
def test_invalid(bad):
    with pytest.raises(ValueError):
        validate_name(bad)
