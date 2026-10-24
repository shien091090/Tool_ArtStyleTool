# 遊戲示意第 2 期(遊戲示意核心) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增「遊戲示意」頁籤: 選畫面架構建場景、擺灰盒/素材/地面格、設風格、AI 畫整張並貼回素材成候選、在候選上框選去背存進素材庫。

**Architecture:** 後端新模組 `backend/artstyle/mockup/`(幾何與預設擺設、場景存檔、指令組裝、合成與去背、API); 前端新資料夾 `frontend/src/mockup/`(純函式模型、Canvas 繪製、編輯互動、面板、候選與框選) 加 `pages/mockupPage.ts`。灰盒圖與素材層由前端用同一套繪製函式畫成 PNG 送後端, 後端只負責呼叫 AI、貼回、存檔。

**Tech Stack:** FastAPI + numpy/OpenCV/Pillow(後端), Vite + TypeScript + Canvas 2D(前端), fal.ai GPT Image 2 edit(medium)、SAM 3。

**Spec:** `docs/superpowers/specs/2026-10-24-game-mockup-design.md`「第 2 期: 遊戲示意核心」與其「審閱後補定」「附錄」。

## Global Constraints

- 畫布(邏輯像素): side、topdown、iso、flat 為 1280×720; vertical 為 720×1280。
- 地面格: topdown 方格 64px、20×12, 原點 (0,0); iso 菱形 格寬 96、高 48、10×10, 原點 `ox = W/2`, `oy = (H − 10·48)/2 = 120`, 格點 `pt(i,j,z) = (ox + (i−j)·48, oy + (i+j)·24 − z)`; flat 棋盤預設關, 開啟時 64px 方格、行列 2~20 × 2~11、置中。side、vertical 沒有地面格。
- 內建地形(標籤, 顏色): 草地 grass #96b978、水 water #78a5cd、道路 road #b9aa8c、沙地 sand #e0cc95、石地 stone #9b9b9b、牆 wall #6e6258。
- 預設背景: side、vertical「天空 sky」#cddeeb; topdown「草地 grass」#96b978; iso「虛空 void」#3c463c; flat「桌面 table」#8b6a4a。
- 遊戲類型預設描述: side「side-scrolling platformer」、vertical「vertical-scrolling shooter」、topdown「top-down adventure」、iso「isometric strategy / simulation」、flat「card / board game」。
- 灰盒預設色 #9a9a9a; 顏色一律 `#rrggbb`。標籤最長 60 字。參考圖最多 4 張。一次畫 1~4 張。
- AI: GPT Image 2 edit(medium), 每張 0.06 美元; SAM 3 去背每次 0.005 美元。付費按鈕用既有 `markPaid` + `costNote`。
- 指令骨架照規格附錄, 加規格列出的附加句; 「Do not draw any label text, UI or HUD.」一律加。
- 貼回: 素材層 alpha > 127 處覆蓋結果; 結果比例與畫布差超過 2% 先置中裁成畫布比例再縮放。
- 去背: SAM box prompt `{x_min, y_min, x_max, y_max}`, 挑框內面積最大的遮罩、框外清空、裁到不透明範圍; 全空時錯誤訊息「框內找不到物件, 換個框」。
- 存到素材庫: `source = {"kind": "mockup", "scene": 場景名, "candidate": 候選編號}`, parent = null。
- 擺入素材: 該素材所屬組的根沒有任何視角 → 根加上這個場景的視角(派生圖的標籤已鎖定沿用根)。
- 資料夾 `data/mockups/<場景名>/{scene.json, assets/, candidates/}`, 進 .gitignore。場景名用 `names.validate_name`。
- 前端檔案改動用一支腳本一次寫完(使用者開著 vite, 半成品會讓頁面壞掉)。介面文字一律中文。
- Commit 格式依 `~/.claude/rules/commit-format.md`(`[feat] [遊戲示意] 1.… 2.…`, 不寫英文識別字), 直接在 main, 每個任務一個 commit 並 push。

## Review Focus

