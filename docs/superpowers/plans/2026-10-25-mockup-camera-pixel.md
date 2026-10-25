# 遊戲示意鏡頭遠近與像素場景 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 遊戲示意場景加五段鏡頭(物件存世界座標、輸出框隨鏡頭變)與像素場景(五段原生解析度、AI 畫完整張對齊格子)。

**Architecture:** 後端 `mockup/geometry.py` 定義世界、輸出框、倍率、斜角/地面格參數(一般/像素兩套), 前端 `mockup/model.ts` 鏡射同一套規則。繪圖一律「世界矩形 → 畫布」變換: 送 AI 時矩形 = 輸出框, 編輯時 = 輸出框外擴 15%(框外加暗罩)。像素場景後端多一步整張對齊(`mockup/pixelate.py`)。

**Tech Stack:** Python 3 / FastAPI / numpy / OpenCV(後端, `backend/.venv`), TypeScript / Canvas 2D / Vite / Vitest(前端)。

**Spec:** `docs/superpowers/specs/2026-10-25-mockup-camera-pixel-design.md`

## Global Constraints

- 鏡頭段代號 `xfar` `far` `std` `near` `xnear`, 介面 超遠/遠/標準/近/超近。
- 一般倍率 0.5 / 0.7 / 1 / 1.4 / 2; 像素倍率 2 / 4 / 5 / 8 / 10。
- 輸出圖: 縱向 720×1280, 其他 1280×720(不變)。
- 一般世界: 橫向類 (−640, −360)~(1920, 1080), 縱向 (−360, −640)~(1080, 1920), 一般桌面 (0,0)~(1280,720) 且鎖 `std`。像素世界: (0,0)~(640,360), 縱向 (0,0)~(360,640)。
- 新場景預設鏡頭: 一般 `std`, 像素 `far`。
- 俯瞰地面: 一般 64/格 40×24 起點 (−640, −384); 像素 16/格 40×23 起點 (0,0)。斜角: 一般菱形 96×48、20×20、格索引 c → i = c − 5、`iso_point` 原點不變 (640,120); 像素菱形 32×16、20×20、原點 (320, 20)。桌面棋盤: 一般 64/格 2~20 × 2~11; 像素 16/格 2~40 × 2~22; 皆置中於世界。
- 舊場景升級: 俯瞰 20×12 → 40×24 偏移 (10, 6), 斜角 10×10 → 20×20 偏移 (5, 5), 新格填「草地 grass」; 缺 `pixel` → false, 缺 `camera` → `std`, 缺 `style.colors` → 32, 舊候選缺 `camera` → `std`。
- 色數選項 16/24/32/48/64, 預設 32。
- 像素場景: 灰盒/素材 x y w h 整數; 斜角方塊 i j w l 為 0.5 的倍數、h 整數。
- 介面文字繁體中文; commit 照 `~/.claude/rules/commit-format.md`(`[feat] [遊戲示意] ...`)。
- 改前端檔案用一次寫完的方式(使用者開著 vite, 分多步改會讓頁面卡在半成品)。

## Review Focus

1. 舊場景開啟後外觀不變: 物件、地面格、斜角方塊位置都對得上(後端升級測試 + 前端以舊座標畫出相同位置的測試)。
2. 超遠鏡頭下送 AI: 框外物件不在指令裡、九宮格位置用輸出框算(prompt 測試)。
3. 換鏡頭後框選截素材: 預設名稱用候選當時的鏡頭比對(overlap 測試帶 camera)。
4. 像素場景對齊後每個 s×s 方塊單色且色數不超過設定, 縱向卷軸也成立(pixelate 測試含 720×1280)。
5. 像素截素材邊緣對齊方塊、存進素材庫的是原生解析度(cut 測試)。

---

### Task 1: 後端幾何(世界、輸出框、倍率、地面與斜角參數)

**Files:**
- Modify: `backend/artstyle/mockup/geometry.py`
- Test: `backend/tests/test_mockup_geometry.py`(新)、`backend/tests/test_mockup_presets.py`(`test_iso_point` 照舊通過)

