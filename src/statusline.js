#!/usr/bin/env node
'use strict';
/*
 * ccbar - Claude Code status-line command.
 *
 * Always publishes this session's project name and limit state to a small
 * file keyed by session id. A top-bar pane picks the file up and draws the
 * console at the top of the window; while such a pane is attached it keeps a
 * fresh .claim file, and this command then prints nothing so the display
 * lives in exactly one place. With no pane attached, it draws the two-line
 * console itself, so a session is never left without a gauge.
 *
 * Never throws: any failure degrades to the bare project name.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const claim = require('./claim.js');
const watchdog = require('./watchdog.js');
const cache = require('./cache.js');

/*
 * Nothing this process does is worth outliving the second it was asked for.
 * The watchdog is armed before anything else and never unref'd: however the
 * run goes, the process is gone inside this budget. Everything that waits
 * below - stdin, the claim's confirmation - is cut to fit under it.
 */
const BUDGET_MS = 2000;
const STARTED = Date.now();
watchdog.arm(BUDGET_MS, 'ccbar: status line gave up after ' + BUDGET_MS + 'ms');
const remaining = () => Math.max(0, STARTED + BUDGET_MS - 200 - Date.now());

/* CCBAR_STATE is for the test suite, so it can never disturb a live session */
const STATE_DIR = process.env.CCBAR_STATE || path.join(os.homedir(), '.claude', 'ccbar', 'state');

function sessionKey(data) {
  /* Started by the ccbar launcher: it named this session, and the pane above
     watches exactly that name. Nothing is left to guess. */
  const owned = process.env.CCBAR_ID;
  if (typeof owned === 'string' && /^[A-Za-z0-9._-]{4,80}$/.test(owned)) return owned;

  const raw = data && (data.session_id || data.sessionId);
  if (typeof raw === 'string' && /^[A-Za-z0-9._-]{4,80}$/.test(raw)) return raw;
  /* no id in the payload: fall back to a stable key for this directory */
  let seed = 'cwd';
  try {
    seed = (data && data.workspace && data.workspace.current_dir) || process.cwd();
  } catch (_) {}
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return 'dir-' + h.toString(36);
}

/* -> what was published, or null */
function publish(key, data, name, info) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const payload = {
      name: name,
      used: info ? info.used : null,
      resets: info ? info.resets : null,
      label: info ? info.label : null,
      model: (data && data.model && data.model.display_name) || null,
      cwd: (data && data.workspace && data.workspace.current_dir) || null,
      ts: Date.now(),
    };
    const tmp = path.join(STATE_DIR, key + '.tmp');
    fs.writeFileSync(tmp, JSON.stringify(payload));
    fs.renameSync(tmp, path.join(STATE_DIR, key + '.json'));
    return payload;
  } catch (_) {
    /* the display is a nicety; never let it disturb the session */
    return null;
  }
}

/*
 * Every session's published reading, for the account's figure.
 *
 * Reading every session file on the machine once a second per session is
 * the one thing here that grows with the number of windows open, so the scan
 * is kept for a few seconds in a cache file and shared by every status line
 * on the machine (cache.js). This session's own reading is never taken from
 * the cache: it was published a moment ago, and it is the one that moves.
 */
function sessions(key, own) {
  const all = cache.remember('readings:' + STATE_DIR, cache.TTL_MS, () => require('./state.js').readings(STATE_DIR));
  const others = (all || []).filter((r) => r && r.key !== key);
  return own ? others.concat([Object.assign({ key: key }, own)]) : others;
}

/*
 * A top pane is drawing this session. Its claim is either freshly touched or
 * held by a bar that is demonstrably still running - the difference matters
 * on the first status line after the machine wakes, when every file on disk
 * looks hours old and the bar has not yet had its first frame back. Drawing
 * the console down here on that evidence is how the bar "moved to the
 * bottom" after every sleep.
 */
function claimed(key) {
  return claim.live(STATE_DIR, key, { budgetMs: remaining() });
}

