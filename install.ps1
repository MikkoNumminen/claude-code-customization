<#
.SYNOPSIS
  Installs ccbar - a sci-fi console bar for Claude Code.

.DESCRIPTION
  Copies ccbar into %USERPROFILE%\.claude\ccbar and puts a `cc` command on
  PATH. What draws the figures is the -Mode:

    Band        (default) the ccbar-band mod: one row above the prompt that
                Claude Code places itself. Installed as a plugin from the
                folder marketplace in %USERPROFILE%\.claude\ccbar, which
                enables it in ~/.claude/settings.json (enabledPlugins). The
                launcher's top bar stays off and ccbar's status line is taken
                out, since the band shows the same figures.
    StatusLine  the bottom status line alone, for a Claude Code too old to
                load the band. The top bar stays off.
    TopBar      the retired top-edge bar: `cc` splits the Windows Terminal
                window again, with the status line as its fallback.

  Nothing outside those places is touched: no execution policy is changed, no
  PowerShell profile is written, and the only PATH entry added is ccbar's own
  bin directory.

.PARAMETER Mode
  Band (default), StatusLine or TopBar, as above.

.PARAMETER ShadowClaude
  Also install a `claude` shim, so plain `claude` goes through the launcher.
  Only worth it with -Mode TopBar; the shim falls through to the real
  claude.exe whenever the layout cannot apply.

.PARAMETER NoPathEdit
  Do not touch the user PATH. You will need to call the launcher by full path.

.PARAMETER RefreshInterval
  How often, in seconds, Claude Code re-runs the status line on a timer, on
  top of its own event-driven runs. Default 5; Claude Code allows no less
  than 1. Left out, a value from an earlier install is kept. Not used by the
  band, which runs on no timer.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\install.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\install.ps1 -Mode TopBar -ShadowClaude
#>
[CmdletBinding()]
param(
  [ValidateSet('Band', 'StatusLine', 'TopBar')]
  [string]$Mode = 'Band',
  [switch]$ShadowClaude,
  [switch]$NoPathEdit,
  [int]$RefreshInterval = 0
)

$ErrorActionPreference = 'Stop'

function Say($text, $color = 'Gray') { Write-Host $text -ForegroundColor $color }

# claude's own output as text, stderr included. Under 'Stop', Windows
# PowerShell turns a native command's stderr into a terminating error.
function ClaudeText([string[]]$argv) {
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { (& $claude.Source @argv 2>&1 | Out-String) } finally { $ErrorActionPreference = $old }
}
function BandInstalled { (ClaudeText @('plugin', 'list', '--json')).Contains($pluginId) }

$source = Split-Path -Parent $MyInvocation.MyCommand.Path
$prefix = Join-Path $HOME '.claude\ccbar'
$binDir = Join-Path $prefix 'bin'
$stateDir = Join-Path $prefix 'state'
$topBarOff = Join-Path $stateDir 'topbar.off'
$pluginId = 'ccbar-band@ccbar'

Say ''
Say 'ccbar - sci-fi console bar for Claude Code' 'Cyan'
Say ''

# --- requirements ------------------------------------------------------------

$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $node) {
  Say 'Node.js is required (the launcher and the status line are Node scripts).' 'Red'
  Say 'Install it from https://nodejs.org and run this again.' 'Red'
  exit 1
}
Say "node    : $($node.Source)"

# claude.exe by its extension: a `claude` shim from -ShadowClaude is ours
$claude = Get-Command claude.exe -ErrorAction SilentlyContinue
if ($claude) { Say "claude  : $($claude.Source)" }
else { Say 'claude  : not found on PATH (install Claude Code first)' 'Yellow' }

if ($Mode -eq 'TopBar') {
  $wt = Get-Command wt.exe -ErrorAction SilentlyContinue
  if ($wt) { Say "wt      : $($wt.Source)" }
  else { Say 'wt      : Windows Terminal not found - the bottom status line will work, the top bar will not' 'Yellow' }
}
Say "mode    : $Mode"

# --- files -------------------------------------------------------------------

New-Item -ItemType Directory -Force -Path $prefix | Out-Null
New-Item -ItemType Directory -Force -Path $binDir | Out-Null
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null

Copy-Item -Path (Join-Path $source 'src\*') -Destination $prefix -Force
Copy-Item -Path (Join-Path $source 'bin\cc.cmd') -Destination $binDir -Force
Copy-Item -Path (Join-Path $source 'bin\ccbar.cmd') -Destination $binDir -Force

