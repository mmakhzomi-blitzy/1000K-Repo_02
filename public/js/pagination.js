/**
 * @file public/js/pagination.js
 * @module pagination
 *
 * IntersectionObserver-based infinite-scroll pagination for the branch list
 * (Requirement R2, implicit I2; Workflow W1). Progressively reveals additional
 * branch rows as the user scrolls the fixed 400px branch-list container: the
 * initial view shows branch-1…branch-4 (rendered by app.js), and each scroll
 * that brings the sentinel into view appends the next batch (branch-5…branch-16,
 * then the six `main` rows and `dev`) until the active repository's branches are
 * exhausted.
 *
 * DESIGN CONTRACT — NO INVENTED LOADING UI (AAP §0.4.4, §0.9):
 *   The Figma design paginates as a pure clip at 400px. This module renders NO
 *   spinner, skeleton, "loading more" row, scrollbar chrome, progress bar, or
 *   count badge, and writes NO status/count text. The ONLY DOM feedback it
 *   produces is appending real branch rows (via tree.js) and toggling the
 *   visibility of the accessibility-only #load-more fallback button.
 *
 * TECHNICAL CONTRACT (AAP §0.5, §0.9):
 *   - Native ES module, named exports only, zero dependencies, no build step.
 *   - No inline styles (only the semantic `hidden` attribute is toggled).
 *   - No fetch/XHR/network: pages are computed from the in-memory data.js model.
 *   - The accessibility layer (keyboard #load-more) never alters the visuals.
 *
 * DOM WIRING (stable hooks declared by public/index.html):
 *   - #tree-list            scroll region → IntersectionObserver `root`.
 *   - #pagination-sentinel  zero-footprint target observed inside the root; it
 *                           is kept as the LAST child of #tree-list by tree.js.
 *   - #load-more            keyboard fallback <button> (visually hidden until
 *                           focus via CSS) that triggers the same page load.
 *
 * SHARED STATE (single source of truth owned by app.js — NEVER duplicated here):
 *   - state.loadedBranchCount  count of branch rows already rendered (init 4).
 *   - state.pageSize           batch increment per load (default 12 → the first
 *                              load reveals branch-5…branch-16).
 *   - state.activeRepoId       repository whose branches paginate.
 *   - state.query              active search text; while non-empty pagination is
 *                              SUSPENDED (search shows the full match set).
 *
 * SEARCH COORDINATION (AAP Phase 4) — two complementary, independently-safe
 * mechanisms are provided so a parallel search.js/app.js can wire whichever it
 * prefers:
 *   1. Automatic — {@link loadNextBranchPage} no-ops while `state.query` is
 *      non-empty, so NO wiring is required from search.js/app.js.
 *   2. Explicit — {@link pausePagination}/{@link resumePagination} let a caller
 *      disconnect the observer on search-activate and re-establish it on
 *      search-dismiss. Using neither, either, or both is safe.
 */

import { getBranches, ACTIVE_REPO_ID } from './data.js';
import { appendBranchRows } from './tree.js';

/* ============================================================================
 * Constants — DOM hooks + pagination tuning. The ids are a hard contract shared
 * with index.html and the sibling modules; the numbers mirror the design.
 * ==========================================================================*/

/** Id of the scroll region that is also the IntersectionObserver root. */
const TREE_LIST_ID = 'tree-list';
/** Id of the observed sentinel; tree.js keeps it as the root's last child. */
const SENTINEL_ID = 'pagination-sentinel';
/** Id of the accessibility-only keyboard "Load more" fallback button. */
const LOAD_MORE_ID = 'load-more';

/** Branch rows visible before any scroll (branch-1…branch-4). */
const DEFAULT_INITIAL_LOADED = 4;
/** Rows appended per page; 12 makes the first load reveal branch-5…branch-16. */
const DEFAULT_PAGE_SIZE = 12;
/**
 * Prefetch margin: the observer fires while the sentinel is still 120px below
 * the visible root, loading the next page slightly BEFORE it scrolls fully into
 * view for a smoother reveal (AAP §0.3.3). Expressed in px because it is a
 * scroll-distance threshold, not a scalable typographic value.
 */
const ROOT_MARGIN = '120px';

/* ============================================================================
 * Module state — deliberately minimal. The pagination COUNTERS live on the
 * shared `state` object (owned by app.js); the variables below only cache
 * references so the observer callback, the keyboard fallback, and the exported
 * helpers all operate on the same state and the same observer instance.
 * ==========================================================================*/

