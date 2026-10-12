# 像素素材 設計規格(G 組)

日期: 2026-10-12
狀態: 已實作(2026-10-12)

## 1. 目標

新頁籤「像素素材」: 任意圖片 → AI 重畫成 2D 像素遊戲素材 → 本機縮成真實像素解析度 → 匯出給 Aseprite 修。

不做: 像素修圖器(使用者用 Aseprite)、Retro Diffusion。

## 2. 實驗結論(2026-10-12)

- 自動尺寸: `fal-ai/flux-pro/kontext`(遊戲感強、會改色, 約 US$0.04/張)與 `fal-ai/nano-banana-pro/edit`(忠於原圖, 約 US$0.15/張)兩種都要; 之後用 unfake 偵測格子縮回真解析度
- 指定格數: 只有 Nano Banana Pro 會照格數與重新設計指令畫; Kontext 不理格數, 不提供。AI 實際畫出的格數比要求多約五成, 叫它再修一次無效 → 最後一定由程式縮到精確 W×H
- 縮小方法: 每格取最多色最乾淨但小尺寸掉眼睛; 明暗保留(每格挑最亮/最暗/中間)保得住眼睛但偏暗; unfake 內容自適應會混色。三種並排讓使用者挑
- 指令要寫「不要畫格線或邊框」, 否則 Nano Banana Pro 有時畫出格線
- 否決: 純演算法 PixelOE、Nano Banana 一般版、Retro Diffusion、兩段式「再修一次」、附原圖當第二張參考圖

## 3. 頁面流程

1. **建立作品**: 名稱 + 來源三選一: 上傳圖片、分層包、部位工坊作品的生成結果。作品存 `data/pixel/<名稱>/`, 可刪除
2. **設定**(右側面板):
   - 尺寸模式: 「自動」或「指定格數」
   - 自動: 模型選 Kontext(遊戲感, 約 0.04 美元/張)或 Nano Banana Pro(忠於原圖, 約 0.15 美元/張)
   - 指定格數: 寬、高各 1~16 格, 一格 8px(例 寬 1 × 高 2 = 8×16); 固定 Nano Banana Pro
   - 色數 2~64; 預設依尺寸: 長邊 ≤16px 8 色、≤32px 12 色、其他格數 16 色、自動 24 色
   - 補充描述(選填, 最多 200 字)、候選張數 1~4(預設 1)
   - 「AI 重畫」按鈕旁顯示預估花費
3. **候選列**: 每張 AI 原圖存成候選, 縮圖列出, 可刪
4. **縮小結果**: 選一張候選 → 本機縮小, 結果用整數倍最近鄰放大顯示在透明格紋底上
   - 指定格數: 三格並排「每格取最多色」「明暗保留」「內容自適應」
   - 自動: 一格「自動偵測格子」
   - 改色數 → 重縮(不叫 AI)
5. **匯出**(每格結果): 原尺寸 PNG(一格一像素, 透明背景)、放大 PNG(×8)、`.gpl` 調色盤

## 4. 後端

### 4.1 資料

```
data/pixel/<名稱>/
  meta.json
  source.png           來源圖(RGB, 長邊上限 2048)
  ai/c<n>.png          AI 候選原圖
```

`meta.json`:

```json
{
  "version": 1, "name": "...", "created": "...", "updated": "...", "source": "來源標籤",
  "candidates": [{"id": "c1", "created": "...", "mode": "grid", "model": "nano-banana-pro",
                  "cols": 1, "rows": 2, "colors": 8, "note": ""}],
  "counters": {"candidate": 1}
}
```

- 候選記下自己的 mode/cols/rows/colors(預設色數), 縮小依候選的設定, 不依目前面板
- 候選編號用計數器, 刪除後不重用
- 縮小結果不存檔, 每次即時算

### 4.2 API(前綴 `/api/pixel`)

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/works` | `[{name, updated, candidates}]` |
| POST | `/works` | form `name` + `file` 或 `pack` 或 `workshop`(`作品名/r<n>`) |
| GET | `/works/{name}` | meta |
| DELETE | `/works/{name}` | 刪整個資料夾 |
| GET | `/works/{name}/files/{source.png 或 ai/c<n>.png}` | 圖檔 |
| GET | `/workshop-results` | `[{work, id}]` 部位工坊所有生成結果 |
| POST | `/works/{name}/candidates` | body `{mode, model, cols, rows, colors, note, count}` → `{meta, candidates, errors}` |
| DELETE | `/works/{name}/candidates/{cid}` | 刪候選與檔案 |
| POST | `/works/{name}/candidates/{cid}/pixelate` | body `{colors}` → `{results: [{method, label, png, w, h, palette} 或 {method, label, error}]}` |

- `png` 為 data URI(RGBA); `palette` 為不透明像素的 `#rrggbb` 清單(依出現次數多到少)
- 驗證失敗 → 400 中文訊息; 名稱含 `..` 等 → 400; 檔名不在白名單 → 404
- fal 失敗照現有方式 502, 已有候選不受影響; 回傳張數少於要求 → 照常保存並附 `errors`

