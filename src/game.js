// Prism — game shell: daily seeding, canvas render with light bloom, input,
// region-locking, scoring, stats/streak/share. Engine + generator are pure and
// proven in scripts/selfcheck.mjs; this file is the UI around them.

import { generateBoard, mulberry32 } from './generate.js';
import { trace, lockedSet, rotatableIndices, socketIndices, rotateOnce, ROTATABLE, DIRS, LEFT, RIGHT, xy, idx } from './engine.js';
import {
  isLeaderboardConfigured, submitScore, submitMetricCompletion, alltimeBoard,
  cleanHandle, formatTime, rowParts, recordHistory, historyStats, loadHistory, reportStats, todayStr, streakLineHtml,
  loadSharedHandle, saveSharedHandle,
} from './arcade-leaderboard.js';
import { createLeaderboardModal } from './arcade-leaderboard-ui.js';
import { dailyDateKey } from './arcade-daily-seed.js';
import { createArchive, enterArchiveDate, exitArchive, getArchiveDate, archiveDayNumber } from './arcade-archive.js';
import { createTutorial } from './arcade-tutorial.js';

const GAME_SLUG = 'prism';
const DIFFS = ['easy', 'medium', 'hard'];
const DIFF_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard', total: 'Total' };

// ---- colour: RGB bitmask -> glow ----
const GLOW = { 1: '#ff5d5d', 2: '#54e08a', 4: '#5b9bff', 3: '#ffd24a', 5: '#ff6dd0', 6: '#4fe3e8', 7: '#fff2bf' };
const glow = (c) => GLOW[c] || '#fff2bf';
// Light theme: additive 'lighter' blending saturates toward white on the cream
// background, so beams swap to opaque saturated inks drawn source-over. White
// (7) is special — pure white is invisible on cream, so it renders as a pale
// warm core inside a darker warm casing (reads as "light", stays distinct from
// yellow, mask 3).
const LIGHT_BEAM = { 1: '#d92b2b', 2: '#0f9448', 4: '#2361d8', 3: '#c08a00', 5: '#c2189c', 6: '#0e8fa0', 7: '#f7edd2' };
const LIGHT_WHITE_EDGE = '#a3874a';
const beamInk = (c) => LIGHT_BEAM[c] || LIGHT_BEAM[7];
const isLightTheme = () => document.documentElement.dataset.theme === 'light';

// ---- daily seeding (LOCAL date, like the rest of the arcade) ----
// Seed off the shared daily date key so the puzzle, the board key, and the
// shared client's local date all share one basis. dailyDateKey() honors the
// pinned archive replay date, so an archived day replays byte-identically while
// today's key ('YYYY-M-D', 1-based month) reproduces the historical seed exactly.
function dailySeed(diff) {
  const p = dailyDateKey().split('-').map(Number);
  const base = p[0] * 10000 + p[1] * 100 + p[2];
  const off = { easy: 1, medium: 2, hard: 3 }[diff];
  return ((base * 2654435761) ^ (off * 0x9e3779b9)) >>> 0;
}

// ---- leaderboard handle + per-board local bests ----
let lbHandle = loadSharedHandle(GAME_SLUG);
const BKEY = 'ctt.prism.bests2';
function loadBests() { try { return JSON.parse(localStorage.getItem(BKEY)) || {}; } catch (_) { return {}; } }
function saveBests(b) { try { localStorage.setItem(BKEY, JSON.stringify(b)); } catch (_) {} }
let bests = loadBests();

// ---- per-day run: first-attempt eligibility + the combined Total board ----
const RKEY = 'ctt.prism.run';
function loadRun() { try { const r = JSON.parse(localStorage.getItem(RKEY)); if (r && r.date === todayStr()) return r; } catch (_) {} return { date: todayStr(), results: {} }; }
function saveRun(r) { try { localStorage.setItem(RKEY, JSON.stringify(r)); } catch (_) {} }
function recordRunResult(diff, timeMs, moves, par) { const r = loadRun(); if (!r.results[diff]) { r.results[diff] = { timeMs, moves, par }; saveRun(r); } return loadRun(); }

// ---- leaderboard board keys (daily board + day navigation) ----
// Anchored on dailyDateKey() (today, or the archived day being replayed) so a
// replay's win panel + board navigation reflect that day; for real today the
// key is byte-identical to the old todayStr()-based keys.
const curDiff = () => (state ? state.diff : 'easy');
function boardKeyForOffset(offset, diff) { const p = dailyDateKey().split('-').map(Number); const d = new Date(p[0], p[1] - 1, p[2]); d.setDate(d.getDate() - offset); const base = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); return base + '|' + (diff || curDiff()); }
function totalBoardKey() { return dailyDateKey() + '|total'; }
function dayLabelForOffset(offset) { if (offset === 0) return 'Today'; if (offset === 1) return 'Yesterday'; const d = new Date(); d.setDate(d.getDate() - offset); return d.toLocaleDateString('en', { month: 'short', day: 'numeric' }); }

const doneToday = (diff) => loadHistory(GAME_SLUG).some((h) => h.date === todayStr() && h.difficulty === diff);

// ---- game state ----
let state = null;  // { diff, isDaily, board, par, moves, finished, hasTray }
let cell = 48, pad = 18;
let traySel = null; // index into board.tray of the selected pre-cut piece (one slot)

