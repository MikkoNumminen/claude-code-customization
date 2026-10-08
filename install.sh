#!/usr/bin/env sh
# ccbar - macOS / Linux install.
#
# Installs the status line only. The top bar is a Windows Terminal pane split
# and has no equivalent here, so on this platform ccbar draws the same console
# as Claude Code's ordinary status line, under the prompt.
#
#   ./install.sh [--refresh <seconds>]   how often the timer re-runs the line
#                                         (default 5; Claude Code allows 1 or more)
set -e

here=$(cd "$(dirname "$0")" && pwd)
prefix="$HOME/.claude/ccbar"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required (the status line is a Node script)." >&2
  echo "Install it from https://nodejs.org and run this again." >&2
  exit 1
fi

mkdir -p "$prefix/state"
cp "$here"/src/*.js "$prefix/"
echo "installed to : $prefix"

node "$prefix/settings.js" install "$@"

echo
echo "Done. Start a new Claude Code session to see the console under the prompt."
echo "The top bar needs Windows Terminal; on this platform the status line is it."
