# 部位比例 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新頁籤「部位比例」: SAM 3 切部位 → 前端變形拼貼(含別張圖的部位)→ Nano Banana/Qwen 修圖 → 只採用改動範圍附近, 加比例配方。

**Architecture:** 後端新增 `artstyle/proportion/` 套件(作品存檔、切部位、補洞貼回、比例配方驗證)與獨立 router; fal 客戶端加 `segment`、`edit`。前端新增 `src/proportion/`(純邏輯: 變形、配方; 繪圖: 拼貼與改動範圍用 Canvas 2D 同一條路徑產生預覽與輸出)與頁面。

**Tech Stack:** FastAPI + OpenCV + numpy(pytest); TypeScript + Vite + Canvas 2D(vitest)。

**Spec:** `docs/superpowers/specs/2026-10-10-part-proportion-design.md`

## Global Constraints

- 後端寫入請求一律要 `X-ArtStyle: 1` 標頭(既有 middleware)
- 名稱驗證沿用 `names.validate_name`; 上傳圖長邊上限 `config.MAX_SIDE`(2048)
- 錯誤訊息一律中文; ValueError→400、FileNotFoundError→404、FileExistsError→409、FalError→502、NoClientError→503
- 修圖模型只允許 `nano-banana`、`qwen`; 張數 1~4
- SAM 分數 < 0.3 丟棄
- 貼回: 膨脹 `pad = max(8, round(長邊 × 0.03))`, 高斯 σ = pad/2, 範圍外與補洞後拼貼逐像素相同
- 比例配方 `version` 必須是整數 1
- commit 訊息格式: `[feat] [美術風格工具] ...`, 單行

## Review Focus

1. 作品有素材圖但部位被刪光、或素材圖部位未放到主圖 → 拼貼不應畫它, 生成仍可用
2. 縮放為 0 或負數、NaN 從 layout PUT 進來 → 後端 400, 不寫入
3. 主圖部位隱藏但沒有其他改動 → 算「有改動」, 生成可按, 改動範圍 = 該部位原位置
4. AI 回傳尺寸、長寬比與拼貼不同 → 縮放對齊後貼回, 不崩潰(Task 3 測試)
5. 從分層包建作品時分層包不存在 → 404 且不留空資料夾(Task 2 測試)

---

### Task 1: fal 客戶端加 segment 與 edit

**Files:** Modify `backend/artstyle/fal.py`; Test `backend/tests/test_fal_client.py`(以 httpx MockTransport 測解析)

**Interfaces — Produces:**
- `SAM_MODEL = "fal-ai/sam-3/image"`, `EDIT_MODELS = {"nano-banana": "fal-ai/nano-banana/edit", "qwen": "fal-ai/qwen-image-edit"}`
- `FalClient.segment(img: np.ndarray, prompt: str, points: list[dict], boxes: list[dict]) -> list[tuple[np.ndarray, float]]`(遮罩 uint8 0/255、原圖尺寸; 無結果回空 list)
- `FalClient.edit(model_key: str, img: np.ndarray, prompt: str, num_images: int) -> list[np.ndarray]`(RGB)
- `HttpFalClient(key, timeout=180, transport=None)`(transport 供測試)

- [ ] 測試: segment 解析 masks+scores、masks 為 null 回空、遮罩 RGBA 取 alpha/RGB 轉灰階並縮放回原圖; edit 對 nano 送 `image_urls`、對 qwen 送 `image_url`+`image_size`; HTTP 400 → FalError
- [ ] 實作, 跑 `pytest tests/test_fal_client.py`, commit

### Task 2: 作品存檔 Work

**Files:** Create `backend/artstyle/proportion/__init__.py`, `work.py`; Test `backend/tests/test_proportion_work.py`

**Interfaces — Produces:**
- `Work.create(root, name, image_bytes) -> Work`; `Work.open(root, name)`; `Work.list(root) -> list[dict]`
- `work.add_image(image_bytes, name) -> str`(id `s1`、`s2`…)
- `work.image(image_id) -> np.ndarray`(RGB); `work.mask(part_id) -> np.ndarray`
- `work.add_part(name, image_id, mask, points, box) -> dict`; `work.update_part_mask(part_id, mask, points, box)`; `work.delete_part(part_id)`
- `work.set_layout(parts: list[dict], pad: dict)` 驗證: 變形數值有限、scale ∈ (0, 20]、anchor 合法、z 整數、place 為 null 或 {scale>0,tx,ty}
- `work.add_result(img, params) -> dict`; `work.file_path(rel) -> Path`(只允許 images/、masks/、results/ 下 .png/.json, 防路徑穿越)
- 部位顏色依序輪替 12 色; bbox 由遮罩算

- [ ] 測試: 建立/重開/清單、壞圖不留資料夾、加素材圖、部位增刪改、layout 驗證錯誤(0、負、NaN、未知 anchor)、file_path 拒絕 `../`
- [ ] 實作, 測試, commit

### Task 3: 切部位與合成邏輯

**Files:** Create `backend/artstyle/proportion/parts.py`, `compose.py`; Test `backend/tests/test_proportion_parts.py`, `test_proportion_compose.py`

