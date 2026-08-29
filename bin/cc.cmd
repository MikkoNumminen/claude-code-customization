@echo off
REM ccbar - starts Claude Code with the sci-fi bar pinned to the top of the
REM Windows Terminal window.
REM
REM A .cmd shim rather than a PowerShell function on purpose: a fresh shell on
REM a default Windows install runs under the Restricted execution policy and
REM never loads a profile, so a profile-based wrapper would silently do nothing.
where node.exe >nul 2>&1 || goto plain
node "%USERPROFILE%\.claude\ccbar\launch.js" %*
exit /b %ERRORLEVEL%

:plain
claude.exe %*
exit /b %ERRORLEVEL%