// ---- pause the solve clock while a help/tutorial overlay is open ----
// Time only matters at win() (timeMs = Date.now() - state.startMs, submitted as
// the leaderboard tiebreak). There is no live ticking timer, so pausing simply
// shifts state.startMs FORWARD by however long an overlay was open — the elapsed
// time then excludes any seconds spent reading Help / the first-play tutorial.
let pausedAt = 0;
function isShown(el) {
  if (!el) return false;
  if (el.hasAttribute('hidden')) return false;
  const st = el.style;
  if (st && (st.display === 'none' || st.visibility === 'hidden')) return false;
  return true;
}
function overlayOpen() {
  return isShown(document.getElementById('tutorial-modal'))
    || isShown(document.getElementById('help'))
    || isShown(document.getElementById('lb-modal'))
    || isShown(document.getElementById('archive-modal')); // lazily created by the shared lib
}
function pauseClock() {
  if (pausedAt || !(state && state.startMs)) return;
  pausedAt = Date.now();
}
function resumeClock() {
  if (!pausedAt) return;
  const dt = Date.now() - pausedAt;
  pausedAt = 0;
  if (state && state.startMs) state.startMs += dt;
}
function syncClock() { overlayOpen() ? pauseClock() : resumeClock(); }
document.addEventListener('arcade:tutorial', syncClock);
window._clockState = () => ({ startMs: state && state.startMs, pausedAt });

// ---- idle pre-generation of today's other tiers ----
// Hard generation can block the main thread for 0.2–1.6s, so once a daily board
// is up we build the day's OTHER tiers during idle time. Entries are SINGLE-USE
// (boards mutate during play, so a cached board must never be handed out twice);
// same generateBoard call → determinism untouched. Archive replays and random
// boards are never pre-generated.
const genCache = new Map(); // 'seed|diff' -> generateBoard result
const idle = (fn) => (window.requestIdleCallback ? window.requestIdleCallback(fn, { timeout: 4000 }) : setTimeout(fn, 350));
function takeBoard(seed, diff) {
  const k = seed + '|' + diff;
  const g = genCache.get(k);
  if (g) { genCache.delete(k); return g; }
  return generateBoard(seed, diff);
}
function schedulePregen() {
  if (!(state && state.isDaily) || dailyDateKey() !== todayStr()) return; // real today only
  // All three tiers, including the one on screen: its cache entry was just
  // consumed, so a spare keeps a return visit instant too.
  const jobs = DIFFS.map((d) => ({ seed: dailySeed(d), diff: d }))
    .filter((j) => !genCache.has(j.seed + '|' + j.diff));
  const run = () => {
    const j = jobs.shift();
    if (!j) return;
    if (!genCache.has(j.seed + '|' + j.diff)) genCache.set(j.seed + '|' + j.diff, generateBoard(j.seed, j.diff));
    if (jobs.length) idle(run); // one tier per idle slice
  };
  if (jobs.length) idle(run);
}

function newGame(diff, isDaily) {
  const seed = isDaily ? dailySeed(diff) : (mulberry32((Date.now() ^ (Math.random() * 1e9)) >>> 0)() * 4294967296) >>> 0;
  const g = takeBoard(seed, diff);
  // hasTray is decided once at game start: the tray row stays docked (emptying
  // out / refilling on lifts) for the whole game, and never appears on tiers
  // that ship without one.
  const hasTray = !!(g.board.tray && g.board.tray.length);
  // The solved-state record rides along for the engine's frost rule (a piece
  // frosts only when lit AND in its solved state AND no longer productive).
  const solution = { solved: g.solved || [], solvedSockets: g.solvedSockets || [] };
  state = { diff, isDaily, board: g.board, par: g.par, moves: 0, finished: false, seed, startMs: Date.now(), hasTray, solution };
  traySel = null;
  pausedAt = 0;
  bloomUntil = 0; // a win bloom must not bleed into the next board
  syncClock(); // if a first-play tutorial / help is already open, pause the just-started clock
  const li = document.getElementById('lb-inline'); if (li) li.innerHTML = '';
  layout();
  render();
  renderTray();
  syncChrome();
  schedulePregen();
}

