#!/usr/bin/env node
'use strict';
/*
 * ccbar - the top pane.
 *
 * Draws the console at the top of the window at 20 fps. It owns its own loop,
 * so motion is continuous: light glides across the title and the gauge eases
 * toward a new reading instead of jumping. Only the numbers come from the
 * session's state file, so the bar keeps breathing while the session is idle.
 *
 * With --auto it attaches to the freshest Claude Code session on the machine
 * and then stays with it. While attached it keeps a .claim file warm, which
 * tells that session's status line to stop drawing its own bar at the bottom.
 *
 * Usage: node topbar.js [--auto | <session-id>] [--stop <token>] [--name <fallback>]
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const theme = require('./theme.js');
const { etaText } = require('./payload.js');

/* ---------- arguments ---------- */

const argv = process.argv.slice(2);
let explicitId = '';
let auto = false;
let stopToken = '';
let fallbackName = '';
let attachMode = 'new'; // 'new' waits for a session that starts after us; 'any' takes the freshest
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--auto') auto = true;
  else if (a === '--stop') stopToken = argv[++i] || '';
  else if (a === '--name') fallbackName = argv[++i] || '';
  else if (a === '--attach') attachMode = argv[++i] === 'any' ? 'any' : 'new';
  else if (!a.startsWith('--') && !explicitId) explicitId = a;
}
/*
 * A --stop token doubles as the session's name: the launcher passes the same
 * token to the pane below, which hands it to Claude as CCBAR_ID, and its status
 * line publishes under it. So the bar knows exactly which session is its own
 * and never attaches to - or silences - somebody else's window.
 */
if (!explicitId && stopToken) explicitId = stopToken;
if (!explicitId) auto = true;
else auto = false;
if (!fallbackName) {
  try {
    fallbackName = path.basename(process.cwd()) || 'claude';
  } catch (_) {
    fallbackName = 'claude';
  }
}

const STATE_DIR = path.join(os.homedir(), '.claude', 'ccbar', 'state');
const STOP_FILE = stopToken ? path.join(STATE_DIR, stopToken + '.stop') : '';

const FRAME_MS = 50;              // 20 fps
const READ_EVERY = 10;            // re-read state twice a second
const HOUSEKEEP_EVERY = 20;       // claim, attach and exit checks once a second
const ATTACH_FRESH_MS = 20000;    // a session counts as live if seen this recently
const ATTACH_FALLBACK_MS = 60000; // no new session by then -> settle for an existing one
const STALE_EXIT_MS = 120000;     // attached session went quiet this long -> stand down

let id = explicitId;
let state = null;
let shown = null;                 // eased gauge value
let frames = 0;
const started = Date.now();

/* ---------- session attachment ---------- */

/*
 * Sessions already publishing when this pane started. In the default 'new'
 * mode they are ignored, so a bar launched alongside a fresh session never
 * steals - and silences - a session running in another window. If no new
 * session shows up in time, we fall back to the freshest of them.
 */
const PREEXISTING = (() => {
  const seen = new Set();
  try {
    for (const f of fs.readdirSync(STATE_DIR)) {
      if (f.endsWith('.json')) seen.add(f.slice(0, -5));
    }
  } catch (_) {}
  return seen;
})();

function attach() {
  if (id) return;
  const allowOld = attachMode === 'any' || Date.now() - started > ATTACH_FALLBACK_MS;
  let best = null;
  try {
    for (const f of fs.readdirSync(STATE_DIR)) {
      if (!f.endsWith('.json')) continue;
      const key = f.slice(0, -5);
      if (!allowOld && PREEXISTING.has(key)) continue;
      let mtime;
      try {
        mtime = fs.statSync(path.join(STATE_DIR, f)).mtimeMs;
      } catch (_) {
        continue;
      }
      if (Date.now() - mtime > ATTACH_FRESH_MS) continue;
      if (!best || mtime > best.mtime) best = { id: key, mtime: mtime };
    }
  } catch (_) {
    /* no state directory yet */
  }
  if (best) id = best.id;
}

