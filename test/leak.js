'use strict';
/*
 * No status line is ever left behind.
 *
 * Claude Code runs statusline.js once a second (refreshInterval) and on every
 * event besides, and when a new trigger arrives while a run is still going it
 * cancels the run in flight: the wrapper is killed and both pipes are closed.
 * A status line that cannot cope with that is one process more each time it
 * happens, and nobody sees them - they have no window. One machine collected
 * about 1,300 of them in a day, 52 GB of RAM between them, before anyone
 * looked.
 *
 * So this does what Claude Code does, thirty times: a realistic payload on
 * stdin, the output read back, and every other run cancelled the way a new
 * trigger cancels it - the reader goes away while the script is still
 * thinking. Three seconds later nothing may be left, and every run that ended
 * must have ended inside the two seconds the watchdog allows.
 *
 *   node test/leak.js      stand-alone, with the counts printed
 */

const { spawn } = require('child_process');
const path = require('path');
const { SRC, tmpState, discard, suite, wait, nodeChildren } = require('./harness.js');

const STATUSLINE = path.join(SRC, 'statusline.js');
const RUNS = 30;
const SETTLE_MS = 3000;
const BUDGET_MS = 2000;

/* The shape Claude Code sends, trimmed to the fields ccbar reads. */
function payload(i) {
  return JSON.stringify({
    session_id: 'leak-' + i,
    transcript_path: 'C:\Users\me\.claude\projects\leak\leak-' + i + '.jsonl',
    cwd: 'C:\Takaovi\Koodia\ccbar',
    model: { id: 'claude-opus-5-5', display_name: 'Opus' },
    workspace: { current_dir: 'C:\Takaovi\Koodia\ccbar', project_dir: 'C:\Takaovi\Koodia\ccbar' },
    version: '2.1.295',
    output_style: { name: 'default' },
    cost: { total_cost_usd: 0.42, total_duration_ms: 120000, total_api_duration_ms: 30000, total_lines_added: 12, total_lines_removed: 3 },
    context_window: { total_input_tokens: 42000, total_output_tokens: 1200, context_window_size: 200000, used_percentage: 21, remaining_percentage: 79 },
    rate_limits: {
      five_hour: { used_percentage: 42, resets_at: Math.floor(Date.now() / 1000) + 3600 },
      seven_day: { used_percentage: 12, resets_at: Math.floor(Date.now() / 1000) + 86400 },
    },
    exceeds_200k_tokens: false,
  });
}

/*
 * One run. `cancel` is the host's cancellation: it has written the payload,
 * then loses interest - its reader is closed and its writer dropped - before
 * the script has answered. Resolves with how the run went; never rejects.
 */
function run(state, i, cancel) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const env = Object.assign({}, process.env, { CCBAR_STATE: state, COLUMNS: '120' });
    delete env.CCBAR_ID;
    const p = spawn(process.execPath, [STATUSLINE], { stdio: ['pipe', 'pipe', 'pipe'], env: env, windowsHide: true });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.resume();
    p.stdin.on('error', () => {});
    p.stdout.on('error', () => {});
    const result = { pid: p.pid, ended: false, ms: null, out: '', code: null, proc: p };
    p.on('exit', (code) => {
      result.ended = true;
      result.ms = Date.now() - t0;
      result.code = code;
    });
    p.on('close', () => {
      result.out = out; // complete only now: 'exit' can come before the last of stdout
    });
    if (cancel) {
      p.stdin.write(payload(i));
      setTimeout(() => {
        p.stdout.destroy();
        p.stdin.destroy();
      }, 100);
    } else {
      p.stdin.end(payload(i));
    }
    resolve(result);
  });
}

module.exports = async function () {
  const s = suite();
  const state = tmpState();
  const results = [];

  try {
    for (let i = 0; i < RUNS; i++) results.push(await run(state, i, i % 2 === 1));
    await wait(SETTLE_MS);

    const left = nodeChildren(process.pid).filter((c) => /statusline\.js/.test(c.cmd));
    const ended = results.filter((r) => r.ended);
    const slow = ended.filter((r) => r.ms >= BUDGET_MS);
    const drew = results.filter((r, i) => i % 2 === 0 && r.out.trim().length > 0);

    s.ok('no status line is left behind ' + SETTLE_MS / 1000 + 's after ' + RUNS + ' runs', left.length === 0,
      left.length + ' of ' + RUNS + ' still running');
    s.ok('every run ended', ended.length === RUNS, ended.length + ' of ' + RUNS + ' ended');
    s.ok('every run ended inside the watchdog\'s ' + BUDGET_MS + 'ms', slow.length === 0,
      'slowest ' + Math.max.apply(null, ended.map((r) => r.ms).concat([0])) + 'ms');
    s.ok('the runs that were read drew the console', drew.length === RUNS / 2, drew.length + ' of ' + RUNS / 2);
  } finally {
    /* only what this test started: a leak is counted, not kept */
    for (const r of results) if (!r.ended) try { r.proc.kill(); } catch (_) {}
    discard(state);
  }

  return s.report();
};

if (require.main === module) {
  console.log('leak');
  module.exports().then((failed) => process.exit(failed ? 1 : 0));
}
