# 美術風格探索工具 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做出一個本機網頁工具: 把一張有光影的成品圖拆成分層包(線稿、區塊、平塗、法線、線條距離場), 經檢查點確認後, 用五層 WebGL2 shader 依「風格配方」即時重新渲染。

**Architecture:** Python FastAPI 本機伺服器負責拆解(呼叫 fal.ai 取深度圖與線稿, 其餘用 OpenCV/numpy 在本機算)與檔案讀寫; 瀏覽器端 Vite + TypeScript + 原生 WebGL2 負責渲染、檢查點與對照網格。兩者只透過 `/api` 的 JSON 與 PNG 溝通。

**Tech Stack:** Python 3.14, FastAPI, uvicorn, httpx, numpy, opencv-python-headless, pytest; Node 24, Vite, TypeScript, Tweakpane 4, Vitest。

**Spec:** `docs/superpowers/specs/2026-10-09-art-style-tool-design.md`

## Global Constraints

- 輸入長邊最大 2048px, 超過自動等比縮小
- fal.ai 只用於拆解: 深度圖 `fal-ai/imageutils/marigold-depth`, 線稿 `fal-ai/image-preprocessors/{lineart,teed,hed,pidi}`, 預設 `lineart`
- fal.ai 金鑰只從後端環境變數 `FAL_KEY` 讀, 不送到前端
- 後端只監聽 `127.0.0.1`, 埠號 8765; 前端 dev server 用 Vite proxy 轉 `/api`
- 不使用 LYGIA、Intrinsic; shader 全部自己寫
- 分層包放 `data/packs/<名稱>/`, 配方放 `data/recipes/<名稱>.json`
- 風格配方帶 `version: 1`; 單一區塊改色存在分層包, 不存配方
- 渲染讀分層包 PNG 時不可做色彩空間轉換與 premultiply(區塊編號圖是資料, 不是顏色)

## Review Focus

1. fal.ai 回傳的線稿/深度圖解析度與原圖不同、或線稿是黑底白線 → 必須縮放回原圖尺寸並統一成白底黑線, 否則各層錯位(Task 2、Task 5 測試)
2. 分層包/配方名稱含 `..`、`/`、`\` → 拒絕; 含中文 → 允許(Task 1 測試)
3. 上傳的圖是帶透明的 PNG、灰階圖、JPEG → 一律轉成 RGB, 透明處鋪白(Task 1 測試)
4. 線稿完全空白或沒有任何封閉區塊 → 整張圖算一個區塊, 不崩潰(Task 3 測試)
5. 讀到殘缺或數值越界的配方(色階數 0、未知色票名) → 補預設值、夾到合法範圍, 並回報哪些欄位被修正(Task 8 測試)

---

## 檔案結構

```
backend/
  requirements.txt
  artstyle/
    __init__.py
    config.py        # 路徑、埠、上限、fal 設定
    imaging.py       # 讀檔轉 RGB、縮圖、PNG 存取、data URI
    names.py         # 名稱驗證
    lines.py         # 線稿正規化、線條遮罩、有號距離場
    regions.py       # 線稿圍區塊(多尺度補線縫 + 最近區塊擴張)
    flat.py          # 區塊代表色、平塗圖
    normals.py       # 深度 → 法線
    fal.py           # fal.ai 客戶端(介面 + HTTP 實作)
    pack.py          # 分層包讀寫、meta、過期標記
    decompose.py     # 拆解各步驟的協調
    recipes.py       # 配方檔讀寫
    server.py        # FastAPI 路由
  tests/
    conftest.py
    test_imaging.py test_names.py test_lines.py test_regions.py
    test_flat.py test_normals.py test_pack.py test_decompose.py test_server.py
  scripts/fal_smoke.py   # 實際呼叫 fal.ai 的冒煙測試(手動跑)
frontend/
  package.json vite.config.ts tsconfig.json index.html
  src/
    main.ts          # 導覽與頁面切換(hash 路由)
    api.ts           # 後端 API 呼叫
    recipe.ts        # 配方型別、預設值、正規化
    colorMath.ts     # OKLab、色相/飽和/色溫、k-means 色票、區塊色表
    palettes.ts      # 預設色票
    gl/
      glUtil.ts      # 編譯、貼圖、FBO、全螢幕三角形
      shaders.ts     # 五層 fragment shader 原始碼
      renderer.ts    # Renderer: 載入分層包、依配方渲染
    pages/
      decomposePage.ts
      renderPage.ts
      gridPage.ts
    style.css
  tests/
    recipe.test.ts colorMath.test.ts
data/
  packs/   (gitignore)
  recipes/
README.md
```

## 資料格式(所有 Task 共用)

**分層包檔案** `data/packs/<name>/`:
- `source.png` RGB
- `line.png` 灰階, 白底(255)黑線(0), 保留反鋸齒灰階
- `line_sdf.png` 灰階, 有號距離場: `value = clamp(128 + sd * 8, 0, 255)`, `sd` 單位像素, 線內為負、線外為正(範圍約 ±16px)
- `regions.png` RGBA, 區塊編號 `id = R + G*256`(1 起算), B=0, A=255
- `flat.png` RGB
- `normal.png` RGB, `n*0.5+0.5`, OpenGL 慣例(+X 右、+Y 上、+Z 朝觀看者)
- `depth.png` 灰階, 亮 = 近(正規化後)
- `meta.json`:

```json
{
  "name": "knight",
  "width": 1024, "height": 1536,
  "created": "2026-10-09T12:00:00",
  "layers": {
    "source": {"origin": "user", "updated": "...", "stale": false},
    "depth":  {"origin": "ai:fal-ai/imageutils/marigold-depth", "updated": "...", "stale": false},
    "normal": {"origin": "computed", "updated": "...", "stale": false},
    "line":   {"origin": "ai:fal-ai/image-preprocessors/lineart", "updated": "...", "stale": false},
    "line_sdf": {"origin": "computed", ...},
    "regions": {"origin": "computed", "params": {"gap_radius": 3, "min_area": 12}, ...},
    "flat":  {"origin": "computed", "color_source": "source", ...}
  },
  "regions": {"count": 42, "colors": {"1": [200, 180, 150], "2": [30, 40, 90]}, "areas": {"1": 5120, "2": 800}}
}
```

**相依關係**(上游更新 → 下游標 `stale: true`):
`source → depth → normal`; `source → line → line_sdf`; `line → regions → flat`; `source → flat`

---

### Task 1: 後端骨架、影像讀寫、名稱驗證

**Files:**
- Create: `backend/requirements.txt`, `backend/artstyle/__init__.py`, `backend/artstyle/config.py`, `backend/artstyle/imaging.py`, `backend/artstyle/names.py`, `backend/tests/conftest.py`, `backend/tests/test_imaging.py`, `backend/tests/test_names.py`, `.gitignore`

**Interfaces:**
- Produces:
  - `config.DATA_DIR: Path`(預設 repo 根的 `data/`, 可用環境變數 `ARTSTYLE_DATA` 覆寫), `config.PACKS_DIR`, `config.RECIPES_DIR`, `config.MAX_SIDE = 2048`, `config.FAL_KEY: str | None`
  - `imaging.load_rgb(data: bytes) -> np.ndarray` (H,W,3 uint8, RGB; 透明鋪白; 灰階/16bit 轉 8bit RGB)
  - `imaging.limit_size(img: np.ndarray, max_side: int) -> np.ndarray`
  - `imaging.resize_to(img, width, height, nearest=False) -> np.ndarray`
  - `imaging.read_png(path) -> np.ndarray`(灰階回 2D, 彩色回 RGB 或 RGBA), `imaging.write_png(path, img)`(輸入 RGB/RGBA/灰階, 內部轉 BGR)
  - `imaging.to_data_uri(img) -> str`(PNG base64)
  - `names.validate_name(name: str) -> str`(不合法拋 `ValueError`)

- [ ] **Step 1: 建立 requirements 與 .gitignore**

`backend/requirements.txt`:
```
fastapi
uvicorn
httpx
numpy
opencv-python-headless
python-multipart
pytest
```
`.gitignore`:
```
data/packs/
node_modules/
dist/
__pycache__/
.pytest_cache/
.venv/
```
建虛擬環境: `cd backend && python -m venv .venv && .venv/Scripts/python -m pip install -r requirements.txt`

- [ ] **Step 2: 寫失敗測試**

```python
# backend/tests/test_imaging.py
import cv2, numpy as np
from artstyle import imaging

