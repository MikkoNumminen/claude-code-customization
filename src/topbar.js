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
 * Nothing else takes it down. Not the machine sleeping, not the window being
 * carried to a monitor of another size, not a session that has gone quiet.
 * The bar used to judge the session dead when its state file looked two
 * minutes old, and a clock that has jumped forward over a sleep makes every
 * file look hours old at once - so the bar quit in its first frame back, and
 * the console reappeared at the bottom of the window. Now the pane pid and the
 * stop marker are the only word on a session that has a runner; the age rule
 * survives only for sessions nobody left a marker for, and it counts frames
 * the bar has actually drawn rather than the wall clock.
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
const claim = require('./claim.js');
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

const FRAME_MS = 50;              // 20 fps
const READ_EVERY = 10;            // re-read state twice a second
const HOUSEKEEP_EVERY = 20;       // claim, attach and exit checks once a second
const ATTACH_FRESH_MS = 20000;    // a session counts as live if seen this recently
const ATTACH_FALLBACK_MS = 60000; // no new session by then -> settle for an existing one
/* two minutes of *drawn* frames, see quiet(); CCBAR_QUIET_MS is for the tests */
const STALE_EXIT_FRAMES = (parseInt(process.env.CCBAR_QUIET_MS || '', 10) || 120000) / FRAME_MS;
const EXIT_CHECK_EVERY = 4;       // the session ending is noticed within ~200ms
const RESUME_GAP_MS = 5000;       // a frame this late means the machine was away

let id = explicitId;
let state = null;
let shown = null;                 // eased gauge value
let frames = 0;
const started = Date.now();

/* Same trail the launcher keeps, so a bar that vanished can say why. */
function log(text) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.appendFileSync(
      path.join(STATE_DIR, 'launch.log'),
      new Date().toISOString() + '  bar ' + (stopToken || id || '?').slice(0, 8) + ': ' + text + '\n'
    );
  } catch (_) {}
}

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
  return claim.live(STATE_DIR, key, { confirm: false });
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
  if (picked) {
    id = picked;
    log('attached');
  }
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
function renewClaim() {
  if (!id) return;
  claim.write(STATE_DIR, id);
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
  const rows = process.stdout.rows || 2;
  const name = (state && state.name) || fallbackName;

  let info = null;
  if (state && typeof state.used === 'number') {
    /* eased so a jump in usage glides into place */
    shown = shown === null ? state.used : shown + (state.used - shown) * 0.08;
    info = { used: shown, label: state.label || 'SESSION', eta: etaText(state.resets) };
  }

  /*
   * Home, the rows, then erase everything from here to the end of the pane.
   * That last part is not tidiness: Windows Terminal scales panes with the
   * window, so a pane that started two rows tall becomes six when the window
   * is made taller, and it reflows the buffer on every resize. Rows the
   * composition does not reach then keep whatever the reflow left there -
   * fragments of an older, wider gauge, which is exactly what they looked
   * like. Erasing below the composition every frame means there is nothing
   * left to see, whatever height the pane has been given.
   */
  return '\x1b[H' + theme.compose(name, info, cols, rows, t).join('\x1b[K\n') + '\x1b[J';
}

function draw() {
  try {
    process.stdout.write(frame());
  } catch (_) {}
}

/* ---------- lifetime ---------- */

/*
 * The session this bar answers for. The launcher names it with --stop; the
 * `ccbar` command, run by hand in a pane whose bar was stopped, has to learn
 * it by attaching - and the markers the runner leaves are filed under that
 * same name, so once attached the bar watches them exactly as if it had been
 * told.
 */
function owner() {
  return stopToken || id;
}

