'use strict';
/*
 * Shared bits of the suite.
 *
 * Every test runs against src/ and against a state directory of its own, handed
 * over through CCBAR_STATE. Nothing here ever reads or writes the real one, so
 * a test run cannot disturb a session that happens to be open.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');

function tmpState() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ccbar-test-'));
}

function discard(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
}

/* Collects results so a suite prints as one block and reports one number. */
function suite() {
  const results = [];
  return {
    ok(label, pass, detail) {
      results.push({ label: label, pass: !!pass, detail: detail });
    },
    report() {
      for (const r of results) {
        console.log('  ' + (r.pass ? 'PASS  ' : 'FAIL  ') + r.label + (r.detail ? '  (' + r.detail + ')' : ''));
      }
      return results.filter((r) => !r.pass).length;
    },
  };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* An age a sweep is meant to notice. */
function age(file, minutes) {
  const when = new Date(Date.now() - minutes * 60000);
  fs.utimesSync(file, when, when);
}


/*
 * The node processes whose parent is `pid`, as [{ pid, cmd }]. What a leak
 * test counts: a status line that is still there seconds after it was asked
 * for one line of output. Windows answers through WMI, everything else
 * through ps; both are read-only.
 */
function nodeChildren(pid) {
  const { execFileSync } = require('child_process');
  try {
    if (process.platform === 'win32') {
      const script =
        "Get-CimInstance Win32_Process -Filter \"ParentProcessId=" + pid + " and Name='node.exe'\" | " +
        'ForEach-Object { $_.ProcessId.ToString() + "`t" + $_.CommandLine }';
      const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 30000,
      });
      return out.split(/\r?\n/).filter(Boolean).map((l) => {
        const i = l.indexOf('\t');
        return { pid: parseInt(l.slice(0, i), 10), cmd: l.slice(i + 1) };
      });
    }
    const out = execFileSync('ps', ['-axo', 'pid=,ppid=,args='], { encoding: 'utf8', timeout: 30000 });
    return out.split('\n').map((l) => l.trim().split(/\s+/)).filter((f) => f.length >= 3 && parseInt(f[1], 10) === pid && /node/.test(f[2]))
      .map((f) => ({ pid: parseInt(f[0], 10), cmd: f.slice(2).join(' ') }));
  } catch (_) {
    return [];
  }
}

module.exports = { SRC, tmpState, discard, suite, wait, age, nodeChildren };
