<#
.SYNOPSIS
  Removes ccbar.

.DESCRIPTION
  Uninstalls the ccbar-band plugin and its `ccbar` marketplace, takes the
  status line out of ~/.claude/settings.json (only if it is ccbar's),
  removes ccbar's bin directory from the user PATH, and deletes
  %USERPROFILE%\.claude\ccbar. Nothing else was ever changed, so nothing else
  needs undoing.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
#>
[CmdletBinding()]
param([switch]$KeepFiles)

$ErrorActionPreference = 'Stop'

function Say($text, $color = 'Gray') { Write-Host $text -ForegroundColor $color }

$prefix = Join-Path $HOME '.claude\ccbar'
$binDir = Join-Path $prefix 'bin'

Say ''
Say 'Removing ccbar' 'Cyan'
Say ''

$node = Get-Command node.exe -ErrorAction SilentlyContinue
$settingsScript = Join-Path $prefix 'settings.js'
if ($node -and (Test-Path -LiteralPath $settingsScript)) {
  & $node.Source $settingsScript uninstall
} else {
  Say 'Could not run the settings step - remove the "statusLine" block from' 'Yellow'
  Say '~/.claude/settings.json by hand.' 'Yellow'
}

$claude = Get-Command claude.exe -ErrorAction SilentlyContinue
if ($claude) {
  # Windows PowerShell under 'Stop' turns a native command's stderr into an error
  $ErrorActionPreference = 'Continue'
  $listed = (& $claude.Source plugin list --json 2>&1 | Out-String).Contains('ccbar-band@ccbar')
  if ($listed) {
    & $claude.Source plugin uninstall ccbar-band@ccbar --scope user 2>&1 | Out-Null
    Say 'plugin: ccbar-band uninstalled'
  } else {
    Say 'plugin: ccbar-band not installed'
  }
  $markets = (& $claude.Source plugin marketplace list 2>&1 | Out-String)
  if ($markets -match '(?m)^\W*ccbar\b') {
    & $claude.Source plugin marketplace remove ccbar 2>&1 | Out-Null
    Say 'marketplace: ccbar removed'
  }
  $ErrorActionPreference = 'Stop'
} else {
  Say 'claude.exe not on PATH - if the band was installed, run:' 'Yellow'
  Say '  claude plugin uninstall ccbar-band@ccbar; claude plugin marketplace remove ccbar' 'Yellow'
}

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($userPath) {
  $parts = @($userPath -split ';' | Where-Object { $_ -ne '' -and $_ -ne $binDir })
  if ($parts.Count -ne @($userPath -split ';' | Where-Object { $_ -ne '' }).Count) {
    [Environment]::SetEnvironmentVariable('Path', ($parts -join ';'), 'User')
    Say 'PATH: ccbar\bin removed (new terminals only)'
  } else {
    Say 'PATH: no ccbar entry found'
  }
}

if ($KeepFiles) {
  Say "files: kept at $prefix"
} elseif (Test-Path -LiteralPath $prefix) {
  Remove-Item -LiteralPath $prefix -Recurse -Force
  Say "files: $prefix deleted"
} else {
  Say 'files: nothing to delete'
}

Say ''
Say 'ccbar removed.' 'Green'
Say ''
