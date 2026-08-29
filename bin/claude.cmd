@echo off
REM ccbar - makes plain `claude` start with the bar at the top of the window.
REM
REM Installed only with `install.ps1 -ShadowClaude`. It works by sitting in a
REM directory placed ahead of claude.exe on PATH; `claude.exe` below still
REM resolves to the real binary, because the extension is explicit.
REM
REM The launcher falls through to claude.exe untouched whenever the layout
REM cannot apply: outside Windows Terminal, inside a Claude session, with
REM non-interactive flags (-p, --print, mcp, ...), or in a window too short.
where node.exe >nul 2>&1 || goto plain
node "%USERPROFILE%\.claude\ccbar\launch.js" %*
exit /b %ERRORLEVEL%

:plain
claude.exe %*
exit /b %ERRORLEVEL%
