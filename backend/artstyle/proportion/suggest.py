"""AI 列出部位: 視覺模型看圖給部位清單, 使用者勾選後再切。"""
import json
import re

MAX_PARTS = 12

PROMPT = ("You help an artist split this image into parts to resize separately when exploring proportions. "
          "List the main parts of the subject as large chunks (e.g. head, body, arm, leg, wing, tail, roof, wall, tower). "
          "Do not list small details such as eyes, teeth, claws, buttons or patterns. Merge left/right pairs into one entry "
          "(\"arm\", not \"left arm\"). For each part give a Traditional Chinese name (zh) and an English name (en). "
          "Reply with JSON only, no prose: {\"parts\": [{\"zh\": \"頭\", \"en\": \"head\"}]}")

ERROR = "AI 沒有列出部位, 請手動輸入"


def parse(text: str) -> list[dict]:
    """模型回覆 → [{name, en}]。會剝掉 ```json 包裝與前後文字; 壞格式或空清單 → ValueError。"""
    m = re.search(r"\{.*\}", text or "", re.S)
    if not m:
        raise ValueError(ERROR)
    try:
        items = json.loads(m.group(0)).get("parts")
    except (ValueError, AttributeError):
        raise ValueError(ERROR)
    if not isinstance(items, list):
        raise ValueError(ERROR)
    out, seen = [], set()
    for it in items:
        if not isinstance(it, dict):
            continue
        zh, en = it.get("zh"), it.get("en")
        if not isinstance(zh, str) or not isinstance(en, str):
            continue
        zh = zh.strip()
        en = " ".join(re.sub(r"[^A-Za-z -]", "", en).split())
        if not 1 <= len(zh) <= 20 or not en or zh in seen:
            continue
        seen.add(zh)
        out.append({"name": zh, "en": en})
        if len(out) == MAX_PARTS:
            break
    if not out:
        raise ValueError(ERROR)
    return out
