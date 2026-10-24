# 素材庫與頁籤(遊戲示意第 1 期) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 加回頁籤列(平面圖、素材庫), 新增素材庫(匯入、標籤、派生歸組), 平面圖的圖片輸入可選素材庫、節點輸出可存回素材庫。

**Architecture:** 後端新增 `artstyle/library/`(store + api, 前綴 `/api/library`), 每張素材一個資料夾 `data/library/<id>/{image.png, asset.json}`; 流程 API 加「從素材庫設輸出」與「存到素材庫」兩個入口, 原圖判斷在後端。前端新增 `src/library/`(純函式 model + 頁面 + 挑選視窗), main.ts 恢復頁籤路由。

**Tech Stack:** FastAPI / Python 3.14(pytest), TypeScript + Vite(vitest)。

**Spec:** `docs/superpowers/specs/2026-10-24-game-mockup-design.md`(只做「第 1 期」與「共通: 視角與類型標籤」)

## Global Constraints

- 頁籤名稱「平面圖」(`#/flow`)、「素材庫」(`#/library`); 其他網址轉 `#/flow`。頁籤裡「新流程」「刪除流程」等字不改。
- 視角代號 `side`、`vertical`、`topdown`、`iso`、`flat`, 顯示「橫向卷軸」「縱向卷軸」「俯瞰」「斜角俯瞰」「平面」。
- 類型: 地形、背景、角色、敵人、道具、建築、景物、其他(單選, 可為 null)。
- 沒選任何視角 = 未分類(即使有類型)。
- 素材編號 `a` + 遞增數字, 刪除後不重複使用。
- 素材圖建立後不變; 只能改名稱、標籤。圖片大小上限 `config.MAX_SIDE`。
- 派生沿用原圖標籤(存入當下複製)。
- 刪除: 子素材改掛到被刪者的 parent。
- 存到素材庫: 主圖輸入鏈上有過期節點時拒絕, 訊息「上游改過了, 先更新輸出再存」。
- 使用者看得到的字一律中文; commit 照 `~/.claude/rules/commit-format.md`(前綴 `[feat]`/`[test]`/`[docs]`, 系統名 `[素材庫]`)。
- 改前端檔案要一次寫完(使用者開著 vite, 半成品會讓頁面壞掉)。

## Review Focus

- 主圖輸入鏈經過改部位節點時, 素材接點的上游不能被當成原圖 → Task 3 測試 `test_to_library_ignores_material_link`。
- 圖片輸入節點選的素材之後被刪除, 再存下游輸出 → parent 為 null、不報錯 → Task 3 `test_to_library_parent_deleted`。
- 匯入非圖片檔或空檔 → 400 中文訊息, 已成功的其他檔不回滾也不留半個資料夾 → Task 2 `test_import_bad_file`。
- 標籤帶未知視角/類型 → 400 → Task 1 `test_bad_tags`。
- 刪除根素材且有多個子素材 → 子素材都變成根, 各自成組 → Task 1 `test_delete_root_reparents_children`。

---

### Task 1: 素材庫儲存層

**Files:**
- Create: `backend/artstyle/library/__init__.py`(空)、`backend/artstyle/library/store.py`
- Test: `backend/tests/test_library.py`

**Interfaces:**
- Produces(`artstyle.library.store`):
  - `VIEWS = ("side", "vertical", "topdown", "iso", "flat")`, `KINDS = ("地形", "背景", "角色", "敵人", "道具", "建築", "景物", "其他")`
  - `check_tags(tags) -> dict`: 回傳 `{"views": [...去重保序], "type": str|None}`; 缺省 `{"views": [], "type": None}`; 不合法拋 `ValueError`。
  - `class Library(root: Path)`:
    - `add(img: np.ndarray, name: str, source: dict, parent: str|None = None, tags: dict|None = None) -> dict`(回傳 asset.json 內容; `img` 先 `limit_size(..., config.MAX_SIDE)`; parent 不存在當 None)
    - `list() -> list[dict]`(依 created、id 排序)
    - `get(aid) -> dict`、`image_path(aid) -> Path`(找不到拋 `FileNotFoundError`; aid 必須符合 `a[0-9]{1,6}`, 否則 `FileNotFoundError`)
    - `update(aid, name: str|None, tags: dict|None) -> dict`
    - `delete(aid) -> None`(子素材 parent 改成被刪者的 parent)
  - 編號計數存在 `root/counter.json`(`{"next": N}`), 寫入用與 flow store 同樣的 `threading.RLock` + tmp 檔 replace。
  - 名稱: 去頭尾空白, 空字串拋 `ValueError("名稱不能空白")`, 最長 60 字。

