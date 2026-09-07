'use strict';
/*
 * ccbar - what every session on the machine has published.
 *
 * One small JSON file per session, written by its status line once a second.
 * Reading them all is how a bar sees the account's real usage rather than the
 * figure its own session last happened to fetch - see accountLimit() in
 * payload.js. Nothing here throws: a file caught mid-write is simply skipped
 * this time round.
 */

const fs = require('fs');
const path = require('path');

/* -> [{ key, used, resets, label, ... }] for every readable session file */
function readings(dir) {
  const out = [];
  let files;
  try {
    files = fs.readdirSync(dir);
  } catch (_) {
    return out;
  }
  for (const f of files) {
    /* term.json is not a session: an older install may have left one */
    if (!f.endsWith('.json') || f === 'term.json') continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (parsed && typeof parsed === 'object') out.push(Object.assign({ key: f.slice(0, -5) }, parsed));
    } catch (_) {}
  }
  return out;
}

module.exports = { readings };
