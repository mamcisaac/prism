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

// Build the action-buttons row honoring the Next-vs-Share priority rule.
function actionsHtml(o) {
  const showNext = o.nextLabel != null && o.nextLabel !== '';
  const showShare = o.showShare !== false;
  const advanceFirst = !!o.advanceFirst && showNext;
  const share = showShare
    ? '<button class="btn' + (advanceFirst ? ' secondary' : '') + '" id="share-btn" type="button">' + (o.shareLabel || 'Share') + '</button>'
    : '';
  const next = showNext
    ? '<button class="btn' + (advanceFirst || !showShare ? '' : ' secondary') + '" id="next-btn" type="button">' + o.nextLabel + '</button>'
    : '';
  // Optional tertiary action (e.g. "Try again" / replay the same puzzle).
  const again = (o.againLabel != null && o.againLabel !== '')
    ? '<button class="btn secondary" id="again-btn" type="button">' + o.againLabel + '</button>'
    : '';
  return (advanceFirst ? (next + share) : (share + next)) + again;
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
//   onShare, onNext, onAgain  functions
export function renderResults(opts) {
  const o = opts || {};
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
    '<div class="results-actions">' + actionsHtml(o) + '</div>',
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
