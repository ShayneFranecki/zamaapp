@echo off
echo ================================
echo  ZeroDrop Protocol Frontend
echo ================================
echo Starting local development server on port 3012...
echo.
echo Open your browser to:
echo http://localhost:3012
echo.
echo Press Ctrl+C to stop the server
echo.

cd /d "%~dp0public"
python server.py

pause