'use strict';
/*
 * The status line has to end, every time.
 *
 * It writes its rows and then has nothing left to do, but it used to go on
 * listening on stdin - and a session that goes away without closing the pipe,
 * which is how sessions usually go, left the process behind for good.
 */

const { spawn } = require('child_process');
const path = require('path');
const { SRC, tmpState, discard, suite } = require('./harness.js');

const STATUSLINE = path.join(SRC, 'statusline.js');
const PAYLOAD = JSON.stringify({
  workspace: { current_dir: 'C:\\Takaovi\\Koodia' },
  context_window: { used_percentage: 42 },
});

function run(state, feed, budgetMs) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn(process.execPath, [STATUSLINE], {
      stdio: ['pipe', 'pipe', 'ignore'],
      env: Object.assign({}, process.env, { CCBAR_STATE: state, CCBAR_ID: 'slTest' }),
    });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    const giveUp = setTimeout(() => {
      p.kill();
      resolve({ ended: false, ms: budgetMs, out: out });
    }, budgetMs);
    p.on('exit', () => {
      clearTimeout(giveUp);
      resolve({ ended: true, ms: Date.now() - t0, out: out });
    });
    feed(p.stdin);
  });
}

module.exports = async function () {
  const s = suite();
  const state = tmpState();

  try {
    const a = await run(state, (i) => i.end(PAYLOAD), 4000);
    s.ok('ends when stdin is closed normally', a.ended && a.out.trim().length > 0, a.ms + 'ms');

    const b = await run(state, (i) => i.write(PAYLOAD), 6000);
    s.ok('ends even if nobody closes stdin', b.ended && b.out.trim().length > 0, b.ms + 'ms');

    const c = await run(state, () => {}, 6000);
    s.ok('ends even if nothing is ever sent', c.ended, c.ms + 'ms');
    s.ok('still draws something with no payload at all', c.out.trim().length > 0);
  } finally {
    discard(state);
  }

  return s.report();
};
