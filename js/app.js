/**
 * js/app.js — Bootstrap / entry point (Requirement R8)
 * ===========================================================================
 * Blitzy Platform 2.0 — "Branch pagination + search" (AAP §0.6.2).
 *
 * This is the THIRD and LAST of three classic (non-module) scripts loaded by
 * index.html at the end of <body>, in this exact order:
 *     js/data.js  ->  js/branch-selector.js  ->  js/app.js
 *
 * Because it loads last, the globals it consumes are already defined:
 *   - window.BranchData     (js/data.js)          = { tree, branches }
 *   - window.BranchSelector (js/branch-selector.js) = { init(container, data, options) }
 *
 * Responsibilities (thin glue only — NO feature logic lives here):
 *   1. Mount the branch selector into the #branch-selector container using the
 *      static client-side seed (window.BranchData). All rendering, pagination,
 *      search, filtering, empty state, selection and the confirmation bar live
 *      inside js/branch-selector.js; this file only wires it up.
 *   2. Wire BENIGN, visual-only chrome affordances so the static page chrome
 *      feels alive — specifically an open/closed state on the workspace and
 *      repository .select-control elements. These toggle a CSS state hook
 *      (.is-open) and flip aria-expanded ONLY; they build no real dropdown and
 *      load no data.
 *
 * Hard constraints honoured (AAP §0.8, §0.7.2):
 *   - Vanilla JS only: NO import/export/require, NO framework/library, NO
 *     bundler. Native browser APIs only; the page must work from file://.
 *   - NO network/API/DB calls (no fetch/XHR/WebSocket). Real workspace
 *     switching, GitLab auth, tech-spec building and environment persistence
 *     are explicitly OUT OF SCOPE and are NOT wired to anything.
 *   - The "Build tech spec" button stays disabled as authored — it is never
 *     enabled and never given an action.
 *   - Adds NOTHING to the global scope (the whole body is IIFE-scoped).
 *   - Every DOM lookup is guarded: a missing container, a missing global, or a
 *     missing chrome element degrades gracefully and never throws.
 * ===========================================================================
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------------
   * Constants — the only DOM contracts this bootstrap depends on. They match
   * the mount element and the select controls authored in index.html /
   * css/styles.css (section#branch-selector, .select-control).
   * ---------------------------------------------------------------------- */
  var MOUNT_ID = 'branch-selector';        // <section id="branch-selector"> mount
  var SELECT_SELECTOR = '.select-control'; // workspace / repository selects
  var OPEN_CLASS = 'is-open';              // benign visual "open" state hook

  /* ------------------------------------------------------------------------
   * Small guarded console.warn helper. Never throws if console is absent.
   * ---------------------------------------------------------------------- */
  function warn(message) {
    if (window.console && typeof window.console.warn === 'function') {
      window.console.warn(message);
    }
  }

  /* ========================================================================
   * Phase 1 — Mount the branch selector (primary responsibility, R8).
   *
   * Locates the mount container, verifies the required globals exist, then
   * delegates the entire render to window.BranchSelector.init using the static
   * seed. Makes no network call. Returns the handle produced by init (or null
   * on any no-op); nothing is stored globally.
   * ===================================================================== */
  function mountBranchSelector() {
    var container = document.getElementById(MOUNT_ID);
    if (!container) {
      // No mount point on this page — leave the DOM untouched.
      return null;
    }

    // Under the documented load order both globals are present; guard anyway
    // so an out-of-order load or a missing sibling script degrades gracefully
    // instead of throwing.
    if (!window.BranchSelector || typeof window.BranchSelector.init !== 'function') {
      warn('[app] window.BranchSelector.init is unavailable; branch selector not mounted.');
      return null;
    }
    if (!window.BranchData) {
      warn('[app] window.BranchData is unavailable; branch selector not mounted.');
      return null;
    }

    // Mount with the client-side static seed. No backend/API/DB call is made.
    return window.BranchSelector.init(container, window.BranchData);
  }

  /* ========================================================================
   * Phase 2 — Benign chrome interactions (visual only).
   *
   * Give the workspace/repository .select-control elements an open/closed
   * affordance: clicking one opens it (and closes the others); clicking it
   * again closes it. State is expressed purely as the .is-open class plus
   * aria-expanded — no menu is built, no navigation happens, and no data is
   * loaded. Clicking outside or pressing Escape closes any open control. Every
   * lookup is guarded so missing chrome never throws.
   * ===================================================================== */
  function setSelectOpen(el, open) {
    if (!el) {
      return;
    }
    if (open) {
      el.classList.add(OPEN_CLASS);
    } else {
      el.classList.remove(OPEN_CLASS);
    }
    el.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function closeAllSelects(selects) {
    Array.prototype.forEach.call(selects, function (el) {
      setSelectOpen(el, false);
    });
  }

  function setupSelectControls() {
    var selects = document.querySelectorAll(SELECT_SELECTOR);
    if (!selects || !selects.length) {
      // No chrome selects on this page — nothing to wire.
      return;
    }

    Array.prototype.forEach.call(selects, function (el) {
      // Reflect the initial (closed) state for assistive technology.
      el.setAttribute('aria-expanded', 'false');

      el.addEventListener('click', function (event) {
        // Stop the document-level outside-click handler (registered below)
        // from immediately closing the control within this same click.
        event.stopPropagation();
        var willOpen = !el.classList.contains(OPEN_CLASS);
        // Single-open behaviour: collapse every control first, then open the
        // clicked one only if it was previously closed (so a second click on
        // the same control closes it).
        closeAllSelects(selects);
        if (willOpen) {
          setSelectOpen(el, true);
        }
      });
    });

    // Clicking anywhere outside an open control closes it. Benign — it only
    // removes the visual state hook; it performs no navigation or data load.
    document.addEventListener('click', function () {
      closeAllSelects(selects);
    });

    // Escape closes any open control for keyboard users.
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' || event.keyCode === 27) {
        closeAllSelects(selects);
      }
    });
  }

  /* ========================================================================
   * Bootstrap orchestration + DOM-ready guard.
   * ===================================================================== */
  function boot() {
    mountBranchSelector(); // R8 primary: mount the feature into #branch-selector
    setupSelectControls(); // R8 chrome: benign select open/close affordance
  }

  if (document.readyState === 'loading') {
    // Scripts sit at the end of <body>; if the parser has not finished
    // (or the scripts are marked defer), wait for the DOM to be ready.
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    // DOM already parsed — run immediately.
    boot();
  }
})();