- [ ] **Step 1: 寫失敗測試** `backend/tests/test_library.py`

```python
def test_add_get_list(tmp_path):
    lib = Library(tmp_path)
    a = lib.add(_img(), "樹", {"kind": "import", "file": "tree.png"})
    assert a["id"] == "a1" and a["parent"] is None and a["tags"] == {"views": [], "type": None}
    assert lib.image_path("a1").is_file()
    assert [x["id"] for x in lib.list()] == ["a1"]

def test_ids_not_reused(tmp_path):
    lib = Library(tmp_path)
    lib.add(_img(), "a", SRC); lib.delete("a1")
    assert lib.add(_img(), "b", SRC)["id"] == "a2"

def test_bad_tags(tmp_path):
    with pytest.raises(ValueError): check_tags({"views": ["3d"]})
    with pytest.raises(ValueError): check_tags({"type": "魔法"})
    assert check_tags({"views": ["iso", "iso", "side"], "type": "建築"}) == {"views": ["iso", "side"], "type": "建築"}

def test_update(tmp_path):  # 改名、改標籤; 空白名稱拋 ValueError
def test_delete_middle_reparents(tmp_path):  # a1 → a2 → a3, 刪 a2 後 a3.parent == "a1"
def test_delete_root_reparents_children(tmp_path):  # a1 → a2, a1 → a3, 刪 a1 後 a2、a3 parent 都是 None
def test_bad_id(tmp_path):  # get("../x") 拋 FileNotFoundError
```

(`_img()` = 8×8 RGBA 隨意圖; `SRC = {"kind": "import", "file": "x.png"}`)

- [ ] **Step 2:** `backend/.venv/Scripts/python -m pytest backend/tests/test_library.py -q` → FAIL(模組不存在)
- [ ] **Step 3:** 實作 `store.py`
- [ ] **Step 4:** 同指令 → PASS
- [ ] **Step 5:** commit `[feat] [素材庫] 新增素材庫儲存(匯入、改名、標籤、刪除時子素材改掛)`

### Task 2: 素材庫 API

**Files:**
- Create: `backend/artstyle/library/api.py`
- Modify: `backend/artstyle/server.py`(include router)、`.gitignore`(加 `data/library/`)
- Test: `backend/tests/test_library_api.py`

**Interfaces:**
- Consumes: Task 1 `Library`, `check_tags`
- Produces: `create_router(data_dir: Path) -> APIRouter`(前綴 `/api/library`, 資料夾 `data_dir / "library"`)
  - `GET ""` → `list[asset]`
  - `POST ""` multipart: `files: list[UploadFile]`, `tags: str | None`(JSON) → `{"added": [asset...], "errors": [{"file": 檔名, "detail": 訊息}]}`; 每檔名稱 = 檔名去副檔名; `source = {"kind": "import", "file": 檔名}`; 讀不了的圖記進 errors 不中斷。全部失敗仍回 200(前端顯示 errors)。
  - `GET /{aid}/image` → PNG, `Cache-Control: no-store` 不需要(素材圖不變), 用 `max-age=31536000, immutable`
  - `PATCH /{aid}` JSON `{name?, tags?}` → asset
  - `DELETE /{aid}` → `{"ok": true}`