1. 場景存檔收到前端送來的壞資料(物件種類與架構不符、座標非數字、地面格長度不符、參照不存在的素材檔) → 400 中文訊息, 不寫壞檔。(Task 2 測)
2. AI 回傳尺寸或比例與畫布不同(例如 1024×1536 對 720×1280) → 置中裁切後縮放, 素材貼回位置不偏。(Task 4 測)
3. 框選範圍超出圖片或寬高為 0、框到透明背景 → 400「框內找不到物件, 換個框」或座標夾回圖內, 不當掉。(Task 4、5 測)
4. 擺入的素材是派生圖且組根沒有視角 → 掛到根上, 不因派生鎖定報錯。(Task 5 測)
5. 渲染時場景還有未存的修改 → 前端先送出存檔再畫, 候選的物件快照對應畫的那份。(Task 9 實作時先存再畫; 由最終審查檢查)

---

### Task 1: 後端幾何與預設擺設

**Files:**
- Create: `backend/artstyle/mockup/__init__.py`, `backend/artstyle/mockup/geometry.py`, `backend/artstyle/mockup/presets.py`
- Test: `backend/tests/test_mockup_presets.py`

**Interfaces:**
- Produces:
  - `geometry.VIEWS = ("side","vertical","topdown","iso","flat")`; `canvas_size(view) -> tuple[int,int]`(寬, 高)
  - `iso_point(i: float, j: float, z: float = 0, view_w=1280, view_h=720) -> tuple[float,float]`
  - `object_bbox(view: str, obj: dict) -> tuple[float,float,float,float]`: box/asset 回 (x, y, x+w, y+h); block 回 iso 方塊投影(頂面加側面)的外框
  - `iso_depth(obj: dict) -> float`: block 用 `iso_point(i+w, j+l)[1]`, asset 用 `y+h`
  - `ground_spec(view, ground) -> dict | None`: `{"tile": 64, "cols", "rows", "ox", "oy"}`(方格)或 iso 的 `{"iso": True, ...}`
  - `presets.TERRAINS: list[dict]`(label, color)、`DEFAULT_BG: dict[view, dict]`、`GENRE: dict[view, str]`、`DEFAULT_BOX_COLOR = "#9a9a9a"`
  - `presets.preset_scene(view: str, empty: bool) -> dict`: 回 `{"background", "ground", "objects", "style"}`; 物件格式見 Task 2

- [ ] **Step 1: 寫測試** `test_presets_valid`(五種架構預設擺設: 物件數 > 0, 每個物件 `object_bbox` 在畫布內(允許 iso 方塊頂端), 標籤非空且 ≤ 60, iso 只有 block/asset、其他只有 box; topdown/iso 有地面格且格數 = cols×rows; side/vertical/flat 地面為 None), `test_empty_preset`(empty=True 時 objects == [], 背景與地面格照預設), `test_iso_point`(`iso_point(0,0) == (640,120)`, `iso_point(10,10) == (640,600)`, `iso_point(1,0,30) == (688,114)`), `test_canvas_size`(vertical == (720,1280))。
- [ ] **Step 2: 跑** `backend/.venv/Scripts/python -m pytest backend/tests/test_mockup_presets.py -q` → 失敗(模組不存在)。
- [ ] **Step 3: 實作**。預設擺設內容照規格「預設擺設」, 座標仿實驗草稿(side 地面兩排 64px 方塊合成兩個長灰盒、中間 128px 坑; iso 物件即實驗的 `(i,j,w,l,h)` 清單)。topdown 地面: 草地為底、第 6 列道路、左下 3×3 水; iso: 草地為底、i=5 與 j=4 道路、j≥7 且 i≤3 水。
- [ ] **Step 4: 跑測試** → 全過。
- [ ] **Step 5: Commit** `[feat] [遊戲示意] 新增畫面架構幾何與五種預設擺設`

### Task 2: 後端場景存檔

