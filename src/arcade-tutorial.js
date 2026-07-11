// ============================================================
// Shared first-play tutorial — a small slide carousel that *shows* a new
// player how to play instead of making them read the rules.
//
// A game opts in by:
//   1. const tut = createTutorial({ gameSlug, steps }) — 2–4 plain-language slides,
//   2. tut.wire()            — inject a "Show me how to play ▶" button into the help
//                              modal so the tutorial is re-openable from the rules menu,
//   3. tut.maybeAutoStart()  — fire it automatically the first time this game is played
//                              (tracked by localStorage ctt.<slug>.tutorialSeen).
//
// Self-contained: builds its own modal (canonical .modal-backdrop/.modal chrome) on
// first open, so a game needs no extra markup. Only the per-game `steps` content
// differs — the carousel mechanics are identical arcade-wide.
// ============================================================

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

// Help-modal containers vary across games (esm vs classic); wire() walks this chain
// to find where to inject the replay button, unless the game passes an explicit selector.
const HELP_CARD_SELECTORS = [
  '#help-modal .modal',
  '#instructionsOverlay .overlay-content',
  '#instructions-popup',
  '#helpModal .modal',
];

export function createTutorial(config) {
  const {
    gameSlug,
    title = 'How to play',
    steps = [],
    helpCard = null,
  } = config;
  const seenKey = 'ctt.' + gameSlug + '.tutorialSeen';
  let backdrop = null, artEl = null, titleEl = null, bodyEl = null,
    dotsEl = null, backBtn = null, nextBtn = null;
  let i = 0;

  function hasSeen() {
    try { return !!localStorage.getItem(seenKey); } catch (_) { return false; }
  }
  function markSeen() {
    try { localStorage.setItem(seenKey, '1'); } catch (_) {}
  }

  function build() {
    if (backdrop) return;
    backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.id = 'tutorial-modal';
    backdrop.hidden = true;
    backdrop.innerHTML =
      '<div class="modal tutorial-card" role="dialog" aria-modal="true" aria-labelledby="tutorial-title">' +
        '<button class="modal-close-x" type="button" aria-label="Close">×</button>' +
        '<div class="tutorial-art" aria-hidden="true"></div>' +
        '<h2 id="tutorial-title"></h2>' +
        '<div class="tutorial-body"></div>' +
        '<div class="tutorial-dots"></div>' +
        '<div class="tutorial-nav">' +
          '<button class="btn secondary tutorial-back" type="button">Back</button>' +
          '<button class="btn tutorial-next" type="button">Next</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(backdrop);
    artEl = backdrop.querySelector('.tutorial-art');
    titleEl = backdrop.querySelector('#tutorial-title');
    bodyEl = backdrop.querySelector('.tutorial-body');
    dotsEl = backdrop.querySelector('.tutorial-dots');
    backBtn = backdrop.querySelector('.tutorial-back');
    nextBtn = backdrop.querySelector('.tutorial-next');

    backdrop.querySelector('.modal-close-x').addEventListener('click', close);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    document.addEventListener('keydown', (e) => {
      if (backdrop.hidden) return;
      if (e.key === 'Escape') { close(); e.stopPropagation(); }
      else if (e.key === 'ArrowRight') { e.stopPropagation(); next(); }
      else if (e.key === 'ArrowLeft') { e.stopPropagation(); prev(); }
    });
    backBtn.addEventListener('click', prev);
    nextBtn.addEventListener('click', next);
  }

  function render() {
    const step = steps[i] || {};
    if (step.art) { artEl.innerHTML = step.art; artEl.hidden = false; }
    else { artEl.innerHTML = ''; artEl.hidden = true; }
    titleEl.textContent = step.title || title;
    bodyEl.innerHTML = step.body || '';
    dotsEl.innerHTML = steps
      .map((_, n) => '<span class="tutorial-dot' + (n === i ? ' active' : '') + '"></span>')
      .join('');
    backBtn.hidden = i === 0;
    const last = i === steps.length - 1;
    nextBtn.textContent = last ? 'Start playing' : 'Next';
  }

  function next() {
    if (i >= steps.length - 1) { close(); return; }
    i += 1; render();
  }
  function prev() {
    if (i <= 0) return;
    i -= 1; render();
  }

  // Let games pause their solve clock while the tutorial covers a started game,
  // without each game having to observe the modal DOM. All open/close paths
  // (×, backdrop click, Escape, the final "Start playing" step) route through
  // open()/close(), so one dispatch in each covers every case.
  function emit(isOpen) {
    document.dispatchEvent(new CustomEvent('arcade:tutorial', { detail: { open: isOpen } }));
  }

  function open() {
    if (!steps.length) return;
    build();
    markSeen();
    i = 0;
    render();
    backdrop.hidden = false;
    emit(true);
  }
  function close() {
    if (!backdrop || backdrop.hidden) return;
    backdrop.hidden = true;
    emit(false);
  }

  // Fire once, the first time a game is played.
  function maybeAutoStart() {
    if (hasSeen()) return;
    open();
  }

  // Inject the "Show me how to play" launcher into the game's help/rules modal so the
  // tutorial is re-openable after the first play. Idempotent.
  function wire() {
    if (!steps.length) return;
    let card = null;
    if (helpCard) card = document.querySelector(helpCard);
    if (!card) {
      for (const sel of HELP_CARD_SELECTORS) {
        card = document.querySelector(sel);
        if (card) break;
      }
    }
    if (!card || card.querySelector('.tutorial-launch')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn secondary tutorial-launch';
    btn.textContent = 'Show me how to play ▶';
    btn.addEventListener('click', () => {
      // Close the host help modal, then open the tutorial on top. Games hide/reopen
      // their help differently (the `hidden` attribute, a `.hidden`/`.show` class, or
      // inline display) — so trigger the modal's OWN close control, which uses the
      // correct, reversible hide logic. Fall back to attribute/class toggling.
      const host = card.closest('.modal-backdrop, .overlay, .instructions-popup, .modal') || card;
      const closer = host.querySelector('.modal-close-x, .closeOverlay, .close-help, [data-arcade-close], [aria-label^="Close"]');
      if (closer) closer.click();
      else { host.hidden = true; host.classList.add('hidden'); host.classList.remove('open', 'visible', 'show', 'active'); }
      open();
    });
    card.appendChild(btn);
  }

  return { open, close, wire, maybeAutoStart };
}