- [ ] **Step 1: 失敗測試**(用 `create_app(tmp_path, lambda: None)` + `X-ArtStyle` 標頭, 照 test_flow.py 的寫法)

```python
def test_import_list_patch_delete(client):  # 匯入兩檔(帶 tags {"views":["side"]}), 名稱取檔名, list 長度 2, PATCH 改名, DELETE 後 list 長度 1
def test_import_bad_file(client):  # 一張好圖 + 一個 b"not png" → added 1、errors 1(file 名稱對), library 資料夾只有 a1
def test_image_route(client):  # GET /api/library/a1/image 200, image/png
def test_bad_tags_400(client):  # PATCH tags {"views":["3d"]} → 400
```

- [ ] **Step 2:** pytest 該檔 → FAIL
- [ ] **Step 3:** 實作 api.py、掛到 server.py、改 .gitignore
- [ ] **Step 4:** pytest 該檔 → PASS
- [ ] **Step 5:** commit `[feat] [素材庫] 新增素材庫 API`

### Task 3: 平面圖接素材庫(後端)

**Files:**
- Modify: `backend/artstyle/flow/api.py`(輸出 API、新路由)、`backend/artstyle/flow/store.py`(鏈查詢)
- Test: `backend/tests/test_flow_library.py`

**Interfaces:**
- Consumes: Task 1 `Library`
- Produces:
  - `Flow.main_chain(nid) -> list[dict]`: 從 nid 沿主圖輸入往上到沒有上游為止, 回傳 `[nid 節點, 上游, 上上游, ...]`。
  - `Flow.chain_stale(nid) -> bool`: 鏈上任一個有輸入接點的節點(非 input)`inputRev != 上游.rev`, 或任一節點 `rev` 為 0 → True。
  - `POST /api/flows/{name}/nodes/{nid}/output` 新增表單欄位 `asset: str | None`: 有它時 `file` 可省略; 只允許 `input` 節點(否則 `ValueError("只有圖片輸入節點能從素材庫選圖")`); 讀素材圖設為輸出; params 若沒帶就設 `{"source": 素材名稱, "asset": aid}`。
  - `POST /api/flows/{name}/nodes/{nid}/to-library` JSON `{"name": str}` → asset。規則: 節點沒輸出 → `ValueError("節點還沒有輸出")`; `chain_stale` → `ValueError("上游改過了, 先更新輸出再存")`; 鏈的最後一個若是 input 且 `params.asset` 存在且素材還在 → parent = 它、tags = 它的 tags 複製; 否則 parent None、無標籤。`source = {"kind": "flow", "flow": name, "node": nid, "rev": 節點 rev}`。
  - `create_router(data_dir, client_factory)` 內部自己建 `Library(data_dir / "library")`, 簽名不變。

- [ ] **Step 1: 失敗測試**

```python
def test_input_from_library(client):  # 匯入 a1; input 節點 output 帶 asset=a1 → rev 1, params == {"source": "樹", "asset": "a1"}, 輸出圖等於素材圖
def test_asset_only_for_input(client):  # cutout 節點帶 asset → 400
def test_to_library_derived(client):  # a1(tags side/景物) → n1 input → n2 cutout(上傳輸出, inputRev=1) → to-library n2 → parent a1, tags 同 a1, source.node == "n2"
def test_to_library_upload_source(client):  # n1 為上傳 → parent None, tags 空
def test_to_library_stale(client):  # n1 重新設輸出後(rev 2), n2 inputRev 仍 1 → 400 且訊息含「上游改過了」
def test_to_library_ignores_material_link(client):  # n1(asset a1) 只接到 workshop 的 material 接點, workshop 主圖接 n3(上傳) → 存 workshop 輸出 parent None
def test_to_library_parent_deleted(client):  # n1 選 a1, 刪除 a1, 存 n1 → parent None
def test_to_library_no_output(client):  # 沒輸出 → 400
```

(workshop 輸出直接用 output API 上傳即可, 不需要真的跑改部位)