**Interfaces — Produces:**
- `LEVELS = ("xfar", "far", "std", "near", "xnear")`
- `scale(pixel: bool, camera: str) -> float`
- `world_rect(view: str, pixel: bool) -> tuple[float, float, float, float]`
- `frame_rect(view: str, pixel: bool, camera: str) -> tuple[float, float, float, float]`(以世界中心為中心, 大小 = 輸出尺寸 ÷ 倍率)
- `to_screen(view, pixel, camera, x, y) -> tuple[float, float]`
- `iso_point(i, j, z=0, pixel=False)`(一般維持舊結果; 像素用 32×16、原點 (320,20))
- `object_bbox(view, obj, pixel=False)`、`iso_depth(obj, pixel=False)`
- `ground_size(view, pixel) -> tuple[int, int] | None`(俯瞰/斜角的固定大小)
- `ground_spec(view, ground, pixel=False)`: 方格 → `{"tile","cols","rows","ox","oy"}`; 斜角 → `{"iso": True, "cols", "rows", "offset"}`(一般 5、像素 0)

- [ ] **Step 1: 寫失敗測試** `test_mockup_geometry.py`:
  - `scale(False,"xfar")==0.5`, `scale(True,"far")==4`, 非法段數 raise ValueError
  - `world_rect("side",False)==(-640,-360,1920,1080)`, `world_rect("vertical",False)==(-360,-640,1080,1920)`, `world_rect("flat",False)==(0,0,1280,720)`, `world_rect("side",True)==(0,0,640,360)`, `world_rect("vertical",True)==(0,0,360,640)`
  - `frame_rect("side",False,"std")==(0,0,1280,720)`(舊座標即世界座標), `frame_rect("side",False,"xfar")==world_rect("side",False)`, `frame_rect("side",True,"far")==(160,90,480,270)`, `frame_rect("vertical",True,"xnear")==(144,256,216,384)`
  - `to_screen("side",True,"far",160,90)==(0,0)`; `to_screen("side",False,"xfar",-640,-360)==(0,0)`
  - `iso_point(0,0)==(640,120)`; `iso_point(0,0,pixel=True)==(320,20)`; `iso_point(20,20,pixel=True)[1]==340`
  - `ground_spec("topdown",{"cols":40,"rows":24},False)["ox"]==-640` 且 `oy==-384`; 像素 `tile==16, ox==0`
- [ ] **Step 2:** `backend/.venv/Scripts/python -m pytest -q tests/test_mockup_geometry.py` → FAIL(匯入錯誤)
- [ ] **Step 3: 實作** 上列函式。`canvas_size` 不變。
- [ ] **Step 4:** `pytest -q tests/test_mockup_geometry.py tests/test_mockup_presets.py tests/test_mockup_compose.py` → PASS
- [ ] **Step 5: Commit** `[feat] [遊戲示意] 新增鏡頭與像素場景的世界座標幾何`

### Task 2: 後端場景資料(新欄位、舊場景升級、存檔檢查、建立)

**Files:**
- Modify: `backend/artstyle/mockup/store.py`, `backend/artstyle/mockup/api.py`(`create_scene` 讀 `pixel`、`camera`), `backend/artstyle/mockup/presets.py`(本 task 只改簽名 `preset_scene(view, empty, pixel=False)`, 像素暫用縮小的佔位擺設可以, Task 3 換掉)
- Test: `backend/tests/test_mockup_store.py`, `backend/tests/test_mockup_api.py`

**Interfaces:**
- Consumes: Task 1 全部。
- Produces: `Scene.create(root, name, view, empty, pixel=False, camera=None)`; meta 多 `pixel`、`camera`、`style.colors`; `Scene.open` 回傳已升級的 meta(`upgrade_meta(meta) -> dict` 為模組函式, 冪等); `save(body)` 接受 `camera`、`style.colors`, 忽略 body 裡的 `pixel`; `add_candidate(img, prompt, objects=None, style=None, camera="std", raw=None)` → 候選多 `camera`, 有 raw 時寫 `candidates/<id>_raw.png` 並記 `"raw": "candidates/<id>_raw.png"`; `_FILE` 允許 `_raw`; `delete_candidate` 一併刪 raw。

