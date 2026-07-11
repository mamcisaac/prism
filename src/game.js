// Prism — game shell: daily seeding, canvas render with light bloom, input,
// region-locking, scoring, stats/streak/share. Engine + generator are pure and
// proven in scripts/selfcheck.mjs; this file is the UI around them.

import { generateBoard, mulberry32 } from './generate.js';
import { trace, lockedSet, rotatableIndices, ALT_ORIENT, xy, idx } from './engine.js';
import {
  isLeaderboardConfigured, submitScore, submitMetricCompletion, alltimeBoard,
  cleanHandle, formatTime, rowParts, recordHistory, historyStats, loadHistory, reportStats, todayStr, streakLineHtml,
  loadSharedHandle, saveSharedHandle,
} from './arcade-leaderboard.js';
import { createLeaderboardModal } from './arcade-leaderboard-ui.js';
import { dailyDateKey } from './arcade-daily-seed.js';
import { createArchive } from './arcade-archive.js';
import { createTutorial } from './arcade-tutorial.js';

const GAME_SLUG = 'prism';
const DIFFS = ['easy', 'medium', 'hard'];
const DIFF_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard', total: 'Total' };

// ---- colour: RGB bitmask -> glow ----
const GLOW = { 1: '#ff5d5d', 2: '#54e08a', 4: '#5b9bff', 3: '#ffd24a', 5: '#ff6dd0', 6: '#4fe3e8', 7: '#fff2bf' };
const glow = (c) => GLOW[c] || '#fff2bf';

// ---- daily seeding (LOCAL date, like the rest of the arcade) ----
// Seed off the shared daily date key so the puzzle, the board key, and the
// shared client's local date all share one basis. dailyDateKey() honors
// window.__archiveDateKey, so an archived day replays byte-identically while
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
let state = null;  // { diff, isDaily, board, par, moves, finished }
let cell = 48, pad = 18;

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
    || isShown(document.getElementById('help-modal'))
    || isShown(document.getElementById('help'));
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

function newGame(diff, isDaily) {
  const seed = isDaily ? dailySeed(diff) : (mulberry32((Date.now() ^ (Math.random() * 1e9)) >>> 0)() * 4294967296) >>> 0;
  const g = generateBoard(seed, diff);
  state = { diff, isDaily, board: g.board, par: g.par, moves: 0, finished: false, seed, startMs: Date.now() };
  pausedAt = 0;
  syncClock(); // if a first-play tutorial / help is already open, pause the just-started clock
  const li = document.getElementById('lb-inline'); if (li) li.innerHTML = '';
  layout();
  render(true);
  syncChrome();
}