**Files:**
- Create: `backend/artstyle/mockup/store.py`
- Modify: `backend/artstyle/library/store.py`(加 `root_of`)
- Test: `backend/tests/test_mockup_store.py`, `backend/tests/test_library.py`

**Interfaces:**
- Consumes: Task 1 `preset_scene`, `canvas_size`, `TERRAINS`。
- Produces:
  - 場景 JSON: `{"version":1,"name","view","created","updated","background":{"label","color"},"ground": null | {"cols","rows","cells":[str|null...],"custom":[{"label","color"}]},"objects":[...],"style":{"text","refs":[aid],"genre"},"candidates":[{"id":"c1","created","prompt","style","objects"}],"nextCandidate":1}`
  - 物件: `{"id":"o1","kind":"box","label","color","type",x,y,w,h}` / `{"id","kind":"block","label","color","type",i,j,w,l,h}` / `{"id","kind":"asset","asset":"a3","name",x,y,w,h,"flip":bool}`; `type` 為素材庫類型或 null
  - `class Scene`: `create(root, name, view, empty) -> Scene`、`open(root, name)`、`list(root) -> [{"name","view","updated","candidates"}]`、`delete()`、`save(body: dict) -> dict`(只收 background/ground/objects/style, 驗證後寫入)、`add_asset(aid, img) -> str`(寫 `assets/<aid>.png` 回相對路徑)、`add_candidate(img, prompt) -> dict`(快照當下 style 與 objects)、`delete_candidate(cid)`、`candidate_image(cid) -> np.ndarray`、`file_path(rel) -> Path`(只允許 assets/ 與 candidates/ 底下)、`meta`
  - `Library.root_of(aid) -> str`

- [ ] **Step 1: 寫測試** `test_create_open_list_delete`(重名 FileExistsError, 名稱不合法 ValueError); `test_save_validates`(以下各送一次都 ValueError 且檔案不變: iso 場景放 box、非 iso 放 block、座標字串、w ≤ 0、顏色 `red`、標籤 61 字、ground cells 長度不符、cell 標籤不在內建與 custom 裡、refs 5 張、asset 物件的 `assets/<aid>.png` 不存在、flat 的 cols 21); `test_save_keeps_candidates`(save 不能改 candidates/name/view); `test_candidate_snapshot`(add_candidate 後改物件, 候選的 objects 仍是舊的; id 依序 c1、c2, 刪 c1 後新的是 c3); `test_file_path_escape`(`../scene.json` 與 `scene.json` → FileNotFoundError); library `test_root_of`(三層鏈回根, 原圖已刪時停在自己)。
- [ ] **Step 2: 跑** → 失敗。
- [ ] **Step 3: 實作**。寫檔用暫存檔取代(同 Flow._save); 模組層 RLock。flat 的 ground 可為 None 或方格(cols 2~20、rows 2~11)。
- [ ] **Step 4: 跑全部後端測試** `backend/.venv/Scripts/python -m pytest backend -q` → 全過。
- [ ] **Step 5: Commit** `[feat] [遊戲示意] 新增場景存檔與驗證`

### Task 3: 後端指令組裝

**Files:**
- Create: `backend/artstyle/mockup/prompt.py`
- Test: `backend/tests/test_mockup_prompt.py`

**Interfaces:**
- Consumes: Task 1 `object_bbox`, `GENRE`, `TERRAINS`; Task 2 場景 JSON。
- Produces: `build_prompt(scene: dict) -> str`; `position_word(bbox, w, h) -> str`(3×3: `top/middle/bottom` + `-left/-center/-right`, 正中為 `center`)