- [ ] **Step 1: 寫失敗測試**
  - `test_upgrade_old_topdown`: 手寫舊 scene.json(俯瞰 20×12, 第 0 格 "水 water", 無 pixel/camera) → open 後 `ground["cols"],["rows"]==(40,24)`, `cells[6*40+10]=="水 water"`, `cells[0]=="草地 grass"`, `pixel is False`, `camera=="std"`, `style["colors"]==32`; 再 open 一次結果相同(冪等)
  - `test_upgrade_old_iso`: 10×10 第 0 格道路 → 20×20 `cells[5*20+5]` 為道路
  - `test_save_camera_rules`: 一般側捲存 `camera:"xfar"` OK; 非法值 400/ValueError; 一般桌面存 `"far"` → ValueError; body 帶 `pixel:true` 不會改變 pixel
  - `test_pixel_integer_rules`: 像素側捲灰盒 x=1.5 → ValueError; 斜角像素方塊 i=0.5 OK、i=0.25 ValueError、h=10.5 ValueError
  - `test_ground_sizes_by_pixel`: 像素俯瞰 40×23 OK、40×24 ValueError; 像素桌面棋盤 40×22 OK、41×22 ValueError
  - `test_style_colors`: 24 OK, 20 ValueError
  - API `test_create_pixel_scene`: POST `{name, view:"side", pixel:true}` → `pixel` true、`camera=="far"`; 帶 `camera:"near"` → near
- [ ] **Step 2:** 跑上述測試 → FAIL
- [ ] **Step 3: 實作**(地面大小檢查改用 `ground_size`; 桌面棋盤上限依 pixel)
- [ ] **Step 4:** `pytest -q tests/test_mockup_store.py tests/test_mockup_api.py` → PASS(舊測試若寫死 20×12 / 10×10, 改成升級後的大小)
- [ ] **Step 5: Commit** `[feat] [遊戲示意] 場景加入鏡頭與像素欄位並自動升級舊場景`

### Task 3: 後端 10 種預設擺設

**Files:**
- Modify: `backend/artstyle/mockup/presets.py`
- Test: `backend/tests/test_mockup_presets.py`

**Interfaces:** `preset_scene(view, empty, pixel=False) -> dict`(background、ground、objects、style 含 genre 與 colors=32)。

- [ ] **Step 1: 寫失敗測試** `test_presets_valid` 改成參數化 `(view, pixel)` 10 組:
  - 物件外框都在 `world_rect` 內、標籤非空、類型在 KINDS
  - 像素: box/asset 座標整數; 斜角方塊 i j w l 是 0.5 倍數、h 整數
  - 地面格大小 == `ground_size`(俯瞰/斜角), cells 數 == cols×rows
  - `test_presets_fill_xfar`: 非桌面(以及像素桌面), 把 `frame_rect(view,pixel,"xfar")` 切成 4×4 宮格, 地面格以外的架構(side/vertical/flat)每格至少和一個物件外框相交; 俯瞰/斜角只要求物件數 ≥ 標準框內物件數的 2 倍
  - `test_presets_std_has_player`: 標準鏡頭框內有標籤含 "player" 的物件; 超近框內至少 2 個物件
  - `test_pixel_player_16`: 像素 side/vertical/topdown/flat 的主角 w==h==16(斜角: w==l==0.5 格)
  - `test_normal_flat_unchanged`: 一般桌面 == 改版前的 `_FLAT` 內容
- [ ] **Step 2:** `pytest -q tests/test_mockup_presets.py` → FAIL
- [ ] **Step 3: 實作** 9 組新擺設(一般 side/vertical/topdown/iso 保留現有物件、往四周延伸; 像素 5 組以 16 的倍數擺)。地面格函式依 (view, pixel) 產生。
- [ ] **Step 4:** `pytest -q tests/test_mockup_presets.py tests/test_mockup_store.py` → PASS
- [ ] **Step 5: Commit** `[feat] [遊戲示意] 新增鏡頭可用的大世界預設擺設`

### Task 4: 後端指令(框內物件、鏡頭句、像素句)

**Files:**
- Modify: `backend/artstyle/mockup/prompt.py`
- Test: `backend/tests/test_mockup_prompt.py`

**Interfaces:** `build_prompt(scene: dict) -> str` 讀 `scene["camera"]`、`scene["pixel"]`(缺省 std / False); `CAMERA_SENTENCE: dict[str, str | None]`(英文照規格四、`std` 為 None)。

