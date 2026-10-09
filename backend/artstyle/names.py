import re

_NAME = re.compile(r"[\w\- ]{1,64}")


def validate_name(name: str) -> str:
    """分層包與配方名稱: 字母數字底線(含中文)、連字號、空白, 1~64 字。"""
    if not isinstance(name, str) or not _NAME.fullmatch(name) or not name.strip():
        raise ValueError(f"名稱不合法: {name!r}(只能用中英文、數字、底線、連字號、空白, 最多 64 字)")
    return name
