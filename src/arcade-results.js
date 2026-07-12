// @arcade-classic ArcadeResults
// ============================================================
// Connect the Thoughts — shared results / completion card (ES module).
//
// CANONICAL SOURCE. Edit only here (connectthethoughts/shared/), then run
//   node scripts/sync-shared.mjs
// to vend copies into each game repo (ESM into Vite games' src/, a transformed
// window.ArcadeResults build into vanilla games). `--check` flags drift.
//
// Renders the standardized finish card every daily game shares: headline,
// the game's ranking metric, a game-specific sub-line + detail block, an
// optional "daily complete" note, the #lb-inline + #placements mounts (the
// game fills these afterwards, exactly as before), and the Next / Share
// action buttons. (Stars were removed arcade-wide — every game leads with
// the raw metric its leaderboard ranks by.)
//
// Button priority is centralized here: while daily levels remain, advancing to
// the next difficulty is primary and Share steps down; once the run is
// complete (or in non-daily modes), Share is primary. Pass `advanceFirst`.
// ============================================================

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

// ── Arcade daily chain ──────────────────────────────────────────────────────
// Finishing one game's daily points the player at the NEXT daily in the arcade,
// so the whole floor is one continuous run. Order mirrors the hub's "The
// Dailies" section and wraps at the end. All games deploy on one origin
// (location.origin), so a plain link inherits the shared ctt.theme; ?theme= is
// belt-and-suspenders for the cross-origin stub path.
const DAILY_CHAIN = [
  ['tumbler', 'Tumbler'], ['mosaic', 'Mosaic'], ['Cornerstone', 'Cornerstone'],
  ['switchback', 'Switchback'], ['ladder', 'Ladder'], ['connect-the-thoughts', 'Connect the Thoughts'],
  ['the-dictionary-game', 'The Dictionary Game'], ['guess-the-date', 'Guess the Date'],
  ['word-crush', 'Word Crush'], ['doublet-cross', 'Doublet Cross'],
];
// Which game are we in? Explicit opts.gameSlug wins; otherwise infer from the
// first path segment (production games live at <origin>/<slug>/).
function currentDailySlug(o) {
  if (o.gameSlug) return String(o.gameSlug);
  try { return (location.pathname.split('/').filter(Boolean)[0]) || ''; } catch (_) { return ''; }
}
// Has this game's daily been played TODAY on this device? Every daily game
// records a dated entry into the shared ctt.<slug>.history (same origin across
// the whole arcade), so the chain can skip dailies you've already cleared.
// Date parsing mirrors arcade-leaderboard's historyStats (padded or unpadded
// 'YYYY-M-D' → the same UTC day-number today is measured in).
function playedDailyToday(slug) {
  try {
    const raw = localStorage.getItem('ctt.' + String(slug).toLowerCase() + '.history');
    if (!raw) return false;
    const h = JSON.parse(raw);
    if (!Array.isArray(h) || !h.length) return false;
    const today = Math.floor(Date.now() / 86400000);
    return h.some(function (e) {
      const p = String((e && e.date) || '').split('-').map(Number);
      if (!p[0]) return false;
      return Math.floor(Date.UTC(p[0], p[1] - 1, p[2]) / 86400000) === today;
    });
  } catch (_) { return false; }
}
function themeParam() {
  try { return localStorage.getItem('ctt.theme') || document.documentElement.getAttribute('data-theme') || 'dark'; } catch (_) { return 'dark'; }
}
function gameOrigin() {
  try { if (location.origin && /^https?:/.test(location.origin)) return location.origin; } catch (_) {}
  return 'https://mamcisaac.github.io';
}
// The next-daily link {label, url}, or null if this game isn't in the chain.
// Walks the fixed Dailies order from the current game, SKIPPING dailies already
// played today, and wraps. If everything today is done, points back to the
// arcade home with a "cleared" cue instead of looping you onto a finished game.
function nextDailyLink(o) {
  const slug = currentDailySlug(o).toLowerCase();
  if (!slug) return null;
  let i = -1;
  for (let k = 0; k < DAILY_CHAIN.length; k++) { if (DAILY_CHAIN[k][0].toLowerCase() === slug) { i = k; break; } }
  if (i === -1) return null;
  const origin = gameOrigin(), theme = themeParam();
  for (let step = 1; step <= DAILY_CHAIN.length; step++) {
    const nx = DAILY_CHAIN[(i + step) % DAILY_CHAIN.length];
    if (nx[0].toLowerCase() === slug) break; // came all the way back to us → all done
    if (!playedDailyToday(nx[0])) {
      return { label: 'Next daily · ' + nx[1], url: origin + '/' + nx[0] + '/?theme=' + theme };
    }
  }
  // Every daily is cleared for today — send them home to the arcade.
  return { label: 'You’ve cleared today’s dailies', url: 'https://connectthethoughts.ca/?theme=' + theme, allDone: true };
}