### 4.3 送 AI 前

- 裁掉來源圖的白邊(接近白 = 三通道最小值 > 235), 四周補白邊 = 長邊 6%
- 指定格數: 再把主體等比放進 W:H(像素比)白底畫布, 主體佔 94%, 長邊 1024px
- 自動: 長邊縮到 1024px 以內

### 4.4 指令(英文, 自動組合)

自動:

> Convert this image into pixel art: a 2D pixel art game sprite in 16-bit SNES RPG style. Very low resolution (about 64 pixels tall, upscaled with big visible square pixels), limited {C}-color palette, no anti-aliasing, no gradients, 1-pixel dark outline, flat cel shading. Same subject, pose and colors. Plain white background.

指定格數(W×H 為像素):

> Redraw this image as a pixel art game sprite that is exactly {W} pixels wide and {H} pixels tall, shown enlarged so that each sprite pixel is one big flat square of equal size; the sprite fills the whole frame edge to edge. Do NOT draw any grid lines, borders or frame. Limited palette of about {C} colors, no anti-aliasing, no gradients, dark outline. Plain white background.

- 長邊 ≤ 16px 加: `At this tiny size simplify it like an icon: keep only the silhouette and the main color blocks, eyes at most 1 pixel each.`
- 主體寬高比與 W:H 相差超過 25%(大 ÷ 小 − 1 > 0.25)加: `The frame's aspect ratio is different from the original image: redesign the proportions to fill the frame (for example chibi proportions with a big head and short body for a square frame).`
- 有補充描述加: `Additional instructions: {note}`

### 4.5 縮小(本機)

共同:
- **裁切補比例**: 裁掉 AI 圖白邊, 補白成 W:H 比例(置中)
- **減色**: k-means 分 `色數 + 1` 群(多一群給白背景), 每像素換成所屬群中心
- **去背**: 結果中「接近白(最小通道 > 225)且與圖邊 4 連通」的像素 alpha = 0, 主體內的白保留

指定格數三種:
- **每格取最多色**(dominant): 縮到 16W×16H(INTER_AREA) → 減色 → 每 16×16 格取出現最多的群
- **明暗保留**(contrast): 縮到 8W×8H(INTER_AREA), 每 8×8 格算亮度; 最小值比中位數暗超過 40 且亮度在最小值 +20 內的像素佔 ≥ 10% → 取這些像素平均色; 否則最大值比中位數亮超過 40 且同樣佔 ≥ 10% → 取亮像素平均色; 否則取亮度最接近中位數的像素色 → 對 W×H 結果減色
- **內容自適應**(adaptive): unfake `content_adaptive_downscale(rgba, W, H)` → 減色

自動:
- unfake `process_image`(偵測 auto、dominant、jaggy 清理、`max_colors = 色數 + 1`, 不用它的去背)→ 自己去背
- 結果長邊 > 256 → 該格回 error「偵測不到像素格子」

- **最後**: 不透明像素色數仍超過色數(白背景那一群落在主體上)→ 對不透明像素再分 `色數` 群

單一方法失敗(例外、整張白)→ 該格 `error`, 其他照常。

### 4.6 依賴

- `requirements.txt` 加 `unfake`, OpenCV 由 `opencv-python-headless` 改 `opencv-python`(unfake 依賴後者, 兩者並存會互相覆蓋)
- `EDIT_MODELS` 加 `nano-banana-pro`; Kontext 走 `run_image`

## 5. 前端

- 路由 `#/pixel`, 標籤「像素素材」, 檔案 `frontend/src/pages/pixelPage.ts`、`frontend/src/pixel/*.ts`
- 純函式(可測): `defaultColors(mode, cols, rows)`、`estimateCost(mode, model, count)`、`toGpl(name, palette)`、`displayScale(w, h, box)`
- 下載: data URI 直接下載; 放大版用 canvas 關掉平滑放大 ×8; `.gpl` 用 Blob
- 檔名 `<作品>_<候選>_<方法>.png`、`..._x8.png`、`<作品>_<候選>_<方法>.gpl`

## 6. 測試

- 後端(假 AI, 不花錢): 指令組合(自動/格數、≤16 加簡化、比例差 >25% 才加重新設計、補充描述)、送 AI 前的畫布比例; 三種縮小輸出剛好 W×H、不透明色數 ≤ 色數、主體內白色保留、邊緣白去背; 自動偵測縮回正確尺寸; 作品建立(三種來源)/刪除/名稱驗證; 候選新增/刪除/編號不重用; 參數驗證; fal 失敗與張數不足
- 前端: 預設色數、花費估算、gpl 格式
- 實跑(約 0.3 美元): 自動 Kontext 一張、格數 1×2 一張, 看結果