- [ ] **Step 1: 寫失敗測試**
  - `test_only_visible_objects`: 一般側捲加一個 x=1700 的灰盒「遠方 far」, camera std → 指令沒有 "遠方 far"; camera xfar → 有, 且位置字 `middle-right` 或 `*-right`
  - `test_position_uses_frame`: 像素側捲 camera far, 灰盒置於 (304,164,16,16)(框右下) → 位置字 `bottom-right`
  - `test_camera_sentences`: xfar 含 "very far away"; std 不含 "camera is"; xnear 含 "close-up"
  - `test_pixel_sentence`: 像素 far → 含 "native resolution of 320×180" 與 "4×4"; 不含鏡頭句; 俯瞰含 "16×16 game pixels"; 斜角含 "32×16"
  - 舊測試全部照過
- [ ] **Step 2:** → FAIL
- [ ] **Step 3: 實作**(可見 = 外框與 `frame_rect` 有交集; 位置字用 `to_screen` 換算後的外框與輸出尺寸)
- [ ] **Step 4:** `pytest -q tests/test_mockup_prompt.py` → PASS
- [ ] **Step 5: Commit** `[feat] [遊戲示意] 指令依鏡頭只列畫面內物件並加入鏡頭與像素描述`

### Task 5: 後端像素對齊、候選原圖、截素材對齊

**Files:**
- Create: `backend/artstyle/mockup/pixelate.py`
- Modify: `backend/artstyle/mockup/compose.py`, `backend/artstyle/mockup/api.py`
- Test: `backend/tests/test_mockup_pixelate.py`(新), `backend/tests/test_mockup_compose.py`, `backend/tests/test_mockup_api.py`

**Interfaces — Produces:**
- `align_grid(rgb: np.ndarray, s: int, colors: int) -> np.ndarray`: 同尺寸 RGB, 每 s×s 方塊單色, 全圖顏色數 ≤ colors。做法: 全圖 kmeans 量化到 colors 色得到標籤, 每塊取最多的標籤, 再 `np.repeat` 放大。不去背。
- `cut_object(client, img, box, prompt, grid: int = 1)`: grid>1 時遮罩先對齊方塊(塊內過半前景 → 整塊前景), 裁切範圍對齊到 grid 倍數, 回傳 `rgba[::grid, ::grid]`(原生解析度)。
- `overlap_suggest(objects, view, box, pixel=False, camera="std")`: 物件外框先 `to_screen` 再比。
- render 端點: 像素場景 `raw = paste_layer(fit_to_canvas(...))`, `img = align_grid(raw, int(scale), style.colors)`, `add_candidate(img, ..., camera=..., raw=raw)`; 一般場景 `add_candidate(..., camera=...)`。候選 style 已含 colors。
- cut 端點: 用候選當時的 camera 呼叫 `overlap_suggest`; 像素場景 `grid = int(scale(True, cand camera))`。

- [ ] **Step 1: 寫失敗測試**
  - `test_align_blocks_uniform`: 隨機雜訊 1280×720, s=4, colors=16 → 每個 4×4 塊 `np.unique` 一色; 全圖 `np.unique(axis=0)` ≤ 16; 尺寸不變
  - `test_align_vertical`: 720×1280, s=5 → 同上
  - `test_cut_grid`: FakeFal 遮罩邊緣切在方塊中間, grid=4 → 回傳尺寸 == 對齊後外框 / 4, alpha 只有 0/255
  - `test_overlap_with_camera`: 一般側捲物件 (1700,400,100,100), camera xfar, box 在輸出座標 (1170,380,1230,430) 附近 → 回傳該物件; camera std 同框 → None
  - API `test_render_pixel_scene`: 像素場景 render → 候選有 `raw`, `files/candidates/c1_raw.png` 200, c1.png 每 4×4 塊單色; 一般場景候選沒有 `raw`、有 `camera`
  - API `test_cut_pixel_scene_native_size`: 像素 far 場景截素材存庫 → 素材圖寬高約為框寬高 / 4
  - `test_delete_candidate_removes_raw`
- [ ] **Step 2:** → FAIL
- [ ] **Step 3: 實作**
- [ ] **Step 4:** `backend/.venv/Scripts/python -m pytest -q` → 全部 PASS
- [ ] **Step 5: Commit** `[feat] [遊戲示意] 像素場景 AI 結果整張對齊格子並保留原圖, 截素材存原生大小`