- [ ] **Step 1: 寫測試** `test_greybox_only`(無素材無參考圖無描述: 含 `greybox layout mockup of a 2D side-scrolling platformer`, 含 `- "主角 player" (grey block, bottom-left)` 這種逐行列出, 含背景句 `The flat 天空 sky background` 且含 `paint them fully`, 含 `Do not draw any label text, UI or HUD.`, 不含 `style references`); `test_with_assets`(有素材物件: 含 `already finished`、列出素材名稱、{style} 為 `the same style as the finished elements`); `test_refs_and_text`(有參考圖: 含 `The additional images are style references only`; 有描述「水彩」: 含 `水彩`); `test_iso_sentence`(iso 含 `keep every small character clearly visible`); `test_ground_terrains`(topdown 列出用到的地形「草地 grass」與顏色, 未用到的「沙地」不列); `test_position_word`(畫布四角與正中)。
- [ ] **Step 2: 跑** → 失敗。
- [ ] **Step 3: 實作** 照規格骨架與「審閱後補定」的 {style} 改寫; 顏色是預設灰時寫 `grey`, 否則寫色碼。
- [ ] **Step 4: 跑** → 全過。
- [ ] **Step 5: Commit** `[feat] [遊戲示意] 新增送 AI 的指令組裝`

### Task 4: 後端合成與去背

**Files:**
- Create: `backend/artstyle/mockup/compose.py`
- Test: `backend/tests/test_mockup_compose.py`

**Interfaces:**
- Produces:
  - `fit_to_canvas(img: np.ndarray, w: int, h: int) -> np.ndarray`(RGB)
  - `paste_layer(img: np.ndarray, layer: np.ndarray) -> np.ndarray`(layer RGBA 同尺寸, alpha > 127 覆蓋)
  - `cut_object(client, img: np.ndarray, box: list[float], prompt: str) -> np.ndarray`(RGBA, 已裁切); 框先夾回圖內, 夾完寬或高 < 2 → ValueError「框內找不到物件, 換個框」
  - `overlap_suggest(objects: list[dict], view: str, box) -> dict | None`(重疊面積最大的 box/block, 回該物件; 只看灰盒不看素材)

- [ ] **Step 1: 寫測試** `test_fit_same_ratio`(1280×720 → 尺寸不變值不變); `test_fit_crops_ratio`(1024×1536 圖左右各塗不同色, 縮到 720×1280 後尺寸對、且中間像素色正確); `test_paste_layer`(alpha 200 處等於素材、alpha 50 處等於原圖); `test_cut_picks_largest_inside`(假 segment 回兩個遮罩: 分數高的在框外、分數低的在框內 → 用框內的, 輸出尺寸 = 框內遮罩外框, 框外 alpha 0); `test_cut_empty`(遮罩全在框外 → ValueError 含「框內找不到物件」); `test_cut_clamps_box`(框 [-50,-50,30,30] 不當掉, 送給 segment 的框是 [0,0,30,30]); `test_overlap_suggest`(兩個灰盒, 框大半蓋在第二個 → 回第二個; 只蓋到素材 → None)。
- [ ] **Step 2: 跑** → 失敗。
- [ ] **Step 3: 實作**(segment 的 box 用 `{"x_min","y_min","x_max","y_max"}` 整數)。
- [ ] **Step 4: 跑** → 全過。
- [ ] **Step 5: Commit** `[feat] [遊戲示意] 新增 AI 結果貼回素材與框選去背`

### Task 5: 後端 API

**Files:**
- Create: `backend/artstyle/mockup/api.py`
- Modify: `backend/artstyle/server.py`(掛路由)、`.gitignore`(`data/mockups/`)
- Test: `backend/tests/test_mockup_api.py`

**Interfaces:**
- Consumes: Task 1~4; `Library`。
- Produces(前綴 `/api/mockups`):
  - `GET ""` 清單; `POST ""` `{name, view, empty}` → 場景; `GET/PUT/DELETE /{name}`(PUT 收 Task 2 的 save body, 回場景)
  - `POST /{name}/assets` `{asset}` → `{"scene": 場景, "asset": 素材(可能已掛上視角)}`
  - `GET /{name}/files/{path:path}` → PNG(`Cache-Control: no-store`)
  - `POST /{name}/render` multipart `greybox`(PNG)、`layer`(PNG)、`count`(1~4) → 場景(候選已加入); 兩張圖尺寸須等於畫布
  - `DELETE /{name}/candidates/{cid}` → 場景
  - `POST /{name}/candidates/{cid}/cut` `{box:[x0,y0,x1,y1]}` → `{"url": "files/cut.png", "name": 預設名稱, "type": 預設類型}`(預覽存 `cut.png` 與 `cut.json` 記候選與框); 預設名稱 = 重疊灰盒標籤, 沒有就「<場景名> 截圖」; SAM 文字提示 = 該標籤的英文部分(標籤裡的 ASCII 字), 沒有就 `object`
  - `POST /{name}/candidates/{cid}/cut/save` `{name, tags}` → 新素材(cut.json 的候選須等於 cid, 否則 400「先做去背預覽」)
  - `file_path` 白名單加 `cut.png`