def _encode(img_bgr_or_bgra, ext=".png"):
    ok, buf = cv2.imencode(ext, img_bgr_or_bgra); assert ok
    return buf.tobytes()

def test_load_rgb_flattens_alpha_onto_white():
    bgra = np.zeros((4, 4, 4), np.uint8); bgra[..., 2] = 255  # 紅色但全透明
    out = imaging.load_rgb(_encode(bgra))
    assert out.shape == (4, 4, 3) and (out == 255).all()

def test_load_rgb_converts_gray_and_keeps_channel_order():
    gray = np.full((3, 5), 100, np.uint8)
    assert (imaging.load_rgb(_encode(gray)) == 100).all()
    bgr = np.zeros((2, 2, 3), np.uint8); bgr[..., 2] = 255  # BGR 的紅
    out = imaging.load_rgb(_encode(bgr, ".jpg"))
    assert out[0, 0, 0] > 200 and out[0, 0, 2] < 60  # RGB 的紅

def test_load_rgb_handles_16bit():
    g16 = np.full((2, 2), 65535, np.uint16)
    assert (imaging.load_rgb(_encode(g16)) == 255).all()

def test_limit_size_keeps_aspect():
    img = np.zeros((1000, 4000, 3), np.uint8)
    assert imaging.limit_size(img, 2048).shape == (512, 2048, 3)
    assert imaging.limit_size(np.zeros((10, 20, 3), np.uint8), 2048).shape == (10, 20, 3)

def test_png_roundtrip_rgb(tmp_path):
    img = np.random.default_rng(0).integers(0, 255, (5, 6, 3), dtype=np.uint8)
    imaging.write_png(tmp_path / "a.png", img)
    assert (imaging.read_png(tmp_path / "a.png") == img).all()
```
```python
# backend/tests/test_names.py
import pytest
from artstyle.names import validate_name

@pytest.mark.parametrize("ok", ["knight", "騎士_01", "my-pack 2"])
def test_valid(ok): assert validate_name(ok) == ok

@pytest.mark.parametrize("bad", ["", "..", "a/b", "a\\b", "../x", " ", "x" * 65, "a:b"])
def test_invalid(bad):
    with pytest.raises(ValueError): validate_name(bad)
```
`conftest.py` 加 `sys.path` 指向 `backend/`。

- [ ] **Step 3: 跑測試確認失敗** — `cd backend && .venv/Scripts/python -m pytest -q` → ImportError

- [ ] **Step 4: 實作**

重點:
- `load_rgb`: `cv2.imdecode(np.frombuffer(data,np.uint8), cv2.IMREAD_UNCHANGED)`; 無法解碼拋 `ValueError("無法讀取圖片")`; uint16 → `(img/257).astype(uint8)`; 2D → 疊三通道; 4 通道 → `rgb*a + 255*(1-a)`; 最後 BGR→RGB
- `limit_size`: 長邊 > max_side 才用 `INTER_AREA` 縮
- `names.validate_name`: `re.fullmatch(r"[\w\- ]{1,64}", name)` 且 `name.strip()` 非空, `\w` 在 Python 預設含中文

- [ ] **Step 5: 跑測試確認通過**

- [ ] **Step 6: Commit** — `[feat] [美術風格工具] 建立後端骨架與影像讀寫`

---

### Task 2: 線稿正規化與有號距離場

**Files:**
- Create: `backend/artstyle/lines.py`, `backend/tests/test_lines.py`

**Interfaces:**
- Consumes: `imaging.resize_to`
- Produces:
  - `lines.normalize_line(img: np.ndarray, width: int, height: int) -> np.ndarray` — 任何 fal 回傳(RGB/灰階、黑底白線或白底黑線、任意尺寸)→ 指定尺寸的白底黑線灰階 uint8
  - `lines.line_mask(line: np.ndarray) -> np.ndarray` — bool, 線條像素(Otsu 門檻, 至少 < 200 才算線; 全白圖回全 False)
  - `lines.signed_distance(mask: np.ndarray) -> np.ndarray` — float32, 線內負、線外正
  - `lines.encode_sdf(sd: np.ndarray) -> np.ndarray` — uint8, `clip(128 + sd*8)`

- [ ] **Step 1: 寫失敗測試**

```python
# backend/tests/test_lines.py
import numpy as np
from artstyle import lines

def _white_with_black_bar():
    img = np.full((40, 40), 255, np.uint8); img[:, 18:22] = 0; return img

def test_normalize_keeps_white_background():
    out = lines.normalize_line(_white_with_black_bar(), 40, 40)
    assert out[0, 0] == 255 and out[0, 20] == 0

def test_normalize_inverts_black_background_and_rgb():
    inv = 255 - _white_with_black_bar()
    rgb = np.stack([inv] * 3, -1)
    out = lines.normalize_line(rgb, 40, 40)
    assert out[0, 0] == 255 and out[0, 20] == 0

def test_normalize_resizes_to_source():
    out = lines.normalize_line(_white_with_black_bar(), 80, 60)
    assert out.shape == (60, 80)

def test_line_mask_blank_is_empty():
    assert not lines.line_mask(np.full((10, 10), 255, np.uint8)).any()

def test_signed_distance_signs():
    mask = np.zeros((40, 40), bool); mask[:, 18:22] = True
    sd = lines.signed_distance(mask)
    assert sd[20, 20] < 0 and sd[20, 0] > 10
    assert abs(sd[20, 23] - 1.5) < 1.0  # 線外一兩像素

def test_signed_distance_no_lines_is_far():
    sd = lines.signed_distance(np.zeros((10, 10), bool))
    assert (sd >= 16).all()

def test_encode_sdf_range():
    enc = lines.encode_sdf(np.array([[-100, 0, 100]], np.float32))
    assert enc.tolist() == [[0, 128, 255]]
