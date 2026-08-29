<#
  ccbar - runs Claude Code in the lower pane.

  The pane exists for one session and closes with it. Claude runs here; when it
  returns, the .stop marker tells the bar above to stand down and this shell
  ends, which closes the pane and gives the window back to the shell the user
  started from - full height, its own history, no leftover furniture.

  The one exception is a session that dies in its first seconds: that is a
  startup failure, and a pane that vanishes takes the reason with it, so the
  pane is held open until the message has been read.
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
#
# It carries this shell's pid, which is also how the bar notices a pane that is
# closed or killed outright and never reaches the .stop below.
try { Set-Content -LiteralPath (Join-Path $stateDir "$Token.started") -Value $PID -Encoding ascii } catch { }

# Names this session for the bar above. Without it the pane would have to guess
# which session is "ours" from publishing timestamps, and with several sessions
# alive on the machine that guess lands on the wrong one.
$env:CCBAR_ID = $Token

$startedAt = Get-Date
$code = 0
try {
  $global:LASTEXITCODE = 0
  if ($Rest -and $Rest.Count -gt 0) { & claude.exe @Rest } else { & claude.exe }
  if ($null -ne $LASTEXITCODE) { $code = $LASTEXITCODE }
} catch {
  # claude.exe missing from PATH, or refused to start at all
  Write-Host $_.Exception.Message -ForegroundColor Red
  $code = 1
} finally {
  try {
    Set-Content -LiteralPath (Join-Path $stateDir "$Token.stop") -Value '' -Encoding ascii
  } catch { }
}

if ($code -ne 0 -and ((Get-Date) - $startedAt).TotalSeconds -lt 10) {
  Write-Host ''
  Write-Host "ccbar: claude exited with code $code" -ForegroundColor Yellow
  $null = Read-Host 'press Enter to close this pane'
}

exit $code
