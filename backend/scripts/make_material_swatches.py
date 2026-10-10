"""生成部位工坊的快捷材質縮圖(64×64), 輸出到 frontend/public/materials/。

用法: python scripts/make_material_swatches.py [key ...]   不給 key 就全部重生。需要 FAL_KEY。
"""
import os
import sys
from pathlib import Path

import cv2
import httpx
import numpy as np

MODEL = "fal-ai/flux/schnell"
OUT = Path(__file__).resolve().parents[2] / "frontend" / "public" / "materials"
SIZE = 64

# key 要與 frontend/src/proportion/materials.ts 一致
PROMPTS = {
    "metal": "polished brushed steel metal surface",
    "rusty_metal": "rusty riveted iron plate surface with orange rust",
    "gold": "shiny polished gold surface",
    "wood": "natural oak wood grain planks",
    "stone": "rough grey cobblestone rock surface",
    "crystal": "faceted translucent blue crystal surface",
    "ice": "frozen pale blue ice surface with cracks",
    "lava": "glowing molten lava with dark cooled crust cracks",
    "scales": "close-up of overlapping rounded green snake scales with glossy highlights",
    "fur": "soft brown animal fur",
    "feathers": "overlapping white and grey bird feathers",
    "leather": "worn brown leather with stitching",
    "cloth": "woven red fabric cloth weave",
    "ceramic": "blue and white Chinese porcelain with painted floral pattern and glossy glaze reflections",
    "moss": "lush green moss and small leaves",
}


def main(keys: list[str]) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    headers = {"Authorization": f"Key {os.environ['FAL_KEY']}"}
    with httpx.Client(timeout=120) as http:
        for key in keys or PROMPTS:
            body = {"prompt": f"seamless square texture swatch of {PROMPTS[key]}, flat lay, evenly lit, game asset, "
                              "fills the whole frame, no objects, no text", "image_size": "square", "num_images": 1}
            r = http.post(f"https://fal.run/{MODEL}", json=body, headers=headers)
            r.raise_for_status()
            img = cv2.imdecode(np.frombuffer(http.get(r.json()["images"][0]["url"]).content, np.uint8), cv2.IMREAD_COLOR)
            cv2.imwrite(str(OUT / f"{key}.png"), cv2.resize(img, (SIZE, SIZE), interpolation=cv2.INTER_AREA))
            print(key)


if __name__ == "__main__":
    main(sys.argv[1:])