/** Re-entrancy guard: true while a page append is in flight. */
let loading = false;
/** The live IntersectionObserver, or null when none is currently active. */
let observer = null;
/** The most recent shared UI state object seen by the module. */
let activeState = null;
/** The most recent options object ({ onLoadNext }) passed to initPagination. */
let activeOptions = {};
/** Cached #load-more click handler so it can be detached before re-attaching. */
let loadMoreHandler = null;

/* ============================================================================
 * DOM lookup helpers — all defensive; index.html is the structural authority
 * and may be absent in a test harness, so every lookup tolerates absence.
 * ==========================================================================*/

/** @returns {HTMLElement|null} The scroll region / IntersectionObserver root. */
function getTreeList() {
  return document.getElementById(TREE_LIST_ID);
}

/** @returns {HTMLElement|null} The observed pagination sentinel. */
function getSentinel() {
  return document.getElementById(SENTINEL_ID);
}

/** @returns {HTMLElement|null} The keyboard "Load more" fallback button. */
function getLoadMore() {
  return document.getElementById(LOAD_MORE_ID);
}

/* ============================================================================
 * Shared-state helpers — read/normalise the pagination counters WITHOUT
 * creating a competing source of truth. Defaults are written back onto the
 * shared object only when a field is missing/invalid, never overwriting a value
 * already set by app.js.
 * ==========================================================================*/

/**
 * Ensure the shared state carries usable pagination fields, then return it. Any
 * field already provided by app.js is preserved; only missing/invalid fields
 * receive a default, so this can never clobber the single source of truth.
 *
 * @param {object} [state] Shared UI state from app.js.
 * @returns {object} The same object (or a fresh one) with defaults applied.
 */
function normalizePaginationState(state) {
  const s = state && typeof state === 'object' ? state : {};
  if (!Number.isFinite(s.loadedBranchCount) || s.loadedBranchCount < 0) {
    s.loadedBranchCount = DEFAULT_INITIAL_LOADED;
  }
  if (!Number.isFinite(s.pageSize) || s.pageSize <= 0) {
    s.pageSize = DEFAULT_PAGE_SIZE;
  }
  if (typeof s.activeRepoId !== 'string' || s.activeRepoId.length === 0) {
    s.activeRepoId = ACTIVE_REPO_ID;
  }
  return s;
}

/**
 * @param {object} state Shared UI state.
 * @returns {number} How many branch rows are already rendered.
 */
function getLoadedCount(state) {
  const n = state ? state.loadedBranchCount : undefined;
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_INITIAL_LOADED;
}

/**
 * @param {object} state Shared UI state.
 * @returns {number} Number of rows to append per page.
 */
function getPageSize(state) {
  const n = state ? state.pageSize : undefined;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_PAGE_SIZE;
}

/**
 * Ordered branch leaves of the active repository (pure data.js lookup; never a
 * network call). Tolerates an unset activeRepoId by falling back to the data
 * module's default active repository.
 *
 * @param {object} state Shared UI state.
 * @returns {import('./data.js').TreeNode[]}
 */
function getActiveBranches(state) {
  const repoId = (state && state.activeRepoId) || ACTIVE_REPO_ID;
  const all = getBranches(repoId);
  return Array.isArray(all) ? all : [];
}

/**
 * Whether a search query is active. While true, pagination is suspended so the
 * search module can present the full filtered match set at once (not paged).
 *
 * @param {object} state Shared UI state.
 * @returns {boolean}
 */
function isSearching(state) {
  return !!(state && typeof state.query === 'string' && state.query.length > 0);
}

/**
 * Whether every branch of the active repository is already rendered.
 *
 * @param {object} state Shared UI state.
 * @returns {boolean}
 */
function isExhausted(state) {
  return getLoadedCount(state) >= getActiveBranches(state).length;
}

/* ============================================================================
 * Core — append the next page of branch rows.
 * ==========================================================================*/

/**
 * Append the next batch of branch rows for the active repository.
 *
 * Guards, in order:
 *   1. no resolvable state → no-op;
 *   2. a search query is active → no-op (search owns the branch region while
 *      filtering — AAP Phase 4);
 *   3. a load is already in flight → no-op (the `loading` flag prevents
 *      duplicate appends from rapid, overlapping intersections — AAP §0.3.3).
 * When there is nothing left to append, the observer is disconnected and the
 * keyboard fallback hidden (data exhausted).
 *
 * Rows are appended via tree.js {@link module:tree.appendBranchRows}, which
 * inserts them before #pagination-sentinel (keeping the sentinel last) and never
 * clears existing rows. The shared `state.loadedBranchCount` is advanced so the
 * next call continues from the correct offset — the single source of truth is
 * never duplicated here.
 *
 * @param {object} [state] Shared UI state; defaults to the cached active state.
 * @returns {boolean} True if a page was appended, false otherwise.
 */