# The mod and the marketplace that lists it, laid out as in the repository, so
# the install below reads the plugin from this folder and a reinstall is all
# an update takes. The types Claude Code lays beside a mod are its own.
$pluginDest = Join-Path $prefix 'plugins\ccbar-band'
if (Test-Path -LiteralPath $pluginDest) { Remove-Item -LiteralPath $pluginDest -Recurse -Force }
New-Item -ItemType Directory -Force -Path (Join-Path $prefix 'plugins') | Out-Null
Copy-Item -Path (Join-Path $source 'plugins\ccbar-band') -Destination $pluginDest -Recurse -Force
$laidTypes = Join-Path $pluginDest '.claude-plugin\types'
if (Test-Path -LiteralPath $laidTypes) { Remove-Item -LiteralPath $laidTypes -Recurse -Force }
New-Item -ItemType Directory -Force -Path (Join-Path $prefix '.claude-plugin') | Out-Null
Copy-Item -Path (Join-Path $source '.claude-plugin\marketplace.json') -Destination (Join-Path $prefix '.claude-plugin') -Force

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

# --- top bar -----------------------------------------------------------------

if ($Mode -eq 'TopBar') {
  if (Test-Path -LiteralPath $topBarOff) { Remove-Item -LiteralPath $topBarOff -Force }
  Say 'top bar      : on - `cc` splits the window'
} else {
  Set-Content -LiteralPath $topBarOff -Value "set by install.ps1 -Mode $Mode" -Encoding ascii
  Say 'top bar      : off - `cc` starts plain Claude Code'
}

# --- band --------------------------------------------------------------------

Say ''
if ($Mode -eq 'Band') {
  if (-not $claude) {
    Say 'Could not install the band: claude.exe is not on PATH. Once it is, run:' 'Red'
    Say "    claude plugin install ccbar-band --marketplace `"$prefix`" --scope user" 'Red'
    exit 1
  }
  # adds the folder as the `ccbar` marketplace (user settings) if it is not
  # yet, then installs and enables ccbar-band from it
  $said = ClaudeText @('plugin', 'install', 'ccbar-band', '--marketplace', $prefix, '--scope', 'user')
  if ($LASTEXITCODE -eq 0) {
    Say "plugin       : $pluginId installed and enabled (user scope)"
  } elseif (BandInstalled) {
    # an earlier install left it there; it may have been disabled since
    ClaudeText @('plugin', 'enable', $pluginId, '--scope', 'user') | Out-Null
    Say "plugin       : $pluginId already installed, enabled"
  } else {
    Say $said.Trim() 'Red'
    Say 'Could not install the band - see the message above.' 'Red'
    exit 1
  }
} elseif ($claude -and (BandInstalled)) {
  # the band and a bottom or top bar would draw the same figures twice
  ClaudeText @('plugin', 'uninstall', $pluginId, '--scope', 'user') | Out-Null
  Say "plugin       : $pluginId uninstalled"
}

# --- status line -------------------------------------------------------------

Say ''
if ($Mode -eq 'Band') {
  & $node.Source (Join-Path $prefix 'settings.js') uninstall
} else {
  $settingsArgs = @((Join-Path $prefix 'settings.js'), 'install')
  if ($RefreshInterval -gt 0) { $settingsArgs += @('--refresh', "$RefreshInterval") }
  & $node.Source @settingsArgs
}
if ($LASTEXITCODE -ne 0) {
  Say 'Could not update settings.json - see the message above.' 'Red'
  exit 1
}

# --- done --------------------------------------------------------------------

Say ''
if ($Mode -eq 'Band') {
  Say 'Done. Start Claude Code as usual (`claude`, or `cc`).' 'Green'
  Say ''
  Say 'The band shows above the prompt once the session has its first figures:'
  Say 'model, session and weekly limits with their resets, context, git branch.'
  Say 'A session that is already running picks it up after /reload-plugins.'
} elseif ($Mode -eq 'StatusLine') {
  Say 'Done. Start Claude Code as usual; the console is its bottom status line.' 'Green'
} else {
  Say 'Done. Open a NEW Windows Terminal tab and run:' 'Green'
  if ($ShadowClaude) { Say '    claude        (or cc)' 'Green' } else { Say '    cc' 'Green' }
  Say ''
  Say 'The pane you type in becomes the bar at the top of the window and Claude'
  Say 'Code opens below it. Anywhere the split cannot apply, the same console is'
  Say 'drawn as the ordinary Claude Code status line instead.'
}
Say ''
Say 'Trouble? Run: powershell -ExecutionPolicy Bypass -File .\doctor.ps1' 'DarkGray'
Say ''
