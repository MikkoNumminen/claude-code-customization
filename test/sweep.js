'use strict';
/*
 * The launcher clears up after sessions that are over, and after nothing else.
 *
 * Driven through launch.js itself rather than a copy of the rule: `--version`
 * is a non-interactive argument, so the launcher sweeps, declines to build a
 * layout and hands straight over - which is all this needs.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { SRC, tmpState, discard, suite, age } = require('./harness.js');

const LAUNCH = path.join(SRC, 'launch.js');

function put(state, file, body, minutesOld) {
  const full = path.join(state, file);
  fs.writeFileSync(full, body === undefined ? '' : String(body));
  if (minutesOld) age(full, minutesOld);
  return full;
}

function runLauncher(state) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [LAUNCH, '--version'], {
      stdio: 'ignore',
      env: Object.assign({}, process.env, { CCBAR_STATE: state }),
    });
    p.on('exit', () => resolve());
    p.on('error', () => resolve()); // claude.exe missing is fine: the sweep already ran
  });
}

module.exports = async function () {
  const s = suite();
  const state = tmpState();

  try {
    const dead = spawn(process.execPath, ['-e', 'process.exit(0)']);
    await new Promise((r) => dead.on('exit', r));

    /* a session that is over: quiet for an hour, its pane gone */
    for (const ext of ['.json', '.claim', '.width']) put(state, 'over' + ext, '{}', 60);
    put(state, 'over.started', dead.pid, 60);

    /* a session that is alive right now */
    for (const ext of ['.json', '.claim', '.width']) put(state, 'live' + ext, '{}');
    put(state, 'live.started', process.pid);

    /* quiet for an hour, but its pane is still running */
    put(state, 'idle.json', '{}', 60);
    put(state, 'idle.started', process.pid, 60);

    /* not ours to delete, however old */
    put(state, 'launch.log', 'old entries', 60);

    /* an install from before per-session widths */
    put(state, 'term.json', '{"cols":80}', 60);

    await runLauncher(state);
    const left = fs.readdirSync(state).sort();

    s.ok('a finished session is cleared away',
      !left.some((f) => f.startsWith('over.')), left.filter((f) => f.startsWith('over.')).join(',') || 'gone');
    s.ok('a live session is left alone',
      ['live.json', 'live.claim', 'live.width', 'live.started'].every((f) => left.includes(f)));
    s.ok('a quiet session whose pane still runs is left alone',
      left.includes('idle.json') && left.includes('idle.started'));
    s.ok('the launcher log is never touched', left.includes('launch.log'));
    s.ok('a leftover shared width file is cleared away', !left.includes('term.json'));
    /* live x4 + idle x2 + the log */
    s.ok('nothing else went missing', left.length === 7, 'kept: ' + left.join(', '));
  } finally {
    discard(state);
  }

  return s.report();
};
