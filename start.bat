@echo off
TITLE CINEGEN AI — Open Source Film Restoration Engine
echo ===============================================================
echo          CINEGEN AI — Launching Production Server              
echo ===============================================================
echo.

IF NOT EXIST ".env" (
    echo [Notice] .env file not found. Copying .env.example to .env ...
    copy .env.example .env
)

echo [1/2] Checking build artifacts ...
IF NOT EXIST ".next" (
    echo [Build] First-time setup detected. Running production build ...
    call npm run build
)

echo [2/2] Starting server at http://localhost:3000 ...
call npm run start
pause
