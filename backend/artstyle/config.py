import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.environ.get("ARTSTYLE_DATA", REPO_ROOT / "data"))
PACKS_DIR = DATA_DIR / "packs"
RECIPES_DIR = DATA_DIR / "recipes"

MAX_SIDE = 2048
FAL_KEY = os.environ.get("FAL_KEY") or None

# fal.ai marigold-depth 實測(2026-10-09): 16bit, 近的暗、遠的亮
DEPTH_NEAR_IS_BRIGHT = False