function markerPid() {
  const key = owner();
  if (!key) return null;
  let pid;
  try {
    pid = parseInt(fs.readFileSync(path.join(STATE_DIR, key + '.started'), 'utf8'), 10);
  } catch (_) {
    return null; // no marker to read: nothing is being claimed either way
  }
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

/*
 * The pane below wrote its shell's pid when it came up. Watching it covers the
 * endings that never get to write a marker - the pane closed from its own X,
 * the session killed outright - which would otherwise leave the bar drawing a
 * session that is already gone.
 */
function paneGone() {
  const pid = markerPid();
  if (pid === null) return false;
  try {
    process.kill(pid, 0); // signal 0 only asks whether it is still there
    return false;
  } catch (e) {
    /* only a plain "no such process" is proof. Anything else - no permission,
       some oddity of the platform - is no grounds for tearing the bar down. */
    return e.code === 'ESRCH';
  }
}

function stopped() {
  const key = owner();
  if (!key) return false;
  try {
    return fs.existsSync(path.join(STATE_DIR, key + '.stop'));
  } catch (_) {
    return false;
  }
}

/*
 * A session with no runner behind it - one keyed by Claude's own session id,
 * attached to by hand - leaves no marker when it ends. Its state file simply
 * stops changing, and that is the only sign there is. Quiet is measured in
 * frames this bar has drawn since the file last changed, never in wall-clock
 * time: a sleeping machine draws no frames, so it comes back with the count
 * where it left it, while its clock has moved on by hours.
 */
let lastStateMtime = null;
let quietFrames = 0;

function quiet() {
  let m;
  try {
    m = fs.statSync(stateFile()).mtimeMs;
  } catch (_) {
    return state !== null; // state file vanished under us
  }
  if (m !== lastStateMtime) {
    lastStateMtime = m;
    quietFrames = 0;
    return false;
  }
  quietFrames += EXIT_CHECK_EVERY;
  return quietFrames > STALE_EXIT_FRAMES;
}

/* -> reason string, or null to keep drawing */
function exitReason() {
  /*
   * The session below is over: it left the marker on its way out, and the pane
   * it ran in has closed itself. The bar goes with it. Lingering here - in the
   * hope of a session restarted in the same pane - is what used to leave a dead
   * gauge pinned above a plain prompt for minutes after the session had ended.
   */
  if (stopped()) return 'stop marker';
  if (paneGone()) return 'pane ' + markerPid() + ' is gone';
  if (!id) return Date.now() - started > 10 * 60 * 1000 ? 'never found a session' : null;
  /* a runner's pid is the truth about its session; only without one is quiet
     taken as an ending */
  if (markerPid() !== null) return null;
  return quiet() ? 'session quiet for ' + Math.round(STALE_EXIT_FRAMES * FRAME_MS / 1000) + 's of drawing' : null;
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
  if (id) junk.push(claim.file(STATE_DIR, id), path.join(STATE_DIR, id + '.width'));
  const key = owner();
  if (key) junk.push(path.join(STATE_DIR, key + '.stop'), path.join(STATE_DIR, key + '.started'));
  for (const f of junk) {
    try {
      fs.unlinkSync(f);
    } catch (_) {}
  }
}

function leave(reason) {
  log('exit: ' + reason);
  cleanup();
  process.exit(0);
}

process.on('SIGINT', () => leave('SIGINT'));
process.on('SIGTERM', () => leave('SIGTERM'));
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

function redrawFromEmpty() {
  /* the reflow that comes with a resize can leave anything anywhere in the
     pane, so this one starts from an empty one rather than drawing over it */
  try {
    process.stdout.write('\x1b[2J');
  } catch (_) {}
  draw();
}

process.stdout.on('resize', () => {
  publishWidth();
  redrawFromEmpty();
});

measure();
attach();
readState();
renewClaim();
publishWidth();
draw();
log('drawing ' + (process.stdout.columns || '?') + 'x' + (process.stdout.rows || '?'));

let lastFrameAt = Date.now();

setInterval(() => {
  frames++;
  const now = Date.now();
  /*
   * Back from sleep, or from being frozen while the window found a new monitor.
   * Every timestamp on disk is now old, so the claim is renewed before the
   * session's status line can read it as abandoned, and the pane - which may
   * be a different size on a different screen - is measured and cleared
   * rather than drawn over.
   */
  if (now - lastFrameAt > RESUME_GAP_MS) {
    log('resumed after ' + Math.round((now - lastFrameAt) / 1000) + 's away');
    measure();
    renewClaim();
    publishWidth();
    redrawFromEmpty();
  }
  lastFrameAt = now;

  measure(); // the pane may have been resized since the last frame
  if (frames % READ_EVERY === 0) readState();
  if (frames % HOUSEKEEP_EVERY === 0) {
    if (auto) attach();
    renewClaim();
    publishWidth();
  }
  /* far more often than the rest: the whole point of the bar is that it leaves
     with its session, and a second of afterlife is a second too many */
  if (frames % EXIT_CHECK_EVERY === 0) {
    const reason = exitReason();
    if (reason) leave(reason);
  }
  draw();
}, FRAME_MS);
