# 風格效果擴充 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在既有五層渲染上加入約 25 個風格效果、一個「調色」層、兩個新的拆解圖層(環境遮蔽、主體剪影), 以及六份唯讀的風格起始配方。

**Architecture:** 後端在拆解流程尾端多算 `ao.png`、`silhouette_sdf.png`(純本機)。前端配方加新欄位與 `grade` 層, 正規化改為缺欄位安靜補值; shader 在既有 pass 內擴充, 另加泛光(兩次分離模糊)與調色 pass; 面板加新參數並沿用顯示規則; 起始配方以 JSON 內建於前端。

**Tech Stack:** 同 v1(Python/FastAPI/OpenCV、Vite/TS/WebGL2/Tweakpane、pytest、Vitest)。

**Spec:** `docs/superpowers/specs/2026-10-10-style-effects-design.md`(上位: `2026-10-09-art-style-tool-design.md`)

## Global Constraints

- 所有新效果預設關閉或強度 0, 舊配方外觀不變
- 以像素為單位的參數以長邊 1024px 為基準, 渲染時乘 `uScale`
- `version` 維持 1; 缺欄位安靜補預設, 只有型別錯/越界列入 `fixed`
- 不用外部紋理素材, 紋理一律程式產生; 不用 LYGIA
- 渲染缺 `ao`/`silhouette_sdf` 時, 相關效果自動不作用(用 1x1 預設貼圖)
- push 由使用者自己來, 只 commit

## Review Focus

1. 舊分層包沒有 `ao`/`silhouette_sdf` → 渲染不報錯, 外框描邊/外輪廓/環境遮蔽不作用, 其他照常(Task 3 renderer 用預設貼圖; 瀏覽器驗證用舊包 knight2)
2. 讀 v1 時期存的配方(缺所有新欄位) → 外觀與之前完全相同、不跳補值提示(Task 2 測試: 舊配方正規化後新欄位全是預設且 `fixed` 為空)
3. 沒有深度(使用者上傳法線)時的主體判斷 → 以碰到邊框的最大區塊當背景(Task 1 測試)
4. 起始配方被使用者改了按「存檔」 → 不能覆蓋起始配方, 要求另存新名(Task 7)
5. 大圖(2048px)開泛光、油畫平滑、點描 → 不當機; 單幀渲染在 GTX1650 上可接受(Task 6 瀏覽器實測 big2048 類大圖)

---

## 配方新欄位(所有 Task 共用)

```
lighting:  shadowMode += 'custom'; shadowColor '#3a3f6b'
           litColor '#fff2d6', litStrength 0 [0,1]
           softness 0 [0,1], edgeJitter 0 [0,1]
           specular false, specSize 0.3 [0,1], specSharpness 0.8 [0,1], specColor '#ffffff', specStrength 0.8 [0,1]
           fill false, fillAzimuth 315 [0,360], fillElevation 20 [5,90], fillColor '#7fa7ff', fillStrength 0.4 [0,1]
           ao 0 [0,1]
lines:     outerThickness 0 [-3,8], innerLines true
           pressure 0 [0,1], pressureScale 1 [0.2,4]
           breaks 0 [0,1]
           doubleLine false, doubleOffset 3 [0,12], doubleAngle 45 [0,360], doubleColor '#e04a4a'
effects:   hatch false, hatchSpacing 6 [3,24], hatchAngle 45 [0,180], hatchWidth 1 [0.5,4], crossHatch false, hatchStrength 0.7 [0,1]
           stipple false, stippleSize 2 [1,8], stippleDensity 0.6 [0,1]
           wcEdge 0 [0,1], wcBleed 0 [0,1], wcGranule 0 [0,1]
           brush 0 [0,1], brushScale 1 [0.3,4]
           riso 0 [0,12], risoAngle 30 [0,360]
filter:    outlineWidth 0 [0,16], outlineColor '#ffffff'
           bloom 0 [0,1], bloomThreshold 0.7 [0,1], bloomRadius 1 [0.5,3]
           chroma 0 [0,8], scan 0 [0,1], scanSpacing 3 [2,12]
grade(新): enabled true, preset 'none'|'film'|'faded'|'warm'|'night'|'noir', presetStrength 1 [0,1]
           gradientMap false, gradientStops ['#1b1b3a','#f2e6c9'](2~6 色), gradientStrength 1 [0,1]
           satShadow 0 [-1,1], satHighlight 0 [-1,1]
```

## 顯示規則(新增)

