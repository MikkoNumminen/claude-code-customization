# ccbar

A sci-fi console bar for [Claude Code](https://claude.com/claude-code): your project name
animated at the **top** of the Windows Terminal window, with a session-limit gauge under it.

![The ccbar top pane: the project name in a drifting cool gradient above a session-limit gauge reading 74 percent with a countdown](docs/topbar.png)

The pane you type `cc` in becomes a three-row bar at the top of the window, and Claude Code
opens beneath it. Where that split cannot apply, the same console is drawn as Claude Code's
ordinary status line instead, so a session is never left without a gauge.

## What it looks like

**The title** is one continuous gradient laid across the letters — ice, cyan, azure, violet,
magenta — never a random colour per letter. The gradient drifts slowly through the word while
a soft specular highlight glides across it, like a light bar travelling over chrome, over a
barely-there phosphor breath. The letters themselves never move.

**The gauge** uses a separate, warm language, because instrumentation should not look like
decoration: aqua → signal green → amber CRT → ember → alert red as the five-hour session
window drains. It fills in eighth-width blocks so the level glides instead of stepping,
darkens away from the leading edge for depth, and below ten percent it pulses on a smooth
sine. Cool title against a warm gauge: the frame idles calm until the meter starts to burn.

The top pane redraws at 20 fps and computes its animation locally, so it keeps breathing
while the session below is idle.

## Requirements

- [Claude Code](https://claude.com/claude-code)
- [Node.js](https://nodejs.org) (the bar and status line are dependency-free Node scripts)
- Windows Terminal — for the top bar. Without it you still get the status line.

## Install

```powershell
git clone https://github.com/MikkoNumminen/claude-code-customization.git
cd claude-code-customization
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

The `-ExecutionPolicy Bypass` is not a system change — it applies to that one PowerShell
process. A default Windows install runs scripts under `Restricted`, and without it the
installer would refuse to start.

Then open a **new** Windows Terminal tab and run:

```
cc
```

To make plain `claude` do the same thing, install with `-ShadowClaude`:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -ShadowClaude
```

That adds a `claude` shim ahead of `claude.exe` on PATH. It hands straight over to the real
binary whenever the layout cannot apply — outside Windows Terminal, inside an existing Claude
session, with non-interactive flags (`-p`, `--print`, `mcp`, …), or in a window under 16 rows.

Starting a session in a window that already has a live bar does not split again: Claude starts
in that pane and the bar above adopts the new session, so windows never collect a stack of
bars. A third command, `ccbar`, redraws the bar in the current pane without starting a
session — useful after updating ccbar, or if you stopped a bar with Ctrl+C.

### macOS / Linux

```sh
./install.sh
```

Status line only; the top bar is a Windows Terminal pane split with no equivalent here.

## What the installer touches

| Path | What |
| --- | --- |
| `~/.claude/ccbar/` | the scripts |
| `~/.claude/ccbar/bin/` | the `cc` and `ccbar` commands (and optional `claude` shim) |
| user `PATH` | that bin directory, prepended — skip with `-NoPathEdit` |
| `~/.claude/settings.json` | a `statusLine` entry, with a timestamped backup |

No execution policy is changed, no PowerShell profile is written, nothing else is modified.

## Uninstall

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
```

Removes the status line entry (only if it is ccbar's), the PATH entry and the install
directory.

## When the bar does not appear

```powershell
powershell -ExecutionPolicy Bypass -File .\doctor.ps1
```

Run it in the terminal where you would type `cc`. It checks every gate the launcher checks
and prints the verdict. The launcher also says its reason out loud in one grey line and
records it in `~/.claude/ccbar/state/launch.log`.

## How it works

```
cc.cmd ──> launch.js ──> split.ps1 ──> wt split-pane ──> run-claude.ps1 ──> claude
   (real console)  │                                          │ CCBAR_ID=<token>
                   └──> topbar.js  <── state/<token>.json <── statusline.js
```

- **launch.js** runs from a real console, so unlike anything Claude Code spawns it can see the
  terminal size. It splits the window, waits for the pane below to say it is up, then turns
  its own pane into the bar.
- **split.ps1** exists because `wt.exe` is a Windows App Execution Alias, and Node cannot
  launch it: from `node.exe` the stub returns exit 0 and does nothing at all — even
  `wt.exe --version` prints nothing. PowerShell resolves the alias correctly.
- **run-claude.ps1** names the session with `CCBAR_ID=<token>` and drops a `.started` marker
  carrying its own pid. `wt.exe`'s own exit code cannot be trusted for that handshake: it
  hands the command to the running window and may report failure for a split that worked.
  It runs without `-NoExit`: the pane exists for one session and closes with it.
- **statusline.js** is Claude Code's status-line command. It publishes the session's name and
  limit under that token, and stays silent while a bar holds a fresh `.claim` beside it, so
  the console lives in exactly one place. With no bar attached it draws the console itself,
  centred against a width the launcher and the bar record under that same token — never one
  file shared by the machine, or two windows of different widths take turns overwriting each
  other's reading and one of them ends up centred against a terminal that is not its own.
- **topbar.js** watches exactly its own token. Started by hand with no token it takes the
  session published from *its own directory* and skips sessions another bar already claims —
  never "the freshest session on the machine", which in a second window adopts a stranger,
  leaves the real session unclaimed (so it draws a second bar at the bottom) and shows the
  wrong numbers up top.

### The bar lives exactly as long as its session

A gauge left hovering over a finished session is furniture, so every way a session can end
has to reach the bar:

- **Claude exits.** `run-claude.ps1` leaves a `.stop` marker and then ends, which closes the
  pane it ran in. The bar sees the marker within 200ms and stands down. The window is a single
  full-height terminal again — the very shell you typed `cc` in, with its own history, at the
  prompt where you left it. Nothing has to be tidied up by hand.
- **The pane is closed or killed.** Then nothing gets to write a marker, so the bar also
  watches the pid that pane recorded in `.started`, and leaves when it is gone.
- **A session that borrowed the bar.** A pane whose shell still carries `CCBAR_ID` under a
  live bar runs Claude in place rather than stacking a second bar on the first — and that
  session leaves the `.stop` marker itself, because the runner that normally leaves it belongs
  to the session that opened the pane and finished long ago.

`CCBAR_ID` in a shell is not on its own proof of a bar: the launcher checks for a live claim
as well before reusing one, or a pane whose bar had gone could never get one back. And a
`claude` run from *inside* the session — `claude update` from a Bash tool, `!claude doctor`
at the prompt — is a sub-command of a session still going, not a session of its own. It
borrows nothing and marks nothing; the marker it used to leave took the bar down the moment
the update finished, while the session went on below.

### And not one second less

Those are the only endings. The bar does not stand down because the machine slept, because
the window was carried to another monitor, or because the session went quiet — all three
were reported as "the bar disappears and the console turns up at the bottom", and all three
were one rule: the bar judged its session dead when the state file looked two minutes old.
A clock that has jumped forward over a sleep makes every file look hours old at once, so the
bar quit in its first frame back, and its cleanup took the claim with it, so the session's
status line drew the console at the bottom of the window from then on.

Now a session that has a runner is judged by that runner's pid and its `.stop` marker, and by
nothing else. The age rule survives only for sessions nobody left a marker for — one keyed by
Claude's own session id and attached to by hand — and it counts *frames the bar has drawn*
since the file last changed, never the wall clock: a sleeping machine draws no frames, so it
comes back with the count where it left it.

The status line gets the same treatment from the other side. The bar's `.claim` carries its
pid, and a claim counts as live if it was touched in the last few seconds **or** its pid is
running and touches the file again within the second — because the first status line after a
wake tends to run before the bar's first frame back, when its mtime alone says "no bar". A
pid that is running but never touches the file is a stranger who inherited the number, and
does not count. On waking, the bar also renews its claim, re-measures its pane and redraws
from empty before anything else, since the pane may be a different size on a different
screen.

Every exit the bar makes is logged with its reason in `state/launch.log`, so a bar that is
gone can say why.

A session that dies in its first ten seconds is the one exception to the pane closing: that
is a startup failure, and a pane that vanishes takes the reason with it, so it is held open
until the message has been read.

Not every ending gets to tidy up — a window closed from its X takes its bar down with no
chance to run — so the launcher sweeps the state directory when it starts a session. A token
whose files were written in the last half hour, or whose pane is still running, is left alone;
anything else belonged to a session that is over. Without it the directory only grows, which
is how one reached fifty files.

## Tests

```
node test/run.js
```

No dependencies and nothing to install. Every suite runs against `src/` in a state directory
of its own, handed over through `CCBAR_STATE`, so a run cannot disturb a session you have
open. Covered: the composition fits every width from 20 to 200 columns, at two rows and at
one; the bar leaves with its session and takes its files with it; it survives a sleep —
every file aged hours back under running processes — and so does the status line's respect
for its claim; the status line always ends, even when nobody closes its stdin; two windows
never read each other's width; the sweep clears finished sessions and nothing else.

What that cannot cover is the window itself. For the pane really closing, the layout really
collapsing, and the bar really following a pane that is resized under it, there is an
end-to-end run — by hand, from inside a Windows Terminal window:

```
powershell -ExecutionPolicy Bypass -File .\test\e2e.ps1
```

It splits the window you run it in, stands in for Claude with a sleep, and reports. Nothing
real is involved and it takes about twenty seconds.

### Every row fits the window

A line one column too long wraps, and a wrapped line pushes the three-row composition out of
shape — which is what a narrow window used to do. Both rows now take a hard column budget and
give things up in order rather than overflowing: the gauge narrows, then the countdown goes,
then the `SESSION` label, and the title drops its letter-spacing before truncating with an
ellipsis. The reading itself is never dropped. Checked from 24 to 200 columns.

The budget is only as good as the width behind it, and that width is not simply available.
**Node never reports a resize in a Windows Terminal pane.** Splitting a 120-column window
leaves `process.stdout.columns` still answering 120 for a pane that is now 58 wide, with no
`resize` event at all — so every row goes on being composed for a terminal that no longer
exists: too long for a window that has been narrowed, which wraps and scrolls the whole
composition off the top, and too short for one that has been widened, which leaves it sitting
left of centre. Both were reported from the same install, an hour apart, and they are the
same bug.

So the bar asks the console itself, every frame, rather than trusting the cached reading.
And autowrap is turned off in the pane for as long as the bar owns it: a row that somehow
still comes out too long is then clipped at the right edge instead of wrapping, so the worst
a wrong reading can do is look cropped for one frame.

### The height it is given

At the start the bar takes the least it can. Reserving three rows produces a two-row pane —
Windows Terminal spends one on the border — which is exactly the composition; reserving two
produces a single row, which is not enough for it. Both measured, not guessed.

After that the height is not ccbar's to decide. Windows Terminal scales panes with the
window, so making a window twice as tall makes the bar's pane twice as tall with it, and
there is no resize verb in the `wt` command line to put it back: `resize-pane` does nothing,
in a split window as much as anywhere else. `alt+shift+up` in the bar's own pane does it by
hand, and a fresh `cc` starts from two rows again.

It goes the other way too. Two rows of a seventy-row window become one when that window
lands on a monitor with thirty — which, on a laptop that moves between docks, is every day.
Two rows drawn into one scroll the title straight out of the pane and leave half a gauge, so
on a single row the title and the gauge share it: the gauge gives up its trimmings first and
the title never gives up the row. Checked at every width, at two rows and at one.

What ccbar can do is make sure those extra rows are empty. The bar draws on the **alternate
screen**, the one every full-screen program takes, so its pane has no scrollback: nothing to
scroll through, nothing for a resize to reflow, and none of the shell's history left
underneath to surface. On top of that every frame erases from the end of the composition to
the end of the pane. Before both, rows the composition never reached kept whatever the reflow
had left in them — fragments of an older, wider gauge, appearing and disappearing as the
window was dragged about.

Leaving the alternate screen puts the shell's own screen back exactly as it was, so the pane
the bar hands back still has the history it started with.

### Built to survive Claude Code updates

Only the documented `statusLine` command contract is used: JSON on stdin, text on stdout.
Every field is probed under several plausible names — `rate_limits.five_hour.used_percentage`,
then `utilization`, then `remaining_percentage` — and falls back to the context window when a
plan limit is unavailable (API key, Bedrock, Vertex). Nothing throws; the worst case prints
the bare project name.

### One known limitation

A status-line command is spawned with no console, no `COLUMNS`, and no terminal size in its
payload, so it cannot know where the middle of the line is. The top pane can, and centres
there; the bottom status line centres only once something that *can* see the terminal has
recorded the width (the launcher does this on every start). Until then it draws flush left,
deliberately — a guessed centre looks broken, a left edge looks intended.

## License

MIT
