'use strict';
/*
 * ccbar - shared visual language.
 *
 * Art direction: late-70s / early-80s ship-console science fiction. Two
 * deliberately separate colour languages, never mixed:
 *
 *   TITLE  a cool spectrum - ice, cyan, azure, violet, magenta - laid across
 *          the letters as ONE continuous gradient (never a random colour per
 *          letter). The gradient drifts slowly through the word while a soft
 *          specular highlight glides across it, like a light bar travelling
 *          over chrome, over a barely-there phosphor breath.
 *   METER  a warm status spectrum - aqua, signal green, amber CRT, ember,
 *          alert red - because a gauge has to read as instrumentation, not as
 *          decoration.
 *
 * The cool title against the warm gauge is the composition: the frame idles
 * calm and instrument-like until the meter starts to burn.
 *
 * Time is continuous. Every function takes `t` in floating-point seconds and
 * nothing snaps to a step, so the same code is buttery at 20 fps in the top
 * pane and simply sampled coarsely when a host can only redraw once a second.
 * Letterforms and tracking never move: motion is carried by light, not by
 * stretching the type.
 *
 * Pure and defensive: no I/O, no throwing, no assumptions about the caller.
 */

/* ---------- terminal capability ---------- */

const CAP = (() => {
  const env = process.env || {};
  const color = env.NO_COLOR === undefined && env.TERM !== 'dumb';
  const truecolor =
    color && !(/256color/.test(env.TERM || '') && !env.COLORTERM && !env.WT_SESSION);
  return { color, truecolor };
})();

const RESET = CAP.color ? '\x1b[0m' : '';
const DIM = CAP.color ? '\x1b[2m' : '';
const BOLD = CAP.color ? '\x1b[1m' : '';

function cube(v) {
  return Math.round((Math.max(0, Math.min(255, v)) / 255) * 5);
}

function fg(rgb) {
  if (!CAP.color) return '';
  const r = Math.round(Math.max(0, Math.min(255, rgb[0])));
  const g = Math.round(Math.max(0, Math.min(255, rgb[1])));
  const b = Math.round(Math.max(0, Math.min(255, rgb[2])));
  if (CAP.truecolor) return '\x1b[38;2;' + r + ';' + g + ';' + b + 'm';
  return '\x1b[38;5;' + (16 + 36 * cube(r) + 6 * cube(g) + cube(b)) + 'm';
}

function paint(rgb, s) {
  return CAP.color ? fg(rgb) + s + RESET : s;
}

/* ---------- colour maths ---------- */

function mix(a, b, t) {
  const k = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

function scale(rgb, k) {
  return [rgb[0] * k, rgb[1] * k, rgb[2] * k];
}

/* Even-spaced stops, u in [0,1]. */
function rampAt(stops, u) {
  const k = Math.max(0, Math.min(1, u)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(k));
  return mix(stops[i], stops[i + 1], k - i);
}

/* Keyed stops [[position, rgb], ...], pos in 0..100. */
function rampKeyed(stops, pos) {
  const p = Math.max(stops[0][0], Math.min(stops[stops.length - 1][0], pos));
  for (let i = 0; i < stops.length - 1; i++) {
    if (p >= stops[i][0] && p <= stops[i + 1][0]) {
      const span = stops[i + 1][0] - stops[i][0] || 1;
      return mix(stops[i][1], stops[i + 1][1], (p - stops[i][0]) / span);
    }
  }
  return stops[stops.length - 1][1];
}

/* Reverses instead of wrapping, so the gradient never jumps at the seam. */
function pingPong(u) {
  let x = u % 2;
  if (x < 0) x += 2;
  return x > 1 ? 2 - x : x;
}

function smoothstep(x) {
  const k = Math.max(0, Math.min(1, x));
  return k * k * (3 - 2 * k);
}

/* ---------- palettes ---------- */

/* Cool: hull lighting, title cards. */
const TITLE_RAMP = [
  [150, 242, 255], // ice
  [ 34, 205, 255], // cyan
  [ 62, 132, 255], // azure
  [138,  96, 255], // violet
  [226,  82, 206], // magenta
];

/* Warm: instrumentation. Keyed on percentage REMAINING. */
const METER_RAMP = [
  [  0, [255,  48,  42]], // alert red
  [ 12, [255,  92,  32]], // ember
  [ 28, [255, 142,  18]], // warning orange
  [ 48, [255, 190,   0]], // amber CRT
  [ 68, [186, 226,  62]], // signal lime
  [ 84, [ 86, 236, 126]], // signal green
  [100, [ 46, 244, 198]], // aqua
];

const SLATE = [46, 62, 84];   // unfilled cells
const STEEL = [96, 132, 166]; // labels, frame
const WHITE = [255, 255, 255];

/* ---------- title ---------- */

const FLOW_SPEED = 0.055;  // spectrum drift through the word
const SPREAD = 0.85;       // how much of the ramp the word spans at once
const SWEEP_PERIOD = 9;    // seconds per pass of the specular highlight
const SWEEP_SIGMA = 1.45;  // width of that highlight, in characters
const BREATH_PERIOD = 6.5; // phosphor idle

/*
 * The word sits still with fixed one-space tracking. All movement is light:
 * a drifting gradient, a highlight gliding at sub-character precision, and a
 * slow breath in brightness.
 */
function titleLine(name, t) {
  const chars = Array.from(String(name || 'claude').toUpperCase());
  const n = chars.length;
  if (n === 0) return '';

  const phase = ((t / SWEEP_PERIOD) % 1 + 1) % 1;
  const head = -2 + smoothstep(phase) * (n + 3); // eased glide, no snap at the ends
  const breath = 1 + 0.055 * Math.sin((t * 2 * Math.PI) / BREATH_PERIOD);

  const colorAt = (pos) => {
    const u = pingPong(t * FLOW_SPEED + (n > 1 ? pos / (n - 1) : 0) * SPREAD);
    let rgb = rampAt(TITLE_RAMP, u);
    const d = pos - head;
    const glow = Math.exp(-(d * d) / (2 * SWEEP_SIGMA * SWEEP_SIGMA));
    rgb = mix(rgb, WHITE, 0.82 * glow);
    return scale(rgb, breath);
  };

  const lit = chars.map((ch, i) => paint(colorAt(i), ch)).join(' ');
  const left = mix(colorAt(-1.6), SLATE, 0.3);
  const right = mix(colorAt(n + 0.6), SLATE, 0.3);

  return paint(left, '⟨') + ' ' + BOLD + lit + RESET + ' ' + paint(right, '⟩');
}

/* ---------- meter ---------- */

/* Eighth-width blocks: the fill glides instead of stepping cell to cell. */
const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];

