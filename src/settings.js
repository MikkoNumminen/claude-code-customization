#!/usr/bin/env node
'use strict';
/*
 * ccbar - registers (or removes) the status line in ~/.claude/settings.json.
 *
 * Done in Node rather than in the installer's own shell so the file is parsed
 * and written as real JSON, with the rest of the user's settings preserved
 * byte-for-byte in meaning, and a timestamped backup left behind.
 *
 *   node settings.js install [--refresh <seconds>]
 *   node settings.js uninstall
 *
 * The refresh interval is how often Claude Code re-runs the status line on a
 * timer, on top of the runs its own events trigger (every new message, with
 * a 300ms debounce). Claude Code allows no less than 1. The default here is
 * 5: the countdown is in minutes and the gauge in whole percent, so nothing
 * on the line moves faster than that, and every run is a node process. A
 * value already in settings.json from an earlier install is kept.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const MODE = process.argv[2];
const HOME = os.homedir();
const FILE = path.join(HOME, '.claude', 'settings.json');
/* Forward slashes: on Windows Claude Code runs the command through Git Bash,
   which reads an unquoted backslash as an escape. Both forms have worked in
   practice; this is the form the documentation asks for. */
const STATUSLINE = path.join(HOME, '.claude', 'ccbar', 'statusline.js').replace(/\\/g, '/');
const DEFAULT_REFRESH = 5;

function refreshArg() {
  const i = process.argv.indexOf('--refresh');
  if (i === -1) return null;
  const n = parseInt(process.argv[i + 1], 10);
  if (!Number.isInteger(n) || n < 1) {
    console.error('--refresh wants a whole number of seconds, 1 or more');
    process.exit(2);
  }
  return n;
}

function read() {
  try {
    const raw = fs.readFileSync(FILE, 'utf8').replace(/^﻿/, '');
    if (!raw.trim()) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw new Error('~/.claude/settings.json is not valid JSON - fix it first: ' + e.message);
  }
}

function backup() {
  try {
    fs.copyFileSync(FILE, FILE + '.bak-' + Date.now());
    return true;
  } catch (_) {
    return false;
  }
}

function write(settings) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(settings, null, 2) + '\n');
}

const settings = read();

if (MODE === 'install') {
  if (fs.existsSync(FILE)) backup();
  const cur = settings.statusLine;
  const ours = cur && typeof cur.command === 'string' && cur.command.indexOf('ccbar') !== -1;
  const kept = ours && Number.isInteger(cur.refreshInterval) && cur.refreshInterval >= 1 ? cur.refreshInterval : null;
  const asked = refreshArg();
  const refresh = asked !== null ? asked : kept !== null ? kept : DEFAULT_REFRESH;
  settings.statusLine = {
    type: 'command',
    command: 'node "' + STATUSLINE + '"',
    refreshInterval: refresh,
    padding: 0,
  };
  write(settings);
  console.log('settings.json: statusLine -> ccbar, refreshInterval ' + refresh +
    (asked === null && kept !== null ? ' (kept from the existing entry)' : ''));
} else if (MODE === 'uninstall') {
  const cur = settings.statusLine;
  if (cur && typeof cur.command === 'string' && cur.command.indexOf('ccbar') !== -1) {
    backup();
    delete settings.statusLine;
    write(settings);
    console.log('settings.json: ccbar statusLine removed');
  } else if (cur) {
    console.log('settings.json: statusLine belongs to something else - left alone');
  } else {
    console.log('settings.json: no statusLine to remove');
  }
} else {
  console.error('usage: node settings.js install|uninstall');
  process.exit(2);
}
