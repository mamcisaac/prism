// ============================================================
// Shared "Past Daily Puzzles" archive calendar.
//
// Every daily game's puzzle is a pure function of the player's local date —
// the day rolls over at local midnight — so any past day can be replayed.
// A game opts in by:
//   1. giving its archive button id="archive-button" (or passing buttonId),
//   2. supplying loadDailyForDate(dateKey) — set the replay date + restart the
//      daily (typically: enterArchiveDate(dateKey); load the daily),
//   3. optionally isDayDone(dateKey) -> bool for a ✓ "completed" mark.
//
// Self-contained: builds its own modal (canonical .modal-backdrop/.modal chrome)
// on first open, so a game needs no extra markup. "Day N" counts from a single
// shared epoch so the number matches across the whole arcade.
// ============================================================

export const DAILY_EPOCH = Date.UTC(2026, 0, 1); // 2026-01-01 → Day 1

// 'YYYY-M-D' in the player's LOCAL calendar — identical basis to every game's
// daily seeding + lb boards, so the daily rolls over at local midnight.
export function archiveDateKey(d) {
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}

export function archiveDayNumber(key) {
  const p = String(key).split('-').map(Number);
  return Math.max(1, Math.floor((Date.UTC(p[0], p[1] - 1, p[2]) - DAILY_EPOCH) / 86400000) + 1);
}

// ---- Replay state: the one owner of the archive flag ----------------------
// A daily game is either showing TODAY's puzzle or replaying an archived day.
// That choice lives here (backed by window.__archiveDateKey, which classic
// builds share across modules); everything date-derived — seeding, board keys,
// Day N — reads it through dailyDateKey() in arcade-daily-seed.js. Games must
// not poke window.__archiveDateKey directly.
//
// INVARIANT: building a new board NEVER changes this. Only a deliberate "leave
// the archive" action — a mode switch, New game, "Back to today's daily" —
// calls exitArchive(). Games used to fold the clear into newGame(fromArchive),
// which made every re-pick call site responsible for threading a flag; the ones
// that forgot (a difficulty switch mid-replay) silently served TODAY's puzzle.
// With the clear hoisted out of newGame, an in-archive re-pick — difficulty,
// variant, sub-board — stays on the archived day by construction.
export function getArchiveDate() {
  if (typeof window === 'undefined') return null;
  return window.__archiveDateKey || null;
}

export function isArchiving() { return !!getArchiveDate(); }

// Pin the replay date. Called by a game's loadDailyForDate before it restarts.
export function enterArchiveDate(key) {
  if (typeof window !== 'undefined') window.__archiveDateKey = String(key);
}

// Return to today's daily. The ONLY thing that clears the replay date.
export function exitArchive() {
  if (typeof window !== 'undefined') window.__archiveDateKey = null;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

export function createArchive(config) {
  const {
    loadDailyForDate, isDayDone, days = 14, title = 'Past Daily Puzzles',
  } = config;
  let backdrop = null, listEl = null;

  function build() {
    if (backdrop) return;
    backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.id = 'archive-modal';
    backdrop.hidden = true;
    backdrop.innerHTML =
      '<div class="modal archive-card" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">' +
        '<button class="modal-close-x" type="button" aria-label="Close">×</button>' +
        '<h2>' + esc(title) + '</h2>' +
        '<div class="archive-list"></div>' +
      '</div>';
    document.body.appendChild(backdrop);
    listEl = backdrop.querySelector('.archive-list');
    backdrop.querySelector('.modal-close-x').addEventListener('click', close);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    document.addEventListener('keydown', (e) => {
      if (!backdrop.hidden && e.key === 'Escape') { close(); e.stopPropagation(); }
    });
  }

  function render() {
    const now = new Date();
    const rows = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const key = archiveDateKey(d);
      const n = archiveDayNumber(key);
      if (n < 1) break; // pre-epoch
      const done = isDayDone ? !!isDayDone(key) : false;
      const label = d.toLocaleDateString(undefined, {
        weekday: 'short', month: 'short', day: 'numeric',
      });
      rows.push(
        '<button class="archive-item' + (i === 0 ? ' archive-item--today' : '') + '" data-date="' + key + '" type="button">' +
          '<span class="archive-item__date">' + (done ? '✓ ' : '') + esc(label) + (i === 0 ? ' · Today' : '') + '</span>' +
          '<span class="archive-item__day">Day ' + n + '</span>' +
        '</button>'
      );
    }
    listEl.innerHTML = rows.join('');
    listEl.querySelectorAll('.archive-item').forEach((el) => {
      el.addEventListener('click', () => {
        const key = el.getAttribute('data-date');
        close();
        loadDailyForDate(key);
      });
    });
  }

  function open() { build(); render(); backdrop.hidden = false; }
  function close() { if (backdrop) backdrop.hidden = true; }

  // Wire a game's archive button (default id="archive-button"). Call once at init.
  // The canonical topbar ships the button hidden; wiring reveals it, so games
  // that don't opt in show no archive control.
  function wire(buttonId = 'archive-button') {
    const btn = document.getElementById(buttonId);
    if (btn) { btn.hidden = false; btn.addEventListener('click', open); }
  }

  return { open, close, wire };
}