function meterLine(info, t, opts) {
  const width = (opts && opts.width) || 22;
  const frame = mix(STEEL, SLATE, 0.4);
  const openB = paint(frame, '⟨');
  const closeB = paint(frame, '⟩');

  if (!info) {
    return (
      paint(SLATE, 'SESSION') + ' ' + openB + paint(SLATE, '·'.repeat(width)) + closeB +
      ' ' + paint(SLATE, '--%')
    );
  }

  const remaining = Math.max(0, Math.min(100, 100 - info.used));
  const exact = (remaining / 100) * width;
  const full = Math.floor(exact);
  const frac = exact - full;

  const base = rampKeyed(METER_RAMP, remaining);
  /* below ten percent the gauge pulses - a smooth sine, never a hard blink */
  const alarm = remaining <= 10 ? 0.5 + 0.5 * Math.sin(t * 2 * Math.PI * 0.8) : 0;
  const pulse = alarm * 0.45;

  /* a slow bright band drifting through the charged part: the gauge idles alive */
  const flowPos = ((t * 2.2) % (width + 8)) - 4;

  let bar = '';
  for (let i = 0; i < full; i++) {
    const depth = full > 1 ? 0.62 + 0.38 * (i / (full - 1)) : 1; // darkens away from the edge
    let rgb = scale(base, depth);
    const d = i - flowPos;
    rgb = mix(rgb, WHITE, 0.16 * Math.exp(-(d * d) / 6));
    rgb = mix(rgb, WHITE, pulse);
    if (i === full - 1 && frac < 0.15) rgb = mix(rgb, WHITE, 0.28);
    bar += paint(rgb, '█');
  }

  let cells = full;
  if (full < width && frac > 0.06) {
    const glyph = EIGHTHS[Math.max(1, Math.min(7, Math.round(frac * 8)))];
    bar += paint(mix(mix(base, WHITE, 0.22), [0, 0, 0], 0.08), glyph);
    cells += 1;
  }
  if (cells < width) bar += paint(SLATE, '░'.repeat(width - cells));

  const hot = mix(base, WHITE, pulse * 0.8);
  const pct = paint(hot, BOLD + String(Math.round(remaining)).padStart(3, ' ') + '%' + RESET);
  const eta = info.eta ? '  ' + paint(mix(STEEL, base, 0.25), 'T-' + info.eta) : '';

  return paint(STEEL, info.label || 'SESSION') + ' ' + openB + bar + closeB + ' ' + pct + eta;
}

/* ---------- layout ---------- */

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

/* Printed width, ignoring colour. Every glyph used here is single-width. */
function visibleWidth(s) {
  return Array.from(String(s).replace(ANSI, '')).length;
}

/* Centres a coloured string in `cols` columns. */
function center(s, cols) {
  const pad = Math.max(0, Math.floor((cols - visibleWidth(s)) / 2));
  return ' '.repeat(pad) + s;
}

module.exports = { titleLine, meterLine, paint, center, visibleWidth, CAP, RESET, DIM, BOLD };
