#!/usr/bin/env node
'use strict';
/*
 * ccbar - registers (or removes) the status line in ~/.claude/settings.json.
 *
 * Done in Node rather than in the installer's own shell so the file is parsed
 * and written as real JSON, with the rest of the user's settings preserved
 * byte-for-byte in meaning, and a timestamped backup left behind.
 *
 *   node settings.js install
 *   node settings.js uninstall
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const MODE = process.argv[2];
const HOME = os.homedir();
const FILE = path.join(HOME, '.claude', 'settings.json');
const STATUSLINE = path.join(HOME, '.claude', 'ccbar', 'statusline.js');

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
  settings.statusLine = {
    type: 'command',
    command: 'node "' + STATUSLINE + '"',
    refreshInterval: 1,
    padding: 0,
  };
  write(settings);
  console.log('settings.json: statusLine -> ccbar');
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
