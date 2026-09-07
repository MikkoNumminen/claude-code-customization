'use strict';
/*
 * The gauge shows the account's usage, not one session's memory of it.
 *
 * Measured on a machine with three windows open: 40, 41 and 43 percent of the
 * same five-hour window, at the same moment, and only the window being typed
 * into moved. Each session learns the figure from its own API calls, so an
 * idle one reports whatever it last saw. The limit is the account's, so every
 * bar and status line takes the freshest reading any session has.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { SRC, tmpState, discard, suite } = require('./harness.js');

const { accountLimit } = require(path.join(SRC, 'payload.js'));
const STATUSLINE = path.join(SRC, 'statusline.js');

const bare = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

function publish(state, key, used, resets, label) {
  fs.writeFileSync(
    path.join(state, key + '.json'),
    JSON.stringify({ name: key, used: used, resets: resets, label: label || 'SESSION', ts: Date.now() })
  );
}

/* The status line for session `key`, given its own reading. */
function statusLine(state, key, payload) {
  return new Promise((resolve) => {
    const env = Object.assign({}, process.env, { CCBAR_STATE: state, CCBAR_ID: key });
    const p = spawn(process.execPath, [STATUSLINE], { stdio: ['pipe', 'pipe', 'ignore'], env: env });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('exit', () => resolve(bare(out)));
    p.stdin.end(JSON.stringify(payload));
  });
}

module.exports = async function () {
  const s = suite();
  const state = tmpState();
  const NOW = 1788801000;

  try {
    /* --- the rule itself --- */
    const idleA = { used: 40, resets: NOW, label: 'SESSION' };
    const idleB = { used: 41, resets: NOW, label: 'SESSION' };
    const busy = { used: 43, resets: NOW, label: 'SESSION' };
    s.ok('the highest reading in the window is the account\'s',
      accountLimit([idleA, busy, idleB]).used === 43);

    const lastWindow = { used: 92, resets: NOW - 5 * 3600, label: 'SESSION' };
    const fresh = { used: 3, resets: NOW, label: 'SESSION' };
    const r = accountLimit([lastWindow, fresh]);
    s.ok('a session still reporting the previous window is passed over after a reset',
      r.used === 3 && r.resets === NOW, JSON.stringify(r));

    const ctx = { used: 99, resets: null, label: 'CONTEXT' };
    s.ok('a context-window reading is one session\'s own and never merges',
      accountLimit([ctx, idleA]).used === 40 && accountLimit([ctx]) === null);

    s.ok('a reset given as an ISO string still orders', accountLimit([
      { used: 80, resets: new Date((NOW - 18000) * 1000).toISOString(), label: 'SESSION' },
      { used: 5, resets: new Date(NOW * 1000).toISOString(), label: 'SESSION' },
    ]).used === 5);

    s.ok('nothing to read gives nothing', accountLimit([]) === null && accountLimit(null) === null);

    /* --- the status line of an idle session --- */
    publish(state, 'busy', 43, NOW);
    publish(state, 'stale', 92, NOW - 5 * 3600);
    const idle = await statusLine(state, 'idle', {
      workspace: { current_dir: 'C:\\Takaovi\\Koodia' },
      rate_limits: { five_hour: { used_percentage: 40, resets_at: NOW } },
    });
    s.ok('an idle session draws the account\'s figure, not its own', /\b57%/.test(idle), JSON.stringify(idle.trim()));
    let own = null;
    try {
      own = JSON.parse(fs.readFileSync(path.join(state, 'idle.json'), 'utf8')).used;
    } catch (_) {}
    s.ok('but publishes what it was actually told', own === 40, 'published ' + own);

    const apiKey = await statusLine(state, 'apikey', {
      workspace: { current_dir: 'C:\\Takaovi\\Koodia' },
      context_window: { used_percentage: 10 },
    });
    s.ok('a session with no plan limit keeps its context gauge', /CONTEXT/.test(apiKey) && /\b90%/.test(apiKey),
      JSON.stringify(apiKey.trim()));
  } finally {
    discard(state);
  }

  return s.report();
};
