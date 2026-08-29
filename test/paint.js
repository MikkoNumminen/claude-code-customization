'use strict';
/*
 * What the bar actually writes to its pane.
 *
 * Two of these are load-bearing and neither shows up in the composition
 * itself. Autowrap has to be off, or a row one column too long wraps and
 * scrolls the whole thing off the top. And every frame has to erase from the
 * end of the composition to the end of the pane: Windows Terminal scales panes
 * with the window and reflows the buffer when it does, so rows the composition
 * does not reach keep fragments of an older, wider gauge.
 *
 * Both are single escape sequences that are easy to lose in a refactor and
 * invisible until someone resizes a window, so they are asserted here.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { SRC, tmpState, discard, suite, wait } = require('./harness.js');

const TOPBAR = path.join(SRC, 'topbar.js');

module.exports = async function () {
  const s = suite();
  const state = tmpState();

  try {
    const bar = spawn(process.execPath, [TOPBAR, '--stop', 'painted', '--name', 'paint'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      env: Object.assign({}, process.env, { CCBAR_STATE: state }),
    });

    let out = '';
    bar.stdout.on('data', (d) => (out += d));
    await wait(1200);

    const opening = out.slice(0, 60);
    s.ok('takes the alternate screen, so the pane has no scrollback to reflow',
      opening.includes('\x1b[?1049h'));
    s.ok('hides the cursor on the way in', opening.includes('\x1b[?25l'));
    s.ok('turns autowrap off, so a long row is clipped and never wraps', opening.includes('\x1b[?7l'));
    s.ok('clears the pane before the first frame', opening.includes('\x1b[2J'));

    const frames = out.split('\x1b[H').length - 1;
    s.ok('re-homes the cursor every frame rather than drifting', frames > 10, frames + ' frames in 1.2s');
    s.ok('erases from the composition to the end of the pane', out.includes('\x1b[J'),
      'without this, a pane taller than two rows keeps whatever the reflow left');

    const before = out.length;
    fs.writeFileSync(path.join(state, 'painted.stop'), '');
    await new Promise((r) => bar.on('exit', r));
    const parting = out.slice(before);
    s.ok('gives the cursor back on the way out', parting.includes('\x1b[?25h'));
    s.ok('gives autowrap back to the shell that follows it', parting.includes('\x1b[?7h'));
    s.ok('hands the ordinary screen back, history and all', parting.includes('\x1b[?1049l'));
    s.ok('and does not wipe it on the way past', !parting.includes('\x1b[2J'),
      'leaving the alternate screen restores the shell as it was');
  } finally {
    discard(state);
  }

  return s.report();
};
