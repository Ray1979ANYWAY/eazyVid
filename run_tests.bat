@echo off
rem eazyVid regression tests - ALWAYS run with local Python 3.10
rem (same interpreter as eazyvid.bat; never use sandbox python)
chcp 65001 >nul
"D:\Program Files\Python\Python310\python.exe" "%~dp0test_v2.py"
"D:\Program Files\Python\Python310\python.exe" "%~dp0smoke_v2.py"
echo.
echo === done ===
pause