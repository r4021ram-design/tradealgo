@echo off
title KotakAlgo Control Launcher
echo ===================================================
echo   KotakAlgo Automated Trading System Launcher
echo ===================================================
echo.
echo [1/3] Starting FastAPI Backend Server on port 8000...
start "KotakAlgo Backend" /min cmd /c "python -m uvicorn kotak_algo.api:app --host 127.0.0.1 --port 8000"
timeout /t 3 /nobreak > nul

echo [2/3] Starting Vite Frontend Dashboard on port 5173...
start "KotakAlgo Frontend" /min cmd /c "cd dashboard && npm run dev"
timeout /t 2 /nobreak > nul

echo [3/3] Launching Dashboard in default web browser...
start http://localhost:5173/

echo.
echo ===================================================
echo   KotakAlgo services are running in the background!
echo   Close this window or press Ctrl+C to stop services.
echo ===================================================
pause
