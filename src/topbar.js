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
 * The bar lives exactly as long as the session it draws: the pane below writes
 * a marker on its way out (and its pid on the way in, for the exits too abrupt
 * to write anything), and the bar stands down on either. A gauge left hovering
 * over a finished session is just furniture.
 *
 * Given a token it draws exactly that session. Without one it attaches to the
 * session started in this directory - the pane below is a sibling of this one,
 * so the directory is the link, never "whichever session is newest". While
 * attached it keeps a .claim file warm, which tells that session's status line
 * to stop drawing a second bar at the bottom.
 *
 * Usage: node topbar.js [--auto | <session-id>] [--stop <token>] [--name <fallback>]
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const theme = require('./theme.js');
const { etaText, chooseSession } = require('./payload.js');

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

/* CCBAR_STATE is for the test suite, so it can never disturb a live session */
const STATE_DIR = process.env.CCBAR_STATE || path.join(os.homedir(), '.claude', 'ccbar', 'state');
const STOP_FILE = stopToken ? path.join(STATE_DIR, stopToken + '.stop') : '';

const FRAME_MS = 50;              // 20 fps
const READ_EVERY = 10;            // re-read state twice a second
const HOUSEKEEP_EVERY = 20;       // claim, attach and exit checks once a second
const ATTACH_FRESH_MS = 20000;    // a session counts as live if seen this recently
const ATTACH_FALLBACK_MS = 60000; // no new session by then -> settle for an existing one
const CLAIM_FRESH_MS = 6000;      // a claim older than this is nobody's
const STALE_EXIT_MS = 120000;     // attached session went quiet this long -> stand down
const EXIT_CHECK_EVERY = 4;       // the session ending is noticed within ~200ms

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

/* Someone else's bar is already drawing that session. */
function heldByAnother(key) {
  try {
    return Date.now() - fs.statSync(path.join(STATE_DIR, key + '.claim')).mtimeMs < CLAIM_FRESH_MS;
  } catch (_) {
    return false;
  }
}

function attach() {
  if (id) return;
  const candidates = [];
  try {
    for (const f of fs.readdirSync(STATE_DIR)) {
      /* term.json is not a session: nothing writes it any more, but an older
         install may have left one lying in the state directory */
      if (!f.endsWith('.json') || f === 'term.json') continue;
      const key = f.slice(0, -5);
      let mtime;
      try {
        mtime = fs.statSync(path.join(STATE_DIR, f)).mtimeMs;
      } catch (_) {
        continue;
      }
      if (Date.now() - mtime > ATTACH_FRESH_MS) continue;
      let cwd = '';
      try {
        cwd = (JSON.parse(fs.readFileSync(path.join(STATE_DIR, f), 'utf8')) || {}).cwd || '';
      } catch (_) {}
      candidates.push({ key: key, mtime: mtime, cwd: cwd, claimedByOther: heldByAnother(key) });
    }
  } catch (_) {
    /* no state directory yet */
  }

  let here = '';
  try {
    here = process.cwd();
  } catch (_) {}

  const picked = chooseSession(candidates, {
    cwd: here,
    allowOld: attachMode === 'any' || Date.now() - started > ATTACH_FALLBACK_MS,
    preexisting: Array.from(PREEXISTING),
  });
  if (picked) id = picked;
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
 * so it records the width for the status line, which is spawned without a
 * console and would otherwise have nothing to centre against.
 *
 * Filed under the session this bar is drawing, because that session's status
 * line is the only one entitled to this reading. A single shared file made
 * every window on the machine overwrite the last one's width, and a session
 * that drew its own console then centred it against a stranger's terminal.
 */
function publishWidth() {
  if (!id) return; // not attached yet: no session to record it for
  const cols = process.stdout.columns;
  if (!Number.isFinite(cols) || cols <= 20) return;
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(STATE_DIR, id + '.width'),
      JSON.stringify({ cols: cols, rows: process.stdout.rows || null, ts: Date.now() })
    );
  } catch (_) {}
}

/* ---------- drawing ---------- */

/*
 * Node caches the terminal size and only refreshes it when a resize event
 * arrives - and in a Windows Terminal pane that event never arrives. Measured
 * here: splitting a 120-column window left process.stdout.columns still
 * reporting 120 for a pane that was 58 wide, with no 'resize' event at all.
 *
 * Every row would then be composed for a terminal that no longer exists. Too
 * long for a pane that has narrowed, so it wraps, and a wrapped line scrolls
 * the three-row composition off the top; too short for one that has widened,
 * so the whole thing sits left of centre. Both were reported, and both are
 * this.
 *
 * So the console is asked directly, every frame. _refreshSize also emits the
 * resize event Node owes us, which is what republishes the width.
 */
