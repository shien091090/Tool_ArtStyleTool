"""實際呼叫 fal.ai 的冒煙測試: 對一張圖跑深度與四種線稿, 印出格式資訊。
用法: python scripts/fal_smoke.py <圖片路徑> [輸出資料夾]"""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from artstyle import config, imaging  # noqa: E402
from artstyle.fal import DEPTH_MODEL, LINE_MODELS, HttpFalClient  # noqa: E402


def describe(name, img, src_shape):
    gray = imaging.to_gray(img)
    border = np.concatenate([gray[0], gray[-1], gray[:, 0], gray[:, -1]])
    h, w = gray.shape
    print(f"{name}: shape={img.shape} dtype={img.dtype} 與原圖同尺寸={img.shape[:2] == src_shape[:2]} "
          f"邊框中位數={np.median(border):.0f} 中心={gray[h // 2, w // 2]} 四角={[gray[0, 0], gray[0, -1], gray[-1, 0], gray[-1, -1]]}")


def main():
    if not config.FAL_KEY:
        sys.exit("沒有設定 FAL_KEY")
    src_path = Path(sys.argv[1])
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else src_path.parent / "fal_smoke"
    out.mkdir(parents=True, exist_ok=True)
    src = imaging.limit_size(imaging.load_rgb(src_path.read_bytes()), config.MAX_SIDE)
    client = HttpFalClient(config.FAL_KEY)
    for name, model in [("depth", DEPTH_MODEL), *LINE_MODELS.items()]:
        try:
            res = client.run_image(model, src)
        except Exception as e:
            print(f"{name}: 失敗 {e}")
            continue
        imaging.write_png(out / f"{name}.png", res)
        describe(name, res, src.shape)


if __name__ == "__main__":
    main()
