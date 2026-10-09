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

1. **拆解檢查**: 輸入名稱、選一張圖、按「建立」, 再按「全部拆解」(約一分鐘, 會呼叫 fal.ai 的深度、線稿、去光影)。五格對照原圖、線稿、平塗、法線、AI 去光影:
   - 平塗預設「依顏色切」, 從 AI 去光影的圖取色; 太碎就調少「色數」, 太粗就調多
   - 線條乾淨、明暗少的圖可改「依線稿切」, 搭配「合併相近色」
   - AI 去光影改變了構圖或顏色 → 「取色」改成原圖
   - 某塊顏色不對 → 直接點平塗圖上的那一塊改色(重算區塊後會重新取色, 手動改的顏色會被蓋掉)
   - 法線格可以切換看大形(深度)或細部(原圖明暗)
   - 勾「疊上線稿比對」檢查各層有沒有對齊
   - 舊的分層包按「全部拆解」會補算新圖層(細部法線、去光影、環境遮蔽、主體剪影)
2. **渲染**: 選分層包, 右側面板分色彩、光照、線條、質感、濾鏡、調色六層調參數(只會顯示調了有效果的項目), 按住「按住看原圖」對照, 存成配方或匯出 PNG。
3. **對照網格**: 選一份配方, 同時套到所有分層包上並排比較。點縮圖會跳到渲染頁。

### 風格起始配方

配方選單的「起始配方」有六份內建配方: 漫畫網點、水彩、像素、木刻版畫、賽璐璐、復古印刷。選了之後可以照常調整, 存檔時要另存新名稱(起始配方不能覆蓋)。

### 自訂色票

色票選「自訂色票」後可以點色塊改色、`+`/`×` 增刪、貼 Lospec 網址或色碼(有無 `#` 都行, 下載的 .hex 檔可整份貼上)、或從參考圖吸色。漸層映射的色帶也用同一個編輯器(2~6 色)。

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
