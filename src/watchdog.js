'use strict';
/*
 * ccbar - the hard stop.
 *
 * A status line is asked for one line of output and is then supposed to be
 * gone. Whatever keeps it from going - a pipe whose other end has vanished, a
 * stream that never calls back, a handle nobody knew was open - this timer is
 * the one thing in the process that cannot be reasoned with: it is never
 * unref'd, it waits its allotted time, and then it ends the process with a
 * non-zero code and one short line on stderr saying so.
 *
 * It exists because of the other kind of exit, the one that is supposed to
 * happen on its own when the event loop drains. On one machine it did not,
 * about once a minute, and nobody saw the process that stayed: it has no
 * window. Thirteen hundred of them later it was fifty gigabytes of RAM.
 */

function arm(ms, note) {
  const t = setTimeout(() => {
    try {
      process.stderr.write((note || 'ccbar: gave up after ' + ms + 'ms') + '\n');
    } catch (_) {}
    process.exit(1);
  }, ms);
  return t;
}

module.exports = { arm };
