# 部位工坊(AI 列部位 + 材質替換) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 部位比例頁籤改名部位工坊, 加上 AI 列出部位與每部位材質替換。

**Architecture:** 後端在既有 `artstyle.proportion` 套件加 `suggest.py`(視覺模型列部位)與 `material.py`(裁切→Nano Banana→貼回), `Work` 管候選檔與 `material` 欄位; fal 客戶端加 `vision()` 與多圖 `edit()`。前端 `WorkAssets` 依 `material.current` 換像素來源並產生邊緣環, `drawRegion` 加入只換材質部位的邊緣環; 頁面加列部位標籤列與材質面板。

**Tech Stack:** FastAPI + OpenCV + pytest; TypeScript + Vite + vitest; fal.ai(openrouter vision、nano-banana edit、flux schnell 生縮圖)。

**Spec:** `docs/superpowers/specs/2026-10-11-part-workshop-design.md`

## Global Constraints

- API 前綴 `/api/proportion` 與 `data/proportion/` 不改
- 視覺模型: `openrouter/router/vision`, model `google/gemini-2.5-flash`
- 列部位最多 12 項; 中文名 1~20 字; 英文只留 `[A-Za-z -]`
- 材質描述 1~200 字; 候選張數 1~4; 裁切邊距 `round(長邊×5%)`; 貼回遮罩膨脹 2px、σ=1.5
- 只換材質部位的邊緣環半徑 `max(2, round(長邊×0.8%))`
- 快捷材質 15 種, 縮圖 64×64 PNG 於 `frontend/public/materials/<key>.png`
- 使用者看得到的文字一律繁體中文

## Review Focus

