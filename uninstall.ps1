<#
.SYNOPSIS
  Removes ccbar.

.DESCRIPTION
  Takes the status line out of ~/.claude/settings.json (only if it is ccbar's),
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