export function loadNextBranchPage(state) {
  const s = state || activeState;
  if (!s) return false;

  // Suspend while searching — the match set is shown in full, not paginated.
  if (isSearching(s)) return false;

  // Re-entrancy guard against rapid, overlapping intersection callbacks.
  if (loading) return false;

  const all = getActiveBranches(s);
  const loaded = getLoadedCount(s);
  const next = all.slice(loaded, loaded + getPageSize(s));

  // Nothing left to reveal → tear down the observer (data exhausted).
  if (next.length === 0) {
    markExhausted();
    return false;
  }

  loading = true;
  try {
    // Append REAL rows only — no spinner/skeleton/placeholder is ever inserted.
    appendBranchRows(next, s);
    s.loadedBranchCount = loaded + next.length;
  } finally {
    // Always clear the guard, even if the append threw, so pagination can retry.
    loading = false;
  }

  // Optional post-append hook (e.g. app.js re-applies selection to new rows).
  if (typeof activeOptions.onLoadNext === 'function') {
    activeOptions.onLoadNext(next, s);
  }

  // If that was the final batch, disconnect and hide the fallback.
  if (s.loadedBranchCount >= all.length) {
    markExhausted();
  }

  return true;
}

/* ============================================================================
 * IntersectionObserver wiring.
 * ==========================================================================*/

/**
 * Observer callback: load the next page when the sentinel intersects the root
 * (expanded by {@link ROOT_MARGIN}) and no load is already in flight. Iterates
 * defensively though only a single sentinel is ever observed.
 *
 * @param {IntersectionObserverEntry[]} entries
 */
function handleIntersect(entries) {
  for (const entry of entries) {
    if (entry.isIntersecting && !loading) {
      loadNextBranchPage(activeState);
      break;
    }
  }
}

/** Disconnect and drop the live observer (safe to call when none exists). */
function disconnectObserver() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
}

/* ============================================================================
 * Keyboard "Load more" fallback (accessibility only — AAP §0.3.3, §0.4.4).
 * The button is visually hidden until focus by branch-list.css; this module
 * only wires its behavior and toggles its `hidden` attribute on exhaustion.
 * ==========================================================================*/

/**
 * Attach the click handler to #load-more (idempotent: any prior handler is
 * removed first so re-init never stacks listeners). Native <button> semantics
 * already fire `click` on Enter/Space, so keyboard users can advance pagination
 * without a scroll gesture. No label/count text is added beyond the button's
 * existing accessible name.
 */
function attachLoadMore() {
  const loadMore = getLoadMore();
  if (!loadMore) return;
  if (loadMoreHandler) {
    loadMore.removeEventListener('click', loadMoreHandler);
  }
  loadMoreHandler = function onLoadMoreClick() {
    loadNextBranchPage(activeState);
  };
  loadMore.addEventListener('click', loadMoreHandler);
}

/** Remove the #load-more click handler (used on full teardown). */
function detachLoadMore() {
  const loadMore = getLoadMore();
  if (loadMore && loadMoreHandler) {
    loadMore.removeEventListener('click', loadMoreHandler);
  }
  loadMoreHandler = null;
}

/* ============================================================================
 * Exhaustion + initial-page helpers.
 * ==========================================================================*/

/**
 * All branches are shown: disconnect the observer (no leak) and hide the
 * keyboard fallback via the semantic `hidden` attribute so it never becomes a
 * visible artifact. No count/label/status text is produced.
 */
function markExhausted() {
  disconnectObserver();
  const loadMore = getLoadMore();
  if (loadMore) loadMore.hidden = true;
}

/**
 * Safety net: if no branch rows exist yet (i.e. app.js has not rendered the
 * initial page), render branch-1…branch-`loadedBranchCount` now so the first
 * page is never skipped when the observer starts. This is a strict NO-OP when
 * any branch row already exists, so it can never duplicate app.js's initial
 * render. `loadedBranchCount` already reflects the initial count, so it is NOT
 * advanced here.
 *
 * @param {object} state Shared UI state.
 */
