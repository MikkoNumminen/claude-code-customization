'use strict';
/*
 * The bar survives the machine going away.
 *
 * Sleep, hibernation, a laptop carried from one dock to another: the bar
 * draws no frames while it is gone, and comes back to a clock that has moved
 * on by hours. Every file in the state directory then looks abandoned at
 * once - the session's state, the bar's own claim - and two things used to
 * happen in the first second back: the bar judged its session dead and quit,
 * and the session's status line judged the bar dead and drew a console at the
 * bottom of the window. That is the bar "moving to the bottom" after every
 * sleep, and this is what pins it up.
 *
 * Nothing here can really sleep the machine. What it can do is age the files
 * the way a sleep does - the mtimes set hours back while the processes stay
 * up - which is exactly the evidence the rules used to act on.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { SRC, tmpState, discard, suite, wait, age } = require('./harness.js');

const TOPBAR = path.join(SRC, 'topbar.js');
const STATUSLINE = path.join(SRC, 'statusline.js');
const PAYLOAD = JSON.stringify({
  workspace: { current_dir: 'C:\\Takaovi\\Koodia' },
  context_window: { used_percentage: 42 },
});

function startBar(state, args, extraEnv) {
  const p = spawn(process.execPath, [TOPBAR].concat(args), {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { CCBAR_STATE: state }, extraEnv || {}),
  });
  p.stdout.resume();
  p.stderr.resume();
  p.exited = false;
  p.on('exit', () => { p.exited = true; });
  return p;
}

function publish(state, key) {
  fs.writeFileSync(path.join(state, key + '.json'), JSON.stringify({ name: 'wake', used: 40, ts: Date.now() }));
}

/* The status line, told it is session `key`: '' means a bar is drawing it. */
function statusLine(state, key) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const env = Object.assign({}, process.env, { CCBAR_STATE: state, CCBAR_ID: key });
    delete env.COLUMNS;
    const p = spawn(process.execPath, [STATUSLINE], { stdio: ['pipe', 'pipe', 'ignore'], env: env });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('exit', () => resolve({ out: out, ms: Date.now() - t0 }));
    p.stdin.end(PAYLOAD);
  });
}

/* A process that is alive and touches a claim like a bar does, or does not. */
function claimant(state, key, touch) {
  const script = touch
    ? "const fs=require('fs');const f=process.argv[1];setInterval(()=>fs.writeFileSync(f,String(process.pid)),200)"
    : 'setInterval(()=>{},1000)';
  const p = spawn(process.execPath, ['-e', script, path.join(state, key + '.claim')], { stdio: 'ignore' });
  return p;
}

module.exports = async function () {
  const s = suite();
  const state = tmpState();
  const HOURS = 8 * 60;

  try {
    /* --- a launcher-started bar: the runner's pid is the truth --- */
    fs.writeFileSync(path.join(state, 'tokSleep.started'), String(process.pid) + '\r\n');
    publish(state, 'tokSleep');
    const a = startBar(state, ['--stop', 'tokSleep', '--name', 'wake']);
    await wait(1200);
    s.ok('draws with its session up', !a.exited);

    /* the machine sleeps for the night: nothing is written, the clock moves on */
    age(path.join(state, 'tokSleep.json'), HOURS);
    age(path.join(state, 'tokSleep.claim'), HOURS);
    await wait(1500);
    s.ok('a state file hours old does not end a session whose pane is still running', !a.exited);

    const claimText = fs.readFileSync(path.join(state, 'tokSleep.claim'), 'utf8');
    s.ok('the claim names the bar by pid', parseInt(claimText, 10) === a.pid, claimText + ' vs ' + a.pid);
    s.ok('and is touched again within the second', Date.now() - fs.statSync(path.join(state, 'tokSleep.claim')).mtimeMs < 2000);

    /* and the status line, run before that first touch, still stands aside */
    age(path.join(state, 'tokSleep.claim'), HOURS);
    const quietLine = await statusLine(state, 'tokSleep');
    s.ok('the status line stays quiet for a bar that is alive but has not touched its claim since the clock jumped',
      quietLine.out.trim() === '', JSON.stringify(quietLine.out.slice(0, 40)));

    a.kill();
    await wait(300);

    /* --- a bar attached by hand, with no runner: quiet is counted in frames --- */
    publish(state, 'byHand');
    const b = startBar(state, ['byHand', '--name', 'wake'], { CCBAR_QUIET_MS: '1500' });
    await wait(800);
    s.ok('a hand-attached bar draws too', !b.exited);

    /* the session publishes on, but every write lands hours in the past */
    for (let i = 0; i < 8; i++) {
      publish(state, 'byHand');
      age(path.join(state, 'byHand.json'), HOURS + i);
      await wait(300);
    }
    s.ok('a session that keeps publishing is alive however old its clock says the file is', !b.exited);

    /* now it really stops */
    const t0 = Date.now();
    while (!b.exited && Date.now() - t0 < 5000) await wait(100);
    s.ok('and one that stops publishing is let go, after the quiet time has been drawn', b.exited,
      b.exited ? (Date.now() - t0) + 'ms' : 'still there after 5s');
    if (!b.exited) b.kill();

    /* --- the status line's side of the claim --- */
    const live = claimant(state, 'clLive', true);
    await wait(500);
    age(path.join(state, 'clLive.claim'), HOURS);
    const r1 = await statusLine(state, 'clLive');
    s.ok('an old claim held by a bar that is running and touching it: quiet', r1.out.trim() === '');
    live.kill();

    const idle = claimant(state, 'clIdle', false);
    fs.writeFileSync(path.join(state, 'clIdle.claim'), String(idle.pid));
    age(path.join(state, 'clIdle.claim'), HOURS);
    const r2 = await statusLine(state, 'clIdle');
    s.ok('an old claim whose pid is alive but never touches it - a reused pid - is nobody\'s: draws',
      r2.out.trim() !== '', r2.ms + 'ms');
    idle.kill();

    const dead = spawn(process.execPath, ['-e', 'process.exit(0)']);
    await new Promise((r) => dead.on('exit', r));
    fs.writeFileSync(path.join(state, 'clDead.claim'), String(dead.pid));
    age(path.join(state, 'clDead.claim'), HOURS);
    const r3 = await statusLine(state, 'clDead');
    s.ok('an old claim whose pid is gone: draws, without waiting', r3.out.trim() !== '' && r3.ms < 1200, r3.ms + 'ms');
  } finally {
    discard(state);
  }

  return s.report();
};
