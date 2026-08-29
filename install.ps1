<#
.SYNOPSIS
  Installs ccbar - a sci-fi console bar for Claude Code.

.DESCRIPTION
  Copies ccbar into %USERPROFILE%\.claude\ccbar, puts a `cc` command on PATH,
  and registers the status line in ~/.claude/settings.json.

  Nothing outside those places is touched: no execution policy is changed, no
  PowerShell profile is written, and the only PATH entry added is ccbar's own
  bin directory.

.PARAMETER ShadowClaude
  Also install a `claude` shim, so plain `claude` starts with the bar. The shim
  falls through to the real claude.exe whenever the layout cannot apply.

.PARAMETER NoPathEdit
  Do not touch the user PATH. You will need to call the launcher by full path.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\install.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\install.ps1 -ShadowClaude
#>
[CmdletBinding()]
param(
  [switch]$ShadowClaude,
  [switch]$NoPathEdit
)

$ErrorActionPreference = 'Stop'

function Say($text, $color = 'Gray') { Write-Host $text -ForegroundColor $color }

$source = Split-Path -Parent $MyInvocation.MyCommand.Path
$prefix = Join-Path $HOME '.claude\ccbar'
$binDir = Join-Path $prefix 'bin'

Say ''
Say 'ccbar - sci-fi console bar for Claude Code' 'Cyan'
Say ''

# --- requirements ------------------------------------------------------------

$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $node) {
  Say 'Node.js is required (the bar and the status line are Node scripts).' 'Red'
  Say 'Install it from https://nodejs.org and run this again.' 'Red'
  exit 1
}
Say "node    : $($node.Source)"

$claude = Get-Command claude.exe -ErrorAction SilentlyContinue
if ($claude) { Say "claude  : $($claude.Source)" }
else { Say 'claude  : not found on PATH (install Claude Code first)' 'Yellow' }

$wt = Get-Command wt.exe -ErrorAction SilentlyContinue
if ($wt) { Say "wt      : $($wt.Source)" }
else { Say 'wt      : Windows Terminal not found - the bottom status line will work, the top bar will not' 'Yellow' }

# --- files -------------------------------------------------------------------

New-Item -ItemType Directory -Force -Path $prefix | Out-Null
New-Item -ItemType Directory -Force -Path $binDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $prefix 'state') | Out-Null

Copy-Item -Path (Join-Path $source 'src\*') -Destination $prefix -Force
Copy-Item -Path (Join-Path $source 'bin\cc.cmd') -Destination $binDir -Force
Copy-Item -Path (Join-Path $source 'bin\ccbar.cmd') -Destination $binDir -Force
Say ''
Say "installed to : $prefix"

if ($ShadowClaude) {
  Copy-Item -Path (Join-Path $source 'bin\claude.cmd') -Destination $binDir -Force
  Say 'commands     : cc, claude, ccbar'
} else {
  $stale = Join-Path $binDir 'claude.cmd'
  if (Test-Path -LiteralPath $stale) { Remove-Item -LiteralPath $stale -Force }
  Say 'commands     : cc, ccbar'
}

# --- PATH --------------------------------------------------------------------

if ($NoPathEdit) {
  Say "PATH         : left alone - call $binDir\cc.cmd directly" 'Yellow'
} else {
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $parts = @()
  if ($userPath) { $parts = @($userPath -split ';' | Where-Object { $_ -ne '' }) }
  if ($parts -contains $binDir) {
    Say 'PATH         : already contains ccbar\bin'
  } else {
    # prepended, so the optional `claude` shim is found before claude.exe
    $new = (@($binDir) + $parts) -join ';'
    [Environment]::SetEnvironmentVariable('Path', $new, 'User')
    Say 'PATH         : ccbar\bin added (new terminals only)'
  }
}

# --- status line -------------------------------------------------------------

Say ''
& $node.Source (Join-Path $prefix 'settings.js') install
if ($LASTEXITCODE -ne 0) {
  Say 'Could not update settings.json - see the message above.' 'Red'
  exit 1
}

# --- done --------------------------------------------------------------------

Say ''
Say 'Done. Open a NEW Windows Terminal tab and run:' 'Green'
if ($ShadowClaude) { Say '    claude        (or cc)' 'Green' } else { Say '    cc' 'Green' }
Say ''
Say 'The pane you type in becomes the bar at the top of the window and Claude'
Say 'Code opens below it. Anywhere the split cannot apply, the same console is'
Say 'drawn as the ordinary Claude Code status line instead.'
Say ''
Say 'Trouble? Run: powershell -ExecutionPolicy Bypass -File .\doctor.ps1' 'DarkGray'
Say ''