- [ ] **Step 1: 寫測試**(FakeFal: `edit` 回指定尺寸的純色圖並記下 prompt 與 extra_images 張數; `segment` 回框內一塊遮罩) `test_crud`; `test_add_asset_tags_root`(匯入根 a1 沒視角、a2 為其派生; 對 iso 場景擺 a2 → a1 與 a2 的 views 都是 `["iso"]`; 根已有視角時不改); `test_render`(count 2 → candidates 兩個、圖尺寸 = 畫布、素材層不透明處等於素材色、edit 收到參考圖張數 = refs 數); `test_render_size_mismatch`(灰盒圖尺寸錯 → 400); `test_render_count_range`(0 與 5 → 400); `test_cut_and_save`(cut 回預設名稱 = 重疊灰盒標籤、type = 該灰盒類型; save 後素材 source 正確、parent None、tags 照送的); `test_save_without_cut`(→ 400); `test_no_client`(client_factory 回 None → render 503)。
- [ ] **Step 2: 跑** → 失敗。
- [ ] **Step 3: 實作**, `server.py` 加 `app.include_router(create_mockup_router(data_dir, client_factory))`。
- [ ] **Step 4: 跑全部後端測試** → 全過。
- [ ] **Step 5: Commit** `[feat] [遊戲示意] 新增場景、渲染與截素材的後端介面`

### Task 6: 前端模型與純函式

**Files:**
- Create: `frontend/src/mockup/model.ts`, `frontend/src/mockup/history.ts`
- Test: `frontend/tests/mockup.test.ts`

**Interfaces:**
- Produces:
  - 型別 `Scene`、`MockObject`(`BoxObj | BlockObj | AssetObj`)、`Ground`、`Terrain`、`Candidate`, 與 Task 2 的 JSON 一致; `ViewKey` 沿用 `library/model`
  - 常數 `CANVAS: Record<ViewKey,[number,number]>`、`TERRAINS`、`GENRE`、`DEFAULT_BOX_COLOR`、`ISO = {tw:96, th:48, n:10}`
  - `isoPoint(i, j, z?, w=1280, h=720): [number, number]`、`isoCell(x, y): [number, number]`(像素 → 格座標, 小數)
  - `groundGeom(scene): {kind:'square', tile, cols, rows, ox, oy} | {kind:'iso'} | null`、`cellAt(scene, x, y): number | null`(格索引)
  - `objectBox(view, obj): [x0,y0,x1,y1]`(同後端)、`hitTest(scene, x, y): MockObject | null`(最前面的先)
  - `drawOrder(scene): MockObject[]`(iso 依腳底, 其他照清單)
  - `snap(v, step)`、`snapStep(scene): number`(topdown 64, 其他 8)
  - `regions(scene): {label, x, y}[]`(相連同地形 ≥ 2 格的中心, 方格四鄰; iso 中心用 isoPoint)
  - `terrainColor(scene, label): string`
  - `history.ts`: `createHistory<T>(limit = 100)` → `{ push(s: T), undo(cur: T): T | null, redo(cur: T): T | null, clear() }`

