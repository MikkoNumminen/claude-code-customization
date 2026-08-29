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

/* CCBAR_STATE is for the test suite, so it can never disturb a live session */
const STATE_DIR = process.env.CCBAR_STATE || path.join(os.homedir(), '.claude', 'ccbar', 'state');
const CLAIM_FRESH_MS = 6000; // a pane must have touched its claim this recently

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
  } catch (_) {
    /* the display is a nicety; never let it disturb the session */
  }
}

function claimed(key) {
  try {
    return Date.now() - fs.statSync(path.join(STATE_DIR, key + '.claim')).mtimeMs < CLAIM_FRESH_MS;
  } catch (_) {
    return false;
  }
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
  const { projectName, limitInfo, withEta } = require('./payload.js');
  const name = projectName(data);
  const info = withEta(limitInfo(data));
  const key = sessionKey(data);

  publish(key, data, name, info);

  if (claimed(key)) return ''; // a top-bar pane is drawing this session

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

process.on('uncaughtException', () => {
  try {
    process.stdout.write('\n');
  } catch (_) {}
});

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
  process.stdout.write(out ? out + '\n' : '');
  /*
   * The line is written; let go of stdin so the process can end. Without this
   * it keeps listening for input that will never come, and a session that goes
   * away without closing the pipe - which is how sessions usually go - leaves
   * one of these behind for good. They are invisible, and they accumulate.
   *
   * Not process.exit(): stdout is a pipe here, and a pending write would be
   * cut off. With nothing left listening the loop drains and exits by itself.
   */
  try {
    process.stdin.pause();
    process.stdin.destroy();
  } catch (_) {}
}

try {
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    if (raw.length < 1e6) raw += chunk;
  });
  process.stdin.on('end', finish);
  process.stdin.on('error', finish);
  setTimeout(finish, 1500).unref();
} catch (_) {
  finish();
}
