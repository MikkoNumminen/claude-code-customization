'use strict';
/*
 * Every row the bar draws has to fit the pane it is drawn in.
 *
 * A row one column too long wraps, and a wrapped row scrolls the three-row
 * composition off the top of the pane - which is how a narrow window used to
 * lose the project name entirely. This renders the real composition at every
 * width and measures what comes out.
 */

const path = require('path');
const { SRC, suite } = require('./harness.js');
const theme = require(path.join(SRC, 'theme.js'));

/* the composition from topbar.js frame() */
function compose(name, info, cols, t) {
  const budget = Math.max(12, cols - 2);
  const gauge = Math.max(8, Math.min(46, budget - 24));
  return [
    theme.center(theme.titleLine(name, t, { max: budget }), cols),
    theme.center(theme.meterLine(info, t, { width: gauge, max: budget }), cols),
  ];
}

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

  let over = 0;
  let blank = 0;
  let checked = 0;
  let widest = '';

  for (let cols = 20; cols <= 200; cols++) {
    for (const name of NAMES) {
      for (const info of INFOS) {
        for (const t of [0, 3.7, 11.2]) {
          checked++;
          compose(name, info, cols, t).forEach((line, i) => {
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

  s.ok('every row fits its pane, 20 to 200 columns', over === 0,
    over ? over + ' too wide, e.g. ' + widest : checked + ' compositions');
  s.ok('no row ever renders empty', blank === 0, blank ? blank + ' blank' : undefined);

  /* the reading is the one thing that is never given up */
  const tiny = compose('Koodia', { used: 98, label: 'SESSION', eta: '1h54m' }, 24, 0);
  s.ok('the percentage survives the narrowest pane', /98%|\d+%/.test(tiny[1].replace(/\x1b\[[0-9;]*m/g, '')));

  return s.report();
};