```

- [ ] **Step 2: 跑測試確認失敗**

- [ ] **Step 3: 實作**

重點:
- `normalize_line`: 轉灰階 → 若「邊框一圈像素」的中位數 < 128 就反相(用邊框判斷比全圖平均穩, 線多時平均會偏) → `resize_to(..., width, height)`
- `signed_distance`: `outside = cv2.distanceTransform((~mask).astype(uint8), DIST_L2, 5)`, `inside = cv2.distanceTransform(mask.astype(uint8), ...)`, `sd = outside - inside`; 沒有線時回 `full(..., 64.0)`
- 線內距離減 0.5、線外減 0.5 讓邊界落在 0 附近: `sd = (outside - 0.5) * (~mask) - (inside - 0.5) * mask`

- [ ] **Step 4: 跑測試確認通過**

- [ ] **Step 5: Commit** — `[feat] [美術風格工具] 線稿正規化與線條距離場`

---

### Task 3: 線稿圍區塊

**Files:**
- Create: `backend/artstyle/regions.py`, `backend/tests/test_regions.py`

**Interfaces:**
- Consumes: `lines.line_mask`
- Produces:
  - `regions.label_regions(mask: np.ndarray, gap_radius: int = 3, min_area: int = 12) -> np.ndarray` — int32 (H,W), 1..N, **每個像素都有編號**(線條像素歸給最近的區塊)
  - `regions.encode_labels(labels) -> np.ndarray` (H,W,4 uint8), `regions.decode_labels(rgba) -> np.ndarray`
  - 上限 65535 區塊, 超過拋 `ValueError("區塊過多")`

演算法(LineFiller trapped-ball 的簡化版):
1. `labels = 0`
2. 半徑 r 從 `gap_radius` 遞減到 0: `closed = dilate(mask, 圓盤 2r+1)`; 對 `(~closed) & (labels==0)` 取 4 連通區塊; 一個區塊**不碰觸既有區塊**(往外膨脹 1px 後與 `labels>0` 無交集)且面積 ≥ `min_area` 才登記為新區塊。碰到既有區塊的是被膨脹削掉的邊緣, 留給第 3 步
3. 若沒有任何區塊(空白線稿或全是線), 整張設為 1
4. 其餘 `labels==0` 像素用 `cv2.distanceTransformWithLabels(..., labelType=DIST_LABEL_PIXEL)` 取最近的已登記像素, 繼承其編號
5. 重新編號成連續 1..N

- [ ] **Step 1: 寫失敗測試**

```python
# backend/tests/test_regions.py
import numpy as np, pytest
from artstyle import regions

def _two_boxes(gap=0):
    m = np.zeros((60, 60), bool)
    m[0, :] = m[-1, :] = m[:, 0] = m[:, -1] = True
    m[:, 29:31] = True                 # 中間隔牆
    if gap: m[20:20 + gap, 29:31] = False  # 牆上開縫
    return m

def test_two_closed_boxes():
    lab = regions.label_regions(_two_boxes(), gap_radius=0)
    assert lab.min() >= 1 and len(np.unique(lab)) == 2
    assert lab[30, 10] != lab[30, 50]

def test_gap_closed_by_radius():
    m = _two_boxes(gap=4)
    assert len(np.unique(regions.label_regions(m, gap_radius=0))) == 1
    lab = regions.label_regions(m, gap_radius=3)
    assert lab[30, 10] != lab[30, 50]

def test_every_pixel_labeled_including_lines():
    lab = regions.label_regions(_two_boxes(), gap_radius=2)
    assert (lab > 0).all()

def test_thin_enclosed_region_survives_large_radius():
    m = _two_boxes()
    m[45, 2:28] = True; m[49, 2:28] = True; m[45:50, 27] = True  # 3px 高的細長封閉區
    lab = regions.label_regions(m, gap_radius=4, min_area=12)
    assert lab[47, 10] not in (lab[20, 10], lab[30, 50])

def test_blank_and_all_line():
    assert (regions.label_regions(np.zeros((8, 8), bool)) == 1).all()
    assert (regions.label_regions(np.ones((8, 8), bool)) == 1).all()

def test_encode_decode_roundtrip():
    lab = np.array([[1, 300], [65535, 2]], np.int32)
    rgba = regions.encode_labels(lab)
    assert rgba.shape == (2, 2, 4) and (rgba[..., 3] == 255).all()
    assert (regions.decode_labels(rgba) == lab).all()
```

- [ ] **Step 2: 跑測試確認失敗**
- [ ] **Step 3: 實作**(依上方演算法)
- [ ] **Step 4: 跑測試確認通過**
- [ ] **Step 5: Commit** — `[feat] [美術風格工具] 用線稿圍出區塊並補線縫`

---

### Task 4: 區塊代表色與平塗圖

**Files:**
- Create: `backend/artstyle/flat.py`, `backend/tests/test_flat.py`

**Interfaces:**
- Produces:
  - `flat.region_colors(labels, color_img, exclude: np.ndarray | None = None, trim: float = 0.2) -> dict[int, tuple[int,int,int]]` — 每區塊排除 `exclude`(線條)像素, 依亮度去掉最暗與最亮各 `trim` 比例後取各通道中位數; 區塊若全被排除則改用全部像素
  - `flat.region_areas(labels) -> dict[int, int]`
  - `flat.paint(labels, colors) -> np.ndarray` RGB

- [ ] **Step 1: 寫失敗測試**

```python
# backend/tests/test_flat.py
import numpy as np
from artstyle import flat

def test_median_ignores_highlight_and_shadow():
    labels = np.ones((10, 10), np.int32)
    img = np.full((10, 10, 3), 100, np.uint8)
    img[0, :] = 255; img[1, :] = 0      # 10% 高光、10% 陰影
    assert flat.region_colors(labels, img)[1] == (100, 100, 100)

def test_excludes_line_pixels():
    labels = np.ones((4, 4), np.int32); labels[:, 2:] = 2
    img = np.zeros((4, 4, 3), np.uint8); img[:, :2] = (200, 0, 0); img[:, 2:] = (0, 0, 200)
    exclude = np.zeros((4, 4), bool); exclude[:, 1] = True
    img[:, 1] = (0, 0, 0)               # 線條像素是黑的
    cols = flat.region_colors(labels, img, exclude)
    assert cols[1] == (200, 0, 0) and cols[2] == (0, 0, 200)

def test_region_fully_excluded_falls_back():
    labels = np.ones((2, 2), np.int32)
    img = np.full((2, 2, 3), 50, np.uint8)
    assert flat.region_colors(labels, img, np.ones((2, 2), bool))[1] == (50, 50, 50)

def test_paint_and_areas():
    labels = np.array([[1, 2], [2, 2]], np.int32)
    out = flat.paint(labels, {1: (1, 2, 3), 2: (4, 5, 6)})
    assert out[0, 0].tolist() == [1, 2, 3] and out[1, 1].tolist() == [4, 5, 6]
    assert flat.region_areas(labels) == {1: 1, 2: 3}
```

- [ ] **Step 2: 跑測試確認失敗**
- [ ] **Step 3: 實作** — 用 `np.argsort(labels.ravel(), kind="stable")` + `np.split` 依區塊分組, 避免逐區塊掃整張圖; `paint` 用查表陣列 `lut[labels]`
- [ ] **Step 4: 跑測試確認通過**
- [ ] **Step 5: Commit** — `[feat] [美術風格工具] 計算區塊代表色並產生平塗圖`

---

### Task 5: 深度圖換算法線

**Files:**
- Create: `backend/artstyle/normals.py`, `backend/tests/test_normals.py`

**Interfaces:**
- Produces:
  - `normals.normalize_depth(img, width, height, near_is_bright: bool) -> np.ndarray` — float32 0..1, 1 = 近; 縮放到指定尺寸
  - `normals.depth_to_normal(depth: np.ndarray, strength: float = 8.0, blur: float = 1.5) -> np.ndarray` — uint8 RGB 編碼法線(OpenGL 慣例)
  - `config.DEPTH_NEAR_IS_BRIGHT: bool`(Task 6 冒煙測試確定實際值)

計算: `h = GaussianBlur(depth) * strength * max(W,H) / 100`(深度 0..1 換成像素高度); `dx = Sobel_x(h)/8`, `dy = Sobel_y(h)/8`(影像 y 向下); `n = normalize(-dx, +dy, 1)`(+dy: 影像往下變高代表表面朝上); `rgb = (n*0.5+0.5)*255`

- [ ] **Step 1: 寫失敗測試**

```python
# backend/tests/test_normals.py
import numpy as np
from artstyle import normals

