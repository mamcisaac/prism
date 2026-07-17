// Canonical leaderboard-modal UI — the open/render/scope-tab/diff-tab/day-nav
// orchestration that was hand-copied across every esm game. The data layer
// (submit/fetch/compositeScore/personalBests) stays in arcade-leaderboard.js;
// this owns the modal behavior, driven by a small per-game config so each
// game's board keys and score-column format stay pluggable.
//
// Expects the canonical lb-modal markup (#lb-modal, #lb-body, #lb-day-label,
// #lb-prev/#lb-next, .lb-nav, .lb-diff-tab[data-diff], .lb-scope-tab[data-scope])
// and the topbar #lbButton — all already standard via the synced chrome.
//
// config = {
//   gameSlug, difficulties:[...], diffLabel:{...}, maxOffset=13,
//   getDifficulty()  -> current difficulty (for the default tab),
//   getHandle()      -> current handle or null,
//   boardKeyForOffset(offset, diff) -> per-day board key,
//   baseDateKey?()   -> the PLAYED day's date key "YYYY-M-D" (i.e. dailyDateKey(),
//                       which honors the archive). When supplied, the modal derives
//                       the day label itself (relative to the real today), so a
//                       replayed/random past daily is titled by its real date instead
//                       of mislabelled "Today". Games that pass archive-aware board
//                       keys should pass this and can drop dayLabelForOffset.
//   dayLabelForOffset?(offset)      -> legacy per-game label "Today" / "2 days ago";
//                       used only as a fallback when baseDateKey is absent,
//   rowStat(r)       -> score column HTML for a standing row (game-specific),
//   youRow(best, d)  -> score column HTML for the "You" tab,
//   youOrder?        -> difficulty order for "You" (default difficulties+['total']),
//   youHead?         -> heading for the "You" list,
// }
// SINGLE-BOARD mode — OMIT `difficulties` for games with one daily board and no
// difficulty tiers (verdict, doublet-cross). Then: boardKeyForOffset(offset) takes
// no diff, no "· <diff>" label suffix, diff tabs are skipped, and "You" shows one
// row. Extra opts: alltimeKey='daily', youKey='daily', youLabel='Daily',
// youHeadSingle='Your daily best'. (getDifficulty/diffLabel not needed.)
// Empty-state wording ("No solves yet …") is deliberately HARD-CODED, not a
// per-game option — every game shares one phrasing so the arcade can't drift.
import {
  isLeaderboardConfigured, fetchTop, cleanHandle,
  alltimeBoard, personalBests, historyStats, historyStatsHtml,
} from './arcade-leaderboard.js';

// Self-contained HTML-escape (handles only — kept local so adopting the
// leaderboard modal needs nothing beyond arcade-leaderboard.js, which every
// leaderboard game already vendors).
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

