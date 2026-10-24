import numpy as np
import pytest

from artstyle.library.store import Library, check_tags

SRC = {"kind": "import", "file": "x.png"}


def _img():
    img = np.zeros((8, 8, 4), np.uint8)
    img[2:6, 2:6] = (200, 100, 50, 255)
    return img


def test_add_get_list(tmp_path):
    lib = Library(tmp_path)
    a = lib.add(_img(), "樹", {"kind": "import", "file": "tree.png"})
    assert a["id"] == "a1" and a["parent"] is None and a["tags"] == {"views": [], "type": None}
    assert lib.get("a1")["name"] == "樹"
    assert lib.image_path("a1").is_file()
    assert [x["id"] for x in lib.list()] == ["a1"]


def test_ids_not_reused(tmp_path):
    lib = Library(tmp_path)
    lib.add(_img(), "a", SRC)
    lib.delete("a1")
    assert lib.add(_img(), "b", SRC)["id"] == "a2"


def test_bad_tags():
    with pytest.raises(ValueError):
        check_tags({"views": ["3d"]})
    with pytest.raises(ValueError):
        check_tags({"type": "魔法"})
    assert check_tags({"views": ["iso", "iso", "side"], "type": "建築"}) == {"views": ["iso", "side"], "type": "建築"}
    assert check_tags(None) == {"views": [], "type": None}


def test_update(tmp_path):
    lib = Library(tmp_path)
    lib.add(_img(), "樹", SRC)
    a = lib.update("a1", "大樹", {"views": ["side"], "type": "景物"})
    assert a["name"] == "大樹" and a["tags"] == {"views": ["side"], "type": "景物"}
    assert lib.get("a1")["name"] == "大樹"
    assert lib.update("a1", None, None)["name"] == "大樹"
    with pytest.raises(ValueError):
        lib.update("a1", "  ", None)


def test_parent_missing_becomes_none(tmp_path):
    assert Library(tmp_path).add(_img(), "x", SRC, parent="a9")["parent"] is None


def test_delete_middle_reparents(tmp_path):
    lib = Library(tmp_path)
    lib.add(_img(), "1", SRC)
    lib.add(_img(), "2", SRC, parent="a1")
    lib.add(_img(), "3", SRC, parent="a2")
    lib.delete("a2")
    assert lib.get("a3")["parent"] == "a1"
    assert not (tmp_path / "a2").exists()


def test_delete_root_reparents_children(tmp_path):
    lib = Library(tmp_path)
    lib.add(_img(), "1", SRC)
    lib.add(_img(), "2", SRC, parent="a1")
    lib.add(_img(), "3", SRC, parent="a1")
    lib.delete("a1")
    assert lib.get("a2")["parent"] is None and lib.get("a3")["parent"] is None


def test_bad_id(tmp_path):
    lib = Library(tmp_path)
    with pytest.raises(FileNotFoundError):
        lib.get("../x")
    with pytest.raises(FileNotFoundError):
        lib.image_path("a1")