def _sphere(n=64):
    y, x = np.mgrid[0:n, 0:n].astype(np.float32)
    r2 = ((x - n / 2) / (n / 2)) ** 2 + ((y - n / 2) / (n / 2)) ** 2
    return np.sqrt(np.clip(1 - r2, 0, 1))  # 中間最近

def test_sphere_normals_point_outward():
    nrm = normals.depth_to_normal(_sphere()).astype(int)
    c = 32
    assert abs(nrm[c, c, 0] - 128) < 8 and abs(nrm[c, c, 1] - 128) < 8 and nrm[c, c, 2] > 240
    assert nrm[c, 52, 0] > 160      # 右半邊朝右
    assert nrm[12, c, 1] > 160      # 上半邊(影像 y 小)朝上
    assert nrm[52, c, 1] < 96       # 下半邊朝下

def test_flat_depth_faces_viewer():
    nrm = normals.depth_to_normal(np.full((16, 16), 0.5, np.float32))
    assert (abs(nrm[..., :2].astype(int) - 128) <= 1).all()

def test_normalize_depth_flips_and_resizes():
    img = np.zeros((10, 20), np.uint8); img[:, 10:] = 255
    d = normals.normalize_depth(img, 40, 20, near_is_bright=False)
    assert d.shape == (20, 40) and d[0, 0] > 0.9 and d[0, 39] < 0.1
```

- [ ] **Step 2: 跑測試確認失敗**
- [ ] **Step 3: 實作**; `normalize_depth` 先轉灰階 float, 以 1%/99% 分位數拉伸到 0..1 再依 `near_is_bright` 反轉
- [ ] **Step 4: 跑測試確認通過**
- [ ] **Step 5: Commit** — `[feat] [美術風格工具] 深度圖換算法線圖`

---

### Task 6: fal.ai 客戶端與冒煙測試

**Files:**
- Create: `backend/artstyle/fal.py`, `backend/scripts/fal_smoke.py`
- Modify: `backend/artstyle/config.py`(寫入 `DEPTH_NEAR_IS_BRIGHT` 實測結果)

**Interfaces:**
- Produces:
  - `class FalError(Exception)`
  - `class FalClient(Protocol): def run_image(self, model: str, img: np.ndarray, **params) -> np.ndarray`
  - `class HttpFalClient`: `__init__(key: str, timeout: float = 180)`; `run_image` POST `https://fal.run/{model}`, header `Authorization: Key {key}`, body `{"image_url": to_data_uri(img), **params}`; 取回 `result["image"]["url"]` 下載後 `cv2.imdecode`(UNCHANGED, 轉 RGB 或灰階); 任何 HTTP 錯誤/逾時/格式不符一律包成 `FalError(中文訊息 + 狀態碼 + 回應前 300 字)`
  - `fal.DEPTH_MODEL = "fal-ai/imageutils/marigold-depth"`, `fal.LINE_MODELS = {"lineart": "fal-ai/image-preprocessors/lineart", "teed": ..., "hed": ..., "pidi": ...}`

- [ ] **Step 1: 實作 `fal.py`**(純 I/O 包裝, 不寫單元測試; 由 Task 7 用假客戶端測協調邏輯)
- [ ] **Step 2: 寫 `scripts/fal_smoke.py`**: 參數為圖片路徑, 對該圖跑深度與四種線稿, 結果存到 `scratch/fal_smoke/`, 印出各結果尺寸、通道數、邊框中位數、四角與中心的深度值
- [ ] **Step 3: 準備測試圖** — 用 fal.ai 生一張有光影的動漫角色全身圖(`fal-ai/flux/schnell`, 主體在畫面中央、背景單純), 存成 `scratch/sample_char.png`(scratch 不進版控)
- [ ] **Step 4: 跑冒煙測試並目視檢查** — 確認: (a) data URI 輸入可被接受 (b) 線稿是黑底還是白底 (c) 深度圖角色(近)比背景亮還是暗 → 寫入 `config.DEPTH_NEAR_IS_BRIGHT` (d) 回傳尺寸是否等於輸入
- [ ] **Step 5: Commit** — `[feat] [美術風格工具] fal.ai 客戶端與冒煙測試腳本`

---

### Task 7: 分層包儲存與拆解協調

**Files:**
- Create: `backend/artstyle/pack.py`, `backend/artstyle/decompose.py`, `backend/tests/test_pack.py`, `backend/tests/test_decompose.py`

**Interfaces:**
- Consumes: Task 1~6 全部
- Produces:
  - `pack.DEPENDENTS = {"source": ["depth", "line", "flat"], "depth": ["normal"], "line": ["line_sdf", "regions"], "regions": ["flat"]}`
  - `class Pack`: `Pack.create(root: Path, name: str, image_bytes: bytes) -> Pack`(驗名、轉 RGB、限長邊、存 source、寫 meta; 已存在拋 `FileExistsError`); `Pack.open(root, name)`(不存在拋 `FileNotFoundError`); `Pack.list(root) -> list[dict]`(各包 meta)
  - `Pack.path(layer) -> Path`, `Pack.has(layer) -> bool`, `Pack.read(layer) -> np.ndarray`, `Pack.meta: dict`
  - `Pack.write_layer(layer, img, origin, **extra)` — 存檔、更新 `layers[layer]`(`stale=False`), 並遞迴把所有下游標 `stale=True`, 存 meta
  - `Pack.set_regions_meta(colors: dict, areas: dict)`
  - `decompose.STEPS = ["depth", "normal", "line", "line_sdf", "regions", "flat"]`
  - `decompose.run_step(pack, step, client: FalClient | None, **params)`:
    - `depth`: 需要 client; `normalize_depth(client.run_image(DEPTH_MODEL, source), W, H, DEPTH_NEAR_IS_BRIGHT)` 存成 8bit
    - `normal`: 讀 depth → `depth_to_normal`
    - `line`: 需要 client; `params.model` ∈ LINE_MODELS(預設 lineart), `normalize_line`
    - `line_sdf`: `encode_sdf(signed_distance(line_mask(line)))`
    - `regions`: `params.gap_radius`(預設 3, 0..16)、`params.min_area`(預設 12)→ `encode_labels(label_regions(...))`, 參數記進 layers.regions.params
    - `flat`: 色源 = `meta.layers.flat.color_source`("source" 或 "user_flat"); `region_colors(labels, 色源圖, exclude=line_mask)` → `paint` → 寫 flat 與 regions meta
    - 前置層不存在拋 `ValueError("請先完成「X」")`
  - `decompose.run_all(pack, client)` — 依序跑「不存在或 stale」的步驟; 某步失敗就拋出, 已完成的保留
  - `decompose.replace_layer(pack, layer, image_bytes)` — layer ∈ {line, normal, flat}: 轉 RGB/灰階、縮到包尺寸、origin="user"; 換 flat 時 `color_source="user_flat"` 並另存 `user_flat.png`, 接著重算 flat(各區塊從使用者平塗取色)
  - `decompose.set_region_color(pack, region_id, rgb)` — 改 meta 色表、重畫 flat.png(不標下游過期)

- [ ] **Step 1: 寫失敗測試**

