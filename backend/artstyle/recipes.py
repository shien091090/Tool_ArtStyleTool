"""風格配方檔讀寫。內容的格式由前端負責正規化, 後端只保證是 JSON 物件。"""
import json
from pathlib import Path

from .names import validate_name

MAX_BYTES = 256 * 1024


def list_recipes(directory) -> list[str]:
    d = Path(directory)
    if not d.is_dir():
        return []
    return sorted(p.stem for p in d.glob("*.json"))


def load_recipe(directory, name: str) -> dict:
    validate_name(name)
    path = Path(directory) / f"{name}.json"
    if not path.is_file():
        raise FileNotFoundError(f"找不到配方「{name}」")
    return json.loads(path.read_text(encoding="utf-8"))


def delete_recipe(directory, name: str) -> None:
    validate_name(name)
    path = Path(directory) / f"{name}.json"
    if not path.is_file():
        raise FileNotFoundError(f"找不到配方「{name}」")
    path.unlink()


def save_recipe(directory, name: str, data) -> None:
    validate_name(name)
    if not isinstance(data, dict):
        raise ValueError("配方必須是 JSON 物件")
    text = json.dumps(data, ensure_ascii=False, indent=2)
    if len(text.encode("utf-8")) > MAX_BYTES:
        raise ValueError("配方檔太大")
    d = Path(directory)
    d.mkdir(parents=True, exist_ok=True)
    tmp = d / f"{name}.json.tmp"
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(d / f"{name}.json")