- `lighting.shadowColor` ← shadowMode == custom 且有陰影
- `lighting.litColor/litStrength/softness/edgeJitter/ao` ← 有陰影(bands ≥ 2)
- `lighting.spec*` ← specular; `lighting.fill*` ← fill
- `lines.pressureScale` ← pressure > 0; `lines.double*`(除 doubleLine)← doubleLine
- `effects.hatch*`(除 hatch)← hatch; `crossHatch` 另需 hatch; `effects.stipple*` ← stipple; `brushScale` ← brush > 0; `risoAngle` ← riso > 0
- `filter.outlineColor` ← outlineWidth > 0; `filter.bloomThreshold/bloomRadius` ← bloom > 0; `filter.scanSpacing` ← scan > 0
- `grade.presetStrength` ← preset != none; `grade.gradientStops/gradientStrength` ← gradientMap

---

### Task 1: 後端環境遮蔽與主體剪影

**Files:** Create `backend/artstyle/masks.py`, `backend/tests/test_masks.py`; Modify `pack.py`(LAYERS、DEPENDENTS)、`decompose.py`(STEPS 尾端加 `ao`、`silhouette`)、`tests/test_decompose.py`

**Interfaces:**
- `masks.ambient_occlusion(depth01, fg) -> uint8`: `cav = max(0, blur(d, σ=長邊/100) - d) * fg`, 以 99 分位數正規化到 0..255(255 = 最暗凹處); 平面為 0
- `masks.foreground(depth01 | None, labels | None) -> bool`: 有深度用 `depth > 0.001`; 否則碰到邊框且面積最大的區塊為背景; 兩者都無 → 全 True
- `masks.silhouette_sdf(fg) -> uint8`: `encode_sdf(signed_distance(fg))`(主體內負、外正)
- 步驟 `ao`: 需 depth; 步驟 `silhouette`: 需 depth 或 regions
- DEPENDENTS: `depth → ao, silhouette`; `regions → silhouette`

- [ ] 測試: 凹槽深度圖 → 槽內 ao > 槽外; 平面 → 0; 前景(有深度/無深度用區塊/都沒有); 剪影 SDF 符號; run_all 產出兩層且尺寸對齊; 無深度時 silhouette 用 regions
- [ ] 跑測試確認失敗 → 實作 → 通過
- [ ] Commit `[feat] [美術風格工具] 拆解新增環境遮蔽與主體剪影`

### Task 2: 配方欄位、安靜補值、顯示規則、起始配方資料

**Files:** Modify `frontend/src/recipe.ts`、`visibility.ts`; Create `frontend/src/presets.ts`; Tests `recipe.test.ts`、`visibility.test.ts`、Create `presets.test.ts`

**Interfaces:**
- `Recipe` 增加上表欄位與 `grade` 區段; `DEFAULT_RECIPE`、`LIMITS`、`ENUMS` 擴充; `gradientStops` 與 `color.custom` 同樣是 hex 陣列(gradientStops 2~6 色, 不足補預設)
- `normalizeRecipe`: 缺欄位/缺區段 → 補預設**不列入 fixed**; 型別錯、越界、未知列舉 → 列入
- `presets.ts`: `export const STARTER_RECIPES: { name: string; recipe: Recipe }[]` 六份(此 Task 先放合理初值, Task 8 調校)
- `isVisible` 擴充上方規則; 新區段 `grade` 的 `enabled` 規則同其他層

- [ ] 測試: 舊配方(只有 v1 欄位)→ fixed 為空、新欄位皆預設; `shadowMode: 'custom'` 合法; gradientStops 過濾非法色碼與數量限制; 每個新顯示規則一條斷言; 六份起始配方 `normalizeRecipe` 後 fixed 為空且名稱不重複
- [ ] 失敗 → 實作 → 通過, `tsc --noEmit` 通過
- [ ] Commit `[feat] [美術風格工具] 配方新增風格效果欄位與起始配方`

### Task 3: 光照擴充與主體遮罩

**Files:** Modify `frontend/src/gl/shaders.ts`(LIGHTING_FS)、`renderer.ts`

- renderer 載入 `ao`、`silhouette_sdf`(可缺, 缺則 1x1 預設: ao=0、sdf=0 代表全是主體)
- 光照只作用在主體內(sdf ≤ 0), 修掉剪影外的陰影暈
- 色階交界: `q = floor(t*b)/(b-1)` 改為以 `smoothstep` 在每個階邊界做 `softness` 寬度過渡; `edgeJitter` 以 fbm 擾動 t
- shadowMode custom: `shadowCol = mix(c, shadowColor, shadowStrength)`; 亮面: `litCol = mix(c, c*litColor*1.15, litStrength)`
- 高光: Blinn-Phong `pow(max(dot(n,h),0), mix(8,128,specSharpness))`, 以 `specSize` 為門檻切硬邊, 加 `specColor*specStrength`
- 補光: 第二光向量, `max(dot(n,L2),0)` 只加亮 `fillColor*fillStrength`
- 環境遮蔽: `o *= 1 - ao*aoTex`
- [ ] 實作、`tsc` 通過; 瀏覽器: Monster1 開各項目視檢查、knight2(舊包)不報錯
- [ ] Commit `[feat] [美術風格工具] 光照新增高光補光陰影色柔邊與環境遮蔽`