```python
# backend/tests/test_decompose.py
import cv2, numpy as np, pytest
from artstyle.pack import Pack
from artstyle import decompose
from artstyle.fal import FalError

def _png(img):
    return cv2.imencode(".png", img)[1].tobytes()

def _source():
    img = np.full((60, 80, 3), 230, np.uint8)
    cv2.rectangle(img, (10, 10), (70, 50), (40, 40, 40), 2)     # 外框線
    img[12:49, 12:39] = (60, 60, 200)                            # 左半紅(BGR)
    img[12:49, 41:69] = (200, 60, 60)                            # 右半藍
    img[10:51, 39:41] = (40, 40, 40)                             # 中線
    return img

class FakeFal:
    def __init__(self, fail_on=None): self.calls = []; self.fail_on = fail_on
    def run_image(self, model, img, **params):
        self.calls.append(model)
        if self.fail_on and self.fail_on in model: raise FalError("模擬失敗")
        if "depth" in model:
            return np.full((30, 40), 128, np.uint8)               # 故意給一半尺寸
        gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
        return 255 - np.where(gray < 100, 0, 255).astype(np.uint8)  # 黑底白線

@pytest.fixture
def pack(tmp_path):
    return Pack.create(tmp_path, "測試", _png(_source()))

def test_run_all_produces_aligned_layers(pack):
    decompose.run_all(pack, FakeFal())
    for layer in ["depth", "normal", "line", "line_sdf", "regions", "flat"]:
        assert pack.read(layer).shape[:2] == (60, 80)
    flat = pack.read("flat")
    assert flat[30, 25, 0] > 150 and flat[30, 55, 2] > 150      # 左紅右藍(RGB)
    assert pack.meta["regions"]["count"] >= 3

def test_failure_keeps_completed_steps(pack):
    with pytest.raises(FalError):
        decompose.run_all(pack, FakeFal(fail_on="lineart"))
    assert pack.has("depth") and pack.has("normal") and not pack.has("line")

def test_rerun_line_marks_downstream_stale(pack):
    decompose.run_all(pack, FakeFal())
    decompose.run_step(pack, "line", FakeFal(), model="teed")
    layers = pack.meta["layers"]
    assert layers["regions"]["stale"] and layers["flat"]["stale"] and layers["line_sdf"]["stale"]
    assert not layers["normal"]["stale"]
    calls = FakeFal(); decompose.run_all(pack, calls)
    assert calls.calls == []                                     # 只重算本機步驟
    assert not pack.meta["layers"]["flat"]["stale"]

def test_missing_prerequisite(pack):
    with pytest.raises(ValueError, match="請先完成"):
        decompose.run_step(pack, "regions", None)

def test_set_region_color_updates_flat(pack):
    decompose.run_all(pack, FakeFal())
    rid = int(decompose.region_at(pack, 30, 25))
    decompose.set_region_color(pack, rid, (0, 255, 0))
    assert pack.read("flat")[30, 25].tolist() == [0, 255, 0]

def test_replace_flat_resamples_from_user_image(pack):
    decompose.run_all(pack, FakeFal())
    user = np.zeros((60, 80, 3), np.uint8); user[:] = (0, 200, 0)  # BGR 綠
    decompose.replace_layer(pack, "flat", _png(user))
    assert pack.read("flat")[30, 25].tolist() == [0, 200, 0]
    assert pack.meta["layers"]["flat"]["color_source"] == "user_flat"
```
```python
# backend/tests/test_pack.py
import cv2, numpy as np, pytest
from artstyle.pack import Pack

def _png(h, w): return cv2.imencode(".png", np.zeros((h, w, 3), np.uint8))[1].tobytes()

def test_create_limits_size_and_lists(tmp_path):
    p = Pack.create(tmp_path, "big", _png(100, 4096))
    assert (p.meta["width"], p.meta["height"]) == (2048, 50)
    assert [m["name"] for m in Pack.list(tmp_path)] == ["big"]

def test_duplicate_and_bad_names(tmp_path):
    Pack.create(tmp_path, "a", _png(4, 4))
    with pytest.raises(FileExistsError): Pack.create(tmp_path, "a", _png(4, 4))
    with pytest.raises(ValueError): Pack.create(tmp_path, "../x", _png(4, 4))
    with pytest.raises(FileNotFoundError): Pack.open(tmp_path, "nope")

def test_bad_image_bytes(tmp_path):
    with pytest.raises(ValueError): Pack.create(tmp_path, "x", b"not an image")
```

另加 `decompose.region_at(pack, y, x) -> int`(讀 regions 解碼取值, 越界拋 `ValueError`)。

- [ ] **Step 2: 跑測試確認失敗**
- [ ] **Step 3: 實作 `pack.py`、`decompose.py`**
- [ ] **Step 4: 跑全部後端測試確認通過**
- [ ] **Step 5: Commit** — `[feat] [美術風格工具] 分層包儲存與拆解流程協調`

---

### Task 8: 配方儲存與 FastAPI 路由

**Files:**
- Create: `backend/artstyle/recipes.py`, `backend/artstyle/server.py`, `backend/tests/test_server.py`

**Interfaces:**
- Produces(HTTP, 全部 JSON 錯誤格式 `{"detail": "中文訊息"}`):
  - `GET /api/status` → `{"fal": bool}`
  - `GET /api/packs` → `[meta, ...]`
  - `POST /api/packs` multipart `name`, `file` → meta(名稱不合法 400、重複 409、壞圖 400)
  - `GET /api/packs/{name}` → meta(404)
  - `GET /api/packs/{name}/files/{layer}.png` → PNG(`Cache-Control: no-store`; layer 必須在白名單)
  - `POST /api/packs/{name}/steps/{step}` JSON params → meta(前置缺 400, fal 失敗 502, 沒金鑰 503)
  - `POST /api/packs/{name}/decompose` → meta(同上)
  - `PUT /api/packs/{name}/layers/{layer}` multipart `file` → meta
  - `GET /api/packs/{name}/region?x=&y=` → `{"id": int, "color": [r,g,b]}`
  - `PUT /api/packs/{name}/regions/{id}` JSON `{"color": [r,g,b]}` → meta
  - `GET /api/recipes` → `["名稱", ...]`; `GET /api/recipes/{name}` → JSON; `PUT /api/recipes/{name}` JSON → `{"ok": true}`
  - `server.create_app(data_dir: Path, client_factory: Callable[[], FalClient | None]) -> FastAPI`; 模組層 `app = create_app(config.DATA_DIR, 預設工廠)`(有 FAL_KEY 才建 HttpFalClient)
- `recipes.list_recipes(dir)`, `load_recipe(dir, name) -> dict`, `save_recipe(dir, name, data: dict)`(驗名; 內容必須是 JSON 物件, 大小 < 256KB)

- [ ] **Step 1: 寫失敗測試**(用 `fastapi.testclient.TestClient`, 假 fal 沿用 Task 7 的 FakeFal 寫法)

