'use strict';
/*
 * Two windows of different widths must not read each other's terminal.
 *
 * The reading used to live in one file per machine, so whichever window wrote
 * last decided how every other one centred its console. center() pads on the
 * left only, so the leading spaces are the proof of which width was used.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { SRC, tmpState, discard, suite } = require('./harness.js');

const STATUSLINE = path.join(SRC, 'statusline.js');
const PAYLOAD = JSON.stringify({
  workspace: { current_dir: 'C:\\Takaovi\\Koodia' },
  context_window: { used_percentage: 42 },
});

function setWidth(state, token, cols) {
  fs.writeFileSync(path.join(state, token + '.width'), JSON.stringify({ cols: cols, rows: 3, ts: Date.now() }));
}

function render(state, token) {
  return new Promise((resolve) => {
    const env = Object.assign({}, process.env, { CCBAR_STATE: state, CCBAR_ID: token });
    delete env.COLUMNS;
    const p = spawn(process.execPath, [STATUSLINE], { stdio: ['pipe', 'pipe', 'ignore'], env: env });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('exit', () => {
      const first = out.split('\n')[0] || '';
      resolve({ pad: (first.match(/^ */) || [''])[0].length, out: out });
    });
    p.stdin.end(PAYLOAD);
  });
}

const bare = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

module.exports = async function () {
  const s = suite();
  const state = tmpState();

  try {
    setWidth(state, 'winWide', 120);
    setWidth(state, 'winNarrow', 40);

    const wide = await render(state, 'winWide');
    const narrow = await render(state, 'winNarrow');
    s.ok('each window centres against its own width', wide.pad > narrow.pad,
      'wide pad=' + wide.pad + ', narrow pad=' + narrow.pad);

    setWidth(state, 'winNarrow', 200);
    const again = await render(state, 'winWide');
    s.ok('another window resizing leaves this one alone', wide.pad === again.pad,
      'pad ' + wide.pad + ' -> ' + again.pad);

    const unknown = await render(state, 'winUnknown');
    s.ok('an unknown width draws flush left rather than on a guess', unknown.pad === 0, 'pad=' + unknown.pad);

    s.ok('neither window renders wider than its own terminal',
      wide.out.split('\n').every((l) => bare(l).length <= 120) &&
      narrow.out.split('\n').every((l) => bare(l).length <= 40));
  } finally {
    discard(state);
  }

  return s.report();
};