function measure() {
  try {
    if (typeof process.stdout._refreshSize === 'function') process.stdout._refreshSize();
  } catch (_) {
    /* not a tty, or a Node without it: the cached reading is all there is */
  }
}

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

  /*
   * Home, the two rows, then erase everything from here to the end of the
   * pane. That last part is not tidiness: Windows Terminal scales panes with
   * the window, so a pane that started two rows tall becomes six when the
   * window is made taller, and it reflows the buffer on every resize. Rows the
   * composition does not reach then keep whatever the reflow left there -
   * fragments of an older, wider gauge, which is exactly what they looked
   * like. Erasing below the composition every frame means there is nothing
   * left to see, whatever height the pane has been given.
   */
  return '\x1b[H' + line1 + '\x1b[K\n' + line2 + '\x1b[J';
}

function draw() {
  try {
    process.stdout.write(frame());
  } catch (_) {}
}

/* ---------- lifetime ---------- */

/*
 * The pane below wrote its shell's pid when it came up. Watching it covers the
 * endings that never get to write a marker - the pane closed from its own X,
 * the session killed outright - which would otherwise leave the bar drawing a
 * session that is already gone until the stale timeout finally ran out.
 */
function paneGone() {
  if (!stopToken) return false;
  let pid;
  try {
    pid = parseInt(fs.readFileSync(path.join(STATE_DIR, stopToken + '.started'), 'utf8'), 10);
  } catch (_) {
    return false; // no marker to read: nothing is being claimed either way
  }
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0); // signal 0 only asks whether it is still there
    return false;
  } catch (e) {
    /* only a plain "no such process" is proof. Anything else - no permission,
       some oddity of the platform - is no grounds for tearing the bar down. */
    return e.code === 'ESRCH';
  }
}

function shouldExit() {
  /*
   * The session below is over: it left the marker on its way out, and the pane
   * it ran in has closed itself. The bar goes with it. Lingering here - in the
   * hope of a session restarted in the same pane - is what used to leave a dead
   * gauge pinned above a plain prompt for minutes after the session had ended.
   */
  if (STOP_FILE) {
    try {
      if (fs.existsSync(STOP_FILE)) return true;
    } catch (_) {}
  }
  if (paneGone()) return true;
  if (!id) return Date.now() - started > 10 * 60 * 1000; // never found a session
  try {
    return Date.now() - fs.statSync(stateFile()).mtimeMs > STALE_EXIT_MS;
  } catch (_) {
    return state !== null; // state file vanished under us
  }
}

function cleanup() {
  try {
    /*
     * Cursor back, autowrap back, then hand the ordinary screen back. Leaving
     * the alternate screen restores whatever the shell had there before the
     * bar took over, so nothing is cleared here: wiping it would throw away
     * the history this is meant to give back.
     */
    process.stdout.write(theme.RESET + '\x1b[?25h\x1b[?7h\x1b[?1049l');
  } catch (_) {}
  const junk = [];
  if (id) junk.push(path.join(STATE_DIR, id + '.claim'), path.join(STATE_DIR, id + '.width'));
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
  /*
   * Take the alternate screen, hide the cursor, turn autowrap off, clear.
   *
   * The alternate screen is what every full-screen program uses and what this
   * should have used from the start. A pane drawing on the ordinary screen
   * keeps a scrollback: the shell's history stays underneath, every frame
   * drawn piles on top, the pane can be scrolled about, and a resize sets
   * Windows Terminal reflowing all of it - which is where the fragments of old
   * gauges came from. The alternate screen has no scrollback at all, so there
   * is nothing to scroll, nothing to reflow and nothing to inherit. Leaving it
   * puts the shell's own screen back exactly as it was, which is a better
   * parting gift than the blank pane it used to hand over.
   *
   * Autowrap still matters underneath all that: with it on, a row one column
   * too long wraps onto the next and pushes the composition out of a two-row
   * pane. With it off the terminal clips at the right edge instead.
   */
  process.stdout.write('\x1b[?1049h\x1b[?25l\x1b[?7l\x1b[2J');
} catch (_) {}
process.stdout.on('resize', () => {
  publishWidth();
  /* the reflow that comes with a resize can leave anything anywhere in the
     pane, so this one starts from an empty one rather than drawing over it */
  try {
    process.stdout.write('\x1b[2J');
  } catch (_) {}
  draw();
});

measure();
attach();
readState();
claim();
publishWidth();
draw();

setInterval(() => {
  frames++;
  measure(); // the pane may have been resized since the last frame
  if (frames % READ_EVERY === 0) readState();
  if (frames % HOUSEKEEP_EVERY === 0) {
    if (auto) attach();
    claim();
    publishWidth();
  }
  /* far more often than the rest: the whole point of the bar is that it leaves
     with its session, and a second of afterlife is a second too many */
  if (frames % EXIT_CHECK_EVERY === 0 && shouldExit()) {
    cleanup();
    process.exit(0);
  }
  draw();
}, FRAME_MS);
