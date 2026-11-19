@echo off
rem Porneste Outbreak Forge: un server local pentru folderul jocului + deschide browserul.
cd /d "%~dp0"
echo Outbreak Forge ruleaza la http://localhost:8000
echo Inchide fereastra asta ca sa opresti jocul.
start "" cmd /c "timeout /t 1 >nul & start http://localhost:8000"
"%LOCALAPPDATA%\Programs\Python\Python313\python.exe" -m http.server 8000 --bind 127.0.0.1
