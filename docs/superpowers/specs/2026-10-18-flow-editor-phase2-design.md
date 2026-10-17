# 節點流程編輯器 第 2 期: 改部位節點 設計規格

日期: 2026-10-18
狀態: 已實作, 等使用者實測

## 1. 目標

流程多一種節點「改部位」`workshop`: 編輯面板就是部位工坊(切部位、調比例、換材質、擴大畫布、比例配方、AI 生成), 來源是上游輸出; 生成結果按「設為輸出」成為節點輸出。部位工坊頁籤照常可用, 資料各自獨立(節點的作品放在流程資料夾裡, 不會出現在部位工坊的作品清單)。

## 2. 節點

- 標籤「改部位」, 有輸入接點, 要花錢(上游換圖只亮過期, 不自動重跑)
- 資料: `data/flows/<流程>/nodes/<id>/` 就是一個部位工坊作品(meta.json、images/、masks/、materials/、results/), 另在 meta 記 `inputRev`(主圖取自上游第幾版)
- 刪節點或改種類時整個資料夾一起刪(沿用第 1 期)

## 3. 編輯面板

- 打開時還沒有作品且上游有輸出 → 自動用上游輸出建立(免費; 透明處裁掉再鋪白底, 同送 AI 前處理)
- 上游沒有輸出 → 顯示「上游還沒有輸出」
- 作品的 `inputRev` 跟上游目前版本不同 → 黃色提示「上游已更新」+ 按鈕「改用新的上游圖」(確認後清掉部位、材質與結果, 重新建立)
- 其餘介面同部位工坊, 但拿掉: 上方的作品選擇/建立/刪除列、對照列的「送到拆解檢查」
- 對照列多一顆主要按鈕「設為輸出」: 把該結果設成節點輸出, `inputRev` 用作品的 `inputRev`; 結果清單中目前是輸出的那張標「輸出」
- 狀態列與錯誤訊息用節點面板上方的那一組

## 4. API

部位工坊單一作品的路由抽成共用函式, 兩邊掛同一份:

| 前綴 | 作品 |
|---|---|
| `/api/proportion/works/{name}` | 部位工坊作品(原本) |
| `/api/flows/{flow}/nodes/{id}/workshop` | 流程改部位節點的作品(節點種類不是 workshop 回 400) |

共用的子路由: `GET ""`、`GET /files/{folder}/{filename}`、`POST /images`、`POST /parts`、`POST /parts/{pid}/refine`、`POST /parts/{pid}/split`、`POST /suggest-parts`、`POST /parts/{pid}/materials`、`PUT /parts/{pid}/material`、`DELETE /parts/{pid}/materials/{vid}`、`DELETE /parts/{pid}`、`PUT /layout`、`POST /generate`、`POST /results/{rid}/to-pack`

節點另加:

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/flows/{flow}/nodes/{id}/workshop/status` | `{exists, inputRev}` |
| POST | `/api/flows/{flow}/nodes/{id}/workshop/init` | 以上游輸出建立(已存在就整個重建), 記 `inputRev`; 上游沒有輸出 400 |

比例配方仍共用 `/api/proportion/recipes`。

## 5. 前端

- `api.ts`: 單一作品的呼叫抽成 `workshopApi(base)`; `api.proportion` 用作品名組網址, `api.flows.workshop(flow, id)` 用節點網址
- `proportion/draw.ts` 的 `WorkAssets` 改成吃檔案網址函式
- `proportionPage.ts` 多一個嵌入模式(給節點用): 指定作品 API、隱藏作品列、對照列額外按鈕、用外部的狀態列與訊息區
- `flow/editors/workshopEditor.ts`: 建立/重建作品、嵌入部位工坊、設為輸出

## 6. 測試

- 後端: 節點作品建立(裁透明鋪白、記 inputRev)、重建、上游沒輸出 400、非 workshop 節點 400、共用路由可在節點作品上切部位與存版面(FakeFal)、刪節點連帶刪作品、部位工坊原路由不受影響(既有測試)
- 前端: 節點種類資訊(改部位要花錢、有輸入)
