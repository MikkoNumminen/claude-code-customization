'use strict';
/*
 * A reading a few seconds old is as good as a fresh one - and the session's
 * own never comes from the cache.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { SRC, tmpState, discard, suite, wait } = require('./harness.js');

const STATUSLINE = path.join(SRC, 'statusline.js');

function publish(state, key, used, resets) {
  fs.writeFileSync(
    path.join(state, key + '.json'),
    JSON.stringify({ name: key, used: used, resets: resets, label: 'SESSION', ts: Date.now() })
  );
}

function statusLine(state, key, used, resets) {
  return new Promise((resolve) => {
    const env = Object.assign({}, process.env, { CCBAR_STATE: state, CCBAR_ID: key });
    const p = spawn(process.execPath, [STATUSLINE], { stdio: ['pipe', 'pipe', 'ignore'], env: env, windowsHide: true });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('close', () => resolve(out.replace(/\x1b\[[0-9;]*m/g, '')));
    p.stdin.end(
      JSON.stringify({
        workspace: { current_dir: 'C:\\Takaovi\\Koodia' },
        rate_limits: { five_hour: { used_percentage: used, resets_at: resets } },
      })
    );
  });
}

module.exports = async function () {
  const s = suite();
  const state = tmpState();
  const NOW = Math.floor(Date.now() / 1000) + 3600;

  try {
    /* --- the module itself --- */
    process.env.CCBAR_STATE = state; // cache.js files its cache under the suite's state directory
    const cache = require(path.join(SRC, 'cache.js'));
    let computed = 0;
    const compute = () => ++computed;
    s.ok('computes the first time', cache.remember('t1', 500, compute) === 1 && computed === 1);
    s.ok('and not again inside the TTL', cache.remember('t1', 500, compute) === 1 && computed === 1);
    await wait(600);
    s.ok('but does once the TTL is over', cache.remember('t1', 500, compute) === 2 && computed === 2);
    s.ok('the file lives where it was told to', cache.file('t1').startsWith(state), cache.file('t1'));
    delete process.env.CCBAR_STATE;

    /* --- the status line's use of it --- */
    publish(state, 'other', 30, NOW);
    const first = await statusLine(state, 'mine', 20, NOW);
    s.ok('the account figure comes from every session (the gauge shows what is left)', /\b70%/.test(first), JSON.stringify(first.trim()));

    publish(state, 'other', 70, NOW); // another window moved on, inside the TTL
    const second = await statusLine(state, 'mine', 20, NOW);
    s.ok('a scan a moment old is reused rather than redone', /\b70%/.test(second), JSON.stringify(second.trim()));

    const third = await statusLine(state, 'mine', 45, NOW); // this session moved
    s.ok("the session's own reading is never the cached one", /\b55%/.test(third), JSON.stringify(third.trim()));

    await wait(cache.TTL_MS + 200);
    const fourth = await statusLine(state, 'mine', 45, NOW);
    s.ok('and the other windows catch up once the TTL is over', /\b30%/.test(fourth), JSON.stringify(fourth.trim()));
  } finally {
    discard(state);
  }

  return s.report();
};