### Task 4: 線條擴充

**Files:** Modify `shaders.ts`(LINES_FS)、`renderer.ts`

- 外輪廓判定: `outer = 剪影距離 |sdSil| < 線寬 + 2px`; 外輪廓寬 = thickness + outerThickness; `innerLines=false` 時非外輪廓的線覆蓋率為 0
- 筆壓: 寬度乘 `1 + pressure*(vnoise(frag*0.05/pressureScale/uScale)*2-1)`
- 斷續: 覆蓋率乘 `step(breaks, vnoise(frag*0.08/uScale))` 的平滑版
- 雙線: 以偏移 `(cos,sin)(doubleAngle)*doubleOffset*uScale` 再取一次 SDF, 用 doubleColor 疊在主線下方
- [ ] 實作、瀏覽器檢查每一項、Commit `[feat] [美術風格工具] 線條新增外輪廓控制筆壓斷續與雙線錯位`

### Task 5: 質感擴充

**Files:** Modify `shaders.ts`(EFFECTS_FS)、`renderer.ts`(綁 regions、normal 貼圖給此 pass)

- 排線: 旋轉座標後 `abs(fract(y/spacing)-0.5)*spacing < width/2`, 只在暗度 > 門檻處; crossHatch 在暗度更高處加垂直一組
- 點描: 以 `stippleSize` 為格, 每格 hash 決定是否畫點(機率 = 暗度*density)
- 水彩: 邊緣加深 = 區塊編號與鄰近像素不同處的距離衰減; 暈染 = 取前一層顏色時以 fbm 偏移 uv; 顆粒 = fbm 高頻乘暗
- 筆觸: 沿法線切線方向(垂直 n.xy)拉長的雜訊, 調變明度
- 套色錯位: 紅、藍通道分別往 ± 方向偏移取樣
- [ ] 實作、瀏覽器檢查、Commit `[feat] [美術風格工具] 質感新增排線點描水彩筆觸與套色錯位`

### Task 6: 濾鏡擴充、泛光與調色 pass

**Files:** Modify `shaders.ts`(FINAL_FS 拆分、新增 BLOOM_*、GRADE_FS)、`renderer.ts`; Create `frontend/src/grade.ts`、`frontend/tests/grade.test.ts`

- 外框描邊: 剪影外側 `0 < sdSil < outlineWidth*uScale` 塗 outlineColor
- 色差: 依距中心距離偏移 R/B 取樣; 掃描線: `1 - scan*0.5*(sin(y*π/spacing)^2)`
- 泛光: 亮度 > 門檻的部分縮半尺寸, 水平+垂直高斯各一次(半徑 × bloomRadius × uScale), 加回
- 調色: `grade.ts` 的 `GRADE_PRESETS`(lift/gamma/gain RGB、飽和、對比)與 `gradePresetUniforms(preset, strength)`; 漸層映射以亮度在 stops 間線性內插(stops 以 1D 貼圖傳入); 明暗飽和度依亮度在 satShadow/satHighlight 間內插
- [ ] 測試 `grade.test.ts`: preset none 或 strength 0 → 單位轉換; 各 preset 參數存在且在合理範圍; 漸層 stops 轉 1D 表的取樣正確
- [ ] 實作、瀏覽器檢查(含 2048px 圖開泛光+油畫平滑)、Commit `[feat] [美術風格工具] 1.濾鏡新增外框描邊泛光色差掃描線 2.新增調色層`

### Task 7: 面板與起始配方選單

**Files:** Modify `renderPage.ts`、`paletteEditor.ts`(可設定最少/最多色數、標題)、`gridPage.ts`(下拉同樣分組)

- 新增所有 binding 並 `track`; 資料夾: 色彩、光照(展開)、線條、質感、濾鏡、調色(收合)
- 漸層映射色帶用色票編輯器(2~6 色, 不顯示 Lospec/吸色以外的差異: 一律可用)
- 配方下拉: `<optgroup label="起始配方">` 與 `<optgroup label="我的配方">`; 選起始配方後按「存檔」→ 改走另存新檔並提示「起始配方不能覆蓋」
- [ ] 瀏覽器: 每個新開關切換後子參數顯示/隱藏正確; 起始配方載入、存檔行為; Commit `[feat] [美術風格工具] 面板加入新效果與起始配方選單`

### Task 8: 調校起始配方、文件

**Files:** Modify `presets.ts`、`README.md`

- 在瀏覽器把六份配方套在 knight 與 Monster1 上調到風格分明, 回寫參數; 截圖六張×兩圖做成對照頁 `scratch/presets/index.html` 給使用者看
- README 補新效果與起始配方說明
- [ ] 全部測試(pytest、vitest、tsc)通過; Commit `[feat] [美術風格工具] 調校六份風格起始配方`
- [ ] 最終整支審查(fresh reviewer), 修 Critical/Important
