@echo off
rem Start ArtStyleTool: backend (127.0.0.1:8765) and frontend (http://localhost:5173) in two windows.
rem Keep this file ASCII with CRLF line endings: cmd.exe misreads UTF-8 text with LF endings.
cd /d "%~dp0"
if not exist "backend\.venv\Scripts\python.exe" (
  echo [ERROR] backend\.venv not found. See README to set up the Python environment.
  pause
  exit /b 1
)
if "%FAL_KEY%"=="" echo [WARN] FAL_KEY is not set. AI steps (depth, line art, de-lighting) will not work.
start "ArtStyleTool backend" /d "%~dp0" cmd /k backend\.venv\Scripts\python -m uvicorn artstyle.server:app --host 127.0.0.1 --port 8765 --app-dir backend
start "ArtStyleTool frontend" /d "%~dp0frontend" cmd /k npm run dev
timeout /t 4 >nul
start "" http://localhost:5173/