// Build the action-buttons row honoring the Next-vs-Share priority rule.
// When `dailyNext` is set (the run is fully done and this game chains onward),
// the cross-game "Next daily" link is the primary action and Share steps down.
function actionsHtml(o, dailyNext) {
  const showNext = o.nextLabel != null && o.nextLabel !== '';
  const showShare = o.showShare !== false;
  const advanceFirst = dailyNext ? false : (!!o.advanceFirst && showNext);
  const dailyHtml = dailyNext
    ? '<a class="btn" id="next-daily-btn" href="' + dailyNext.url + '">' + dailyNext.label + ' <span aria-hidden="true">→</span></a>'
    : '';
  const share = showShare
    ? '<button class="btn' + ((advanceFirst || dailyNext) ? ' secondary' : '') + '" id="share-btn" type="button">' + (o.shareLabel || 'Share') + '</button>'
    : '';
  const next = showNext
    ? '<button class="btn' + ((advanceFirst || (!showShare && !dailyNext)) ? '' : ' secondary') + '" id="next-btn" type="button">' + o.nextLabel + '</button>'
    : '';
  // Optional tertiary action (e.g. "Try again" / replay the same puzzle).
  const again = (o.againLabel != null && o.againLabel !== '')
    ? '<button class="btn secondary" id="again-btn" type="button">' + o.againLabel + '</button>'
    : '';
  return dailyHtml + (advanceFirst ? (next + share) : (share + next)) + again;
}

// Render the results card into `mount` (its innerHTML is replaced).
// Returns { card, shareBtn, nextBtn } and wires the onShare / onNext callbacks.
//
// opts:
//   mount          HTMLElement (required)
//   headline       string  — e.g. "Perfect!" (omitted if falsy)
//   statHtml       string  — the PRIMARY stat: whatever the game ranks by
//                            (e.g. "42 strokes", "3 clues", "88% close", a score,
//                            or a time). This is the headline number a player
//                            reads — always the metric the leaderboard uses.
//   timeHtml       string  — pre-rendered time text (omitted if falsy). Use ONLY
//                            when time is the game's ranking metric (e.g. switchback).
//   subHtml        string  — game-specific sub-line (omitted if falsy)
//   detailHtml     string  — game-specific block, e.g. correct-order list
//   dailyComplete  boolean — show complete note + #placements mount
//   completeNote   string  — defaults to the standard celebration line
//   nextLabel      string  — advance/again button label (omitted if falsy)
//   shareLabel     string  — defaults to "Share"
//   showShare      boolean — default true
//   advanceFirst   boolean — true => Next primary, Share secondary
//   againLabel     string  — optional 3rd action (e.g. "Try again"); omitted if falsy
//   gameSlug       string  — this game's arcade slug (optional). Used to pick the
//                            "Next daily" chain target on dailyComplete; inferred
//                            from the URL when omitted.
//   onShare, onNext, onAgain  functions
export function renderResults(opts) {
  const o = opts || {};
  // On a finished daily run, offer the next daily in the arcade as the primary CTA.
  const dailyNext = o.dailyComplete ? nextDailyLink(o) : null;
  const note = o.completeNote || '\u{1F389} Daily complete — new puzzles tomorrow.';
  const parts = [
    '<div class="results-card">',
    o.headline ? '<div class="results-headline">' + o.headline + '</div>' : '',
    o.statHtml ? '<div class="results-stat">' + o.statHtml + '</div>' : '',
    o.timeHtml ? '<div class="results-time">' + o.timeHtml + '</div>' : '',
    o.subHtml ? '<div class="results-sub">' + o.subHtml + '</div>' : '',
    o.detailHtml || '',
    o.dailyComplete ? '<div class="daily-complete-note">' + note + '</div>' : '',
    '<div class="lb-inline" id="lb-inline"></div>',
    o.dailyComplete ? '<div class="placements" id="placements"></div>' : '',
    '<div class="results-actions">' + actionsHtml(o, dailyNext) + '</div>',
    '</div>',
  ];
  o.mount.innerHTML = parts.join('');

  const card = o.mount.querySelector('.results-card');
  const shareBtn = o.mount.querySelector('#share-btn');
  const nextBtn = o.mount.querySelector('#next-btn');
  const againBtn = o.mount.querySelector('#again-btn');
  if (shareBtn && typeof o.onShare === 'function') shareBtn.addEventListener('click', o.onShare);
  if (nextBtn && typeof o.onNext === 'function') nextBtn.addEventListener('click', o.onNext);
  if (againBtn && typeof o.onAgain === 'function') againBtn.addEventListener('click', o.onAgain);

  return { card, shareBtn, nextBtn, againBtn };
}