- [ ] **Step 2:** pytest 該檔 → FAIL
- [ ] **Step 3:** 實作
- [ ] **Step 4:** `backend/.venv/Scripts/python -m pytest backend -q` 全部 PASS
- [ ] **Step 5:** commit `[feat] [素材庫] 1.圖片輸入節點可從素材庫選圖 2.節點輸出可存到素材庫並自動記錄原圖`

### Task 4: 前端素材庫資料與純函式

**Files:**
- Create: `frontend/src/library/model.ts`
- Modify: `frontend/src/api.ts`(加 `library` 區塊與 `flows.toLibrary`、`setOutput` 支援 asset)、`frontend/src/flow/editors/types.ts`(`OutputSource = { file: Blob } | { asset: string }`)
- Test: `frontend/tests/library.test.ts`

**Interfaces:**
- Produces(`library/model.ts`):
  - `type ViewKey = 'side'|'vertical'|'topdown'|'iso'|'flat'`; `VIEW_LABEL: Record<ViewKey,string>`; `KINDS: readonly string[]`(與後端同序)
  - `interface Asset { id; name; created; parent: string|null; source: AssetSource; tags: { views: ViewKey[]; type: string|null } }`; `AssetSource = {kind:'import'; file:string} | {kind:'flow'; flow:string; node:string; rev:number} | {kind:'mockup'; [k:string]: unknown}`
  - `rootOf(assets: Asset[], id: string): string`(parent 指到不存在的當成根)
  - `groupAssets(assets: Asset[]): Asset[][]`: 每組根在前、其餘依 created 再依 id; 組之間依「組內最新 created」新到舊。
  - `type Filter = { view: ViewKey|'all'|'none'; kind: string|'all'; text: string }`; `matches(a: Asset, f: Filter): boolean`(`none` = views 為空; text 比對名稱包含, 不分大小寫)
  - `sourceText(a: Asset, nodeLabel: (type: string) => string): string`: `import` → `自己匯入: {file}`; `flow` → `平面圖 {flow} / 節點 {node} 第 {rev} 版`; `mockup` → `遊戲示意`
- Produces(`api.ts`):
  - `api.library.list() / import(files: File[], tags?) / imageUrl(id) / update(id, {name?, tags?}) / remove(id)`
  - `api.flows.toLibrary(flow, nid, name) => Promise<Asset>`
  - `api.flows.setOutput(..., source: { file: Blob } | { asset: string }, ...)`

- [ ] **Step 1: 失敗測試** `frontend/tests/library.test.ts`

```ts
it('groups derived chains under root, newest group first', ...)  // a1←a2←a3, a4 獨立且最新 → [[a4],[a1,a2,a3]]
it('orphan parent becomes root', ...)                              // a2.parent = 'a9'(不存在) → a2 自成一組
it('filter none = no views even with type', ...)                   // tags {views:[], type:'建築'} 符合 none, 不符合 side
it('text filter case-insensitive', ...)
```

- [ ] **Step 2:** `cd frontend && npx vitest run tests/library.test.ts` → FAIL
- [ ] **Step 3:** 實作 model.ts 與 api.ts、types.ts 變更
- [ ] **Step 4:** vitest 該檔 PASS; `npx tsc --noEmit -p .` 無錯
- [ ] **Step 5:** commit `[feat] [素材庫] 前端素材庫資料與分組篩選`

### Task 5: 頁籤列與素材庫頁

**Files:**
- Create: `frontend/src/pages/libraryPage.ts`、`frontend/src/library/picker.ts`(挑選視窗, Task 6 也用)、`frontend/src/library/grid.ts`(分組縮圖清單, 頁面與挑選視窗共用)
- Modify: `frontend/src/main.ts`、`frontend/index.html`(加回 `<nav id="nav">`)、`frontend/src/style.css`

