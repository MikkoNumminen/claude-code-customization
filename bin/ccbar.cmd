@echo off
REM ccbar - (re)draws the bar in THIS pane, without starting a new session.
REM
REM Use it after updating ccbar: stop the old bar with Ctrl+C, then run this
REM to pick the new code up. The session in the pane below keeps running.
REM
REM   ccbar <token>   attach to that exact session (its CCBAR_ID)
REM   ccbar           attach to the freshest session on the machine
REM
REM Prefer the token form when more than one session is alive, so the bar
REM cannot adopt - and silence - another window's session.
if "%~1"=="" goto any
node "%USERPROFILE%\.claude\ccbar\topbar.js" --stop %1
exit /b %ERRORLEVEL%

:any
node "%USERPROFILE%\.claude\ccbar\topbar.js" --auto --attach any
exit /b %ERRORLEVEL%
