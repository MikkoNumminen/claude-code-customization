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

module.exports = { SRC, tmpState, discard, suite, wait, age };