```python
# backend/tests/test_server.py
import cv2, numpy as np, pytest
from fastapi.testclient import TestClient
from artstyle.server import create_app
from tests.test_decompose import FakeFal, _source

def _png(img): return cv2.imencode(".png", img)[1].tobytes()

@pytest.fixture
def client(tmp_path):
    return TestClient(create_app(tmp_path, lambda: FakeFal()))

def _upload(client, name="騎士"):
    return client.post("/api/packs", data={"name": name},
                       files={"file": ("a.png", _png(_source()), "image/png")})

def test_upload_decompose_and_fetch(client):
    assert _upload(client).status_code == 200
    assert client.post("/api/packs/騎士/decompose").status_code == 200
    r = client.get("/api/packs/騎士/files/normal.png")
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    info = client.get("/api/packs/騎士/region", params={"x": 25, "y": 30}).json()
    assert info["id"] >= 1
    r = client.put(f"/api/packs/騎士/regions/{info['id']}", json={"color": [1, 2, 3]})
    assert r.status_code == 200

def test_errors(client):
    assert _upload(client, "../x").status_code == 400
    _upload(client)
    assert _upload(client).status_code == 409
    assert client.get("/api/packs/none").status_code == 404
    assert client.get("/api/packs/騎士/files/meta.json").status_code == 404
    assert client.post("/api/packs/騎士/steps/regions").status_code == 400

def test_no_key_returns_503(tmp_path):
    c = TestClient(create_app(tmp_path, lambda: None))
    assert c.get("/api/status").json() == {"fal": False}
    _upload(c)
    r = c.post("/api/packs/騎士/steps/depth")
    assert r.status_code == 503 and "FAL_KEY" in r.json()["detail"]

def test_fal_failure_returns_502(tmp_path):
    c = TestClient(create_app(tmp_path, lambda: FakeFal(fail_on="depth")))
    _upload(c)
    assert c.post("/api/packs/騎士/decompose").status_code == 502

def test_recipes_roundtrip(client):
    assert client.get("/api/recipes").json() == []
    assert client.put("/api/recipes/漫畫風", json={"version": 1}).status_code == 200
    assert client.get("/api/recipes").json() == ["漫畫風"]
    assert client.get("/api/recipes/漫畫風").json() == {"version": 1}
    assert client.put("/api/recipes/..%2Fx", json={}).status_code in (400, 404)
```

- [ ] **Step 2: 跑測試確認失敗**
- [ ] **Step 3: 實作**; 例外對應: `ValueError`→400, `FileNotFoundError`→404, `FileExistsError`→409, `FalError`→502, 沒客戶端→503 `"沒有設定 FAL_KEY 環境變數, 無法呼叫 fal.ai"`
- [ ] **Step 4: 跑全部後端測試確認通過**
- [ ] **Step 5: Commit** — `[feat] [美術風格工具] 後端 API 路由與配方儲存`

---

### Task 9: 前端骨架、配方模型、API 客戶端

**Files:**
- Create: `frontend/package.json`, `frontend/vite.config.ts`, `frontend/tsconfig.json`, `frontend/index.html`, `frontend/src/main.ts`, `frontend/src/style.css`, `frontend/src/api.ts`, `frontend/src/recipe.ts`, `frontend/tests/recipe.test.ts`

**Interfaces:**
- Produces:
  - `recipe.ts`:
```ts
export interface Recipe {
  version: 1;
  color: { enabled: boolean; paletteMode: 'source' | 'auto' | 'preset' | 'custom'; autoCount: number; preset: string; custom: string[]; hue: number; saturation: number; temperature: number };
  lighting: { enabled: boolean; azimuth: number; elevation: number; bands: number; shadowMode: 'darken' | 'cool'; shadowStrength: number; ambient: number; normalStrength: number; rim: boolean; rimStrength: number; rimColor: string };
  lines: { enabled: boolean; thickness: number; variation: 'uniform' | 'shadow'; variationAmount: number; colorMode: 'black' | 'region'; colorDarken: number; texture: 'clean' | 'pencil' | 'crayon'; jitter: number };
  effects: { enabled: boolean; halftone: boolean; halftoneSize: number; halftoneAngle: number; halftoneShadowOnly: boolean; halftoneStrength: number; paper: number; grain: number };
  filter: { enabled: boolean; kuwahara: number; pixelSize: number; dither: boolean; ditherLevels: number; contrast: number; tint: string; tintStrength: number; vignette: number };
}
export const DEFAULT_RECIPE: Recipe;
export const LIMITS: Record<string, [number, number]>;   // 'lighting.bands': [1, 16] 等
export function normalizeRecipe(raw: unknown): { recipe: Recipe; fixed: string[] };  // fixed = 被補或被修正的欄位路徑
```
  預設值: color(source, 8, 'pico8', [], 0, 1, 0); lighting(true, 135, 45, 3, 'cool', 0.5, 0.25, 1, false, 0.5, '#ffffff'); lines(true, 0, 'uniform', 1.5, 'black', 0.5, 'clean', 0); effects(true, false, 6, 45, true, 0.6, 0, 0); filter(true, 0, 1, false, 4, 1, '#ffffff', 0, 0)
  範圍: autoCount 2..32, hue -180..180, saturation 0..2, temperature -1..1, azimuth 0..360, elevation 5..90, bands 1..16(整數), shadowStrength/ambient/rimStrength/colorDarken/halftoneStrength/paper/grain/tintStrength/vignette 0..1, normalStrength 0..3, thickness -3..8, variationAmount 0..6, jitter 0..4, halftoneSize 3..24, halftoneAngle 0..180, kuwahara 0..6(整數), pixelSize 1..32(整數), ditherLevels 2..16(整數), contrast 0.5..2
  - `api.ts`: `getStatus()`, `listPacks()`, `getPack(name)`, `createPack(name, file)`, `runStep(name, step, params)`, `decomposeAll(name)`, `replaceLayer(name, layer, file)`, `regionAt(name, x, y)`, `setRegionColor(name, id, rgb)`, `fileUrl(name, layer)`(加 `?t=時間戳` 防快取), `listRecipes()`, `getRecipe(name)`, `saveRecipe(name, recipe)`; 非 2xx 拋 `Error(detail)`
  - `main.ts`: 頂部導覽「拆解檢查 / 渲染 / 對照網格」, hash 路由 `#/decompose` `#/render` `#/grid`, 每頁 `mount(el: HTMLElement): () => void`(回傳卸載函式)

- [ ] **Step 1: 建 Vite 專案** — `npm create vite@latest frontend -- --template vanilla-ts` 後刪範例檔; `npm i tweakpane@4 @tweakpane/core@2`(core 只供型別) ; `npm i -D vitest`; `vite.config.ts` proxy `/api` → `http://127.0.0.1:8765`
- [ ] **Step 2: 寫失敗測試**

```ts
// frontend/tests/recipe.test.ts
import { describe, it, expect } from 'vitest';
import { normalizeRecipe, DEFAULT_RECIPE } from '../src/recipe';

describe('normalizeRecipe', () => {
  it('完整預設值原樣通過', () => {
    const { recipe, fixed } = normalizeRecipe(structuredClone(DEFAULT_RECIPE));
    expect(recipe).toEqual(DEFAULT_RECIPE); expect(fixed).toEqual([]);
  });
  it('缺欄位補預設並回報', () => {
    const { recipe, fixed } = normalizeRecipe({ version: 1, lighting: { bands: 5 } });
    expect(recipe.lighting.bands).toBe(5);
    expect(recipe.lines).toEqual(DEFAULT_RECIPE.lines);
    expect(fixed).toContain('lines'); expect(fixed).toContain('lighting.azimuth');
  });
  it('越界數值夾回範圍並取整', () => {
    const { recipe, fixed } = normalizeRecipe({ version: 1, lighting: { bands: 0 }, filter: { pixelSize: 3.7 } });
    expect(recipe.lighting.bands).toBe(1); expect(recipe.filter.pixelSize).toBe(4);
    expect(fixed).toContain('lighting.bands');
  });
  it('未知列舉值與錯誤型別改回預設', () => {
    const { recipe, fixed } = normalizeRecipe({ color: { paletteMode: 'zzz', custom: 'red' }, lines: { enabled: 'yes' } });
    expect(recipe.color.paletteMode).toBe('source'); expect(recipe.color.custom).toEqual([]);
    expect(recipe.lines.enabled).toBe(true); expect(fixed).toContain('color.paletteMode');
  });
  it('非物件輸入回傳整份預設', () => {
    expect(normalizeRecipe(null).recipe).toEqual(DEFAULT_RECIPE);
  });
  it('custom 只保留合法 #rrggbb', () => {
    expect(normalizeRecipe({ color: { custom: ['#ff0000', 'oops', '#00FF00'] } }).recipe.color.custom)
      .toEqual(['#ff0000', '#00ff00']);
  });
});
```

