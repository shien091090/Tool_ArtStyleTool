# 美術風格探索工具

把一張有光影的成品圖拆成線稿、平塗、法線等分層, 再用五層 shader(色彩、光照、線條、特效、濾鏡)依「風格配方」即時重新渲染。用來探索並固定個人美術風格, 同一份配方可以套到任何拆解好的圖上。

設計細節見 [規格書](docs/superpowers/specs/2026-10-09-art-style-tool-design.md)。

## 安裝

需要 Python 3.12 以上與 Node.js 20 以上。

```bash
cd backend
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
cd ..\frontend
npm install
```

拆解要呼叫 fal.ai(深度圖、線稿), 需要設定環境變數 `FAL_KEY`。金鑰只在後端讀取, 不會送到瀏覽器。沒有金鑰時渲染頁照常可用, 也可以上傳自己的線稿、平塗圖、法線圖。

## 啟動

雙擊 `start.bat`, 會開兩個視窗(後端、前端)並打開瀏覽器 http://localhost:5173 。

手動啟動:

```bash
backend\.venv\Scripts\python -m uvicorn artstyle.server:app --host 127.0.0.1 --port 8765 --app-dir backend
cd frontend && npm run dev
```

## 使用流程

1. **拆解檢查**: 輸入名稱、選一張圖、按「建立」, 再按「全部拆解」(約一分鐘)。四格對照原圖、線稿、平塗、法線:
   - 線稿不理想 → 換模型重跑(預設 `teed`, 最能忽略陰影), 或上傳自己畫的線稿
   - 顏色漏到隔壁區塊 → 調大「補線縫」後按「重算區塊」
   - 某塊顏色不對 → 直接點平塗圖上的那一塊改色(重算區塊後會重新取色, 手動改的顏色會被蓋掉)
   - 勾「疊上線稿比對」檢查各層有沒有對齊
2. **渲染**: 選分層包, 右側面板調五層參數, 按住「按住看原圖」對照, 存成配方或匯出 PNG。
3. **對照網格**: 選一份配方, 同時套到所有分層包上並排比較。點縮圖會跳到渲染頁。

想讓多張圖色調統一, 色票請選「預設色票」或「自訂色票」; 「沿用原色」與「自動抽色」會跟著每張圖自己的顏色走。

## 資料夾

| 路徑 | 內容 |
|---|---|
| `data/packs/<名稱>/` | 分層包(不進版控) |
| `data/recipes/<名稱>.json` | 風格配方 |
| `backend/` | Python 後端與拆解演算法 |
| `frontend/` | 網頁介面與 WebGL 渲染 |

可以用環境變數 `ARTSTYLE_DATA` 改資料夾位置。

## 測試

```bash
backend\.venv\Scripts\python -m pytest backend
cd frontend && npm test && npm run typecheck
```

實際呼叫 fal.ai 的冒煙測試: `backend\.venv\Scripts\python backend\scripts\fal_smoke.py <圖片路徑>`
