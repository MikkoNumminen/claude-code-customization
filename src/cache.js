'use strict';
/*
 * ccbar - a reading a few seconds old is as good as a fresh one.
 *
 * The status line runs once a second per session, and some of what it wants
 * costs more than the second deserves: the account's usage means reading
 * every session file on the machine, and anything that touched git or the
 * network would be worse. So a value computed here is kept in a small file
 * under the OS temp folder and reused for a few seconds - the display does
 * not change, only where the number came from. Under the test suite the
 * file goes in the suite's own state directory instead, so a run leaves
 * nothing behind and never shares a cache with a live session.
 *
 * Nothing here throws: a cache that cannot be read is computed, one that
 * cannot be written is simply not kept. Two status lines racing to write
 * the same file is fine - the last rename wins and both values were right.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const TTL_MS = 3000;

function file(name) {
  const dir = process.env.CCBAR_STATE || os.tmpdir();
  const hash = crypto.createHash('sha1').update(String(name)).digest('hex').slice(0, 12);
  return path.join(dir, 'ccbar-cache-' + hash + '.json');
}

/* remember(name, ttlMs, compute) -> the value, from the file if it is young enough */
function remember(name, ttlMs, compute) {
  const f = file(name);
  const ttl = Number.isFinite(ttlMs) ? ttlMs : TTL_MS;
  try {
    const kept = JSON.parse(fs.readFileSync(f, 'utf8'));
    const age = Date.now() - kept.ts;
    /* a negative age is a clock that jumped back: not fresh, whatever it says */
    if (kept && typeof kept.ts === 'number' && age >= 0 && age < ttl) return kept.value;
  } catch (_) {}
  const value = compute();
  const tmp = f + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify({ ts: Date.now(), value: value }));
    fs.renameSync(tmp, f);
  } catch (_) {
    try {
      fs.unlinkSync(tmp);
    } catch (_) {}
  }
  return value;
}

module.exports = { remember, file, TTL_MS };