- [ ] **Step 3: 跑 `npx vitest run` 確認失敗**
- [ ] **Step 4: 實作 recipe.ts、api.ts、main.ts、style.css、index.html**(頁面先放空殼)
- [ ] **Step 5: 跑測試通過, `npx tsc --noEmit` 無錯**
- [ ] **Step 6: Commit** — `[feat] [美術風格工具] 前端骨架與風格配方模型`

---

### Task 10: 色彩運算

**Files:**
- Create: `frontend/src/colorMath.ts`, `frontend/src/palettes.ts`, `frontend/tests/colorMath.test.ts`

**Interfaces:**
- Produces:
  - `type RGB = [number, number, number]`(0..255)
  - `hexToRgb(hex): RGB`, `rgbToHex(rgb): string`
  - `rgbToOklab(rgb): [number, number, number]`, `oklabToRgb(lab): RGB`(夾 0..255)
  - `adjust(rgb, hue: number, saturation: number, temperature: number): RGB` — 在 OKLCh 轉色相(度)、乘彩度; 色溫 t: `a += 0.02*t, b += 0.06*t`(正 = 暖)
  - `kmeansPalette(colors: RGB[], weights: number[], k: number): RGB[]` — OKLab 空間, 決定性初始化(依權重排序取前 k 個彼此距離 > 0.02 的顏色), 迭代 20 次; 輸入顏色數 ≤ k 時直接回傳去重後的輸入
  - `nearest(rgb, palette: RGB[]): RGB` — OKLab 距離
  - `buildRegionTable(regionColors: Record<string, RGB>, areas: Record<string, number>, color: Recipe['color']): Uint8Array` — 長度 256*256*4 的 RGBA 表, 索引 id 放 `id*4`; 依 paletteMode 對應色票後再套 `adjust`; enabled=false 時只放原色
  - `palettes.ts`: `PRESET_PALETTES: Record<string, string[]>` 含 `pico8`(16 色)、`gameboy`(4 色 `#0f380f #306230 #8bac0f #9bbc0f`)、`pastel`(8 色)

- [ ] **Step 1: 寫失敗測試**

