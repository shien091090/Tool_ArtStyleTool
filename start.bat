@echo off
chcp 65001 >nul
rem 啟動美術風格探索工具: 後端(127.0.0.1:8765)與前端(http://localhost:5173)各開一個視窗
cd /d "%~dp0"
if "%FAL_KEY%"=="" echo [提醒] 沒有設定 FAL_KEY 環境變數, 拆解時的 AI 步驟(法線、線稿)會無法執行
start "ArtStyleTool backend" cmd /k "backend\.venv\Scripts\python -m uvicorn artstyle.server:app --host 127.0.0.1 --port 8765 --app-dir backend"
start "ArtStyleTool frontend" cmd /k "cd frontend && npm run dev"
timeout /t 3 >nul
start "" http://localhost:5173/