// ---- layout / canvas sizing ----
const canvas = () => document.getElementById('board');
function layout() {
  const c = canvas(), wrap = c.parentElement;
  const w = state.board.w, h = state.board.h;
  const avail = Math.min(wrap.clientWidth, 560);
  cell = Math.floor((avail - 2 * pad) / w);
  cell = Math.max(34, Math.min(64, cell));
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
function render(instant) {
  if (!state) return;
  const ctx = canvas().getContext('2d');
  const b = state.board;
  const t = trace(b);
  const locked = state.finished ? new Set(rotatableIndices(b)) : lockedSet(b);
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

  // light beams (under pieces), additive glow
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
  for (const s of t.segs) {
    const g = glow(s.color);
    ctx.strokeStyle = g; ctx.shadowColor = g; ctx.shadowBlur = 14 + 8 * bloom;
    ctx.lineWidth = 3 + 2 * bloom;
    ctx.beginPath(); ctx.moveTo(cx(s.x0), cy(s.y0)); ctx.lineTo(cx(s.x1), cy(s.y1)); ctx.stroke();
  }
  ctx.restore();

  // pieces
  for (let i = 0; i < b.cells.length; i++) {
    const c = b.cells[i]; if (c.type === 'empty' || c.type === 'wall') continue;
    const [gx, gy] = xy(i, b.w); const X = cx(gx), Y = cy(gy); const r = cell * 0.34;
    if (c.type === 'emitter') {
      const g = glow(c.color);
      ctx.fillStyle = g; ctx.shadowColor = g; ctx.shadowBlur = 16; ctx.beginPath(); ctx.arc(X, Y, cell * 0.22, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
    } else if (c.type === 'pane') {
      const got = t.paneColor.get(i) || 0;
      const ok = t.satisfied.has(i);
      const sz = cell * 0.5 * (ok ? 1 + 0.06 * bloom : 1);
      ctx.save(); ctx.translate(X, Y); ctx.rotate(Math.PI / 4);
      if (ok) { const g = glow(c.need || got || 7); ctx.fillStyle = g; ctx.shadowColor = g; ctx.shadowBlur = 18; roundRect(ctx, -sz / 2, -sz / 2, sz, sz, 4); ctx.fill(); }
      else { ctx.strokeStyle = got ? css.getPropertyValue('--warn').trim() : fg; ctx.globalAlpha = got ? 0.95 : 0.5; ctx.lineWidth = 2.5; roundRect(ctx, -sz / 2, -sz / 2, sz, sz, 4); ctx.stroke(); }
      ctx.restore();
      if (c.need && c.need !== 7) { ctx.fillStyle = fg; ctx.globalAlpha = 0.8; ctx.font = `600 ${Math.round(cell * 0.22)}px ui-monospace, SFMono-Regular, Menlo, monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(colorGlyph(c.need), X, Y); ctx.globalAlpha = 1; }
    } else { // mirror / splitter
      const fixed = c.fixed, lk = locked.has(i);
      ctx.strokeStyle = fixed ? css.getPropertyValue('--fg-subtle').trim() : css.getPropertyValue('--accent').trim();
      ctx.globalAlpha = fixed ? 0.55 : (lk ? 0.5 : 1);
      ctx.lineWidth = fixed ? 3 : 4; ctx.lineCap = 'round';
      const dx = c.orient === '/' ? r : -r;
      ctx.beginPath(); ctx.moveTo(X - dx, Y + r); ctx.lineTo(X + dx, Y - r); ctx.stroke();
      if (c.type === 'splitter') { ctx.fillStyle = ctx.strokeStyle; ctx.beginPath(); ctx.arc(X, Y, 3, 0, 7); ctx.fill(); }
      ctx.globalAlpha = 1;
      if (lk && !fixed) { // frost = settled (inevitability cue)
        ctx.fillStyle = css.getPropertyValue('--accent').trim(); ctx.globalAlpha = 0.08;
        roundRect(ctx, pad + gx * cell + 3, pad + gy * cell + 3, cell - 6, cell - 6, 6); ctx.fill(); ctx.globalAlpha = 1;
      }
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
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

// ---- input ----
function onClick(ev) {
  if (!state || state.finished) return;
  const rect = canvas().getBoundingClientRect();
  const px = ev.clientX - rect.left, py = ev.clientY - rect.top;
  const gx = Math.floor((px - pad) / cell), gy = Math.floor((py - pad) / cell);
  if (gx < 0 || gy < 0 || gx >= state.board.w || gy >= state.board.h) return;
  const i = idx(gx, gy, state.board.w);
  const c = state.board.cells[i];
  if (!c || (c.type !== 'mirror' && c.type !== 'splitter') || c.fixed) return;
  // Frost is a *cosmetic* "settled" hint — we never disable a mirror, so the
  // player can always experiment freely (and a multi-mirror dependency can never
  // soft-lock the board).
  const before = trace(state.board).satisfied.size;
  c.orient = ALT_ORIENT(c.orient);
  state.moves++;
  const t = trace(state.board);
  if (t.satisfied.size > before) { bloomUntil = performance.now() + 420; chime(420 + t.satisfied.size * 70); }
  render();
  if (t.paneCount > 0 && t.satisfied.size === t.paneCount) win();
}

// ---- win ----
function win() {
  state.finished = true;
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
    title: 'Route the light',
    body: 'A beam enters the panel. <b>Tap a mirror</b> to flip it between <code>/</code> and <code>\\</code> — the whole beam re-routes instantly.',
  },
  {
    title: 'Light every pane',
    body: 'Get light onto <b>every diamond pane</b>. On Hard, a pane needs its <b>exact colour</b> — mix beams together to match it.',
  },
  {
    title: 'Frost means settled',
    body: 'Dim mirrors are <b>fixed</b> in place. As panes light up, the mirrors feeding them <b>frost over</b> — that part\'s done. Beat <b>par</b> for a clean solve.',
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
  document.getElementById('mode-label').textContent = state.isDaily ? `${DIFF_LABEL[state.diff]} · today` : 'Random';
}

function boot() {
  // theme bootstrap + toggle handled by the vended arcade-theme.js (#themeToggle)
  lbUi.wire();
  createArchive({
    isDayDone: (key) => loadHistory(GAME_SLUG).some((h) => h.date === key),
    loadDailyForDate: (key) => { window.__archiveDateKey = key; document.getElementById('win').hidden = true; newGame(state ? state.diff : 'easy', true); },
  }).wire();
  tutorial.wire();
  tutorial.maybeAutoStart();
  // canvas colours come from CSS vars — re-render when the shared toggle flips theme
  document.addEventListener('arcade:themechange', () => { if (state) render(); });
  canvas().addEventListener('click', onClick);
  document.querySelectorAll('.diff-btn').forEach((btn) => btn.addEventListener('click', () => { window.__archiveDateKey = null; document.getElementById('win').hidden = true; newGame(btn.dataset.diff, true); }));
  document.getElementById('new-btn').addEventListener('click', () => { window.__archiveDateKey = null; document.getElementById('win').hidden = true; newGame(state.diff, false); });
  const helpBtn = document.getElementById('helpButton');
  if (helpBtn) helpBtn.addEventListener('click', () => { document.getElementById('help').hidden = false; });
  // pause/resume the solve clock whenever the help overlay opens or closes
  ['help-modal', 'help'].forEach((id) => { const h = document.getElementById(id); if (h) new MutationObserver(syncClock).observe(h, { attributes: true, attributeFilter: ['hidden', 'style', 'class'] }); });
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