// ---- layout / canvas sizing ----
const canvas = () => document.getElementById('board');
function layout() {
  const c = canvas(), wrap = c.parentElement;
  const w = state.board.w, h = state.board.h;
  const avail = Math.min(wrap.clientWidth, 560);
  cell = Math.floor((avail - 2 * pad) / w);
  // Floor of 26 keeps an 8×8 Hard board inside a 320px viewport (34 would
  // overflow); ≥375px screens land above the floor, so nothing changes there.
  cell = Math.max(26, Math.min(64, cell));
  const cw = w * cell + 2 * pad, ch = h * cell + 2 * pad;
  const dpr = window.devicePixelRatio || 1;
  c.width = cw * dpr; c.height = ch * dpr;
  c.style.width = cw + 'px'; c.style.height = ch + 'px';
  const ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
const cx = (x) => pad + x * cell + cell / 2;
const cy = (y) => pad + y * cell + cell / 2;

// ---- render ----
let bloomUntil = 0, raf = 0;
function render() {
  if (!state) return;
  const ctx = canvas().getContext('2d');
  const b = state.board;
  const t = trace(b);
  const locked = state.finished ? new Set([...rotatableIndices(b), ...socketIndices(b)]) : lockedSet(b, state.solution);
  const css = getComputedStyle(document.body);
  const fg = css.getPropertyValue('--fg').trim();
  const bgElev = css.getPropertyValue('--bg-elev').trim();
  const border = css.getPropertyValue('--border').trim();
  const cw = b.w * cell + 2 * pad, ch = b.h * cell + 2 * pad;
  const tNow = performance.now();
  const bloom = Math.max(0, Math.min(1, (bloomUntil - tNow) / 420));

  ctx.clearRect(0, 0, cw, ch);
  // panel backdrop
  ctx.fillStyle = bgElev; roundRect(ctx, 4, 4, cw - 8, ch - 8, 16); ctx.fill();

  // grid
  ctx.strokeStyle = border; ctx.lineWidth = 1;
  for (let x = 0; x <= b.w; x++) { ctx.beginPath(); ctx.moveTo(pad + x * cell, pad); ctx.lineTo(pad + x * cell, pad + b.h * cell); ctx.stroke(); }
  for (let y = 0; y <= b.h; y++) { ctx.beginPath(); ctx.moveTo(pad, pad + y * cell); ctx.lineTo(pad + b.w * cell, pad + y * cell); ctx.stroke(); }

  // walls
  for (let i = 0; i < b.cells.length; i++) if (b.cells[i].type === 'wall') {
    const [gx, gy] = xy(i, b.w); ctx.fillStyle = border;
    roundRect(ctx, pad + gx * cell + 4, pad + gy * cell + 4, cell - 8, cell - 8, 6); ctx.fill();
  }

  // light beams (under pieces), additive glow. Merge segments that share the
  // same grid edge (OR-ing their colour masks) so recombined light draws ONCE as
  // its true blend — three primaries on one line render as white, not three
  // stacked primary strokes. Endpoints are normalised so a beam and its reverse
  // collapse to the same edge.
  const merged = new Map();
  for (const s of t.segs) {
    const a = s.x0 + ',' + s.y0, z = s.x1 + ',' + s.y1;
    const key = a < z ? a + '|' + z : z + '|' + a;
    const e = merged.get(key);
    if (e) e.color |= s.color; else merged.set(key, { x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1, color: s.color });
  }
  const light = isLightTheme();
  ctx.save(); ctx.lineCap = 'round';
  if (!light) { // dark: additive bloom, colours mix optically
    ctx.globalCompositeOperation = 'lighter';
    for (const s of merged.values()) {
      const g = glow(s.color);
      ctx.strokeStyle = g; ctx.shadowColor = g; ctx.shadowBlur = 14 + 8 * bloom;
      ctx.lineWidth = 3 + 2 * bloom;
      ctx.beginPath(); ctx.moveTo(cx(s.x0), cy(s.y0)); ctx.lineTo(cx(s.x1), cy(s.y1)); ctx.stroke();
    }
  } else { // light: opaque saturated inks with crisp edges (see LIGHT_BEAM)
    for (const s of merged.values()) {
      const x0 = cx(s.x0), y0 = cy(s.y0), x1 = cx(s.x1), y1 = cy(s.y1);
      if (s.color === 7) { // white: warm casing so the pale core stays visible
        ctx.shadowBlur = 0; ctx.strokeStyle = LIGHT_WHITE_EDGE; ctx.lineWidth = 5.5 + 2 * bloom;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      }
      const ink = beamInk(s.color);
      ctx.strokeStyle = ink; ctx.shadowColor = ink; ctx.shadowBlur = 3 + 4 * bloom;
      ctx.lineWidth = 3 + 2 * bloom;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }
  }
  ctx.restore();

  // pieces. Everything is drawn to be legible with ZERO light — unlit optics use
  // full-strength strokes (no ghosting), panes are tinted with the colour they
  // want, and the emitter sits in a visible housing.
  const accent = css.getPropertyValue('--accent').trim();
  const subtle = css.getPropertyValue('--fg-subtle').trim();
  const elev2 = css.getPropertyValue('--bg-elev-2').trim();
  const strong = css.getPropertyValue('--border-strong').trim();
  for (let i = 0; i < b.cells.length; i++) {
    const c = b.cells[i]; if (c.type === 'empty' || c.type === 'wall') continue;
    const [gx, gy] = xy(i, b.w); const X = cx(gx), Y = cy(gy);
    const fixed = c.fixed, lk = locked.has(i);
    if (c.type === 'emitter') {
      const g = glow(c.color);
      // housing: a solid casing so the source of the light is unmistakable when dark
      ctx.fillStyle = elev2; ctx.strokeStyle = strong; ctx.lineWidth = 2;
      roundRect(ctx, X - cell * 0.32, Y - cell * 0.32, cell * 0.64, cell * 0.64, 7); ctx.fill(); ctx.stroke();
      // muzzle pointing where the beam fires (reads even before it is lit)
      const [ex, ey] = DIRS[c.dir];
      ctx.fillStyle = light ? LIGHT_WHITE_EDGE : g; ctx.globalAlpha = 0.9;
      roundRect(ctx, X + ex * cell * 0.18 - 4, Y + ey * cell * 0.18 - 4, 8, 8, 2); ctx.fill(); ctx.globalAlpha = 1;
      // glowing core (light theme: pale warm disc in a warm ring — a white glow
      // is invisible on cream)
      ctx.beginPath(); ctx.arc(X, Y, cell * 0.19, 0, 7);
      if (light) { ctx.fillStyle = beamInk(7); ctx.fill(); ctx.strokeStyle = LIGHT_WHITE_EDGE; ctx.lineWidth = 2.5; ctx.stroke(); }
      else { ctx.fillStyle = g; ctx.shadowColor = g; ctx.shadowBlur = 16; ctx.fill(); ctx.shadowBlur = 0; }
    } else if (c.type === 'pane') {
      const got = t.paneColor.get(i) || 0;
      const ok = t.satisfied.has(i);
      const need = c.need || got || 7;         // what this pane is asking for
      const tint = glow(need);
      const sz = cell * 0.52 * (ok ? 1 + 0.06 * bloom : 1);
      ctx.save(); ctx.translate(X, Y); ctx.rotate(Math.PI / 4);
      if (ok) { ctx.fillStyle = tint; ctx.shadowColor = tint; ctx.shadowBlur = 18; roundRect(ctx, -sz / 2, -sz / 2, sz, sz, 4); ctx.fill(); }
      else {
        // faint colour wash + a tinted diamond outline: the target colour is
        // readable before any light arrives; a wrong-colour hit warms the outline.
        ctx.globalAlpha = 0.16; ctx.fillStyle = tint; roundRect(ctx, -sz / 2, -sz / 2, sz, sz, 4); ctx.fill();
        ctx.globalAlpha = got ? 1 : 0.7; ctx.strokeStyle = got && got !== need ? css.getPropertyValue('--warn').trim() : tint;
        ctx.lineWidth = 2.5; roundRect(ctx, -sz / 2, -sz / 2, sz, sz, 4); ctx.stroke(); ctx.globalAlpha = 1;
      }
      ctx.restore();
      // colour glyph — always shown (colour-blind support + dark-start legibility)
      ctx.font = `700 ${Math.round(cell * 0.24)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = ok ? 'rgba(20,18,10,0.72)' : fg; ctx.globalAlpha = ok ? 0.9 : 0.85;
      ctx.fillText(colorGlyph(need), X, Y); ctx.globalAlpha = 1;
    } else if (c.type === 'socket') {
      // Etched mount: a dashed square outline — clearly "something goes here",
      // and clearly not a pane (those are diamonds). When a tray piece is
      // selected, empty mounts brighten to invite the placement.
      const m = cell * 0.15, inviting = !c.piece && traySel != null;
      ctx.save(); ctx.setLineDash([4, 3]);
      ctx.strokeStyle = inviting ? accent : strong; ctx.lineWidth = inviting ? 2 : 1.5;
      ctx.globalAlpha = inviting ? 1 : 0.9;
      roundRect(ctx, pad + gx * cell + m, pad + gy * cell + m, cell - 2 * m, cell - 2 * m, 5); ctx.stroke();
      ctx.restore();
      if (c.piece) { // mounted piece draws exactly like its bare counterpart
        drawPieceGlyph(ctx, c.piece, X, Y, cell, { accent, subtle, strong, fixed: false, lk });
        if (c.piece.type === 'prism') drawPrismFan(ctx, t, gx, gy, X, Y, c.piece.orient, light);
      }
    } else if (c.type === 'prism') {
      drawPieceGlyph(ctx, c, X, Y, cell, { accent, subtle, strong, fixed, lk });
      drawPrismFan(ctx, t, gx, gy, X, Y, c.orient, light);
    } else { // mirror / splitter
      drawPieceGlyph(ctx, c, X, Y, cell, { accent, subtle, strong, fixed, lk });
    }
    // frost = settled (inevitability cue) — rotatables and load-bearing mounts
    if (lk && !fixed && (ROTATABLE.has(c.type) || (c.type === 'socket' && c.piece))) {
      ctx.fillStyle = accent; ctx.globalAlpha = 0.08;
      roundRect(ctx, pad + gx * cell + 3, pad + gy * cell + 3, cell - 6, cell - 6, 6); ctx.fill(); ctx.globalAlpha = 1;
    }
  }

  // HUD
  document.getElementById('moves').textContent = String(state.moves);
  document.getElementById('par').textContent = String(state.par);
  const lit = t.satisfied.size, tot = t.paneCount;
  const pc = document.getElementById('panecount');
  pc.textContent = `${lit}/${tot}`;
  pc.className = 'panecount ' + (lit === tot ? 'is-match' : 'is-under');

  if (bloom > 0 && !raf) raf = requestAnimationFrame(() => { raf = 0; render(); });
}

function colorGlyph(c) { return { 1: 'R', 2: 'G', 4: 'B', 3: 'Y', 5: 'M', 6: 'C', 7: 'W' }[c] || ''; }
// What colour is entering this prism's base? — OR of every trace segment
// landing on the cell while travelling `orient` (the base-entry direction).
// 0 = nothing. Drives the dispersion fan, which must only show the primaries
// actually present (a pure-blue entry must not flash a full rainbow).
function beamEntersBase(t, px, py, orient) {
  const [dx, dy] = DIRS[orient];
  let mask = 0;
  for (const s of t.segs) if (s.x1 === px && s.y1 === py && s.x1 - s.x0 === dx && s.y1 - s.y0 === dy) mask |= s.color;
  return mask;
}
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

// Draw a mirror / splitter / prism glyph centred on (X, Y) scaled to a `size`
// px cell. ONE code path shared by the board pass, mounted sockets, and the
// tray's mini-canvas slots — so a pre-cut piece looks identical everywhere.
// o: { accent, subtle, strong, fixed, lk } (theme colours + state).
function drawPieceGlyph(ctx, piece, X, Y, size, o) {
  const r = size * 0.34;
  if (piece.type === 'prism') {
    // Glassy triangle. Apex points toward `orient`; the base faces the light
    // travelling that way.
    const [dvx, dvy] = DIRS[piece.orient];       // apex direction
    const pvx = -dvy, pvy = dvx;                 // base spread (perpendicular)
    const A = size * 0.36, B = size * 0.26, Wd = size * 0.30;
    const bc = [X - dvx * B, Y - dvy * B];       // base centre
    ctx.beginPath(); ctx.moveTo(X + dvx * A, Y + dvy * A);
    ctx.lineTo(bc[0] + pvx * Wd, bc[1] + pvy * Wd); ctx.lineTo(bc[0] - pvx * Wd, bc[1] - pvy * Wd); ctx.closePath();
    ctx.fillStyle = o.fixed ? o.subtle : o.accent; ctx.globalAlpha = 0.16; ctx.fill();
    ctx.globalAlpha = o.lk ? 0.55 : 1; ctx.strokeStyle = o.fixed ? o.strong : o.accent; ctx.lineWidth = o.fixed ? 2.5 : 3; ctx.lineJoin = 'round';
    ctx.stroke(); ctx.globalAlpha = 1;
    return;
  }
  // mirror / splitter
  ctx.strokeStyle = o.fixed ? o.subtle : o.accent;
  ctx.globalAlpha = o.fixed ? 0.7 : (o.lk ? 0.55 : 1);
  ctx.lineWidth = o.fixed ? 3 : 4; ctx.lineCap = 'round';
  const dx = piece.orient === '/' ? r : -r;
  if (piece.type === 'splitter') {
    // half-silvered: TWIN rails split by a gap + a centre bead, so pass-through
    // light no longer reads as a beam penetrating a solid mirror.
    const ax = X - dx, ay = Y + r, zx = X + dx, zy = Y - r;
    let vx = zx - ax, vy = zy - ay; const L = Math.hypot(vx, vy) || 1;
    const off = 3, px = (-vy / L) * off, py = (vx / L) * off;
    ctx.beginPath(); ctx.moveTo(ax + px, ay + py); ctx.lineTo(zx + px, zy + py); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ax - px, ay - py); ctx.lineTo(zx - px, zy - py); ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle; ctx.beginPath(); ctx.arc(X, Y, 3.5, 0, 7); ctx.fill();
  } else { // solid mirror: one bold diagonal
    ctx.beginPath(); ctx.moveTo(X - dx, Y + r); ctx.lineTo(X + dx, Y - r); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// The prism's "aha" cue: when a beam enters the base, a tiny dispersion fan
// previews the exit rays — ONLY the primaries present in the entering colour
// (light theme: opaque inks — additive glow washes out on cream). Board-pass
// only — tray prisms have no light yet.
function drawPrismFan(ctx, t, gx, gy, X, Y, orient, light) {
  const mask = beamEntersBase(t, gx, gy, orient);
  if (!mask) return;
  const [dvx, dvy] = DIRS[orient];
  const bc = [X - dvx * cell * 0.26, Y - dvy * cell * 0.26]; // base centre
  ctx.save(); if (!light) ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round'; ctx.lineWidth = 2.5;
  for (const [dir, col] of [[LEFT[orient], 1], [orient, 2], [RIGHT[orient], 4]]) {
    if (!(mask & col)) continue; // absent primary → no exit ray to preview
    const [fx, fy] = DIRS[dir]; const g = light ? beamInk(col) : glow(col);
    ctx.strokeStyle = g; ctx.shadowColor = g; ctx.shadowBlur = light ? 0 : 8;
    ctx.beginPath(); ctx.moveTo(bc[0], bc[1]); ctx.lineTo(bc[0] + fx * cell * 0.2, bc[1] + fy * cell * 0.2); ctx.stroke();
  }
  ctx.restore();
}

// ---- tray (pre-cut optics, Hard) ----
// A compact DOM row docked under the board. Slots are mini-canvases drawn with
// drawPieceGlyph so tray pieces match the board exactly; tapping selects (one
// selection slot), tapping again deselects.
function renderTray() {
  const el = document.getElementById('tray');
  if (!el) return;
  const show = !!(state && state.hasTray);
  el.hidden = !show;
  if (!show) return;
  // Rebuilding drops keyboard focus to <body>; remember which slot held it so
  // we can restore focus (same index, clamped) after the rebuild.
  const slotsBefore = [...el.querySelectorAll('.tray-slot')];
  const focusIdx = slotsBefore.indexOf(document.activeElement);
  el.innerHTML = '<span class="tray-label">Tray</span>';
  const tray = state.board.tray || [];
  if (!tray.length) {
    const d = document.createElement('span'); d.className = 'tray-empty'; d.textContent = 'all mounted';
    el.appendChild(d);
    return;
  }
  const css = getComputedStyle(document.body);
  const o = {
    accent: css.getPropertyValue('--accent').trim(),
    subtle: css.getPropertyValue('--fg-subtle').trim(),
    strong: css.getPropertyValue('--border-strong').trim(),
    fixed: false, lk: false,
  };
  tray.forEach((p, k) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tray-slot' + (k === traySel ? ' selected' : '');
    btn.setAttribute('aria-label', `${p.type} (${p.orient})${k === traySel ? ', selected' : ''}`);
    btn.setAttribute('aria-pressed', k === traySel ? 'true' : 'false');
    const S = 40, dpr = window.devicePixelRatio || 1;
    const cv = document.createElement('canvas');
    cv.width = S * dpr; cv.height = S * dpr; cv.style.width = S + 'px'; cv.style.height = S + 'px';
    const c2 = cv.getContext('2d'); c2.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawPieceGlyph(c2, p, S / 2, S / 2, S, o);
    btn.appendChild(cv);
    btn.addEventListener('click', () => onTrayTap(k));
    el.appendChild(btn);
  });
  if (focusIdx >= 0) { // keyboard user: keep focus in the tray across rebuilds
    const slots = el.querySelectorAll('.tray-slot');
    const s = slots[Math.min(focusIdx, slots.length - 1)];
    if (s) s.focus();
  }
}

function onTrayTap(k) {
  if (!state || state.finished) return;
  traySel = traySel === k ? null : k; // one selection slot; second tap deselects
  renderTray();
  render(); // empty sockets brighten while a piece is selected
}

// Brief "look down here" pulse on the tray — the hint for tapping an empty
// socket with nothing selected.
function pulseTray() {
  const el = document.getElementById('tray');
  if (!el || el.hidden) return;
  el.classList.remove('pulse');
  void el.offsetWidth; // restart the CSS animation
  el.classList.add('pulse');
}

// Shared post-change bookkeeping for placements/lifts/rotations: count the
// move (lifts are free), bloom + chime on newly satisfied panes, win-check.
function afterBoardChange(before, countsAsMove) {
  if (countsAsMove) state.moves++;
  const t = trace(state.board);
  if (t.satisfied.size > before) { bloomUntil = performance.now() + 420; chime(420 + t.satisfied.size * 70); }
  renderTray();
  render();
  if (t.paneCount > 0 && t.satisfied.size === t.paneCount) win();
}

function onSocketTap(i) {
  const mount = state.board.cells[i];
  const before = trace(state.board).satisfied.size;
  if (mount.piece) {
    // Lift back to the tray — FREE (a misplacement only costs the re-placement).
    state.board.tray.push(mount.piece);
    mount.piece = null;
    traySel = null; // lifting always clears the selection
    afterBoardChange(before, false);
    return;
  }
  if (traySel == null || !state.board.tray[traySel]) { pulseTray(); return; } // pick from the tray first
  mount.piece = state.board.tray.splice(traySel, 1)[0];
  traySel = null;
  afterBoardChange(before, true); // placing costs 1 move, like a rotation
}

// ---- input ----
function onClick(ev) {
  if (!state || state.finished) return;
  const rect = canvas().getBoundingClientRect();
  const px = ev.clientX - rect.left, py = ev.clientY - rect.top;
  const gx = Math.floor((px - pad) / cell), gy = Math.floor((py - pad) / cell);
  if (gx < 0 || gy < 0 || gx >= state.board.w || gy >= state.board.h) return;
  const i = idx(gx, gy, state.board.w);
  const c = state.board.cells[i];
  if (c && c.type === 'socket') { onSocketTap(i); return; } // place / lift / hint
  if (!c || !ROTATABLE.has(c.type) || c.fixed) return;
  // Frost is a *cosmetic* "settled" hint — we never disable a piece, so the
  // player can always experiment freely (and a multi-piece dependency can never
  // soft-lock the board). One tap = one rotation: mirrors/splitters toggle,
  // prisms cycle N→E→S→W→N. A tray selection survives a rotation.
  const before = trace(state.board).satisfied.size;
  rotateOnce(c);
  afterBoardChange(before, true);
}

// ---- win ----
function win() {
  state.finished = true;
  traySel = null; renderTray(); // a rotation can win mid-selection — drop the highlight
  const timeMs = Date.now() - state.startMs;
  const dateKey = dailyDateKey();
  const isRealToday = dateKey === todayStr();
  // Metric = moves over par (primary) with time as a sub-metric tiebreak.
  const value = Math.max(0, state.moves - state.par) * 1e7 + Math.min(timeMs, 1e7 - 1);
  let firstAttempt = false, run = null;
  if (state.isDaily) {
    // First solve of THIS day+difficulty (archive-safe: keyed off the replayed date).
    firstAttempt = !loadHistory(GAME_SLUG).some((h) => h.date === dateKey && h.difficulty === state.diff);
    recordHistory(GAME_SLUG, { difficulty: state.diff, value, moves: state.moves, par: state.par, timeMs, date: dateKey });
    reportStats(GAME_SLUG);
    // The combined Total board tracks a single real-today run; archived replays
    // don't feed it (they submit to their own dated board only).
    if (isRealToday) run = recordRunResult(state.diff, timeMs, state.moves, state.par);
  }
  bloomUntil = performance.now() + 900; chime(680, 0.6); setTimeout(() => chime(880, 0.6), 90); setTimeout(() => chime(1100, 0.7), 180);
  render();
  const ov = document.getElementById('win');
  ov.querySelector('.win-line').textContent = `Solved in ${state.moves} ${state.moves === 1 ? 'move' : 'moves'} · par ${state.par}`;
  ov.querySelector('.win-sub').textContent = state.isDaily ? `${DIFF_LABEL[state.diff]} daily · ${formatTime(timeMs)}` : 'Random puzzle';
  ov.querySelector('.win-streak').innerHTML = state.isDaily ? streakLineHtml(GAME_SLUG) : '';
  renderWinLeaderboard(document.getElementById('lb-inline'), value, timeMs, run, firstAttempt);
  ov.hidden = false;
  syncChrome();
}

// Post-win panel: submit the first daily attempt (prompting for a name once),
// then show the standing board. Mirrors the other arcade dailies.
function renderWinLeaderboard(mount, value, timeMs, run, firstAttempt) {
  if (!mount) return;
  mount.innerHTML = '';
  if (!isLeaderboardConfigured()) return;
  if (!state.isDaily) { mount.innerHTML = '<div class="lb-hint">Switch to a daily to join the leaderboard.</div>'; return; }
  const board = boardKeyForOffset(0, state.diff);
  if (!firstAttempt) { lbUi.renderBoard(mount, board, lbHandle || null); return; }

  async function doSubmit(name) {
    if (bests[board] !== undefined && value >= bests[board]) { lbUi.renderBoard(mount, board, name); return; }
    mount.innerHTML = '<div class="lb-status">Submitting…</div>';
    const ok = await submitMetricCompletion({ game: GAME_SLUG, difficulty: state.diff, value, handle: name, board, meta: { moves: state.moves, par: state.par, timeMs } });
    if (ok) { bests[board] = value; saveBests(bests); }
    else if (bests[board] === undefined) { mount.innerHTML = '<div class="lb-status">Couldn\'t reach the leaderboard — your solve is saved under “You”.</div>'; return; }
    lbUi.renderBoard(mount, board, name);
    if (run && DIFFS.every((d) => run.results[d])) { // combined Total board once all three are done
      const totalValue = DIFFS.reduce((s, d) => s + Math.max(0, run.results[d].moves - run.results[d].par) * 1e7, 0)
        + DIFFS.reduce((s, d) => s + run.results[d].timeMs, 0);
      const totalTime = DIFFS.reduce((s, d) => s + run.results[d].timeMs, 0);
      const totalMoves = DIFFS.reduce((s, d) => s + run.results[d].moves, 0);
      const tBoard = totalBoardKey();
      if (bests[tBoard] === undefined || totalValue < bests[tBoard]) {
        const meta = { moves: totalMoves, timeMs: totalTime, difficulty: 'total' };
        const a = await submitScore({ game: GAME_SLUG, board: tBoard, handle: name, score: totalValue, meta });
        const b = await submitScore({ game: GAME_SLUG, board: alltimeBoard('total', 2), handle: name, score: totalValue, meta });
        if (a || b) { bests[tBoard] = totalValue; saveBests(bests); }
      }
    }
  }

  if (lbHandle) { doSubmit(lbHandle); return; }
  mount.innerHTML = '<div class="lb-join"><div class="lb-join-title">🏆 Join today\'s leaderboard:</div>'
    + '<div class="lb-join-row"><input id="lb-handle" class="lb-input" type="text" maxlength="24" placeholder="Your name" autocomplete="off" aria-label="Your name" />'
    + '<button id="lb-submit" class="btn" type="button">Submit</button></div></div>';
  const input = mount.querySelector('#lb-handle'), btn = mount.querySelector('#lb-submit');
  input.focus();
  btn.addEventListener('click', () => { const name = cleanHandle(input.value); if (!name) { input.focus(); return; } lbHandle = saveSharedHandle(name); doSubmit(name); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') btn.click(); });
}

const lbUi = createLeaderboardModal({
  gameSlug: GAME_SLUG, difficulties: DIFFS, diffLabel: DIFF_LABEL,
  getDifficulty: () => curDiff(), getHandle: () => lbHandle,
  boardKeyForOffset, dayLabelForOffset,
  alltimeVersion: 2,
  // value = max(0, moves-par)*1e7 + timeMs (ascending): buckets are par bands.
  youStats: { metricLabel: 'Over par', buckets: [
    { label: 'Par or better', max: 9999999 }, { label: '+1', max: 19999999 },
    { label: '+2', max: 29999999 }, { label: '+3 or more' },
  ] },
  rowStat: (r) => {
    const m = r.meta || {};
    if (m.par != null && m.moves != null) {
      const over = Math.max(0, m.moves - m.par);
      return `${over === 0 ? 'par' : '+' + over} · ${formatTime(m.timeMs || 0)}`;
    }
    return formatTime(rowParts(r).timeMs); // legacy composite rows
  },
  youRow: (best) => {
    if (best.par != null && best.moves != null) {
      const over = Math.max(0, best.moves - best.par);
      return `${over === 0 ? 'par' : '+' + over} · ${formatTime(best.timeMs || 0)}`;
    }
    return formatTime(best.timeMs || 0);
  },
});

// First-play tutorial — shared carousel mechanics; only this content is per-game.
// #help uses .modal-card (not one of the default HELP_CARD_SELECTORS), so point
// wire() at it explicitly.
const TUTORIAL_STEPS = [
  {
    title: 'White light splits',
    body: 'A beam of <b>white light</b> hits the glass <b>prism</b> ▲ and fans into <b>red, green &amp; blue</b>. The apex points the way the green ray keeps going.',
  },
  {
    title: 'Route each colour',
    body: 'Tap <b>mirrors</b> to flip them <code>/</code>↔<code>\\</code>, and tap a <b>prism</b> to spin it. Steer every colour to the <b>diamond pane</b> that wants it — each pane shows its letter (R/G/B).',
  },
  {
    title: 'Colours mix',
    body: 'Cross two beams at a pane for a <b>secondary</b> (R+G = yellow). Feed all three back through a reversed prism to rebuild <b>white</b>. Settled optics <b>frost over</b> — beat <b>par</b>.',
  },
  {
    title: 'Pre-cut optics (Hard)',
    body: 'Hard boards ship a <b>tray</b> of pre-cut pieces. Tap one, then tap an empty <b>socket</b> ▢ to mount it (1 move). Tap a mounted piece to <b>lift it back</b> — free.',
  },
];
const tutorial = createTutorial({ gameSlug: GAME_SLUG, steps: TUTORIAL_STEPS, helpCard: '#help .modal-card' });

function shareText() {
  const tag = state.isDaily ? `${dailyDateKey()} · ${DIFF_LABEL[state.diff]}` : 'Random';
  return `Prism · ${tag}\nSolved in ${state.moves} (par ${state.par})\nconnectthethoughts.ca/prism`;
}

// ---- gentle WebAudio chime (many-small-completions juice) ----
let actx = null, muted = false;
function chime(freq, gain = 0.4) {
  if (muted) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.value = 0; o.connect(g); g.connect(actx.destination);
    const now = actx.currentTime;
    g.gain.linearRampToValueAtTime(gain * 0.18, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    o.start(now); o.stop(now + 0.36);
  } catch (_) {}
}

// ---- chrome wiring ----
function syncChrome() {
  document.querySelectorAll('.diff-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.diff === state.diff && state.isDaily);
    btn.classList.toggle('done', doneToday(btn.dataset.diff)); // check mark on dailies cleared today
  });
  // During an archive replay the label names the replayed day, not "today".
  const replayKey = getArchiveDate();
  document.getElementById('mode-label').textContent = !state.isDaily ? 'Random'
    : replayKey ? `${DIFF_LABEL[state.diff]} · Day ${archiveDayNumber(replayKey)} replay`
    : `${DIFF_LABEL[state.diff]} · today`;
}

function boot() {
  // theme bootstrap + toggle handled by the vended arcade-theme.js (#themeToggle)
  lbUi.wire();
  createArchive({
    isDayDone: (key) => loadHistory(GAME_SLUG).some((h) => h.date === key),
    loadDailyForDate: (key) => { enterArchiveDate(key); document.getElementById('win').hidden = true; newGame(state ? state.diff : 'easy', true); },
  }).wire();
  tutorial.wire();
  tutorial.maybeAutoStart();
  // canvas colours come from CSS vars — re-render (board + tray mini-canvases)
  // when the shared toggle flips theme
  document.addEventListener('arcade:themechange', () => { if (state) { render(); renderTray(); } });
  canvas().addEventListener('click', onClick);
  // A difficulty switch is a within-day re-pick (each diff is its own board for
  // the day), so it must NOT clear the replay date — it stays on the archived day.
  document.querySelectorAll('.diff-btn').forEach((btn) => btn.addEventListener('click', () => { document.getElementById('win').hidden = true; newGame(btn.dataset.diff, true); }));
  // Leaving the daily for a random board is a deliberate exit from the archive.
  document.getElementById('new-btn').addEventListener('click', () => { exitArchive(); document.getElementById('win').hidden = true; newGame(state.diff, false); });
  const helpBtn = document.getElementById('helpButton');
  if (helpBtn) helpBtn.addEventListener('click', () => { document.getElementById('help').hidden = false; });
  // pause/resume the solve clock whenever a browsable overlay opens or closes —
  // help, leaderboard, and the archive picker all stop the tiebreak clock.
  const watchOverlay = (el) => new MutationObserver(syncClock).observe(el, { attributes: true, attributeFilter: ['hidden', 'style', 'class'] });
  ['help', 'lb-modal'].forEach((id) => { const h = document.getElementById(id); if (h) watchOverlay(h); });
  // #archive-modal is built lazily by the shared archive lib on first open, so
  // watch the body until it appears, then hook it like the static modals.
  new MutationObserver((_, obs) => {
    const am = document.getElementById('archive-modal');
    if (am) { watchOverlay(am); syncClock(); obs.disconnect(); }
  }).observe(document.body, { childList: true });
  const muteBtn = document.getElementById('mute-btn');
  if (muteBtn) muteBtn.addEventListener('click', (e) => { muted = !muted; e.currentTarget.textContent = muted ? '🔇' : '🔊'; });
  // Canonical modal wiring: a [data-close] control or a click on the backdrop
  // itself hides the .modal-backdrop (Escape is handled by shared arcade-theme.js).
  document.querySelectorAll('.modal-backdrop').forEach((m) => m.addEventListener('click', (e) => {
    if (e.target === m || (e.target.closest && e.target.closest('[data-close]'))) m.hidden = true;
  }));
  document.getElementById('win-share').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(shareText()); document.getElementById('win-share').textContent = 'Copied!'; setTimeout(() => document.getElementById('win-share').textContent = 'Share', 1400); } catch (_) {}
  });
  document.getElementById('win-next').addEventListener('click', () => {
    document.getElementById('win').hidden = true;
    const ni = (DIFFS.indexOf(state.diff) + 1) % DIFFS.length;
    newGame(state.isDaily ? DIFFS[ni] : state.diff, state.isDaily);
  });
  window.addEventListener('resize', () => { if (state) { layout(); render(); } });
  newGame('easy', true);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
