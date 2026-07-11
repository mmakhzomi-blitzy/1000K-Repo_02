/**
 * @file public/js/app.js
 * @module app
 *
 * ES-module ENTRY POINT for the "Branch pagination + search" static frontend.
 * This is the ONLY script referenced by public/index.html
 * (`<script type="module" src="js/app.js">`) and it is the CONDUCTOR of the
 * feature: it owns the single source-of-truth UI `state`, performs the initial
 * render, and wires the four otherwise-independent feature modules together —
 *
 *   - js/tree.js       folder/repository/branch row rendering + folder
 *                      expand/collapse (fully self-managed via delegation)
 *   - js/pagination.js IntersectionObserver infinite-scroll of branch rows,
 *                      with a keyboard "Load more" fallback
 *   - js/search.js     "Search" affordance ↔ inline input toggle, debounced
 *                      substring filter, and the "Branch not found" empty state
 *   - js/selection.js  branch-row selection highlight + pinned confirmation
 *                      footer
 *
 * over the in-memory data model in js/data.js.
 *
 * Design contract (Technical Spec §0.5, §0.9): a native ES module with ZERO
 * dependencies, no build step, and no framework/bundler/library. It performs no
 * `fetch`/API/backend I/O and never touches server.js/package.json. ALL feature
 * logic lives in the sibling modules; this file is ORCHESTRATION ONLY — state
 * construction, the initial render, and the `init*` calls plus the small set of
 * wiring callbacks that let search and pagination share the branch-row region
 * of #tree-list without ever fighting over it.
 */

import { ACTIVE_REPO_ID, getBranches } from './data.js';
import { renderTree, renderBranchRows } from './tree.js';
import { initPagination } from './pagination.js';
import { initSearch } from './search.js';
import { initSelection } from './selection.js';

/* ============================================================================
 * DOM hooks owned at the orchestration layer. Every other id/class is a private
 * contract of the sibling module that owns it; app.js only needs the tree root
 * (shared event-delegation surface) and the branch-row activation selector to
 * wire the search-dismiss-on-selection behavior (Figma W6).
 * ==========================================================================*/

/** Id of the scrollable tree/branch list — the shared delegation surface. */
const TREE_LIST_ID = 'tree-list';
/** Attribute selector identifying an activatable branch row. */
const BRANCH_ROW_SELECTOR = '[data-branch-id]';

/* ============================================================================
 * Single source of truth.
 *
 * Every module receives THIS one object by reference and reads/mutates it in
 * place; there is deliberately no competing copy of `query`, `loadedBranchCount`,
 * `selectedBranchId`, or `expanded` anywhere else in the module graph. The
 * initial values mirror the Figma initial view (node 48966:64339) and the
 * dataset authored in js/data.js.
 * ==========================================================================*/

/**
 * @typedef {Object} UiState
 * @property {string} activeRepoId       Repository whose branches paginate/filter.
 * @property {Set<string>} expanded      Ids of currently-expanded folders/repos.
 * @property {string} query              Live search query ("" when not filtering).
 * @property {boolean} searchActive      Whether the inline search input is open.
 * @property {(string|null)} selectedBranchId  Selected branch id (see note below).
 * @property {number} loadedBranchCount  Branch rows currently revealed (paginated).
 * @property {number} pageSize           Branch rows appended per pagination page.
 */

/** @type {UiState} */
const state = {
  // Active repository — its branch leaves drive both pagination and search.
  activeRepoId: ACTIVE_REPO_ID,

  // Initial open chain engineering › frontend › web-app › customer-portal,
  // matching the `expanded: true` flags authored in js/data.js so the active
  // repository's branches are visible on first paint.
  expanded: new Set(['engineering', 'frontend', 'web-app', 'customer-portal']),

  // At rest there is no query and the search field is closed (the transparent
  // "Search" affordance row is showing).
  query: '',
  searchActive: false,

  // Pre-selected `dev` mirrors the Figma mock and js/data.js (`dev.selected`).
  // This is a COSMETIC highlight only: js/tree.js paints the `dev` row with the
  // lavender selected background (#F2F0FE) once it scrolls into view (dev sits
  // below the initial fold). The confirmation footer stays hidden until the
  // user actively selects a branch — the initial frame (48966:64339) shows no
  // footer — so selectBranch() is intentionally NOT called during boot.
  selectedBranchId: 'dev',

  // branch-1…branch-4 are visible before any scroll (R2); a page of 12 rows
  // makes the first scroll reveal branch-5…branch-16.
  loadedBranchCount: 4,
  pageSize: 12,
};