- [ ] **Step 1: 寫測試** `isoPoint/isoCell 互逆`(isoCell(...isoPoint(3,4)) ≈ [3,4]); `drawOrder iso`(方塊 i=0,j=0,寬深 1 的前下角 y=168, 素材底邊 y=500 → 方塊先畫、素材後畫, 即使素材在清單前面); `drawOrder 非 iso 照清單`; `hitTest 取最前面`; `cellAt topdown`(x=130,y=70 → 1*20+2=22; 畫布外 → null); `regions`(兩塊不相連的水各回一個中心、單格的不回); `snapStep`; `history`(push a,b; undo(c) → b; undo → a; redo → b; 新 push 清掉 redo)。
- [ ] **Step 2: 跑** `cd frontend && npx vitest run tests/mockup.test.ts` → 失敗。
- [ ] **Step 3: 實作**。
- [ ] **Step 4: 跑全部** `npx vitest run` 與 `npx tsc --noEmit -p .` → 全過。
- [ ] **Step 5: Commit** `[feat] [遊戲示意] 新增前端場景模型與座標換算`

### Task 7: 前端繪製與 API

**Files:**
- Create: `frontend/src/mockup/draw.ts`
- Modify: `frontend/src/api.ts`(`api.mockups.*`)、`frontend/src/cost.ts`(若無 GPT Image 2 價錢沿用 `gptImage`)、`frontend/src/library/model.ts`(`AssetSource` 的 mockup 型別與 `sourceText`)
- Test: `frontend/tests/library.test.ts`(sourceText 遊戲示意)

**Interfaces:**
- Produces:
  - `drawScene(ctx, scene, images: Map<string, HTMLImageElement>, opts: { layer?: 'all' | 'assets'; selected?: string | null }): void` — `all` 畫背景、地面格(含區域標籤)、物件(灰盒含標籤字, 白字深色描邊、粗體微軟正黑體、可換行)、選取框; `assets` 只畫素材、透明底
  - `renderPngs(scene, images): Promise<{ greybox: Blob; layer: Blob }>`(畫布邏輯尺寸, 不畫選取框)
  - `api.mockups`: `list`, `create(name, view, empty)`, `get`, `save(name, body)`, `remove`, `addAsset(name, aid)`, `fileUrl(name, path, bust?)`, `render(name, greybox, layer, count)`, `removeCandidate`, `cut(name, cid, box)`, `saveCut(name, cid, assetName, tags)`
  - `sourceText` mockup → `遊戲示意「<場景>」候選 <數字>`(c3 → 3)

- [ ] **Step 1: 寫測試** sourceText 遊戲示意一案。
- [ ] **Step 2: 跑** → 失敗。
- [ ] **Step 3: 實作**(繪製無單元測試; iso 方塊畫法: 右前面 70%、左前面 85%、頂面原色、`#282828` 描邊; 素材翻轉用 `scale(-1,1)`)。
- [ ] **Step 4: 跑** vitest、tsc → 全過。
- [ ] **Step 5: Commit** `[feat] [遊戲示意] 新增場景繪製與前端介面呼叫`

### Task 8: 前端頁面與編輯器

**Files:**
- Create: `frontend/src/mockup/editor.ts`(畫布互動)、`frontend/src/mockup/panels.ts`(屬性、背景、地面調色盤、新場景表單)、`frontend/src/pages/mockupPage.ts`
- Modify: `frontend/src/main.ts`(路由 `mockup`「遊戲示意」排在平面圖與素材庫中間)、`frontend/src/style.css`(`.mk-*`)

**Interfaces:**
- Consumes: Task 6、7; `pickAsset()`。
- Produces: `mountMockupPage(root, params) => cleanup & { canLeave }`(同平面圖, 有未存修改時先存); `mountEditor(host, getScene, onChange(scene, commit: boolean))` 回 `{ redraw(), setTool('select'|'brush'), setBrush(label|null), selected() }`