1. 舊作品(部位無 `material`、作品無 `aliases`/`counters.material`)開啟、切部位、生成都不出錯 → Task 2 測試
2. 換過材質後拆左右, 兩半都顯示新材質且刪其中一半不刪到另一半的檔 → Task 2 測試
3. 刪掉套用中的候選 → 部位切回原本材質, 畫布不壞圖 → Task 2 測試
4. 只換材質沒動比例按生成 → 允許, 且 AI 只能改邊緣環 → Task 3、Task 5 測試
5. AI 列部位回傳帶 \`\`\`json 或多餘文字 → 能解析; 完全壞掉 → 中文錯誤 → Task 1 測試

---

### Task 1: fal 客戶端 vision 與多圖 edit、列部位解析

**Files:** Modify `backend/artstyle/fal.py`; Create `backend/artstyle/proportion/suggest.py`; Test `backend/tests/test_fal_client.py`, `backend/tests/test_proportion_suggest.py`

**Interfaces:**
- `HttpFalClient.vision(img: np.ndarray, prompt: str) -> str`(回傳 `output` 文字)
- `HttpFalClient.edit(model_key, img, prompt, num_images, extra_images: list[np.ndarray] = ())`, nano-banana 時 `image_urls = [img, *extra]`; qwen 帶 extra → ValueError
- `suggest.PROMPT: str`; `suggest.parse(text: str) -> list[dict]`(`[{name, en}]`, 壞 → `ValueError("AI 沒有列出部位, 請手動輸入")`)

- [ ] 寫失敗測試: vision 送出 body 含 model/prompt/image_urls 並回 output; edit 帶 extra_images 時 image_urls 有兩張; parse 剝 \`\`\`json、取第一個 `{...}`、去重、上限 12、過濾不合法項、全壞報錯
- [ ] 實作, 測試通過
- [ ] Commit

### Task 2: Work 材質資料與別名

**Files:** Modify `backend/artstyle/proportion/work.py`, `parts.py`; Test `backend/tests/test_proportion_work.py`, `test_proportion_parts.py`

**Interfaces:**
- `Work.part_material(pid) -> dict`(缺 → `{"current": None, "variants": []}`)
- `Work.add_material_variant(pid, img: np.ndarray, material: str, ref: np.ndarray | None) -> dict`(存 `materials/<pid>_m<n>.png`, 參考圖 `_ref.png`; 原本材質時自動套用)
- `Work.set_material(pid, vid | None)`; `Work.delete_material(pid, vid)`
- `Work.material_image(pid) -> np.ndarray`(套用中候選或來源圖)
- `Work.copy_materials(src_pid, dst_pid)`(拆左右用)
- `delete_part` 一併刪 `materials/<pid>_*`
- `Work.set_alias(zh, en)`; `parts.to_prompt(name, aliases=None)` 先查別名
- `_FILE` 白名單加 `materials`

- [ ] 寫失敗測試: Review Focus 1~3、編號不重用、白名單
- [ ] 實作, 測試通過
- [ ] Commit

### Task 3: API(列部位、換材質、套用/刪除、拆左右繼承、生成允許只換材質)

**Files:** Modify `backend/artstyle/proportion/api.py`; Create `backend/artstyle/proportion/material.py`; Test `backend/tests/test_proportion_api.py`, `test_proportion_material.py`

**Interfaces:**
- `material.crop_box(mask) -> (x0,y0,x1,y1)`; `material.build_prompt(part_en, material, has_ref) -> str`; `material.paste(src, ai, mask, box) -> np.ndarray`(羽化範圍外與 src 相同)
- `POST /works/{name}/suggest-parts` `{image}` → `{parts, meta}`
- `POST /works/{name}/parts/{pid}/materials` form `material`, `count`, `reference?` → `{meta, errors}`
- `PUT /works/{name}/parts/{pid}/material` `{variant}`; `DELETE /works/{name}/parts/{pid}/materials/{vid}`
- split 呼叫 `copy_materials`; 切部位/重切用 `to_prompt(name, aliases)`
- generate 不需改(前端送的 region 已含邊緣環); 「沒有任何改動」照舊由 region 判斷

- [ ] 寫失敗測試(FakeFal 加 vision 與 extra_images): 列部位寫別名、換材質貼回外部不變、張數不足 errors、參數驗證、拆左右繼承
- [ ] 實作, 測試通過
- [ ] Commit

### Task 4: 材質縮圖

**Files:** Create `backend/scripts/make_material_swatches.py`, `frontend/public/materials/*.png`, `frontend/src/proportion/materials.ts`

- `MATERIALS: {key, label, prompt}[]` 15 項(前端用 key/label; 腳本用 prompt 英文)
- 腳本: fal `fal-ai/flux/schnell` 512² → INTER_AREA 64² → PNG
- [ ] 生成並逐張目視檢查, 不像的重生
- [ ] Commit

### Task 5: 前端 繪製與路由

**Files:** Modify `frontend/src/proportion/model.ts`, `draw.ts`, `transform.ts`, `frontend/src/main.ts`, `frontend/src/api.ts`; Test `frontend/tests/proportionDraw.test.ts`, `proportionTransform.test.ts`

**Interfaces:**
- `Part.material?: {current: string | null; variants: MaterialVariant[]}`
- `hasMaterial(part)`; `isChanged` 不變(材質不算比例改動); `needsRegion(part)`
- `WorkAssets.sync` 依 current 載入 `materials/<current>.png`(圖快取鍵 = 檔名); 圖層多 `ring` 與 `ringOx/ringOy`
- `ringMask(alpha crop, w, h, r) -> Uint8Array`(外擴 − 內縮), 純函式可測
- `drawRegion`: 主圖或已放置部位 `hasMaterial && !isChanged` → 畫 ring(依部位變形矩陣; 未變形即原位)
- 路由 `workshop` 標籤「部位工坊」; `proportion` 轉址到 `workshop` 保留 query
- api: `suggestParts`, `addMaterials`, `setMaterial`, `deleteMaterial`

- [ ] 寫失敗測試: ringMask 形狀; 舊路由轉址函式
- [ ] 實作, 測試與 tsc 通過
- [ ] Commit

### Task 6: 前端 頁面 UI

**Files:** Modify `frontend/src/pages/proportionPage.ts`, `frontend/src/style.css`

- 列部位按鈕 + 勾選標籤列(已有同名預設不勾); 切部位合併勾選與手打
- 材質面板: 縮圖格、描述、參考圖、張數、換材質、候選列(原本材質 + 縮圖, 點選套用, 刪除)
- 生成按鈕在只換材質時可用
- [ ] 實作, tsc 通過
- [ ] Commit

### Task 7: 文件與實跑驗證

**Files:** Modify `README.md`, 舊規格狀態列

- [ ] README 部位比例段改名並補兩個功能、縮圖腳本
- [ ] 測試埠實跑: AI 列部位 → 切 → 換材質(含參考圖)→ 調比例 → 生成, 看結果圖
- [ ] Commit
