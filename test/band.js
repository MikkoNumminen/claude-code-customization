'use strict';
/*
 * Installed as the band, `cc` is plain Claude Code: the launcher reads the
 * installer's marker, splits nothing, says nothing, and the sweep never takes
 * the marker for a finished session's file.
 *
 * Driven through launch.js with `--version`, so whatever it hands over to
 * ends at once. The band itself is tested by `claude plugin test
 * plugins/ccbar-band`.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { SRC, tmpState, discard, suite, age } = require('./harness.js');

const LAUNCH = path.join(SRC, 'launch.js');

function runLauncher(state) {
  return new Promise((resolve) => {
    let err = '';
    const p = spawn(process.execPath, [LAUNCH, '--version'], {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: Object.assign({}, process.env, { CCBAR_STATE: state }),
    });
    p.stderr.on('data', (d) => { err += d; });
    p.on('exit', () => resolve(err));
    p.on('error', () => resolve(err));
  });
}

const logOf = (state) => {
  try {
    return fs.readFileSync(path.join(state, 'launch.log'), 'utf8');
  } catch (_) {
    return '';
  }
};

const lastLine = (state) => logOf(state).trim().split('\n').pop().replace(/^\S+\s+/, '');

module.exports = async function () {
  const s = suite();
  const band = tmpState();
  const bar = tmpState();

  try {
    const marker = path.join(band, 'topbar.off');
    fs.writeFileSync(marker, 'set by install.ps1 -Mode Band');
    age(marker, 24 * 60);

    const said = await runLauncher(band);
    s.ok('with the marker the launcher hands over without a split', /top bar off/.test(logOf(band)), lastLine(band));
    s.ok('and without a word', !/ccbar:/.test(said), said.trim() || 'silent');
    s.ok('a day-old marker survives the sweep', fs.existsSync(marker));

    await runLauncher(bar);
    s.ok('without it the launcher still weighs the split',
      /blocked: /.test(logOf(bar)) && !/top bar off/.test(logOf(bar)), lastLine(bar));
  } finally {
    discard(band);
    discard(bar);
  }

  return s.report();
};