行為(規格「場景管理」「物件」「背景」「風格設定」的編輯部分):
- 頂端: 場景下拉、「新場景」(右側表單: 名稱、架構、預設擺設/空白)、「刪除場景」、「復原」「重做」。網址 `#/mockup?scene=<名>`。
- 中間畫布等比縮放; 點選物件、拖曳移動(對齊 `snapStep`, 按住 Alt 不對齊)、右下角控點縮放(素材等比; iso 方塊用屬性面板改佔地與高度, 拖曳以 0.5 格對齊)、Delete 刪除、Ctrl+Z / Ctrl+Y。
- 有地面格時工具列多「地面筆刷」: 左側調色盤(內建 6 種 + 自訂 + 橡皮擦 + 全部填滿), 點或拖曳塗格。flat 屬性區有「棋盤格」開關與行列數。
- 「+ 灰盒」(非 iso 放畫面中央 128×128; iso 放中央格 1×1 高 60)、「擺入素材」(挑選視窗 → `addAsset` → 放中央, 長邊 = 畫布高 25%)。
- 右側: 選到物件時的屬性(灰盒: 標籤多行、顏色、類型、x/y/w/h; 方塊: i/j/寬/深/高; 素材: 名稱、寬、左右翻轉; 非 iso 有前後順序四鈕; 刪除), 沒選時顯示背景(標籤、顏色)與風格區(Task 9)。
- 改動即重畫並排程存檔(0.5 秒), 拖曳中不存、放開才存並記入復原。

- [ ] **Step 1: 實作**(一次寫完所有檔案)。
- [ ] **Step 2: 驗證** `npx tsc --noEmit -p .`、`npx vitest run`、`npx vite build` → 全過。
- [ ] **Step 3: Commit** `[feat] [遊戲示意] 1.新增遊戲示意頁籤與場景管理 2.新增灰盒、素材與地面格編輯`

### Task 9: 風格、AI 畫整張、候選與框選

**Files:**
- Create: `frontend/src/mockup/candidates.ts`(候選列、看候選、框選與去背預覽)
- Modify: `frontend/src/mockup/panels.ts`(風格區)、`frontend/src/pages/mockupPage.ts`、`frontend/src/style.css`

行為:
- 風格區: 遊戲類型描述、風格描述(多行)、參考圖 0~4(挑選視窗 → `addAsset` 存檔進場景, 縮圖右上 × 移除)、張數 1~4、「AI 畫整張」付費按鈕(價錢 = 張數 × 0.06)。按下: 先等存檔完成 → `renderPngs` → `trackJob('AI 畫整張中…', 'mockup:<場景>', …)` → 更新場景。
- 底部候選列: 縮圖 + 時間; 點選切到「看候選」(畫布顯示候選圖), 「回到編輯」切回; 候選可刪除(確認)、下載 PNG、展開看當時指令。
- 看候選時拖框 → 「去背預覽」付費按鈕(0.005) → 右側顯示去背圖(透明格底)、名稱、視角(預設場景視角, 可多選)、類型(預設回傳值) → 「存到素材庫」→ 成功提示「已存到素材庫: <名稱>」。

- [ ] **Step 1: 實作**(一次寫完)。
- [ ] **Step 2: 驗證** tsc、vitest、build → 全過。
- [ ] **Step 3: Commit** `[feat] [遊戲示意] 1.新增風格設定與 AI 畫整張 2.新增候選圖與框選去背存到素材庫`

### Task 10: 實測與文件

**Files:**
- Modify: `README.md`(遊戲示意一節、資料夾表 `data/mockups`)
- Create(暫存, 不進版控): scratchpad 的實測腳本

- [ ] **Step 1: 實測縱向比例**(規格已允許, 約 0.065 美元): 用後端模組直接跑 vertical 預設擺設一張 GPT Image 2 + 一次 SAM 去背, 記下回傳尺寸; 若比例不同, 確認 `fit_to_canvas` 後素材位置正確。結果寫進 Task 10 的 commit 說明不需要, 回報給使用者。
- [ ] **Step 2: 用暫存埠 8775/5183 起前後端, 以瀏覽器 JS 檢查**: 新場景五種架構都畫得出來、擺灰盒、存檔後重新讀回一致。用完關掉。
- [ ] **Step 3: 寫 README**, Commit `[docs] [遊戲示意] 說明遊戲示意頁籤的用法`
