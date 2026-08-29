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
/* CCBAR_STATE is for the test suite, so it can never disturb a live session */
const STATE_DIR = process.env.CCBAR_STATE || path.join(CCBAR, 'state');
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

function runPlain(note, plainNote, stopId) {
  const line = plainNote || (note ? 'ccbar: top bar off - ' + note : '');
  if (line) process.stderr.write('\x1b[90m' + line + '\x1b[0m\n');
  const r = spawnSync('claude.exe', ARGS, { stdio: 'inherit' });
  /*
   * Only when this session borrowed a bar somebody else started: the runner
   * that would normally leave the marker finished long ago, so nothing else is
   * going to tell that bar its session is over, and it would sit there drawing
   * a gauge for something that has ended.
   */
  if (stopId) {
    try {
      fs.mkdirSync(STATE_DIR, { recursive: true });
      fs.writeFileSync(path.join(STATE_DIR, stopId + '.stop'), '');
    } catch (_) {}
  }
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

/*
 * The status line is spawned without a console and cannot measure the
 * terminal, so record the width here, where it is actually visible.
 *
 * Under this session's own token, never in one file shared by the machine: a
 * width belongs to a window, and two windows of different widths would take
 * turns overwriting each other's reading, leaving whichever session draws its
 * own console centred against a stranger's terminal.
 */
function saveWidth(token) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(STATE_DIR, token + '.width'),
      JSON.stringify({ cols: process.stdout.columns, rows: process.stdout.rows, ts: Date.now() })
    );
  } catch (_) {}
}

/* A bar refreshes its claim every second while it is drawing. */
function barIsLive(token) {
  try {
    return Date.now() - fs.statSync(path.join(STATE_DIR, token + '.claim')).mtimeMs < 6000;
  } catch (_) {
    return false;
  }
}

/* The pane that session ran in, if it is still there. */
function paneAlive(token) {
  let pid;
  try {
    pid = parseInt(fs.readFileSync(path.join(STATE_DIR, token + '.started'), 'utf8'), 10);
  } catch (_) {
    return false;
  }
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code !== 'ESRCH'; // alive but out of reach still counts as alive
  }
}

const SWEEP_AFTER_MS = 30 * 60 * 1000; // quiet this long and the session is over
const OURS = /^([A-Za-z0-9._-]{4,80})\.(json|claim|started|stop|width|tmp)$/;

/*
 * Files outlive the sessions that wrote them whenever one never got to clean up
 * after itself - a window closed from its X takes its bar down with no chance
 * to run, leaving the claim, the width and the markers behind. Each one is
 * harmless on its own, and they accumulate: this directory had reached fifty.
 *
 * Nothing is touched while it could still belong to somebody. A token whose
 * files were written recently, or whose pane is still running, is left exactly
 * where it is - a live session's bar refreshes its claim every second, so it is
 * never a candidate. Anything not shaped like ours (launch.log) is not ours to
 * delete either.
 *
 * The launcher is the place for this: starting a session is when a finished one
 * is worth noticing, and it happens once rather than on a timer.
 */
function sweepState() {
  let files;
  try {
    files = fs.readdirSync(STATE_DIR);
  } catch (_) {
    return; // no state directory yet: nothing to sweep
  }

  const sessions = new Map();
  for (const f of files) {
    const m = OURS.exec(f);
    if (!m) continue;
    const full = path.join(STATE_DIR, f);
    let mtime;
    try {
      mtime = fs.statSync(full).mtimeMs;
    } catch (_) {
      continue;
    }
    const seen = sessions.get(m[1]) || { paths: [], newest: 0 };
    seen.paths.push(full);
    if (mtime > seen.newest) seen.newest = mtime;
    sessions.set(m[1], seen);
  }

  let removed = 0;
  for (const [token, seen] of sessions) {
    if (Date.now() - seen.newest < SWEEP_AFTER_MS) continue;
    if (paneAlive(token)) continue;
    for (const p of seen.paths) {
      try {
        fs.unlinkSync(p);
        removed++;
      } catch (_) {}
    }
  }
  if (removed) log('swept ' + removed + ' file(s) left by sessions that are over');
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
  sweepState();
  /*
   * This pane belongs to a ccbar layout AND that layout's bar is still alive
   * above it - a live bar keeps its claim warm. Splitting again would stack a
   * second bar on the first, which is how a window ends up with a row of them.
   * Start Claude right here: it inherits the same CCBAR_ID, publishes under it,
   * and the bar above picks the new session up.
   *
   * The claim check matters as much as CCBAR_ID: when the bar is gone the shell
   * still carries the id, and trusting the id alone would leave that pane
   * unable to ever get a bar back.
   *
   * The id is handed on so this session marks itself finished on the way out.
   * Nothing else can: the runner that leaves that marker belongs to the session
   * that opened this pane, and it is already done.
   */
  if (process.env.CCBAR_ID && barIsLive(process.env.CCBAR_ID)) {
    log('reuse: live bar holds layout ' + process.env.CCBAR_ID);
    return runPlain(null, 'ccbar: using the bar already above this pane', process.env.CCBAR_ID);
  }

  const stop = blocker();
  if (stop) {
    log('blocked: ' + stop);
    return runPlain(stop);
  }

  const rows = process.stdout.rows;
  const cwd = process.cwd();
  const token = crypto.randomBytes(16).toString('hex');
  const size = (Math.round((1 - 3 / rows) * 1000) / 1000).toFixed(3); // reserve 3 rows on top

  saveWidth(token); // the session is named first, so the reading can be filed under it

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

  /*
   * This pane is now the bar, and it draws for exactly as long as the session
   * below lives. When that session ends, the pane it ran in closes itself, the
   * bar stands down, and this pane - the one the user typed `cc` in - is the
   * whole window again, back at its own prompt with its own history.
   */
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
