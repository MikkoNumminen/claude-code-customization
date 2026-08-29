'use strict';
/*
 * ccbar - reading Claude Code's status-line payload.
 *
 * Every field is probed under several plausible names and falls back, so a
 * Claude Code release that renames or drops something degrades the display
 * instead of breaking it. Nothing here throws.
 */

const path = require('path');

function num(v) {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function clampPct(n) {
  return Math.max(0, Math.min(100, n));
}

function projectName(d) {
  const ws = (d && d.workspace) || {};
  const candidates = [ws.project_dir, ws.current_dir, d && d.cwd];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) {
      const base = path.basename(c.replace(/[\\/]+$/, ''));
      if (base) return base;
    }
  }
  try {
    return path.basename(process.cwd()) || 'claude';
  } catch (_) {
    return 'claude';
  }
}

/* -> { used, resets, label } | null */
function limitInfo(d) {
  const rl = (d && d.rate_limits) || {};
  const win = rl.five_hour || rl.session || rl.fiveHour;
  if (win && typeof win === 'object') {
    let used = num(win.used_percentage);
    if (used === null) {
      const u = num(win.utilization);
      if (u !== null) used = u <= 1 ? u * 100 : u;
    }
    if (used === null) {
      const rem = num(win.remaining_percentage);
      if (rem !== null) used = 100 - rem;
    }
    if (used !== null) {
      return {
        used: clampPct(used),
        resets: win.resets_at !== undefined ? win.resets_at : win.resetsAt,
        label: 'SESSION',
      };
    }
  }

  /* No plan limits (API key, Bedrock/Vertex, or a payload that stopped
     carrying them) -> fall back to the context window so the gauge stays live. */
  const cw = (d && d.context_window) || {};
  let used = num(cw.used_percentage);
  if (used === null) {
    const rem = num(cw.remaining_percentage);
    if (rem !== null) used = 100 - rem;
  }
  if (used === null) {
    const tok = num(cw.total_input_tokens);
    const size = num(cw.context_window_size);
    if (tok !== null && size) used = (tok / size) * 100;
  }
  if (used !== null) return { used: clampPct(used), resets: null, label: 'CONTEXT' };

  return null;
}

/* Countdown text, recomputed locally so it stays true between payloads. */
function etaText(ts) {
  if (ts === null || ts === undefined) return null;
  let ms;
  if (typeof ts === 'number') ms = ts > 1e12 ? ts : ts * 1000;
  else {
    const parsed = Date.parse(String(ts));
    if (Number.isNaN(parsed)) return null;
    ms = parsed;
  }
  const diff = ms - Date.now();
  if (!Number.isFinite(diff)) return null;
  if (diff <= 0) return '00m';
  const mins = Math.floor(diff / 60000);
  const h = Math.floor(mins / 60);
  return h > 0 ? h + 'h' + String(mins % 60).padStart(2, '0') + 'm' : String(mins) + 'm';
}

/* Adds the locally recomputed countdown. */
function withEta(info) {
  if (!info) return null;
  return Object.assign({}, info, { eta: etaText(info.resets) });
}

/* ---------- which session does a bar belong to ---------- */

function normDir(p) {
  if (typeof p !== 'string' || !p) return '';
  return p.replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase();
}

/*
 * Picks the session a bar should draw.
 *
 * A bar sits in the same window as its session and was started in the same
 * directory, so the directory is the link - not "the freshest session on the
 * machine", which in a second window picks up a stranger, leaves the real
 * session unclaimed (its status line then draws a second bar at the bottom)
 * and reports the wrong numbers up top.
 *
 * candidates: [{ key, mtime, cwd, claimedByOther }]
 */
function chooseSession(candidates, opts) {
  const o = opts || {};
  const here = normDir(o.cwd);
  const free = (candidates || []).filter((c) => c && !c.claimedByOther);

  /* a session started in this directory is ours, however old it is */
  const mine = here ? free.filter((c) => normDir(c.cwd) === here) : [];

  /* otherwise only sessions that appeared after this bar did, unless told
     to settle for any */
  const rest = free.filter((c) => o.allowOld || !(o.preexisting || []).includes(c.key));

  const pool = mine.length ? mine : rest;
  let best = null;
  for (const c of pool) if (!best || c.mtime > best.mtime) best = c;
  return best ? best.key : null;
}

module.exports = { projectName, limitInfo, etaText, withEta, chooseSession, normDir };