export function createLeaderboardModal(config) {
  const {
    gameSlug, difficulties, diffLabel, maxOffset = 13,
    getDifficulty, getHandle, boardKeyForOffset, dayLabelForOffset, baseDateKey,
    rowStat, youRow,
    youHead = 'Your best by difficulty',
    // Single-board mode (omit `difficulties`): one daily board, no diff tabs.
    alltimeKey = 'daily', youKey = 'daily', youLabel = 'Daily',
    youHeadSingle = 'Your daily best',
    // `alltimeVersion` picks a fresh all-time board when a game's score meaning
    // changed. `bestComparator(candidate, current)` orders the "You" bests by
    // the game's own metric. `youStats` = {metricLabel, buckets:[{label, max}]}
    // renders the You-tab metric-distribution chart (see historyStatsHtml).
    alltimeVersion = 1, bestComparator, youStats,
  } = config;
  // Games without difficulty tiers (e.g. verdict, doublet-cross) run a single
  // daily board: no diff tabs, no "· <diff>" suffix, one row in "You".
  const single = !difficulties;
  const youOrder = config.youOrder || (difficulties ? [...difficulties, 'total'] : []);

  let lbOffset = 0;
  let lbDiff = null;
  let lbScope = 'today';

  // Day-nav label. When the game supplies baseDateKey() (its archive-aware
  // dailyDateKey), we describe (played day − offset) relative to the REAL today,
  // so replaying/opening a past daily reads as its real date ("Jul 10"), not the
  // stale "Today" the old per-game dayLabelForOffset produced during a replay.
  // Falls back to the legacy per-game label when baseDateKey isn't provided.
  function dayLabel(offset) {
    const key = baseDateKey && baseDateKey();
    if (!key) return dayLabelForOffset ? dayLabelForOffset(offset) : (offset === 0 ? 'Today' : offset + ' days ago');
    const p = String(key).split('-').map(Number);
    const d = new Date(p[0], p[1] - 1, p[2]);
    d.setDate(d.getDate() - offset);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const diffDays = Math.round((today - d) / 86400000);
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays > 1 && diffDays < 7) return diffDays + ' days ago';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  // Render a board (top 20) into `el`, highlighting the viewer's own rows.
  async function renderBoard(el, board, myHandle) {
    el.innerHTML = `<div class="lb-status">Loading…</div>`;
    const rows = await fetchTop({ game: gameSlug, board });
    if (!rows.length) {
      el.innerHTML = `<div class="lb-status">No solves yet${myHandle ? ' — you might be first!' : ''}.</div>`;
      return;
    }
    const me = myHandle ? cleanHandle(myHandle) : null;
    const list = rows.map((r, i) => {
      const isMe = me && cleanHandle(r.handle) === me;
      return `<li class="lb-row${isMe ? ' me' : ''}">` +
        `<span class="lb-rank">${i + 1}</span>` +
        `<span class="lb-name">${escapeHtml(r.handle)}</span>` +
        `<span class="lb-score">${rowStat(r)}</span>` +
        `</li>`;
    }).join('');
    el.innerHTML = `<ol class="lb-list">${list}</ol>`;
    const inTop = rows.some(r => me && cleanHandle(r.handle) === me);
    if (me && !inTop) {
      el.insertAdjacentHTML('beforeend', `<div class="lb-status lb-you-note">Your solve isn't in the top 20 yet.</div>`);
    }
  }

  // The "You" tab: personal bests + a shared stats panel (solves, current/best
  // streak, optional metric distribution) derived from local history — identical
  // across every leaderboard game, so the arcade can't drift on what "your
  // stats" means.
  function renderYou() {
    const body = document.getElementById('lb-body');
    const best = personalBests(gameSlug, bestComparator);
    let bests;
    if (single) {
      const d = best[youKey];
      bests = d
        ? `<div class="lb-you-head">${youHeadSingle}</div><ol class="lb-list"><li class="lb-row"><span class="lb-name">${youLabel}</span><span class="lb-score">${youRow(d)}</span></li></ol>`
        : '';
    } else {
      const rows = youOrder.filter(d => best[d]).map(d =>
        `<li class="lb-row"><span class="lb-name">${diffLabel[d]}</span><span class="lb-score">${youRow(best[d], d)}</span></li>`
      ).join('');
      bests = rows ? `<div class="lb-you-head">${youHead}</div><ol class="lb-list">${rows}</ol>` : '';
    }
    const st = historyStats(gameSlug);
    const stats = historyStatsHtml(gameSlug, youStats);
    const note = st.solves
      ? `<div class="lb-status">${st.solves} solve${st.solves === 1 ? '' : 's'} recorded on this device.</div>`
      : `<div class="lb-status">No solves yet — finish today's daily to start your record.</div>`;
    body.innerHTML = bests + stats + note;
  }

  function renderModalBoard() {
    const isYou = lbScope === 'you';
    const isAll = lbScope === 'alltime';
    const d = single ? null : (lbDiff || getDifficulty());
    const nav = document.querySelector('#lb-modal .lb-nav');
    if (nav) nav.style.display = (isYou || isAll) ? 'none' : '';
    if (isYou) { document.getElementById('lb-day-label').textContent = 'Your bests'; renderYou(); return; }
    const board = single
      ? (isAll ? alltimeBoard(alltimeKey, alltimeVersion) : boardKeyForOffset(lbOffset))
      : (isAll ? alltimeBoard(d, alltimeVersion) : boardKeyForOffset(lbOffset, d));
    renderBoard(document.getElementById('lb-body'), board, getHandle() || null);
    const dayPart = isAll ? 'All-time' : dayLabel(lbOffset);
    document.getElementById('lb-day-label').textContent = single ? dayPart : dayPart + ' · ' + diffLabel[d];
    document.getElementById('lb-prev').disabled = lbOffset >= maxOffset;
    document.getElementById('lb-next').disabled = lbOffset <= 0;
  }

  function open() {
    lbOffset = 0;
    lbScope = 'today';
    if (!single) {
      lbDiff = getDifficulty();
      document.querySelectorAll('.lb-diff-tab').forEach(b => b.classList.toggle('active', b.dataset.diff === lbDiff));
    }
    document.getElementById('lb-modal').hidden = false;
    document.querySelectorAll('.lb-scope-tab').forEach(b => b.classList.toggle('active', b.dataset.scope === 'today'));
    renderModalBoard();
  }

  // Wire the modal's controls. Call once after the DOM is ready. Hides the
  // leaderboard button (and does nothing else) when the backend isn't set up.
  function wire() {
    const lbBtn = document.getElementById('lbButton');
    const lbModal = document.getElementById('lb-modal');
    if (!isLeaderboardConfigured()) { if (lbBtn) lbBtn.hidden = true; return; }
    if (lbBtn) lbBtn.addEventListener('click', open);
    document.getElementById('lb-close').addEventListener('click', () => { lbModal.hidden = true; });
    lbModal.addEventListener('click', e => { if (e.target === lbModal) lbModal.hidden = true; });
    document.getElementById('lb-prev').addEventListener('click', () => { lbOffset = Math.min(maxOffset, lbOffset + 1); renderModalBoard(); });
    document.getElementById('lb-next').addEventListener('click', () => { lbOffset = Math.max(0, lbOffset - 1); renderModalBoard(); });
    document.querySelectorAll('.lb-diff-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        lbDiff = btn.dataset.diff;
        document.querySelectorAll('.lb-diff-tab').forEach(b => b.classList.toggle('active', b.dataset.diff === lbDiff));
        lbOffset = 0;
        renderModalBoard();
      });
    });
    document.querySelectorAll('.lb-scope-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        lbScope = btn.dataset.scope;
        document.querySelectorAll('.lb-scope-tab').forEach(b => b.classList.toggle('active', b === btn));
        lbOffset = 0;
        renderModalBoard();
      });
    });
  }

  // Public API: wire() once at init; open() to show the modal programmatically;
  // renderBoard() for the post-win panel, which submits then shows the standing
  // board via the same renderer. (renderModalBoard stays internal.)
  return { open, wire, renderBoard };
}
