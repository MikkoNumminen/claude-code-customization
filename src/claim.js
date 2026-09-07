'use strict';
/*
 * ccbar - the claim a bar holds on its session.
 *
 * While a top pane draws a session it keeps <id>.claim warm, which is how that
 * session's status line knows to stay quiet. The file carries the bar's pid,
 * and a claim counts as live if either
 *
 *   - it was touched in the last few seconds, or
 *   - the pid in it is a process that is still running AND touches the file
 *     again within a short wait.
 *
 * The second rule is for the machine coming back from sleep. The bar refreshes
 * its claim once a second, but a clock that has jumped eight hours makes the
 * last touch look eight hours old, and the status line is quite likely to run
 * before the bar's first frame back. Its mtime alone then says "no bar", the
 * status line draws a console at the bottom of the window, and the user finds
 * the bar has moved. A live pid says a bar is there; the refresh proves the
 * pid is that bar and not a stranger who inherited the number.
 */

const fs = require('fs');
const path = require('path');

const FRESH_MS = 6000;      // touched this recently: nobody needs to ask further
const CONFIRM_MS = 1500;    // a live pid gets this long to touch its claim again
const POLL_MS = 100;

function file(dir, key) {
  return path.join(dir, key + '.claim');
}

/* Written by the bar, once a second, and immediately on waking. */
function write(dir, key) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file(dir, key), String(process.pid));
  } catch (_) {}
}

function remove(dir, key) {
  try {
    fs.unlinkSync(file(dir, key));
  } catch (_) {}
}

function mtime(p) {
  try {
    return fs.statSync(p).mtimeMs;
  } catch (_) {
    return null;
  }
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0); // signal 0 only asks whether it is there
    return true;
  } catch (e) {
    return e.code !== 'ESRCH'; // alive but out of reach still counts
  }
}

function nap(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch (_) {
    const until = Date.now() + ms;
    while (Date.now() < until) { /* spin; Atomics.wait is unavailable here */ }
  }
}

/*
 * Is a bar drawing this session?
 *
 * opts.confirm (default true): give a live pid the chance to refresh a stale
 * claim before answering. A bar checking whether a *different* bar holds a
 * session does not need to wait, and must not stall its own frame loop.
 */
function live(dir, key, opts) {
  const o = opts || {};
  const p = file(dir, key);
  const m0 = mtime(p);
  if (m0 === null) return false;
  if (Date.now() - m0 < FRESH_MS) return true;

  let pid = NaN;
  try {
    pid = parseInt(fs.readFileSync(p, 'utf8'), 10);
  } catch (_) {}
  if (!pidAlive(pid)) return false;
  if (pid === process.pid) return false; // our own, and we have not touched it
  if (o.confirm === false) return true;

  /* something with that pid is running: a bar would touch the file within
     the second, so wait that long for proof */
  const until = Date.now() + CONFIRM_MS;
  while (Date.now() < until) {
    nap(POLL_MS);
    const m = mtime(p);
    if (m !== null && m !== m0) return true;
  }
  return false;
}

module.exports = { file, write, remove, live, pidAlive, FRESH_MS };
