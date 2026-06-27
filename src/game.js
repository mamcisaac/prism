// Prism — game shell: daily seeding, canvas render with light bloom, input,
// region-locking, scoring, stats/streak/share. Engine + generator are pure and
// proven in scripts/selfcheck.mjs; this file is the UI around them.

import { generateBoard, mulberry32 } from './generate.js';
import { trace, lockedSet, rotatableIndices, ALT_ORIENT, xy, idx } from './engine.js';

const DIFFS = ['easy', 'medium', 'hard'];
const DIFF_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

// ---- colour: RGB bitmask -> glow ----
const GLOW = { 1: '#ff5d5d', 2: '#54e08a', 4: '#5b9bff', 3: '#ffd24a', 5: '#ff6dd0', 6: '#4fe3e8', 7: '#fff2bf' };
const glow = (c) => GLOW[c] || '#fff2bf';

// ---- daily seeding (UTC date, like the rest of the arcade) ----
function todayStr() { const d = new Date(); return d.getUTCFullYear() + '-' + (d.getUTCMonth() + 1) + '-' + d.getUTCDate(); }
function dailySeed(diff) {
  const d = new Date();
  const base = d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  const off = { easy: 1, medium: 2, hard: 3 }[diff];
  return ((base * 2654435761) ^ (off * 0x9e3779b9)) >>> 0;
}

// ---- persistent stats ----
const SKEY = 'ctt.prism.stats';
function loadStats() {
  try { return Object.assign({ solves: 0, streak: 0, best: 0, lastDay: null, done: {} }, JSON.parse(localStorage.getItem(SKEY)) || {}); }
  catch (_) { return { solves: 0, streak: 0, best: 0, lastDay: null, done: {} }; }
}
function saveStats(s) { try { localStorage.setItem(SKEY, JSON.stringify(s)); } catch (_) {} }
let stats = loadStats();

function recordSolve(diff, isDaily) {
  if (!isDaily) return;
  const day = todayStr();
  const key = day + '|' + diff;
  if (stats.done[key]) return; // already counted this daily — don't inflate on replay
  stats.done[key] = true;
  stats.solves++;
  // streak = consecutive days with at least one daily solve
  if (stats.lastDay !== day) {
    const y = new Date(); y.setUTCDate(y.getUTCDate() - 1);
    const yday = y.getUTCFullYear() + '-' + (y.getUTCMonth() + 1) + '-' + y.getUTCDate();
    stats.streak = stats.lastDay === yday ? stats.streak + 1 : 1;
    stats.lastDay = day;
    stats.best = Math.max(stats.best, stats.streak);
  }
  saveStats(stats);
}

function stars(moves, par) { const over = moves - par; return over <= 0 ? 3 : over <= 2 ? 2 : over <= 4 ? 1 : 0; }
const starStr = (n) => '★★★☆☆☆'.slice(3 - n, 6 - n);

// ---- game state ----
let state = null;  // { diff, isDaily, board, par, moves, finished }
let cell = 48, pad = 18;

function newGame(diff, isDaily) {
  const seed = isDaily ? dailySeed(diff) : (mulberry32((Date.now() ^ (Math.random() * 1e9)) >>> 0)() * 4294967296) >>> 0;
  const g = generateBoard(seed, diff);
  state = { diff, isDaily, board: g.board, par: g.par, moves: 0, finished: false, seed };
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
  const st = stars(state.moves, state.par);
  recordSolve(state.diff, state.isDaily);
  bloomUntil = performance.now() + 900; chime(680, 0.6); setTimeout(() => chime(880, 0.6), 90); setTimeout(() => chime(1100, 0.7), 180);
  render();
  const ov = document.getElementById('win');
  ov.querySelector('.win-stars').textContent = starStr(st);
  ov.querySelector('.win-line').textContent = `Solved in ${state.moves} ${state.moves === 1 ? 'move' : 'moves'} · par ${state.par}`;
  ov.querySelector('.win-sub').textContent = state.isDaily ? `${DIFF_LABEL[state.diff]} daily — streak ${stats.streak} 🔆` : 'Random puzzle';
  ov.classList.add('show');
  syncChrome();
}

function shareText() {
  const st = stars(state.moves, state.par);
  const tag = state.isDaily ? `${todayStr()} · ${DIFF_LABEL[state.diff]}` : 'Random';
  return `Prism ✦ ${tag}\nSolved in ${state.moves} (par ${state.par}) ${starStr(st)}\nconnectthethoughts.ca/prism`;
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
  const day = todayStr();
  document.querySelectorAll('.diff-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.diff === state.diff && state.isDaily);
    btn.classList.toggle('done', !!stats.done[day + '|' + btn.dataset.diff]); // ★ on dailies cleared today
  });
  document.getElementById('mode-label').textContent = state.isDaily ? `${DIFF_LABEL[state.diff]} · today` : 'Random';
  document.getElementById('streak').textContent = stats.streak ? `🔆 ${stats.streak}` : '';
}

function initTheme() {
  let th; try { th = localStorage.getItem('ctt.theme'); } catch (_) {}
  document.documentElement.setAttribute('data-theme', th || 'dark');
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', cur);
  try { localStorage.setItem('ctt.theme', cur); } catch (_) {}
  render();
}

function boot() {
  initTheme();
  canvas().addEventListener('click', onClick);
  document.querySelectorAll('.diff-btn').forEach((btn) => btn.addEventListener('click', () => { document.getElementById('win').classList.remove('show'); newGame(btn.dataset.diff, true); }));
  document.getElementById('new-btn').addEventListener('click', () => { document.getElementById('win').classList.remove('show'); newGame(state.diff, false); });
  document.getElementById('theme-btn').addEventListener('click', toggleTheme);
  document.getElementById('help-btn').addEventListener('click', () => document.getElementById('help').classList.add('show'));
  document.getElementById('mute-btn').addEventListener('click', (e) => { muted = !muted; e.currentTarget.textContent = muted ? '🔇' : '🔊'; });
  document.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', (e) => { if (e.target === el || e.target.hasAttribute('data-close')) el.closest('.modal,.overlay').classList.remove('show'); }));
  document.getElementById('win-share').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(shareText()); document.getElementById('win-share').textContent = 'Copied!'; setTimeout(() => document.getElementById('win-share').textContent = 'Share', 1400); } catch (_) {}
  });
  document.getElementById('win-next').addEventListener('click', () => {
    document.getElementById('win').classList.remove('show');
    const ni = (DIFFS.indexOf(state.diff) + 1) % DIFFS.length;
    newGame(state.isDaily ? DIFFS[ni] : state.diff, state.isDaily);
  });
  window.addEventListener('resize', () => { if (state) { layout(); render(); } });
  newGame('easy', true);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
