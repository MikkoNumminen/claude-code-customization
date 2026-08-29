<#
.SYNOPSIS
  ccbar end-to-end, by hand, in a real Windows Terminal window.

.DESCRIPTION
  The headless suite (node test/run.js) can prove the rules; it cannot prove
  the window. This can, because it runs inside one and splits it.

  Two phases:

    layout  a session starts in a pane below, ends, and the pane closes itself
            - the bar leaves with it and the window is one full-height
            terminal again.

    width   the bar's pane is halved under it while it draws. Node never
            reports a resize in a Windows Terminal pane, so the bar has to ask
            the console itself; if it does not, every row it draws is composed
            for a terminal that no longer exists.

  Nothing real is involved: Claude is stood in for by a sleep, and the state
  goes to a directory of its own, so an open session is never touched.

  Unlike the headless suite this one uses the real state directory. It has to:
  the pane below is created by Windows Terminal rather than as a child of this
  script, so it cannot inherit a CCBAR_STATE pointing somewhere else. It only
  ever writes under two tokens of its own, and takes them with it.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\test\e2e.ps1
#>
[CmdletBinding()]
param([int]$SessionSeconds = 6)

$ErrorActionPreference = 'Stop'

$repo   = Split-Path -Parent $PSScriptRoot
$src    = Join-Path $repo 'src'
$state  = Join-Path $HOME '.claude\ccbar\state'
$work   = Join-Path ([IO.Path]::GetTempPath()) ('ccbar-e2e-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$log    = Join-Path $work 'e2e.log'
$runner = Join-Path $work 'runner.ps1'

New-Item -ItemType Directory -Force -Path $work | Out-Null
New-Item -ItemType Directory -Force -Path $state | Out-Null

$results = @()
function Note($t) { Add-Content -LiteralPath $log -Value ('{0}  {1}' -f (Get-Date -Format 'HH:mm:ss.fff'), $t) }
function Check($name, $pass, $detail) {
  $script:results += [pscustomobject]@{ Name = $name; Pass = [bool]$pass; Detail = $detail }
  Note ('  {0}  {1}{2}' -f $(if ($pass) { 'PASS' } else { 'FAIL' }), $name, $(if ($detail) { "  ($detail)" } else { '' }))
}
function Cols { $Host.UI.RawUI.WindowSize.Width }
function Rows { $Host.UI.RawUI.WindowSize.Height }

if (-not $env:WT_SESSION) {
  Write-Host 'Run this inside a Windows Terminal window - there is nothing to split otherwise.' -ForegroundColor Yellow
  exit 2
}

# The runner is the shipped one with a single line replaced, so the markers,
# the pid, the stop in the finally and the missing -NoExit are all the real
# thing rather than a re-typed approximation.
$real = Get-Content -LiteralPath (Join-Path $src 'run-claude.ps1') -Raw
$call = '  if ($Rest -and $Rest.Count -gt 0) { & claude.exe @Rest } else { & claude.exe }'
if (-not $real.Contains($call)) {
  Write-Host 'run-claude.ps1 no longer has the line this test replaces - refusing to guess.' -ForegroundColor Red
  exit 2
}
Set-Content -LiteralPath $runner -Value $real.Replace(
  $call,
  ("  Write-Host 'e2e: standing in for a Claude session'; Start-Sleep -Seconds " + $SessionSeconds)
) -Encoding UTF8

Note ('state ' + $state)
Note ('start rows={0} cols={1}' -f (Rows), (Cols))

# ---------------------------------------------------------------- layout ----
Note 'layout'
$rowsAtStart = Rows
$token = 'e2e' + (Get-Random -Maximum 999999)
$size = [Math]::Round(1 - 3 / $rowsAtStart, 3)

& powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $src 'split.ps1') `
  -Window 0 -Size $size -Dir $repo -Runner $runner -Token $token

$deadline = (Get-Date).AddSeconds(8)
while (-not (Test-Path -LiteralPath (Join-Path $state "$token.started")) -and (Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 100
}
$started = Test-Path -LiteralPath (Join-Path $state "$token.started")
Check 'the pane below comes up' $started
if (-not $started) { Note 'RESULT  cannot continue'; Get-Content $log; exit 1 }

$panePid = [int](Get-Content -LiteralPath (Join-Path $state "$token.started") -Raw).Trim()
Check 'the pane records its pid, not an empty marker' ($panePid -gt 0) "pid=$panePid"

$t0 = Get-Date
& node (Join-Path $src 'topbar.js') --stop $token --name e2e
$barMs = [int]((Get-Date) - $t0).TotalMilliseconds

Start-Sleep -Milliseconds 1500
Check 'the bar leaves with its session, not minutes later' ($barMs -lt 12000) "${barMs}ms for a ${SessionSeconds}s session"
Check 'it waited for the session rather than quitting early' ($barMs -gt ($SessionSeconds * 1000 - 2000)) "${barMs}ms"
Check 'the pane below closed itself' (-not (Get-Process -Id $panePid -ErrorAction SilentlyContinue))
Check 'the window is one full-height pane again' ((Rows) -ge $rowsAtStart - 1) ('rows {0} -> {1}' -f $rowsAtStart, (Rows))
Check 'the session left no state behind' (-not (Get-ChildItem -LiteralPath $state -Filter "$token.*"))

# ----------------------------------------------------------------- width ----
Note 'width'
$wToken = 'e2ew' + (Get-Random -Maximum 999999)
$colsBefore = Cols
Start-Process -FilePath 'node' -ArgumentList @((Join-Path $src 'topbar.js'), '--stop', $wToken, '--name', 'e2e-width') -NoNewWindow
Start-Sleep -Seconds 2

$widthFile = Join-Path $state "$wToken.width"
$firstOk = Test-Path -LiteralPath $widthFile
Check 'the bar records the width it can see' $firstOk
$first = if ($firstOk) { (Get-Content -LiteralPath $widthFile -Raw | ConvertFrom-Json).cols } else { 0 }
Check 'and that width is the pane it is drawing in' ($first -eq $colsBefore) "recorded=$first pane=$colsBefore"

# Halve this pane under the bar. Called straight from PowerShell with plain
# tokens: nesting a quoted command inside -Command loses the quotes in 5.1, and
# wt then silently splits nothing, which reads as the bar having failed.
& wt.exe -w 0 split-pane --vertical --size 0.5 cmd.exe /c ping -n 7 127.0.0.1
Start-Sleep -Seconds 3

$after = (Get-Content -LiteralPath $widthFile -Raw | ConvertFrom-Json).cols
$truth = Cols
Check 'the pane really did get narrower' ($truth -lt $colsBefore) "$colsBefore -> $truth"
Check 'the bar noticed, with no resize event to tell it' ($after -eq $truth) "recorded=$after actual=$truth"

Set-Content -LiteralPath (Join-Path $state "$wToken.stop") -Value '' -Encoding ascii
Start-Sleep -Seconds 2
Check 'the width file goes when the bar does' (-not (Test-Path -LiteralPath $widthFile))

# ---------------------------------------------------------------- report ----
Start-Sleep -Seconds 4   # let the pane opened for the resize close on its own
$esc = [char]27          # PowerShell 5.1 has no `e escape
[Console]::Write("$esc[?25h$esc[?7h$esc[2J$esc[H")

$failed = @($results | Where-Object { -not $_.Pass }).Count
Note ('RESULT  {0}' -f $(if ($failed) { "$failed FAILING" } else { 'all good' }))

Write-Host ''
Get-Content -LiteralPath $log | ForEach-Object {
  $colour = if ($_ -match '  FAIL  ') { 'Red' } elseif ($_ -match '  PASS  ') { 'Green' } else { 'Gray' }
  Write-Host $_ -ForegroundColor $colour
}
Write-Host ''
Write-Host ('log: ' + $log) -ForegroundColor DarkGray
Write-Host ''
Remove-Item -LiteralPath $runner -Force -ErrorAction SilentlyContinue
exit $(if ($failed) { 1 } else { 0 })