/*
 * Terminal width, for centring.
 *
 * A status-line command is spawned without a console: stdout is a pipe, no
 * COLUMNS is exported, and the payload carries no size. So the width is taken
 * from whoever could actually see it - the top pane, or the shell that
 * launched the session - through a reading cached under this session's own
 * token.
 *
 * Only its own: the reading used to live in one file per machine, so every
 * window overwrote the last one's width and a session with no bar centred its
 * console against whatever terminal happened to write last. A width that
 * belongs to another window is not a better guess than none.
 *
 * When nothing is known we return null and the console is drawn flush left,
 * because a guessed centre looks broken while a left edge looks deliberate.
 */
function terminalWidth(key) {
  const direct = process.stdout.columns || parseInt(process.env.COLUMNS || '', 10);
  if (Number.isFinite(direct) && direct > 20) return direct;
  try {
    const t = JSON.parse(fs.readFileSync(path.join(STATE_DIR, key + '.width'), 'utf8'));
    if (t && Number.isFinite(t.cols) && t.cols > 20) return t.cols;
  } catch (_) {}
  return null;
}

function run(data) {
  const { projectName, limitInfo, withEta, accountLimit } = require('./payload.js');
  const name = projectName(data);
  let info = withEta(limitInfo(data));
  const key = sessionKey(data);

  const own = publish(key, data, name, info);

  if (claimed(key)) return ''; // a top-bar pane is drawing this session

  /* the plan limit is the account's: show the freshest reading any session
     on the machine has, not the one this session last fetched (payload.js) */
  if (!info || info.label === 'SESSION') {
    const account = accountLimit(sessions(key, own));
    if (account) info = withEta(account);
  }

  const theme = require('./theme.js');
  const t = Date.now() / 1000; // continuous time, sampled at the host's redraw rate
  const cols = terminalWidth(key);
  const budget = cols ? cols - 1 : 0;
  const gauge = budget ? Math.max(8, Math.min(46, budget - 24)) : 20;

  const lines = [
    theme.titleLine(name, t, budget ? { max: budget } : undefined),
    theme.meterLine(info, t, budget ? { width: gauge, max: budget } : { width: gauge }),
  ];
  return (cols ? lines.map((l) => theme.center(l, cols)) : lines).join('\n');
}

function safeRun(data) {
  try {
    return run(data);
  } catch (_) {
    try {
      return path.basename(process.cwd());
    } catch (_) {
      return '';
    }
  }
}

/*
 * Leaving.
 *
 * The host reads stdout and shows it once the process has exited 0, so the
 * output is ended and the exit waits for the stream to say it has gone out -
 * not process.exit() straight after write(), which cuts a pending pipe write
 * short. Then exit, explicitly: not "let the loop drain", which is what left
 * processes behind.
 *
 * The host may also have lost interest. Claude Code cancels a run that is
 * still going when a new trigger arrives, and closes its end of the pipe; the
 * write then fails, and a failed write on stdout is an 'error' event that,
 * unhandled, becomes an uncaughtException. The handler for that used to write
 * a newline to stdout - to the same closed pipe - which failed in turn, and
 * the process spent the rest of its life, at a full core, re-raising the
 * error it was trying to apologise for. That was the leak. Nothing here ever
 * writes to stdout from an error path again; an error means leave.
 */
let gone = false;
function exit(code) {
  if (gone) return;
  gone = true;
  process.exit(code);
}

process.stdout.on('error', () => exit(1));
process.on('uncaughtException', () => {
  try {
    process.stderr.write('ccbar: status line failed\n');
  } catch (_) {}
  exit(1);
});

function leave(text) {
  try {
    process.stdin.pause();
    process.stdin.destroy();
  } catch (_) {}
  try {
    process.stdout.end(text, () => exit(0));
  } catch (_) {
    exit(0);
  }
}

let raw = '';
let done = false;

function finish() {
  if (done) return;
  done = true;
  let data = null;
  try {
    const text = raw.replace(/^﻿/, '').trim();
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = null;
  }
  const out = safeRun(data);
  leave(out ? out + '\n' : '');
}

/*
 * The host writes its JSON and closes the pipe, so 'end' is the normal way
 * in. A host that does not close it gets this long, which is plenty for a
 * payload of a few kilobytes and still leaves the claim its time to be
 * confirmed under the watchdog.
 */
const STDIN_MS = 1000;

try {
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    if (raw.length < 1e6) raw += chunk;
  });
  process.stdin.on('end', finish);
  process.stdin.on('error', finish);
  setTimeout(finish, STDIN_MS).unref();
} catch (_) {
  finish();
}
