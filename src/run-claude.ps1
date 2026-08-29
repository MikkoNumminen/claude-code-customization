<#
  ccbar - runs Claude Code in the lower pane.

  The top pane attaches to this session on its own (it watches for the
  freshest published state), so nothing needs to be threaded through the
  environment. When Claude exits, the .stop marker tells the top pane to
  stand down; this shell stays open so the pane behaves like a normal
  terminal afterwards.
#>
param(
  [Parameter(Mandatory = $true)][string]$Token,
  [string]$Dir = $PWD.Path,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest
)

if ($Dir -and (Test-Path -LiteralPath $Dir)) { Set-Location -LiteralPath $Dir }

$stateDir = Join-Path $HOME '.claude\ccbar\state'
try {
  if (-not (Test-Path -LiteralPath $stateDir)) {
    New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
  }
} catch { }

# Tells the launcher this pane really came up. wt.exe's own exit code cannot
# carry that news - it hands the command to the existing window and can report
# failure while the split in fact succeeded - so this marker is the handshake.
try { Set-Content -LiteralPath (Join-Path $stateDir "$Token.started") -Value '' -Encoding ascii } catch { }

# Names this session for the bar above. Without it the pane would have to guess
# which session is "ours" from publishing timestamps, and with several sessions
# alive on the machine that guess lands on the wrong one.
$env:CCBAR_ID = $Token

try {
  if ($Rest -and $Rest.Count -gt 0) { & claude.exe @Rest } else { & claude.exe }
}
finally {
  try {
    Set-Content -LiteralPath (Join-Path $stateDir "$Token.stop") -Value '' -Encoding ascii
  } catch { }
}
