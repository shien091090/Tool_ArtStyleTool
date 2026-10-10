"""部位比例的冒煙測試: 實際呼叫 fal.ai 切一個部位、放大、生成一張, 輸出拼貼與結果。
用法: python scripts/proportion_smoke.py <圖片路徑> [部位名稱=頭] [放大倍率=1.4] [輸出資料夾]
花費約 0.05 美元。"""
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from artstyle import config, imaging  # noqa: E402
from artstyle.fal import HttpFalClient  # noqa: E402
from artstyle.proportion import compose, parts  # noqa: E402


def main():
    if not config.FAL_KEY:
        sys.exit("沒有設定 FAL_KEY")
    src_path = Path(sys.argv[1])
    name = sys.argv[2] if len(sys.argv) > 2 else "頭"
    scale = float(sys.argv[3]) if len(sys.argv) > 3 else 1.4
    out = Path(sys.argv[4]) if len(sys.argv) > 4 else src_path.parent / "proportion_smoke"
    out.mkdir(parents=True, exist_ok=True)
    img = imaging.limit_size(imaging.load_rgb(src_path.read_bytes()), config.MAX_SIDE)
    h, w = img.shape[:2]
    client = HttpFalClient(config.FAL_KEY)

    results = client.segment(img, parts.to_prompt(name), [], [])
    mask = parts.merge_masks(results, (h, w))
    print(f"切部位「{name}」: {len(results)} 塊, 分數 {[round(s, 2) for _, s in results]}, 面積 {int((mask > 0).sum())}")
    if not mask.any():
        sys.exit("切不到這個部位")

    # 以外框下緣中點為錨點放大, 與前端預設錨點一致
    ys, xs = np.nonzero(mask)
    ax, ay = (xs.min() + xs.max() + 1) / 2, ys.max() + 1
    M = np.float32([[scale, 0, ax * (1 - scale)], [0, scale, ay * (1 - scale)]])
    part = cv2.warpAffine(img, M, (w, h))
    pmask = cv2.warpAffine(mask, M, (w, h))
    a = (pmask.astype(np.float32) / 255)[..., None]
    rgba = np.dstack([img, np.full((h, w), 255, np.uint8)])
    rgba[mask > 0, 3] = 0
    rgba[..., :3] = (part * a + rgba[..., :3] * (1 - a)).astype(np.uint8)
    rgba[..., 3] = np.maximum(rgba[..., 3], pmask)
    region = np.where((mask > 0) | (pmask > 127), 255, 0).astype(np.uint8)

    filled = compose.fill_holes(rgba)
    imaging.write_png(out / "collage.png", filled)
    ai = client.edit("nano-banana", filled, compose.build_prompt(False, ""), 1)[0]
    print(f"AI 回傳尺寸 {ai.shape}, 拼貼尺寸 {filled.shape}")
    imaging.write_png(out / "result.png", compose.paste_back(ai, filled, region))
    print(f"輸出到 {out}")


if __name__ == "__main__":
    main()