function ensureInitialPage(state) {
  const treeList = getTreeList();
  if (!treeList) return;
  if (treeList.querySelector('[data-branch-row]')) return; // already rendered
  const all = getActiveBranches(state);
  const count = Math.min(getLoadedCount(state), all.length);
  if (count <= 0) return;
  appendBranchRows(all.slice(0, count), state);
}

/* ============================================================================
 * Public API.
 * ==========================================================================*/

/**
 * Build the lightweight controller returned by init/resume so app.js can drive
 * pagination without re-importing the module functions.
 *
 * @returns {{
 *   loadNext: () => boolean,
 *   pause: () => void,
 *   resume: (state?: object) => object,
 *   destroy: () => void,
 *   isExhausted: () => boolean
 * }}
 */
function createController() {
  return {
    loadNext: () => loadNextBranchPage(activeState),
    pause: pausePagination,
    resume: (state) => resumePagination(state || activeState),
    destroy: destroyPagination,
    isExhausted: () => isExhausted(activeState),
  };
}

/**
 * Initialise (or re-initialise) infinite-scroll pagination.
 *
 * Idempotent: any previous observer is disconnected first, so calling this again
 * — e.g. after the active repository changes, or to resume after a search — is
 * always safe and never stacks observers. Steps:
 *   1. normalise the shared pagination state (without clobbering app.js values);
 *   2. wire the #load-more keyboard fallback;
 *   3. render the initial page IF the caller has not (safety net; no-op when
 *      branch rows already exist);
 *   4. observe #pagination-sentinel inside #tree-list with a prefetch margin.
 * If the branches are already exhausted, or the DOM hooks are absent, no
 * observer is created (the keyboard fallback still advances pagination).
 *
 * @param {object} state Shared UI state (owned by app.js).
 * @param {{ onLoadNext?: (appended: import('./data.js').TreeNode[], state: object) => void }} [options]
 *   Optional hooks. `onLoadNext(appended, state)` fires after each successful
 *   page append (e.g. to re-apply selection styling to newly-added rows).
 * @returns {object} A controller: { loadNext, pause, resume, destroy, isExhausted }.
 */
export function initPagination(state, options = {}) {
  activeState = normalizePaginationState(state);
  activeOptions = options && typeof options === 'object' ? options : {};

  // Fresh start — never stack observers across re-inits.
  disconnectObserver();

  // Wire the accessibility fallback regardless of the observer's availability.
  attachLoadMore();

  // Render the first page if the caller has not (no-op when rows already exist).
  ensureInitialPage(activeState);

  const exhausted = isExhausted(activeState);
  const loadMore = getLoadMore();
  // Present (focusable, still visually clipped by CSS) while more remain; fully
  // removed via [hidden]{display:none} once everything is shown.
  if (loadMore) loadMore.hidden = exhausted;

  const container = getTreeList();
  const sentinel = getSentinel();

  // Defensive: without the root/sentinel we cannot observe. The keyboard
  // fallback remains functional for advancing pagination.
  if (exhausted || !container || !sentinel) {
    return createController();
  }

  observer = new IntersectionObserver(handleIntersect, {
    root: container,
    rootMargin: ROOT_MARGIN,
  });
  observer.observe(sentinel);

  return createController();
}

/**
 * Suspend scroll-driven pagination by disconnecting the observer WITHOUT tearing
 * down state or the keyboard fallback. Intended for search-activate — though it
 * is optional, since {@link loadNextBranchPage} already no-ops while searching.
 */
export function pausePagination() {
  disconnectObserver();
}

/**
 * Resume scroll-driven pagination after a pause/search-dismiss by re-observing
 * the sentinel over the current DOM and state. Preserves the options passed to
 * the last {@link initPagination}. Pagination continues from the current
 * `state.loadedBranchCount` over the full (unfiltered) branch list.
 *
 * @param {object} [state] Shared UI state; defaults to the cached active state.
 * @returns {object} The refreshed controller.
 */
export function resumePagination(state) {
  return initPagination(state || activeState, activeOptions);
}

/**
 * Fully tear down pagination: disconnect the observer, remove the #load-more
 * handler, and clear the in-flight guard. Primarily for tests and teardown;
 * production code typically uses {@link pausePagination}/{@link resumePagination}.
 */
export function destroyPagination() {
  disconnectObserver();
  detachLoadMore();
  loading = false;
}

