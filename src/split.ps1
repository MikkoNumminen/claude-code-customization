<#
  ccbar - performs the window split.

  This exists because wt.exe is a Windows App Execution Alias, and Node cannot
  launch it: spawned from node.exe the stub returns exit 0 and does nothing
  (even `wt.exe --version` prints nothing, and the alias path itself reads as
  ENOENT). PowerShell resolves the alias correctly, so the launcher delegates
  the one wt call here and keeps the rest in Node.
#>
param(
  [Parameter(Mandatory = $true)][string]$Window,
  [Parameter(Mandatory = $true)][string]$Size,
  [Parameter(Mandatory = $true)][string]$Dir,
  [Parameter(Mandatory = $true)][string]$Runner,
  [Parameter(Mandatory = $true)][string]$Token,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest
)

$wtArgs = @(
  '-w', $Window, 'split-pane', '--horizontal', '--size', $Size, '-d', $Dir,
  'powershell.exe', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-NoExit',
  '-File', $Runner, '-Token', $Token, '-Dir', $Dir
)
if ($Rest -and $Rest.Count -gt 0) { $wtArgs += '-Rest'; $wtArgs += $Rest }

& wt.exe @wtArgs
exit $LASTEXITCODE
