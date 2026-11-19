@echo off
setlocal
chcp 65001 >nul
where node.exe >nul 2>&1
if errorlevel 1 (
    echo Node.js 22 or newer is required. Install it and add it to PATH.
    pause
    exit /b 1
)
node "%~dp0windows-launcher.mjs" start %*
if not errorlevel 1 exit /b 0
pause
exit /b 1
