@echo off
setlocal
cd /d "%~dp0"
set "PREVIEW_PORT=8766"
for %%P in (8766 8767 8768 8769 8770) do (
  powershell -NoProfile -Command "if(Get-NetTCPConnection -LocalPort %%P -State Listen -ErrorAction SilentlyContinue){exit 1}else{exit 0}" >nul 2>&1
  if not errorlevel 1 (set "PREVIEW_PORT=%%P" & goto port_found)
)
:port_found
start "Platformer Preview Server" /min python -m http.server %PREVIEW_PORT% --directory "%~dp0public"
powershell -NoProfile -Command "Start-Sleep -Seconds 2"
start "Platformer Preview" "http://127.0.0.1:%PREVIEW_PORT%/platformer.html"
endlocal
