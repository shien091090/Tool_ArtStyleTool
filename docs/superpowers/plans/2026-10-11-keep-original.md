# 保留原圖 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 不動參數時渲染 = 原圖; 新增「保留原圖光影 / 紋理」兩個滑桿。
**Spec:** `docs/superpowers/specs/2026-10-11-keep-original-design.md`

## Global Constraints
- 第 1 版配方外觀不變(keep 0/0、線條開啟)、不跳提示
- 預設配方 + 任何分層包(含舊包) → 與原圖誤差 ≤ 2/255
- 只 commit, push 由使用者自己來

## Review Focus
1. 舊分層包沒有 shade / sampled → 預設仍等於原圖
2. 檢查點改色後, 保留 1/1 時看得到新顏色(不被細節抵銷)
3. 第 1 版配方與六份起始配方外觀和 D 組前一致
4. 保留光影 = 1 時加高光/補光/邊緣光/環境遮蔽仍看得到
5. 背景區塊、線條像素的原圖光影不出現髒污或光暈

### Task 1: 後端 sampled 顏色與原圖光影圖層
Files: `backend/artstyle/shade.py`(新)、`decompose.py`、`pack.py`、`tests/test_shade.py`(新)、`tests/test_decompose.py`
- `shade.region_shade(source, flat_sampled, labels, line_mask|None) -> float32 (H,W,3)` 正規化卷積, σ = 長邊/60
- `shade.encode_shade(lab_resid) -> uint8 RGB`
- flat 步驟另存 `regions.sampled`; `set_region_color` 只改 `colors`
- 新步驟 `shade`(STEPS 在 flat 之後), DEPENDENTS `regions/delight → shade`
- 測試: 區塊邊界兩側互不影響; 線條排除; 改色後 sampled 不變; run_all 產出 shade

### Task 2: 配方 v2、keep 區段、遷移、顯示規則、起始配方
Files: `frontend/src/recipe.ts`、`visibility.ts`、`presets.ts`、tests
- `Recipe.version: 2`; `keep: { enabled, shade, texture }`; DEFAULT keep 1/1、lines.enabled false
- `normalizeRecipe`: 輸入 version ≠ 2 → 以「v1 基準」(keep 0/0、lines.enabled true)補缺
- 顯示規則: shadowMode/shadowColor/shadowStrength/litColor/litStrength 需 keep.shade < 1(且原規則)

### Task 3: 渲染 shader 與渲染器
Files: `frontend/src/gl/shaders.ts`、`renderer.ts`、`api.ts`
- GLSL OKLab 轉換; 光照 pass 重排(色階 → 保留混合 → 額外光效)
- 原始取色表(sampled)貼圖; `shade` 可選貼圖(缺則 128 = 0)
- 瀏覽器: 預設配方逐像素比對原圖

### Task 4: 面板「保留原圖」與驗收
Files: `renderPage.ts`、README
- 面板最上方加「保留原圖」資料夾; 起始配方與第 1 版配方外觀檢查; 改色與拉低保留的視覺檢查
- 最終審查
