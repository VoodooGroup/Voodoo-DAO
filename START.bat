@echo off
setlocal
cd /d "%~dp0"
set PORT=8787

echo.
echo  VoodooDAO Governance
echo  http://localhost:%PORT%
echo.

where node >nul 2>&1
if %ERRORLEVEL%==0 (
  start "" "http://localhost:%PORT%"
  node server.js
  goto :eof
)

where python >nul 2>&1
if %ERRORLEVEL%==0 (
  start "" "http://localhost:%PORT%"
  python -m http.server %PORT%
  goto :eof
)

where py >nul 2>&1
if %ERRORLEVEL%==0 (
  start "" "http://localhost:%PORT%"
  py -m http.server %PORT%
  goto :eof
)

echo Install Node.js or Python, then run again.
echo Or: npm start
pause
