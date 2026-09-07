'use strict';
/*
 * Every row the bar draws has to fit the pane it is drawn in.
 *
 * A row one column too long wraps, and a wrapped row scrolls the three-row
 * composition off the top of the pane - which is how a narrow window used to
 * lose the project name entirely. This renders the real composition at every
 * width, at two rows and at one, and measures what comes out.
 *
 * One row is not a corner case. Windows Terminal keeps panes in proportion to
 * the window, so a bar given two rows of a tall window is given one when that
 * window is carried to a shorter monitor - which, on a laptop that moves
 * between docks, is every day.
 */

const path = require('path');
const { SRC, suite } = require('./harness.js');
const theme = require(path.join(SRC, 'theme.js'));

const bare = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

const NAMES = ['Koodia', 'ccbar', 'a', 'MFPropertyManagement', 'a-very-long-project-name-indeed'];
const INFOS = [
  { used: 98, label: 'SESSION', eta: '1h54m' },
  { used: 2, label: 'CONTEXT', eta: null },
  { used: 50, label: 'SESSION', eta: '12h07m' },
  { used: 100, label: 'SESSION', eta: '0m' },
  null, // no reading published yet
];

module.exports = function () {
  const s = suite();

  for (const rows of [2, 1]) {
    let over = 0;
    let blank = 0;
    let wrongCount = 0;
    let checked = 0;
    let widest = '';

    for (let cols = 20; cols <= 200; cols++) {
      for (const name of NAMES) {
        for (const info of INFOS) {
          for (const t of [0, 3.7, 11.2]) {
            checked++;
            const lines = theme.compose(name, info, cols, rows, t);
            if (lines.length !== rows) wrongCount++;
            lines.forEach((line, i) => {
              const w = theme.visibleWidth(line);
              if (w > cols - 1) {
                over++;
                if (!widest) widest = 'cols=' + cols + ' row' + (i + 1) + ' width=' + w + ' name=' + name;
              }
              if (theme.visibleWidth(line.trim()) === 0) blank++;
            });
          }
        }
      }
    }

    const at = rows + '-row pane';
    s.ok('every row fits a ' + at + ', 20 to 200 columns', over === 0,
      over ? over + ' too wide, e.g. ' + widest : checked + ' compositions');
    s.ok('no row of a ' + at + ' ever renders empty', blank === 0, blank ? blank + ' blank' : undefined);
    s.ok('a ' + at + ' gets exactly ' + rows + ' row' + (rows > 1 ? 's' : '') + ' - never one more to scroll on',
      wrongCount === 0, wrongCount ? wrongCount + ' wrong' : undefined);
  }

  /* the reading is the one thing that is never given up */
  const tiny = theme.compose('Koodia', { used: 98, label: 'SESSION', eta: '1h54m' }, 24, 2, 0);
  s.ok('the percentage survives the narrowest pane', /\d+%/.test(bare(tiny[1])));

  /* on a single row the title still leads and the gauge still reads */
  const one = bare(theme.compose('Koodia', { used: 98, label: 'SESSION', eta: '1h54m' }, 80, 1, 0)[0]);
  s.ok('one row carries the title and the reading side by side',
    /K ?O ?O ?D ?I ?A/.test(one) && /\d+%/.test(one), JSON.stringify(one.trim()));
  const oneNarrow = bare(theme.compose('MFPropertyManagement', { used: 50, label: 'SESSION', eta: '1h' }, 30, 1, 0)[0]);
  s.ok('a narrow single row keeps the name over the gauge', /M F|MF/.test(oneNarrow), JSON.stringify(oneNarrow.trim()));

  return s.report();
};
