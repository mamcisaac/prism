/* ============================================================
   Connect the Thoughts — shared arcade theme + shortcuts.
   Source of truth for theme bootstrap + persistence, the canonical
   keyboard shortcuts, and cross-origin ?theme= link rewriting — i.e.
   everything a GAME page uses. Each game vendors this file (or its
   bundler-friendly equivalent) so theme preference is preserved when
   navigating between games AND when crossing from the launcher (a
   different origin) into any game.

   Launcher-only behaviour (play tracking, the Supabase leaderboard
   summary, the stats modal, the welcome ribbon) lives in the hub-root
   arcade-launcher.js, which is deliberately NOT vended to games.

   Usage:
     1. Add the pre-paint bootstrap inline in <head> (prevents flash).
        The URL-param read is what carries theme across origins.
        Default is DARK — system preference is ignored.
          <script>
            (function () {
              try {
                var url = new URLSearchParams(location.search).get('theme');
                if (url === 'dark' || url === 'light') {
                  localStorage.setItem('ctt.theme', url);
                }
              } catch (_) {}
              var s = localStorage.getItem('ctt.theme');
              document.documentElement.setAttribute('data-theme', s || 'dark');
            })();
          </script>
     2. Load this file after DOM ready (or with `defer`) to wire toggles
        and the keyboard shortcuts.
     3. Any element with id="themeToggle" or [data-arcade-theme-toggle]
        becomes a toggle. Style is up to the game.
     4. On the launcher (or any page with cross-origin outbound game links),
        mark each link with `data-arcade-pass-theme` (or use `a.game-card`)
        — this script will keep ?theme= up to date on those hrefs so the
        current theme carries to the destination on first paint.
   ============================================================ */

