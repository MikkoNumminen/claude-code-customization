#!/usr/bin/env node
'use strict';
/*
 * ccbar's tests.
 *
 *   node test/run.js
 *
 * Everything here is headless and runs against src/, each suite in a state
 * directory of its own, so a run cannot disturb a session that is open. No
 * dependencies, no runner to install: node and this file.
 *
 * The one thing it cannot cover is the window. Whether a pane really closes
 * when its session ends, and whether the layout collapses back to a single
 * full-height terminal, is test/e2e.ps1 - run by hand, in a real Windows
 * Terminal window.
 */

const SUITES = ['fit', 'paint', 'lifetime', 'statusline', 'width', 'sweep'];

(async () => {
  let failed = 0;
  for (const name of SUITES) {
    console.log('');
    console.log(name);
    try {
      failed += await require('./' + name + '.js')();
    } catch (e) {
      console.log('  FAIL  the suite itself threw: ' + (e && e.message));
      failed++;
    }
  }
  console.log('');
  console.log(failed ? failed + ' failing' : 'all good');
  process.exit(failed ? 1 : 0);
})();