/* ============================================================================
 * Boot — render first, then connect the four concerns to the shared state.
 * ==========================================================================*/

/**
 * Render the initial UI and connect every feature module to the shared state.
 * Runs exactly once, after the DOM has been parsed (see the ready-guard at the
 * bottom of the module).
 */
function init() {
  // 1) Scaffold: folders / repositories / the "New branch" action row rendered
  //    into #tree-list, respecting `state.expanded`. Folder expand/collapse is
  //    fully owned by tree.js's delegated listeners, and its internal
  //    reconciliation re-applies the current selection and restores the branch
  //    rows on re-expand, so no `onToggle` handler is required here.
  renderTree(state);

  // 2) Initial branch page: the first `loadedBranchCount` branches of the
  //    active repository, rendered as plain rows (no highlight) immediately
  //    before #pagination-sentinel, which tree.js keeps as the list's last child.
  renderBranchRows(
    getBranches(state.activeRepoId).slice(0, state.loadedBranchCount),
    state,
  );

  // 3) Selection: one delegated click + Enter/Space listener on #tree-list.
  //    Registered BEFORE the close-on-selection listener below so that, on a
  //    branch click, the branch is selected (row highlight + footer) on the
  //    still-connected row BEFORE search re-renders the branch region.
  initSelection(state);

  // 4) Pagination: an IntersectionObserver over #pagination-sentinel plus the
  //    keyboard "Load more" fallback. Returns a controller so search can
  //    pause/resume the observer. loadNextBranchPage already no-ops while a
  //    query is active, so pagination and search never both drive the branch
  //    region — the pause/resume wiring below just makes that explicit.
  const pager = initPagination(state);

  // 5) Search: the affordance↔input toggle and the debounced substring filter.
  //    The only collaborators app.js must inject are the pause/resume hooks so
  //    the two features cooperate over #tree-list. renderMatches
  //    (renderBranchRows), restoreList (the current paginated slice), and
  //    announce (#search-status) intentionally use search.js's own correct
  //    defaults, keeping this orchestrator free of duplicated feature logic.
  const search = initSearch(state, {
    pausePagination: () => pager.pause(),
    resumePagination: () => pager.resume(state),
  });

  // 6) Dismiss an OPEN search when a branch is selected (Figma W6: the field
  //    reverts to the "Search" affordance once a branch is picked). This runs
  //    AFTER selection.js has applied the highlight + footer on the connected
  //    row; search.close() then restores the resting list and resumes
  //    pagination. It is a strict no-op unless search is open, so ordinary
  //    (non-search) selection is completely untouched.
  wireCloseSearchOnSelection(search);
}

/**
 * Attach the delegated activation listeners that dismiss an OPEN search once a
 * branch row is selected. Mirrors selection.js's own click + Enter/Space
 * activation model so keyboard and pointer behave identically, and is guarded
 * by `search.isActive()` so it does nothing while search is closed. Called
 * exactly once from {@link init}.
 *
 * @param {{ isActive: () => boolean, close: () => void }} search
 *   The handle returned by {@link initSearch}.
 */
function wireCloseSearchOnSelection(search) {
  const treeList = document.getElementById(TREE_LIST_ID);
  if (!treeList) return;

  /**
   * Close search iff it is open AND the event originated on a branch row.
   * @param {Event} event
   */
  const maybeCloseSearch = (event) => {
    if (!search.isActive()) return; // untouched when search is closed
    const target = event.target;
    if (!target || typeof target.closest !== 'function') return;
    const row = target.closest(BRANCH_ROW_SELECTOR);
    if (row && treeList.contains(row)) {
      search.close();
    }
  };

  treeList.addEventListener('click', maybeCloseSearch);
  treeList.addEventListener('keydown', (event) => {
    // Enter, and Space (' ' modern; 'Spacebar' legacy) activate a branch row.
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      maybeCloseSearch(event);
    }
  });
}

/* ============================================================================
 * DOM-ready guard. `<script type="module">` is deferred, so the document is
 * normally fully parsed by the time this module runs; the guard makes the entry
 * point robust even if the script is ever loaded differently, and guarantees
 * init() runs exactly once.
 * ==========================================================================*/

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
