'use strict';
/*
 * The bar lives exactly as long as its session.
 *
 * The pane below is faked with the markers it would leave, so the rules can be
 * exercised without a Windows Terminal window. Whether the pane really closes
 * and the layout collapses is test/e2e.ps1, which needs a real one.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { SRC, tmpState, discard, suite, wait } = require('./harness.js');

const TOPBAR = path.join(SRC, 'topbar.js');

function startBar(state, token) {
  const p = spawn(process.execPath, [TOPBAR, '--stop', token, '--name', 'test'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { CCBAR_STATE: state }),
  });
  p.stdout.resume();
  p.stderr.resume();
  p.exited = false;
  p.on('exit', () => { p.exited = true; });
  return p;
}

async function leavesWithin(p, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (p.exited) return Date.now() - t0;
    await wait(50);
  }
  return null;
}

module.exports = async function () {
  const s = suite();
  const state = tmpState();

  try {
    /* a session that is up */
    const a = startBar(state, 'tokA');
    await wait(1500);
    s.ok('draws while the session is up', !a.exited);

    /* it exits: the marker its runner leaves */
    fs.writeFileSync(path.join(state, 'tokA.stop'), '');
    const left = await leavesWithin(a, 3000);
    s.ok('leaves on the stop marker', left !== null, left === null ? 'still there after 3s' : left + 'ms');
    s.ok('takes its stop marker with it', !fs.existsSync(path.join(state, 'tokA.stop')));
    s.ok('takes its claim with it', !fs.existsSync(path.join(state, 'tokA.claim')));
    s.ok('takes its width with it', !fs.existsSync(path.join(state, 'tokA.width')));
    if (!a.exited) a.kill();

    /* an ending too abrupt to leave a marker: the pane is simply gone */
    fs.writeFileSync(path.join(state, 'tokB.started'), String(process.pid) + '\r\n');
    const b = startBar(state, 'tokB');
    await wait(1200);
    s.ok('a running pane keeps it up', !b.exited);

    const gone = spawn(process.execPath, ['-e', 'process.exit(0)']);
    await new Promise((r) => gone.on('exit', r));
    fs.writeFileSync(path.join(state, 'tokB.started'), String(gone.pid) + '\r\n');
    const left2 = await leavesWithin(b, 3000);
    s.ok('leaves when its pane is gone', left2 !== null, left2 === null ? 'still there after 3s' : left2 + 'ms');
    if (!b.exited) b.kill();
  } finally {
    discard(state);
  }

  return s.report();
};
