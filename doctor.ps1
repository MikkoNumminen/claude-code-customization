<#
.SYNOPSIS
  Reports why the ccbar top bar is or is not going to appear.

.DESCRIPTION
  Run this in the terminal where you would type `cc`. It checks every gate the
  launcher checks, plus the pieces of the install, and prints a verdict.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\doctor.ps1
#>
[CmdletBinding()]
param()

function Row($label, $value, $color = 'Gray') {
  Write-Host ("{0,-18}: " -f $label) -NoNewline
  Write-Host $value -ForegroundColor $color
}

$prefix = Join-Path $HOME '.claude\ccbar'
$binDir = Join-Path $prefix 'bin'
$state = Join-Path $prefix 'state'

Write-Host ''
Write-Host 'ccbar doctor' -ForegroundColor Cyan
Write-Host ''

Row 'install dir' $(if (Test-Path -LiteralPath $prefix) { $prefix } else { 'MISSING - run install.ps1' })
Row 'launcher' $(if (Test-Path -LiteralPath (Join-Path $prefix 'launch.js')) { 'launch.js present' } else { 'MISSING' })
Row 'cc on PATH' $((Get-Command cc -ErrorAction SilentlyContinue).Source)
$claudeCmd = Get-Command claude -ErrorAction SilentlyContinue
Row 'claude resolves' "$($claudeCmd.CommandType) $($claudeCmd.Source)"
Row 'node' $((Get-Command node.exe -ErrorAction SilentlyContinue).Source)
Row 'wt' $((Get-Command wt.exe -ErrorAction SilentlyContinue).Source)

$console = 'unavailable (this shell has no real console)'
try { $console = '{0} x {1}' -f [System.Console]::WindowWidth, [System.Console]::WindowHeight } catch { }
Row 'console size' $console

Row 'WT_SESSION' $(if ($env:WT_SESSION) { 'set - inside Windows Terminal' } else { 'NOT set - top bar cannot apply here' })
Row 'CLAUDECODE' $(if ($env:CLAUDECODE) { 'set - this is a shell inside Claude; the launcher will pass through' } else { 'not set' })

$settings = Join-Path $HOME '.claude\settings.json'
$statusLine = 'not configured'
if (Test-Path -LiteralPath $settings) {
  try {
    $json = Get-Content -LiteralPath $settings -Raw | ConvertFrom-Json
    if ($json.statusLine) { $statusLine = $json.statusLine.command }
  } catch { $statusLine = 'settings.json is not valid JSON' }
}
Row 'statusLine' $statusLine

# --- verdict -----------------------------------------------------------------

$rows = 0
try { $rows = [System.Console]::WindowHeight } catch { }
$blocker = $null
if (-not (Test-Path -LiteralPath (Join-Path $prefix 'launch.js'))) { $blocker = 'ccbar is not installed' }
elseif (-not $env:WT_SESSION) { $blocker = 'not running inside Windows Terminal' }
elseif ($env:CLAUDECODE) { $blocker = 'this shell lives inside a Claude Code session' }
elseif (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { $blocker = 'node.exe not on PATH' }
elseif (-not (Get-Command wt.exe -ErrorAction SilentlyContinue)) { $blocker = 'wt.exe not on PATH' }
elseif ($rows -gt 0 -and $rows -lt 16) { $blocker = "window is only $rows rows tall" }

Write-Host ''
if ($blocker) {
  Write-Host "Top bar will NOT appear here: $blocker" -ForegroundColor Yellow
  Write-Host 'The status line at the bottom still draws the same console.' -ForegroundColor DarkGray
} else {
  Write-Host 'Everything the launcher needs is in place - `cc` should split this window.' -ForegroundColor Green
}

$log = Join-Path $state 'launch.log'
if (Test-Path -LiteralPath $log) {
  Write-Host ''
  Write-Host 'last launcher entries:' -ForegroundColor DarkGray
  Get-Content -LiteralPath $log -Tail 6 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
}
Write-Host ''