(function () {
    'use strict';

    var STORAGE_KEY = 'ctt.theme';
    var root = document.documentElement;

    function current() {
        return root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    }

    function setTheme(theme, persist) {
        root.setAttribute('data-theme', theme);
        if (persist !== false) {
            try { localStorage.setItem(STORAGE_KEY, theme); } catch (_) {}
        }
        document.querySelectorAll('[aria-pressed]').forEach(function (el) {
            if (el.id === 'themeToggle' || el.hasAttribute('data-arcade-theme-toggle')) {
                el.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
            }
        });
        document.dispatchEvent(new CustomEvent('arcade:themechange', { detail: { theme: theme } }));
    }

    // Canonical arcade keyboard shortcuts — every game inherits these
    // when it vendors arcade-theme.js. Games opt in by giving their help button
    // id="helpButton" (or [data-arcade-help]) and modal close buttons
    // [data-arcade-close] (or matching one of the common selectors below).
    //   ?, h, H  → click the help button (open / focus help modal)
    //   Escape   → click the topmost overlay's close
    function isTypingTarget(t) {
        if (!t || !t.tagName) return false;
        var tag = t.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
        return t.isContentEditable === true;
    }
    document.addEventListener('keydown', function (e) {
        if (e.defaultPrevented) return;
        if (isTypingTarget(e.target)) return;
        if (e.metaKey || e.ctrlKey || e.altKey) return;

        if (e.key === '?' || e.key === 'h' || e.key === 'H') {
            var help = document.querySelector('[data-arcade-help], #helpButton, #help-button');
            if (help) { help.click(); e.preventDefault(); }
            return;
        }
        if (e.key === 'Escape') {
            // Try a series of known overlay-close selectors. First match wins.
            var sels = [
                '[data-arcade-overlay]:not([hidden]):not(.hidden) [data-arcade-close]',
                '.overlay:not([hidden]):not(.hidden) [data-close]',
                '.overlay:not([hidden]):not(.hidden) .modal-close-x',
                '.overlay:not([hidden]):not(.hidden) [data-help-close]',
                '.modal-backdrop:not([hidden]):not(.hidden) [data-close]',
                '.modal-backdrop:not([hidden]):not(.hidden) .modal-close-x'
            ];
            for (var i = 0; i < sels.length; i++) {
                var btn = document.querySelector(sels[i]);
                if (btn) { btn.click(); e.preventDefault(); return; }
            }
        }
    });

    // ── Modal scroll lock (self-enforcing) ──────────────────────────────
    // chrome.css declares `body.modal-open { overflow: hidden; … }`, but a
    // convention every modal call-site must remember is a convention that
    // drifts — an audit found ZERO call-sites engaging it. So ONE observer
    // owns the `modal-open` lane: whenever any .modal-backdrop is visible,
    // the body is locked; when the last one hides, it unlocks. Modules and
    // games keep doing what they already do (flip `hidden`/`.hidden`) and
    // inherit the lock for free — including modals built after load
    // (archive, tutorial) and future ones.
    // Opening a modal also closes any open bottom sheet: sheets sit at a
    // higher z-index (1100 vs the backdrop's 100), so an endgame modal
    // could otherwise appear invisibly UNDERNEATH a still-open sheet.
    // Lane ownership: `modal-open` = this observer (never hand-toggle it);
    // `drawer-open` = arcade-sheets.js; `popup-open` = free for a game's
    // own non-backdrop surfaces.
    function backdropVisible(el) {
        if (el.hidden || el.classList.contains('hidden')) return false;
        // checkVisibility also catches display:none inherited from a parent.
        return el.checkVisibility ? el.checkVisibility() : el.style.display !== 'none';
    }
    var modalLockOn = false;
    function syncModalLock() {
        var on = false;
        var els = document.querySelectorAll('.modal-backdrop');
        for (var i = 0; i < els.length; i++) {
            if (backdropVisible(els[i])) { on = true; break; }
        }
        if (on === modalLockOn) return;
        modalLockOn = on;
        if (document.body) document.body.classList.toggle('modal-open', on);
        if (on && window.ArcadeSheets && window.ArcadeSheets.closeAllSheets) {
            window.ArcadeSheets.closeAllSheets();
        }
    }
    function nodesTouchBackdrop(nodes) {
        for (var i = 0; i < nodes.length; i++) {
            var n = nodes[i];
            if (n.nodeType !== 1) continue;
            if (n.classList.contains('modal-backdrop')) return true;
            if (n.querySelector && n.querySelector('.modal-backdrop')) return true;
        }
        return false;
    }
    new MutationObserver(function (muts) {
        // Cheap relevance gate: games mutate classes constantly during play;
        // only a mutation on/around a backdrop warrants the re-scan.
        for (var i = 0; i < muts.length; i++) {
            var m = muts[i];
            if (m.type === 'attributes') {
                if (m.target.classList && m.target.classList.contains('modal-backdrop')) { syncModalLock(); return; }
            } else if (nodesTouchBackdrop(m.addedNodes) || nodesTouchBackdrop(m.removedNodes)) {
                syncModalLock(); return;
            }
        }
    }).observe(document.documentElement, {
        subtree: true, childList: true,
        attributes: true, attributeFilter: ['hidden', 'class', 'style']
    });

    // Intercepted at click/auxclick time so we never depend on init() having
    // run successfully on first paint. Mutates the href just before the
    // browser follows it, so the destination receives ?theme=<current> and
    // can match the launcher's theme on first paint.
    function rewriteLinkOn(ev) {
        var a = ev.target && ev.target.closest && ev.target.closest('a.game-card, a[data-arcade-pass-theme]');
        if (!a || !a.href) return;
        try {
            var u = new URL(a.href, location.href);
            u.searchParams.set('theme', current());
            a.href = u.toString();
        } catch (_) {}
    }
    document.addEventListener('mousedown', rewriteLinkOn, true);
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') rewriteLinkOn(e);
    }, true);
    document.addEventListener('touchstart', rewriteLinkOn, { capture: true, passive: true });

    function init() {
        // A modal already visible at load (e.g. a start/intro modal in the
        // markup) predates any mutation — sync the lock once explicitly.
        syncModalLock();
        var toggles = document.querySelectorAll('#themeToggle, [data-arcade-theme-toggle]');
        toggles.forEach(function (t) {
            t.setAttribute('aria-pressed', current() === 'dark' ? 'true' : 'false');
            t.addEventListener('click', function () {
                setTheme(current() === 'dark' ? 'light' : 'dark');
            });
        });

        // System-preference auto-tracking deliberately removed — the arcade
        // defaults to dark regardless of the user's OS setting. The toggle
        // is the only way to override; their choice persists in
        // localStorage["ctt.theme"].
    }

    // Expose for game code that wants programmatic access
    window.Arcade = {
        getTheme: current,
        setTheme: function (t) { setTheme(t === 'dark' ? 'dark' : 'light'); }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
