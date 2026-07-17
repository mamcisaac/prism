// Canonical post-win leaderboard panel — the submit-then-show-the-board flow
// every leaderboard game hand-rolled as `renderWinLeaderboard`. It pairs with
// arcade-leaderboard-ui.js (the modal) and arcade-leaderboard.js (the data
// layer): this owns the RESULTS-CARD inline panel — prompt for a handle once,
// submit today's daily (deduped so replays don't spam worse/duplicate rows),
// then render the standing board via the modal's renderBoard. A small per-game
// config keeps each game's board keys, metric, and combined-total board
// pluggable while the flow, wording, and read-only gating stay identical.
//
// Read-only BY CONSTRUCTION on any non-scoring completion — a submit happens
// only for a live, in-daily, eligible first/improving solve:
//   • backend not configured  -> nothing
//   • not in daily mode        -> "Switch to Daily …" hint
//   • archive/random replay    -> that day's board, never a submit (isArchiving)
//   • a locked replay          -> that day's board (pass eligible:false, e.g. the
//                                 firstAttempt games)
//
// Dedup: a per-game `bests` localStorage cache ({board -> best value}) keyed by
// bestsKey. A completion (re)submits only when it BEATS the stored best for that
// board, so both "locked to first attempt" and "improvable (replay to beat your
// best)" games run one code path — locked games gate replays with eligible, and
// on a genuine first attempt the cache is empty so the guard is a no-op.
import { isLeaderboardConfigured, submitMetricCompletion, cleanHandle } from './arcade-leaderboard.js';

export function createWinBoard(config) {
  const {
    gameSlug,
    lbUi,                                  // createLeaderboardModal instance (uses .renderBoard)
    isDaily,                               // () => bool  (mode === 'daily' / state.isDaily)
    isArchiving,                           // () => bool  (a past/random daily replay)
    getHandle,                             // () => string  (the game's current handle)
    setHandle,                             // (cleanName) => void  (persist + update the game's var)
    bestsKey = 'ctt.' + gameSlug + '.bests',
    alltimeVersion = 2,                    // default all-time board version for submits
    joinTitle = "🏆 Join today's leaderboard:",
    submitLabel = 'Submit',                // string OR () => string (doublet-cross varies by mode)
    notDailyHint = 'Switch to Daily to join the leaderboard.',
  } = config;

  function loadBests() { try { return JSON.parse(localStorage.getItem(bestsKey)) || {}; } catch (_) { return {}; } }
  function saveBests(b) { try { localStorage.setItem(bestsKey, JSON.stringify(b)); } catch (_) {} }

  // Submit the primary daily board, then (for tiered games) the combined total.
  // Both are deduped against the shared bests cache — only a genuine improvement
  // writes a new row. Mirrors the hand-rolled doSubmit in every game verbatim.
  async function doSubmit(mount, opts) {
    const { board, value, difficulty, meta, total } = opts;
    const ver = opts.alltimeVersion != null ? opts.alltimeVersion : alltimeVersion;
    const bests = loadBests();
    const name = getHandle();
    // Non-improving replay: just show the standing board (no submit, no total).
    if (bests[board] !== undefined && value >= bests[board]) { lbUi.renderBoard(mount, board, name); return; }
    mount.innerHTML = `<div class="lb-status">Submitting…</div>`;
    const ok = await submitMetricCompletion({ game: gameSlug, difficulty, value, handle: name, board, meta, alltimeVersion: ver });
    if (ok) { bests[board] = value; saveBests(bests); }
    else if (bests[board] === undefined) { mount.innerHTML = `<div class="lb-status">Couldn't reach the leaderboard — your solve is saved under “You”.</div>`; return; }
    lbUi.renderBoard(mount, board, name);
    // Combined Total board: tiered games pass a `total` descriptor once every
    // difficulty is done. Deduped on its own board key against the same cache.
    if (total && (bests[total.board] === undefined || total.value < bests[total.board])) {
      const okT = await submitMetricCompletion({
        game: gameSlug, difficulty: total.difficulty || 'total', value: total.value,
        handle: name, board: total.board, meta: total.meta,
        alltimeVersion: total.alltimeVersion != null ? total.alltimeVersion : ver,
      });
      if (okT) { bests[total.board] = total.value; saveBests(bests); }
    }
  }

  // The results-card panel. Call once per completion with the day's board, the
  // ascending metric `value`, and the game-specific meta:
  //   render(mount, {
  //     board,               // primary daily board key (archive-aware)
  //     value,               // ascending metric (lower is better)
  //     difficulty,          // label for the submit ('daily' | 'easy' | state.diff …)
  //     meta,                // per-game meta mirrored into the row
  //     eligible,            // pass firstAttempt for LOCKED games; omit/true = improvable
  //     alltimeVersion?,     // per-call override (else config default)
  //     total?,              // { board, value, meta, difficulty?, alltimeVersion? } once
  //                          //   all difficulties are done (tiered games only)
  //   })
  function render(mount, opts) {
    if (!mount) return;
    mount.innerHTML = '';
    if (!isLeaderboardConfigured()) return;
    if (!isDaily()) { mount.innerHTML = `<div class="lb-hint">${notDailyHint}</div>`; return; }
    const board = opts.board;
    // Read-only: a past/random daily replay, or a locked already-played replay —
    // show that day's standing board, never submit.
    if (isArchiving() || opts.eligible === false) { lbUi.renderBoard(mount, board, getHandle() || null); return; }
    if (getHandle()) { doSubmit(mount, opts); return; }
    // First submit on this device: prompt for the arcade-wide handle once.
    const label = typeof submitLabel === 'function' ? submitLabel() : submitLabel;
    mount.innerHTML =
      `<div class="lb-join"><div class="lb-join-title">${joinTitle}</div>` +
      `<div class="lb-join-row">` +
      `<input id="lb-handle" class="lb-input" type="text" maxlength="24" placeholder="Your name" autocomplete="off" aria-label="Your name" />` +
      `<button id="lb-submit" class="btn" type="button">${label}</button>` +
      `</div></div>`;
    const input = mount.querySelector('#lb-handle');
    const btn = mount.querySelector('#lb-submit');
    input.focus();
    const go = () => {
      const name = cleanHandle(input.value);
      if (!name) { input.focus(); return; }
      setHandle(name);
      doSubmit(mount, opts);
    };
    btn.addEventListener('click', go);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  }

  return { render };
}