**Interfaces — Produces:**
- `parts.to_prompt(name) -> str`(中文對照表, 未知原樣)
- `parts.merge_masks(results, shape) -> np.ndarray`(丟分數 < 0.3, 聯集)
- `parts.split_left_right(mask) -> tuple[np.ndarray, np.ndarray]`(連通塊 < 2 → ValueError)
- `compose.fill_holes(rgba) -> np.ndarray`(RGB, Telea)
- `compose.paste_back(ai, base, region) -> np.ndarray`(ai 縮放到 base 尺寸)
- `compose.build_prompt(has_foreign, extra) -> str`

- [ ] 測試: 對照表、低分過濾、全低分 → 全 0、左右拆分、單塊拆分報錯; 貼回後膨脹區外像素 == base(差值 0)、AI 尺寸不同可對齊、prompt 含外來句與補充描述
- [ ] 實作, 測試, commit

### Task 4: 比例配方與 API router

**Files:** Create `backend/artstyle/proportion/recipes.py`, `backend/artstyle/proportion/api.py`; Modify `backend/artstyle/server.py`(掛 router); Test `backend/tests/test_proportion_api.py`

**Interfaces — Produces:** spec 5.2 全部端點。
- `POST /works`: form `name` + (`file` 或 `pack`)
- `POST /works/{n}/parts`: `{"image": id, "names": [..]}` → `{"meta", "missing": [..]}`
- `POST /works/{n}/parts/{id}/refine`: `{"points": [...], "box": {...}|null}`; 空 → 400「修正後沒有切到任何範圍, 已保留上一版」
- `POST /works/{n}/parts/{id}/split` → meta
- `PUT /works/{n}/layout`: `{"parts": [{id, placed, place, transform}], "pad"}`
- `POST /works/{n}/generate`: form `collage`(PNG RGBA)、`region`(PNG 灰階)、`options`(JSON: model, count, extra, foreign) → `{"meta", "results": [...], "errors": [...]}`; 全部失敗 → 502
- `POST /works/{n}/results/{id}/to-pack` → `{"pack": name}`
- `GET/PUT /recipes[/{name}]`: 比例配方, 存 `data/proportion_recipes`; PUT 驗證 version==1 與欄位
- 沒有 client → 503(沿用 NoClientError)

- [ ] 測試(FakeFal 擴充 segment/edit): 建作品(上傳/分層包/分層包不存在 404)、切部位(找到/找不到列 missing)、refine 空、split、layout、generate(成功、部分失敗、全失敗、尺寸不符 400、改動範圍空 400)、to-pack 重名加流水號、配方存取與版本錯誤、檔案下載
- [ ] 實作, 全部 pytest, commit

### Task 5: 前端純邏輯

**Files:** Create `frontend/src/proportion/model.ts`, `transform.ts`, `recipe.ts`; Modify `frontend/src/api.ts`; Test `frontend/tests/proportionTransform.test.ts`, `proportionRecipe.test.ts`

**Interfaces — Produces:**
- types `WorkMeta`, `Part`, `PartTransform`, `Place`, `Pad`, `Anchor`
- `IDENTITY: PartTransform`; `isChanged(part): boolean`(主圖部位: 非單位或 hidden; 外來部位: placed 即 true)
- `partMatrix(part): Mat`(含 place, 不含 pad), `applyMat(m, x, y)`, `Mat = [a,b,c,d,e,f]`(同 canvas setTransform)
- `placeForeign(srcBBox, targetBBox | null, canvasW, canvasH): Place`
- `transformedBBox(part): [x0,y0,x1,y1]`; `autoPad(parts, w, h): Pad`
- `parseProportionRecipe(data): ProportionRecipe`(錯誤拋中文 Error); `recipeFromParts(parts)`; `RecipePart`
- `api.proportion.*` 對應 Task 4 端點

- [ ] 測試: 錨點 bottom 縮放下緣中點不動、旋轉 90 度、位移比例、外來放置對齊與等比、autoPad、isChanged、配方往返與錯誤
- [ ] 實作, `npm test`, commit

### Task 6: 拼貼繪製與頁面

**Files:** Create `frontend/src/proportion/draw.ts`(Canvas 2D: 部位圖層快取、`drawCollage(ctx, state, opts)`、`exportCollage(state): Promise<{collage: Blob, region: Blob}>`)、`frontend/src/pages/proportionPage.ts`; Modify `frontend/src/main.ts`(加路由)、`frontend/src/style.css`

- 頁面: 作品工具列(清單/新建/從分層包/加素材圖)、畫布(檢視圖切換、遮罩疊色、點選修正、框選、拖曳/縮放/旋轉把手)、右面板(切部位輸入+常用名稱、部位清單、選中部位的數值欄位與錨點/等比/隱藏/拆左右/放到主圖/刪除、畫布擴大(自動+四邊)、生成選項、比例配方存/套)、結果區(滑桿對照、歷史列、送到拆解檢查)
- layout 變更以 400ms debounce PUT
- [ ] `npm run build` 通過、手動用 dev server 驗證, commit

### Task 7: 煙霧測試腳本與 README

**Files:** Create `backend/scripts/proportion_smoke.py`; Modify `README.md`(新頁籤使用說明)

- [ ] 真打 fal 一輪(切頭 → 放大 → 生成 1 張)確認; commit