```ts
// frontend/tests/colorMath.test.ts
import { describe, it, expect } from 'vitest';
import { rgbToOklab, oklabToRgb, adjust, kmeansPalette, nearest, buildRegionTable, hexToRgb } from '../src/colorMath';
import { DEFAULT_RECIPE } from '../src/recipe';

describe('colorMath', () => {
  it('OKLab 往返', () => {
    for (const c of [[0, 0, 0], [255, 255, 255], [200, 30, 90]] as const)
      oklabToRgb(rgbToOklab([...c])).forEach((v, i) => expect(Math.abs(v - c[i])).toBeLessThanOrEqual(1));
  });
  it('adjust 不動時原樣', () => {
    expect(adjust([120, 60, 30], 0, 1, 0)).toEqual([120, 60, 30]);
  });
  it('飽和 0 變灰、色溫正值變暖', () => {
    const g = adjust([200, 50, 50], 0, 0, 0); expect(Math.abs(g[0] - g[2])).toBeLessThanOrEqual(2);
    const w = adjust([128, 128, 128], 0, 1, 1); expect(w[0]).toBeGreaterThan(w[2]);
  });
  it('kmeans 分出兩群', () => {
    const cols: [number, number, number][] = [[250, 0, 0], [240, 10, 10], [0, 0, 250], [10, 10, 240]];
    const p = kmeansPalette(cols, [1, 1, 1, 1], 2);
    expect(p).toHaveLength(2);
    expect(nearest([255, 0, 0], p)[0]).toBeGreaterThan(200);
  });
  it('色表依 id 放置, preset 模式對應到色票', () => {
    const color = { ...DEFAULT_RECIPE.color, paletteMode: 'preset' as const, preset: 'gameboy' };
    const t = buildRegionTable({ '1': [0, 0, 0], '300': [255, 255, 255] }, { '1': 1, '300': 1 }, color);
    expect(Array.from(t.slice(4, 8))).toEqual([...hexToRgb('#0f380f'), 255]);
    expect(Array.from(t.slice(300 * 4, 300 * 4 + 3))).toEqual(hexToRgb('#9bbc0f'));
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**
- [ ] **Step 3: 實作**
- [ ] **Step 4: 跑測試確認通過**
- [ ] **Step 5: Commit** — `[feat] [美術風格工具] 色票與色彩調整運算`

---

### Task 11: WebGL2 渲染器與五層 shader

**Files:**
- Create: `frontend/src/gl/glUtil.ts`, `frontend/src/gl/shaders.ts`, `frontend/src/gl/renderer.ts`

**Interfaces:**
- Consumes: `Recipe`, `buildRegionTable`, `hexToRgb`, `api.fileUrl`
- Produces:
  - `class Renderer`: `constructor(canvas: HTMLCanvasElement)`(`preserveDrawingBuffer: true`); `async loadPack(meta)`(載入 regions、normal、line_sdf、source 四張貼圖, 用 `createImageBitmap(blob, {colorSpaceConversion: 'none', premultiplyAlpha: 'none'})`, `UNPACK_FLIP_Y` 不開, 全部 NEAREST + CLAMP; 依尺寸重建 FBO; 存 regionColors/areas); `render(recipe)`; `renderSource()`(顯示原圖對照); `setRegionColors(colors)`; `dispose()`
  - 渲染鏈(每層一個 FBO, RGBA8; alpha 通道傳「受光度 shade」0..1 給後面的層, 最後一層輸出 alpha=1):
    1. `color`: `id = r + g*256` → `texelFetch(uRegionTable, ivec2(id%256, id/256))`; 輸出 shade=1
    2. `lighting`: `n = tex(normal)*2-1; n.xy *= normalStrength; n = normalize(n)`; `L` 由方位角/仰角(方位角 0 = 右, 逆時針, 畫面 y 向上); `t = max(dot(n,L),0)`; `bands==1` → t=1; 否則 `q = clamp(floor(t*bands)/(bands-1), 0, 1)`; `q = ambient + (1-ambient)*q`; 陰影色: darken = `c*(1-shadowStrength)`, cool = `mix(c, c*vec3(0.55,0.62,0.95), shadowStrength)`; `out = mix(shadowCol, c, q)`; 邊緣光 `rim = smoothstep(0.55, 0.95, 1-n.z) * max(dot(normalize(n.xy+1e-4), normalize(L.xy+1e-4)), 0)` 加上 `rimColor*rimStrength*rim`; alpha = q
    3. `lines`: `sd = (tex(sdf).r*255-128)/8`, 以 `uv + jitter*(noise(uv*0.02*res)-0.5)*2/res` 取樣; 粗細 `w = thickness + (variation==shadow ? variationAmount*(1-shade) : 0)`; 覆蓋率 `a = 1 - smoothstep(w-0.75, w+0.75, sd)`; 質感: pencil `a *= 0.55+0.45*hash(px)`, crayon `a *= step(0.35, fbm(px*0.35))` 後再柔化; 線色 black=`vec3(0.08)`, region=`regionColor*(1-colorDarken)`
    4. `effects`: 網點(格子旋轉 halftoneAngle、格寬 halftoneSize px; 半徑由暗度 `1-shade`(shadowOnly) 或 `1-亮度` 決定 `r = sqrt(dark)*size*0.7`; `out *= 1-halftoneStrength*mask`), 紙紋 `out *= 1-paper*0.25*(1-fbm(px*0.02))`, 顆粒 `out += grain*0.15*(hash(px)-0.5)`
    5. `filterA`(油畫感平滑): kuwahara 半徑 r(0 = 直通), 四象限平均取變異最小
    6. `filterB`: 像素化(取 `floor(px/size)*size + size/2` 的顏色)、對比 `(c-0.5)*contrast+0.5`、染色 `mix(c, c*tint, tintStrength)`、抖色(4x4 Bayer, `floor(c*(L-1)+bayer)/(L-1)`)、暗角 `1 - vignette*smoothstep(0.4, 0.95, length(uv-0.5)*1.4)` → 畫布
    - 任一層 `enabled=false`: 該 shader 直接回傳輸入(lighting 關閉時 shade=1)
  - shader 編譯失敗要 `console.error` 完整 log 並拋錯(含層名)

- [ ] **Step 1: 實作 glUtil.ts**(compile/link、createTexture(bitmap 或 Uint8Array)、FBO、全螢幕三角形 VAO)
- [ ] **Step 2: 實作 shaders.ts**(六個 fragment shader 字串 + 共用 noise 函式片段)
- [ ] **Step 3: 實作 renderer.ts**
- [ ] **Step 4: `npx tsc --noEmit` 通過**
- [ ] **Step 5: Commit** — `[feat] [美術風格工具] WebGL2 五層渲染器`

(畫面正確性在 Task 12 頁面完成後用瀏覽器驗證)

---

### Task 12: 渲染頁

**Files:**
- Create: `frontend/src/pages/renderPage.ts`
- Modify: `frontend/src/main.ts`(掛上頁面)

**Interfaces:**
- Consumes: `Renderer`, `Recipe`, `normalizeRecipe`, `DEFAULT_RECIPE`, `api.*`, `PRESET_PALETTES`

畫面: 左上「分層包」下拉、「配方」下拉 + 讀取/存檔/另存新檔按鈕、「原圖對照」按住切換按鈕、「匯出 PNG」; 中央畫布(CSS `max-width/max-height: 100%`, `image-rendering: pixelated`); 右側 Tweakpane, 五個 folder(色彩/光照/線條/特效/濾鏡), 每個 folder 第一個欄位是「啟用」。
- 光源方向: 一個 point2d 綁定 `{x, y}`(-1..1), 改變時換算 `azimuth = atan2(y, x)`、仰角保留另一個滑桿; 載入配方時反算
- 色票自訂: v1 用一個文字欄位輸入以空白分隔的 hex
- 任一參數改變 → `requestAnimationFrame` 合併後 `renderer.render(recipe)`
- 讀取配方: `normalizeRecipe`, `fixed` 非空時在頁面頂部顯示提示「以下欄位已補預設值或修正: ...」
- 存檔: 名稱用 `prompt()`; 匯出 PNG: `canvas.toBlob` 下載, 檔名 `<pack>_<recipe>.png`
- 分層包缺 regions/normal/line_sdf 任一層 → 畫布區顯示「這個分層包還沒拆解完成, 請到拆解檢查頁」

- [ ] **Step 1: 實作頁面**
- [ ] **Step 2: `npx tsc --noEmit` 通過**
- [ ] **Step 3: 端對端驗證** — 啟動後端(帶 FAL_KEY)與前端, 用 Task 6 的測試圖建包並 `decompose`(可直接打 API), 在瀏覽器開渲染頁; 依序確認: 每層開關都有變化、色階 1/3/16 明顯不同、拖光源陰影跟著動、線條粗細/背光側加粗、網點只在陰影區、像素化+抖色、存配方→重新整理→讀回參數一致、匯出 PNG。用 claude-in-chrome 截圖檢查, 有 shader 錯誤看 console
- [ ] **Step 4: Commit** — `[feat] [美術風格工具] 渲染頁與參數面板`

---

### Task 13: 拆解檢查頁

**Files:**
- Create: `frontend/src/pages/decomposePage.ts`
- Modify: `frontend/src/main.ts`

畫面:
- 頂部: `getStatus().fal === false` 時顯示紅色橫幅「沒有設定 FAL_KEY, 無法執行 AI 步驟(法線、線稿)。設定方式見 README」
- 新增: 名稱輸入 + 檔案選擇 + 「建立」; 分層包下拉
- 「全部拆解」按鈕(執行中禁用並顯示「拆解中…可能需要一兩分鐘」, 錯誤訊息顯示在按鈕旁)
- 四格並排: 原圖 / 線稿 / 平塗 / 法線; 每格標題列顯示來源(AI 模型名 / 使用者 / 計算)與「已過期」標記; 每格有「重跑」與「上傳替換」(原圖格沒有)
  - 線稿格: 模型下拉(lineart/teed/hed/pidi)
  - 平塗格: 補線縫半徑(0..16)、最小面積輸入, 「重算區塊」會依序跑 regions → flat
- 疊圖比對: 「疊上線稿」核取 + 不透明度滑桿, 把線稿以 `mix-blend-mode: multiply` 疊在原圖/平塗/法線上
- 點平塗圖: 換算成圖片座標 → `regionAt` → 跳出 `<input type=color>` 預設該區塊色 → 改完 `setRegionColor` → 刷新平塗圖
- 有過期層時顯示「有 N 層已過期」, 按「全部拆解」只會重算過期的

- [ ] **Step 1: 實作頁面**
- [ ] **Step 2: `npx tsc --noEmit` 通過**
- [ ] **Step 3: 瀏覽器驗證** — 上傳測試圖 → 全部拆解 → 四格出現 → 換線稿模型重跑後平塗標過期 → 全部拆解只重算本機步驟 → 點區塊改色生效 → 上傳自己的平塗圖替換
- [ ] **Step 4: Commit** — `[feat] [美術風格工具] 拆解檢查頁`

---

### Task 14: 對照網格、README、啟動腳本

**Files:**
- Create: `frontend/src/pages/gridPage.ts`, `README.md`, `start.bat`, `data/recipes/預設.json`
- Modify: `frontend/src/main.ts`

對照網格: 配方下拉; 用一個隱藏畫布的 Renderer, 逐一 `loadPack` → `render` → `drawImage` 到各自的縮圖 canvas(長邊 360px), 底下標包名; 未拆解完成的包顯示灰框「未完成」並跳過。點縮圖跳到渲染頁並選好該包與配方(`#/render?pack=..&recipe=..`)。

`start.bat`: 開兩個視窗分別跑 `backend\.venv\Scripts\python -m uvicorn artstyle.server:app --host 127.0.0.1 --port 8765 --app-dir backend` 與 `cd frontend && npm run dev`。

README: 用途一段話、安裝(建 venv、npm install)、設定 `FAL_KEY`、啟動、三個頁面的用法、資料夾說明、參考專案授權表連到規格書。

- [ ] **Step 1: 實作對照網格與渲染頁的網址參數**
- [ ] **Step 2: 寫 README、start.bat、預設配方(就是 DEFAULT_RECIPE 的 JSON)**
- [ ] **Step 3: 瀏覽器驗證** — 至少兩個分層包、切換配方縮圖全部更新
- [ ] **Step 4: 跑全部測試**(後端 pytest、前端 vitest、tsc)
- [ ] **Step 5: Commit** — `[feat] [美術風格工具] 1.對照網格頁 2.使用說明與啟動腳本`
