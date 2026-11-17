@echo off
setlocal
cd /d "%~dp0"
echo REAL ACCOUNT MODE - orders can use real money.
echo Sign in to your intended real account inside MT5 first.
echo The runner starts paused. You must also confirm this account in the app.
set /p SCALP_REAL_ACCOUNT_LOGIN=Enter the exact MT5 real account number: 
if not defined SCALP_REAL_ACCOUNT_LOGIN exit /b 1
call start_windows.bat --robot --remote-control --account-mode real 
endlocal
