'use strict';
/*
 * Everything ccbar starts for an answer ends - and on time.
 *
 * The watchdog is the status line's last word: never unref'd, it ends the
 * process at its deadline with exit 1 and one line on stderr, whatever else
 * is still open. And a child run for a result gets a deadline of its own,
 * at which it is killed with everything it started - killing a PowerShell
 * alone would leave the wt.exe it spawned behind.
 */

const { spawn } = require('child_process');
const path = require('path');
const { SRC, suite, wait, nodeProcesses } = require('./harness.js');

const child = require(path.join(SRC, 'child.js'));
const WATCHDOG = path.join(SRC, 'watchdog.js').replace(/\\/g, '/');

/* A process that arms the watchdog and then keeps itself alive forever. */
function hang(ms) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const script = "require('" + WATCHDOG + "').arm(" + ms + ", 'test: watchdog'); setInterval(() => {}, 1000);";
    const p = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.stdout.resume();
    const giveUp = setTimeout(() => {
      p.kill();
      resolve({ ended: false, ms: Date.now() - t0, code: null, err: err });
    }, ms + 3000);
    p.on('close', (code) => {
      clearTimeout(giveUp);
      resolve({ ended: true, ms: Date.now() - t0, code: code, err: err });
    });
  });
}

module.exports = async function () {
  const s = suite();

  /* --- the watchdog --- */
  const w = await hang(400);
  s.ok('the watchdog ends a process that would otherwise live forever', w.ended, w.ms + 'ms');
  s.ok('at its deadline, not before', w.ms >= 380 && w.ms < 2400, w.ms + 'ms');
  s.ok('with exit code 1', w.code === 1, 'code ' + w.code);
  s.ok('and says so on stderr', /test: watchdog/.test(w.err), JSON.stringify(w.err.trim()));

  /* --- a child with a deadline --- */
  const marker = 'ccbar-exit-test-' + Date.now().toString(36);
  const grandchild = 'setInterval(() => {}, 1000)';
  const parent =
    "const { spawn } = require('child_process');" +
    "spawn(process.execPath, ['-e', " + JSON.stringify(grandchild) + ", '--', '" + marker + "'], { stdio: 'inherit' });" +
    'setInterval(() => {}, 1000);';
  const t0 = Date.now();
  const r = await child.run(process.execPath, ['-e', parent, '--', marker], { timeoutMs: 500 });
  s.ok('a child that never returns is given up on at its deadline', r.timedOut && Date.now() - t0 < 3000,
    (Date.now() - t0) + 'ms, timedOut=' + r.timedOut);
  await wait(500);
  const tree = nodeProcesses().filter((p) => p.cmd.indexOf(marker) !== -1);
  s.ok('and taken down with everything it started', tree.length === 0, tree.length + ' of the tree still running');

  const ok = await child.run(process.execPath, ['-e', "process.stdout.write('fine'); process.exit(3)"], { timeoutMs: 5000 });
  s.ok('a child that returns is reported as it went', ok.status === 3 && ok.stdout === 'fine' && !ok.timedOut,
    'status ' + ok.status + ' out ' + JSON.stringify(ok.stdout));

  const missing = await child.run('ccbar-no-such-program-' + marker, [], { timeoutMs: 5000 });
  s.ok('a program that is not there is an error, not a hang', !!missing.error && !missing.timedOut,
    missing.error ? missing.error.code : 'no error');

  return s.report();
};
