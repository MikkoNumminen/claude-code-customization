'use strict';
/*
 * ccbar - running something else, with an end in sight.
 *
 * Every child ccbar starts for a result goes through here: stdin closed, so
 * it cannot sit waiting for input; its output collected; and a deadline,
 * after which it is killed together with everything it started - on Windows
 * taskkill /T, because killing a PowerShell that has spawned wt.exe leaves
 * wt.exe behind otherwise. The promise always resolves, with what happened
 * in it; nothing here throws and nothing is left running.
 *
 * Not for the two children that are the point of the launcher - claude.exe
 * and the bar itself. Those inherit the terminal and live exactly as long as
 * the session, by design; a deadline on either would be a bug.
 */

const { spawn, spawnSync } = require('child_process');

function killTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true, timeout: 5000 });
    } else {
      spawnSync('pkill', ['-KILL', '-P', String(pid)], { stdio: 'ignore', timeout: 5000 });
      process.kill(pid, 'SIGKILL');
    }
  } catch (_) {}
}

/*
 * run(file, args, { timeoutMs, env }) ->
 *   { pid, status, signal, error, stdout, stderr, timedOut }
 */
function run(file, args, opts) {
  const o = opts || {};
  const timeoutMs = Number.isFinite(o.timeoutMs) && o.timeoutMs > 0 ? o.timeoutMs : 15000;
  return new Promise((resolve) => {
    const result = { pid: null, status: null, signal: null, error: null, stdout: '', stderr: '', timedOut: false };
    let child;
    try {
      child = spawn(file, args || [], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: o.env });
    } catch (e) {
      result.error = e;
      return resolve(result);
    }
    result.pid = child.pid;

    let settled = false;
    let timer = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    timer = setTimeout(() => {
      result.timedOut = true;
      killTree(child.pid);
    }, timeoutMs);

    const collect = (name) => (d) => {
      if (result[name].length < 1e6) result[name] += d;
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', collect('stdout'));
    child.stderr.on('data', collect('stderr'));
    child.on('error', (e) => {
      result.error = e;
      finish();
    });
    child.on('close', (code, signal) => {
      result.status = code;
      result.signal = signal;
      finish();
    });
  });
}

module.exports = { run, killTree };
