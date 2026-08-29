#!/usr/bin/env node
'use strict';
/*
 * ccbar - launcher.
 *
 * Started from a real console (via cc.cmd), so unlike anything Claude Code
 * spawns it can actually see the terminal. It splits the current Windows
 * Terminal window, starts Claude Code in the new pane below, and then turns
 * the pane it was launched from into the top bar.
 *
 * Deliberately not a PowerShell function: a fresh shell on a default Windows
 * install runs under the Restricted execution policy and never loads a
 * profile, so a .ps1-based wrapper silently does nothing. A .cmd shim calling
 * node has no such gate, and the one PowerShell script involved is invoked
 * with -ExecutionPolicy Bypass on its own command line.
 *
 * Any obstacle degrades to plain `claude`, out loud.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const CCBAR = path.join(os.homedir(), '.claude', 'ccbar');
const STATE_DIR = path.join(CCBAR, 'state');
const ARGS = process.argv.slice(2);

/* A short trail, so a bar that refuses to appear can be diagnosed after the
   fact instead of being guessed at. */
function log(text) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.appendFileSync(
      path.join(STATE_DIR, 'launch.log'),
      new Date().toISOString() + '  ' + text + '\n'
    );
  } catch (_) {}
}

const NON_INTERACTIVE =
  /^(-p|--print|--version|-v|--help|-h|mcp|setup-token|install|update|doctor|config|plugin|agents)$/;

function runPlain(note, plainNote) {
  const line = plainNote || (note ? 'ccbar: top bar off - ' + note : '');
  if (line) process.stderr.write('\x1b[90m' + line + '\x1b[0m\n');
  const r = spawnSync('claude.exe', ARGS, { stdio: 'inherit' });
  process.exit(typeof r.status === 'number' ? r.status : 0);
}

function blocker() {
  if (!process.env.WT_SESSION) return 'not running inside Windows Terminal';
  if (process.env.CLAUDECODE) return 'called from inside a Claude Code session';
  if (!process.stdout.isTTY) return 'no terminal attached';
  for (const a of ARGS) if (NON_INTERACTIVE.test(a)) return "non-interactive argument '" + a + "'";
  const rows = process.stdout.rows || 0;
  if (rows < 16) return 'window only ' + rows + ' rows tall';
  return null;
}

/* The status line is spawned without a console and cannot measure the
   terminal, so record the width here, where it is actually visible. */
function saveWidth() {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(STATE_DIR, 'term.json'),
      JSON.stringify({ cols: process.stdout.columns, rows: process.stdout.rows, ts: Date.now() })
    );
  } catch (_) {}
}

/* Blocking poll: this process has nothing else to do until the pane is up. */
function waitForFile(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const nap = new Int32Array(new SharedArrayBuffer(4));
  while (Date.now() < deadline) {
    try {
      if (fs.existsSync(file)) return true;
    } catch (_) {}
    Atomics.wait(nap, 0, 0, 100);
  }
  return false;
}

function main() {
  log(
    'start: wt=' + (process.env.WT_SESSION ? 'yes' : 'no') +
    ' claudecode=' + (process.env.CLAUDECODE ? 'yes' : 'no') +
    ' tty=' + !!process.stdout.isTTY +
    ' size=' + process.stdout.columns + 'x' + process.stdout.rows +
    ' args=' + JSON.stringify(ARGS)
  );
  /*
   * This pane is already part of a ccbar layout - it was created by a launcher
   * and carries that layout's CCBAR_ID. Splitting again would stack a second
   * bar on top of the first, which is how a window ends up with a row of them.
   * Start Claude right here instead: it inherits the same CCBAR_ID, publishes
   * under it, and the bar already above the pane picks the new session up.
   */
  if (process.env.CCBAR_ID) {
    log('reuse: pane already belongs to layout ' + process.env.CCBAR_ID);
    return runPlain(null, 'ccbar: using the bar already above this pane');
  }

  const stop = blocker();
  if (stop) {
    log('blocked: ' + stop);
    return runPlain(stop);
  }

  saveWidth();

  const rows = process.stdout.rows;
  const cwd = process.cwd();
  const token = crypto.randomBytes(16).toString('hex');
  const size = (Math.round((1 - 3 / rows) * 1000) / 1000).toFixed(3); // reserve 3 rows on top

  /* '0' is this window; an explicit name can be forced for testing */
  const win = process.env.CCBAR_WT_WINDOW || '0';

  /*
   * The split goes through PowerShell, not straight to wt.exe: wt is a Windows
   * App Execution Alias and node cannot launch it - the stub returns exit 0 and
   * does nothing at all. PowerShell resolves it properly.
   */
  const psArgs = [
    '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(CCBAR, 'split.ps1'),
    '-Window', win, '-Size', size, '-Dir', cwd,
    '-Runner', path.join(CCBAR, 'run-claude.ps1'), '-Token', token,
  ];
  if (ARGS.length) psArgs.push('-Rest', ...ARGS);

  log('split via: powershell.exe ' + psArgs.join(' '));
  const split = spawnSync('powershell.exe', psArgs, { encoding: 'utf8' });
  log(
    'split result: status=' + split.status +
    ' error=' + (split.error ? split.error.code : 'none') +
    ' stdout=' + JSON.stringify((split.stdout || '').slice(0, 400)) +
    ' stderr=' + JSON.stringify((split.stderr || '').slice(0, 400))
  );
  if (split.error) return runPlain('could not run powershell.exe (' + split.error.code + ')');

  /*
   * Not split.status: wt.exe hands the command to the running window and has
   * been seen reporting failure for a split that worked, which would start a
   * second Claude up here. The pane itself says when it is up.
   */
  if (!waitForFile(path.join(STATE_DIR, token + '.started'), 8000)) {
    log('no .started marker for token ' + token + ' after 8s');
    return runPlain('the pane below did not come up');
  }
  log('pane up, handing over to the bar');

  /* this pane is now the bar; it runs until the session below signals it is done */
  const bar = spawnSync(
    process.execPath,
    [path.join(CCBAR, 'topbar.js'), '--auto', '--stop', token, '--name', path.basename(cwd)],
    { stdio: 'inherit' }
  );
  process.exit(typeof bar.status === 'number' ? bar.status : 0);
}

try {
  main();
} catch (e) {
  runPlain('launcher error (' + (e && e.message) + ')');
}