### Task 6: 前端模型(鏡射後端幾何)

**Files:**
- Modify: `frontend/src/mockup/model.ts`, `frontend/src/api.ts`(`mockups.create(name, view, empty, pixel, camera?)`)
- Test: `frontend/tests/mockup.test.ts`

**Interfaces — Produces:**
- `type CameraLevel = 'xfar' | 'far' | 'std' | 'near' | 'xnear'`; `LEVELS: CameraLevel[]`; `LEVEL_LABEL: Record<CameraLevel, string>`
- `Scene` 多 `pixel: boolean; camera: CameraLevel`; `MockStyle` 多 `colors: number`; `Candidate` 多 `camera: CameraLevel; raw?: string`; `SceneBody` 多 `camera`
- `type Rect = [number, number, number, number]`
- `cameraScale(s: Pick<Scene,'pixel'|'camera'>): number`, `worldRect(s): Rect`, `frameRect(s, camera = s.camera): Rect`, `nativeRes(s, camera): [number, number]`(像素場景, 例 far → [320,180])
- `isoPoint(pixel: boolean, i, j, z = 0)`, `isoCell(pixel: boolean, x, y)`; `objectBox(s: Scene, o)`(原本第一參數是 view); `groundGeom(s)` 依 pixel 與斜角偏移; `snapStep(s)`(一般 8 / 俯瞰 64; 像素 1 / 俯瞰 16); `clampToWorld(s, o: MockObject): void`; `roundPixel(s, o): void`(像素場景取整, 方塊 i j w l 取 0.5、h 取整)
- `visible(s, o, camera = s.camera): boolean`

- [ ] **Step 1: 寫失敗測試**(更新 `base()` 帶 `pixel:false, camera:'std'`, style 帶 `colors:32`)
  - `frameRect` 與後端 Task 1 同一組數值(側捲 std/xfar、像素 far、縱向像素 xnear)
  - `isoPoint(false,0,0)` == [640,120]; `isoPoint(true,0,0)` == [320,20]
  - 俯瞰一般 40×24: `cellAt(s, 0+1, 0+1)` == 6*40+10(舊 (0,0) 格); 像素俯瞰 `cellAt(s, 17, 1)` == 1
  - 斜角一般 20×20: `cellAt(s, ...isoPoint(false, 0.5, 0.5))` == 5*20+5
  - `clampToWorld` 把 x=5000 的灰盒拉回世界內; `roundPixel` 讓 x=3.4 → 3、方塊 i=0.3 → 0.5
  - `visible`: x=1700 的灰盒 std false、xfar true
- [ ] **Step 2:** `cd frontend && npx vitest run tests/mockup.test.ts` → FAIL
- [ ] **Step 3: 實作**(同時修好 draw.ts / editor.ts / candidates.ts / mockupPage.ts 對 `isoPoint`、`objectBox` 新簽名的呼叫, 使型別檢查通過; 行為改變留到 Task 7)
- [ ] **Step 4:** `npx vitest run && npx tsc --noEmit -p .` → PASS
- [ ] **Step 5: Commit** `[feat] [遊戲示意] 前端場景模型加入鏡頭與像素幾何`

### Task 7: 前端繪製與編輯互動

**Files:**
- Modify: `frontend/src/mockup/draw.ts`, `frontend/src/mockup/editor.ts`
- Test: `frontend/tests/mockup.test.ts`

**Interfaces:**
- Consumes: Task 6。
- Produces:
  - `editRect(s: Scene): Rect` = 輸出框四邊各外擴框寬高的 15%
  - `drawScene(ctx, s, images, opts: { layer?: 'all' | 'assets'; selected?: string | null; rect?: Rect; grid?: boolean })`: 把世界矩形 `rect`(預設 `frameRect(s)`)畫滿 ctx 的畫布; rect ≠ 輸出框時, 輸出框外蓋一層編輯區底色 65% 不透明的暗罩並畫輸出框邊線; 像素場景 `imageSmoothingEnabled = false`; `grid` 且一格遊戲像素在畫布上 ≥ 6 px 時畫遊戲像素格線; 灰盒字以輸出像素計至少 11 px; 線寬、控點用畫布像素(除以變換倍率)
  - `renderPngs(s, images)` 用 `rect = frameRect(s)`、畫布 = 輸出尺寸
  - `toWorld(canvas, rect: Rect, e): [number, number]`(取代 `toCanvas` 的編輯用途; `toCanvas` 保留給看候選)
  - `EditorControl` 多 `rect(): Rect`; 拖曳、縮放結束時 `clampToWorld` + `roundPixel`; 控點判定半徑 10 個螢幕 px 換算成世界單位