**Interfaces:**
- Consumes: Task 4 全部
- Produces:
  - `mountLibraryPage(root: HTMLElement): () => void`
  - `renderGroups(container: HTMLElement, assets: Asset[], filter: Filter, opts: { selected?: string; onPick: (a: Asset) => void }): void`: 一組一列; 不符合篩選但同組有符合的 → 加 `dim` class; 派生縮圖角落小字「← 原圖名稱」。
  - `pickAsset(): Promise<Asset | null>`: 全螢幕遮罩視窗, 上方篩選(同頁面), 點一張即回傳, 取消回 null。
- 路由: `#/flow` → `mountFlowPage`, `#/library` → `mountLibraryPage`; 其他轉 `#/flow`(保留 query 的規則照現有 main.ts)。頁籤列樣式參考 `git show f56af5f^:frontend/src/style.css` 被刪掉的 nav 規則與 `git show f56af5f^:frontend/src/main.ts` 的 nav 寫法。

- [ ] **Step 1:** 寫 grid.ts、picker.ts、libraryPage.ts、main.ts、index.html、style.css(一次寫完)。素材庫頁內容照規格「素材庫頁籤」: 左側篩選(全部/五視角/未分類、類型下拉、名稱搜尋)、主區分組、右側詳細(大圖透明格底、名稱可改、視角勾選、類型下拉、來源文字、原圖連結點了選取原圖、下載 PNG、刪除需 `confirmDelete`)、「匯入圖片」(多檔, 選檔後可先勾視角/類型套用到這批, 再按確定; 有 errors 用 banner 列出)。
- [ ] **Step 2:** `npx tsc --noEmit -p .` 無錯、`npx vitest run` 全 PASS、`npx vite build` 成功
- [ ] **Step 3:** commit `[feat] [素材庫] 1.恢復頁籤列, 節點編輯器頁籤改名平面圖 2.新增素材庫頁籤(分組、篩選、標籤、匯入、刪除)`

### Task 6: 平面圖接素材庫(前端)

**Files:**
- Modify: `frontend/src/flow/editors/inputEditor.ts`、`frontend/src/pages/flowPage.ts`、`frontend/src/flow/model.ts`

**Interfaces:**
- Consumes: Task 4 `api.flows.toLibrary`、`setOutput({asset})`; Task 5 `pickAsset`
- Produces: `chainStale(flow: FlowMeta, id: string): boolean`(model.ts; 與後端 `chain_stale` 同規則, 加進 `frontend/tests/flow.test.ts` 兩個案例: 鏈中間過期 → true; 全部新 → false)

- [ ] **Step 1:** flow.test.ts 加 `chainStale` 測試 → 跑 → FAIL
- [ ] **Step 2:** 實作 `chainStale`; inputEditor 加「從素材庫選」按鈕(`pickAsset` → `ctx.save({ asset: a.id }, { params: { source: a.name, asset: a.id } })`, 預覽與標籤顯示素材名稱); flowPage 節點右鍵選單在「下載輸出 PNG」後加「存到素材庫」、編輯畫面右上下載鈕旁加同名按鈕: 沒輸出停用; `chainStale` 為 true 停用並 title 顯示「上游改過了, 先更新輸出再存」; 按下 `prompt` 名稱(預設 `${flow.name} ${NODE_INFO[type].label}`; 取消不存), 成功 banner「已存到素材庫: 名稱」(若有 parent 加「(派生自 原圖名)」)。一次寫完。
- [ ] **Step 3:** tsc、vitest、vite build 全過
- [ ] **Step 4:** commit `[feat] [素材庫] 1.圖片輸入節點加從素材庫選圖 2.節點右鍵與設定畫面加存到素材庫`

### Task 7: 文件

**Files:** Modify `README.md`

- [ ] **Step 1:** README: 「流程(節點編輯器)」標題改「平面圖」並說明頁籤; 圖片輸入加「從素材庫選」; 新增「存到素材庫」說明與過期限制; 新增「素材庫」一節(匯入、標籤、分組、刪除規則); 資料夾表加 `data/library/<編號>/`。
- [ ] **Step 2:** commit `[docs] [素材庫] 說明文件加入素材庫與平面圖頁籤`, push。