function stateFile() {
  return path.join(STATE_DIR, id + '.json');
}

function readState() {
  if (!id) return;
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    if (parsed && typeof parsed === 'object') state = parsed;
  } catch (_) {
    /* not published yet, or caught mid-write: keep the last good reading */
  }
}

/* Tells the attached session's status line to stay quiet. */
function claim() {
  if (!id) return;
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(path.join(STATE_DIR, id + '.claim'), String(Date.now()));
  } catch (_) {}
}

/*
 * This pane is one of the few processes that can actually see the terminal,
 * so it records the width for status lines, which are spawned without a
 * console and would otherwise have nothing to centre against.
 */
function publishWidth() {
  const cols = process.stdout.columns;
  if (!Number.isFinite(cols) || cols <= 20) return;
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(STATE_DIR, 'term.json'),
      JSON.stringify({ cols: cols, rows: process.stdout.rows || null, ts: Date.now() })
    );
  } catch (_) {}
}

/* ---------- drawing ---------- */

function frame() {
  const t = Date.now() / 1000;
  const cols = process.stdout.columns || 80;
  const name = (state && state.name) || fallbackName;

  let info = null;
  if (state && typeof state.used === 'number') {
    /* eased so a jump in usage glides into place */
    shown = shown === null ? state.used : shown + (state.used - shown) * 0.08;
    info = { used: shown, label: state.label || 'SESSION', eta: etaText(state.resets) };
  }

  /*
   * The title card sits centred, the gauge centred beneath it. Both are given
   * a hard column budget: a line one character too long wraps, and a wrapped
   * line pushes the whole composition down and out of the three-row pane.
   * One column is left spare, because writing into the last cell wraps too.
   */
  const budget = Math.max(12, cols - 2);
  const gauge = Math.max(8, Math.min(46, budget - 24));
  const line1 = theme.center(theme.titleLine(name, t, { max: budget }), cols);
  const line2 = theme.center(theme.meterLine(info, t, { width: gauge, max: budget }), cols);

  return '\x1b[H' + line1 + '\x1b[K\n' + line2 + '\x1b[K';
}

function draw() {
  try {
    process.stdout.write(frame());
  } catch (_) {}
}

/* ---------- lifetime ---------- */

function shouldExit() {
  if (STOP_FILE) {
    try {
      if (fs.existsSync(STOP_FILE)) return true;
    } catch (_) {}
  }
  if (!id) return Date.now() - started > 10 * 60 * 1000; // never found a session
  try {
    return Date.now() - fs.statSync(stateFile()).mtimeMs > STALE_EXIT_MS;
  } catch (_) {
    return state !== null; // state file vanished under us
  }
}

function cleanup() {
  try {
    process.stdout.write('\x1b[?25h' + theme.RESET + '\n');
  } catch (_) {}
  const junk = [];
  if (id) junk.push(path.join(STATE_DIR, id + '.claim'));
  if (STOP_FILE) junk.push(STOP_FILE, path.join(STATE_DIR, stopToken + '.started'));
  for (const f of junk) {
    try {
      fs.unlinkSync(f);
    } catch (_) {}
  }
}

process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});
process.on('exit', cleanup);
process.on('uncaughtException', () => {
  /* a bad frame must never take the pane down */
});

try {
  process.stdout.write('\x1b[?25l\x1b[2J'); // hide cursor, clear the pane
} catch (_) {}
process.stdout.on('resize', () => {
  publishWidth();
  draw();
});

attach();
readState();
claim();
publishWidth();
draw();

setInterval(() => {
  frames++;
  if (frames % READ_EVERY === 0) readState();
  if (frames % HOUSEKEEP_EVERY === 0) {
    if (auto) attach();
    claim();
    publishWidth();
    if (shouldExit()) {
      cleanup();
      process.exit(0);
    }
  }
  draw();
}, FRAME_MS);