- [ ] **Step 1: 寫失敗測試**: `editRect` 數值(側捲 std → [-192,-108,1472,828]); `toWorld` 以假的 `getBoundingClientRect` 驗證四角
- [ ] **Step 2:** → FAIL
- [ ] **Step 3: 實作**
- [ ] **Step 4:** `npx vitest run && npx tsc --noEmit -p .` → PASS
- [ ] **Step 5: Commit** `[feat] [遊戲示意] 編輯區依鏡頭顯示並淡化輸出框外的世界`

### Task 8: 前端頁面(鏡頭切換、新場景、色數、候選原圖、預設大小)與說明

**Files:**
- Modify: `frontend/src/pages/mockupPage.ts`, `frontend/src/mockup/panels.ts`, `frontend/src/mockup/candidates.ts`, `frontend/src/style.css`, `README.md`

**Interfaces:** Consumes Task 6、7。

- [ ] **Step 1: 實作(一次寫完各檔)**
  - 場景工具列加五段分段按鈕(`.seg`), 像素場景標「遠 320×180」; 一般桌面隱藏; 點了走 `edit((sc) => { sc.camera = lv }, true)` 並重算畫布大小
  - 工具列加「格線」切換(只在像素場景顯示, 預設開, 不存檔)
  - 編輯模式畫布大小 = `editRect` 寬高 × 倍率(四捨五入), 看候選模式 = 輸出尺寸; `fit()` 依當時畫布比例
  - 新增灰盒: 中心 = 目前輸出框中心; 一般 128×128 世界單位(斜角照舊 1×1 格), 像素 16×16
  - 擺入素材: 一般 = 目前輸出框高 25%(換算世界單位); 像素 = 原始像素大小, 大於輸出框一半時等比縮到一半, 取整
  - `newSceneForm` 多「像素場景」勾選與解析度下拉(預設 遠 320×180), `onCreate(name, view, empty, pixel, camera)`
  - `stylePanel` 像素場景多「色數」下拉 16/24/32/48/64
  - `objectPanel` 像素場景數字欄標「格」、step 1(方塊 i j w l step 0.5)
  - `groundPanel` 桌面棋盤上限依 pixel(像素 40×22)
  - 場景下拉標示像素: `名稱(橫向卷軸·像素)`(清單 API 需回 `pixel`: 在 `Scene.list` 加欄位, 同一 commit)
  - 候選面板: 有 `raw` 時加「對齊後 / AI 原圖」切換, 下載跟著目前顯示的那張
  - README 遊戲示意段補: 鏡頭五段、像素場景、對齊與色數、截素材存原生大小
- [ ] **Step 2:** `npx vitest run && npx tsc --noEmit -p . && npx vite build --outDir <scratchpad>/build --emptyOutDir` → PASS; 後端 `pytest -q` → PASS
- [ ] **Step 3: 用暫存埠手動驗證**(後端 8775 / 前端 5183, 用完關掉): 舊場景外觀不變、五段切換、像素新場景、格線、新增灰盒與素材大小; 截圖逾時就用 JS 讀狀態
- [ ] **Step 4: Commit** `[feat] [遊戲示意] 1.新增鏡頭五段切換 2.新增像素場景與色數設定 3.候選可切換看 AI 原圖`

### Task 9: 實測一次真的 AI(要先徵得使用者同意花費)

- [ ] **Step 1:** 報預估花費(GPT Image 2 一張約 0.06 美元)並取得同意
- [ ] **Step 2:** 用 API 建一個像素橫向卷軸場景(遠 320×180, 預設擺設), render 1 張, 檢查 c1.png 方塊單色、c1_raw.png 存在, 看圖判斷像素感與構圖
- [ ] **Step 3:** 把結果路徑與觀察回報使用者; 測試場景留著讓使用者看(或依使用者意思刪除)
