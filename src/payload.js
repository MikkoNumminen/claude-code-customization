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
  const ms = resetMs(ts);
  if (ms === null) return null;
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

/* ---------- one limit, many sessions ---------- */

/*
 * The five-hour limit belongs to the account, not to a session - but each
 * session only learns the new figure from its own API calls, so an idle
 * session goes on reporting the reading it last saw. Measured: three windows
 * open on the same account showed 40, 41 and 43 percent at the same moment,
 * and only the one being typed into moved. A bar over an idle window then
 * lags the real figure by however long that window has been idle, which is
 * what "the gauge updates too slowly" was.
 *
 * Usage inside one window only goes up, and every session names the window
 * it is reporting on by its reset time. So across every session on the
 * machine: take the newest window anybody has seen, and inside it the highest
 * reading. An idle session still reporting the previous window is passed
 * over by the first rule; one lagging inside the current window by the
 * second. Only plan limits merge - a context-window reading is that
 * session's alone.
 *
 * readings: [{ used, resets, label }] -> { used, resets, label } | null
 */
function accountLimit(readings) {
  let best = null;
  let bestAt = null;
  for (const r of readings || []) {
    if (!r || r.label !== 'SESSION' || typeof r.used !== 'number' || !Number.isFinite(r.used)) continue;
    const at = resetMs(r.resets);
    const newer = best !== null && at !== null && (bestAt === null || at > bestAt);
    const same = best !== null && at === bestAt;
    if (best === null || newer || (same && r.used > best.used)) {
      best = { used: r.used, resets: r.resets, label: 'SESSION' };
      bestAt = at;
    }
  }
  return best;
}

/* A reset time as milliseconds, whatever form the payload gave it in. */
function resetMs(ts) {
  if (ts === null || ts === undefined) return null;
  if (typeof ts === 'number') return Number.isFinite(ts) ? (ts > 1e12 ? ts : ts * 1000) : null;
  const parsed = Date.parse(String(ts));
  return Number.isNaN(parsed) ? null : parsed;
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

module.exports = { projectName, limitInfo, etaText, withEta, accountLimit, chooseSession, normDir };
