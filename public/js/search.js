/**
 * @file public/js/search.js
 * @module search
 *
 * Branch search experience for the "Branch pagination + search" static frontend
 * — Workflows W3 (activation), W4 (filter), W5 (dismissal) and Requirements
 * R3 / R4 / R5 / R7, plus the implicit I3 debounce + `aria-live` layer.
 *
 * Responsibilities:
 *  - Activation (R3 / W3): toggle the resting "Search" affordance row IN PLACE
 *    into the inline `<input type="search">` row and move focus into it.
 *  - Filter (R4 / W4): a debounced, case-insensitive SUBSTRING filter over the
 *    active repository's branch leaves, re-rendered as PLAIN rows (no highlight,
 *    bold, color change, or matched-substring emphasis) while the surrounding
 *    folder tree stays visible.
 *  - Empty state (R5): when nothing matches, reveal the text-only "Branch not
 *    found" message (no icon, no illustration).
 *  - Dismissal (R7 / W5): Escape or the clear-"×" button restore the affordance
 *    row, clear the query, hide the empty state, and re-render the RESTING branch
 *    list (the current paginated slice — not the full list) — leaving NO residual
 *    query, caret, or clear control. Blurring an EMPTY field also dismisses, but
 *    is deferred/exempted so it never races a branch click (see {@link initSearch}).
 *  - Accessibility (I3): announce the match count / empty state through the
 *    visually-hidden `#search-status` `aria-live` region. This layer is invisible
 *    and never alters the visual design.
 *
 * Design contract (do not break):
 *  - Native ES module using named `export`s only. Zero dependencies, no build
 *    step, no framework/library. Imports ONLY from `./data.js` and `./tree.js`.
 *  - NO INLINE STYLES: visibility is communicated exclusively by toggling the
 *    `hidden` attribute (branch-list.css enforces `[hidden] { display: none }`)
 *    and by setting semantic attributes (`aria-*`). No `style` attribute and no
 *    `element.style.*` visual assignment is ever produced.
 *  - NO matched-substring highlight: matches are rendered by
 *    {@link module:tree.renderBranchRows}, identical to normal branch rows
 *    (`#333333`, Inter Regular 400). This module adds no class, markup, or
 *    emphasis to a matched row.
 *  - Content strings are verbatim from the design: the affordance / placeholder
 *    label is "Search"; the empty state is exactly "Branch not found".
 *  - Filtering is 100% client-side over `./data.js` — no `fetch`/API/network and
 *    no backend coupling of any kind.
 *
 * Collaboration: search.js is intentionally decoupled from `pagination.js` and
 * `app.js`. {@link initSearch} accepts an optional `deps` bag so `app.js` can
 * coordinate pagination (pause while searching, resume on dismiss) and reuse its
 * own render/announce plumbing — WITHOUT search.js importing those modules.
 * Every dep has a sensible default (built on `./data.js` + `./tree.js`) so this
 * module is also fully functional standalone.
 */

import { getBranches, ACTIVE_REPO_ID } from './data.js';
import { renderBranchRows, focusBranchRow, focusFirstBranchRow } from './tree.js';

/* ============================================================================
 * Constants — DOM hooks, timing, and verbatim content strings. The ids/classes
 * are a hard contract shared with public/index.html and public/css/branch-list.css.
 * ==========================================================================*/

/** Id of the resting "Search" affordance `<button>` row. */
const SEARCH_AFFORDANCE_ID = 'search-affordance';
/** Id of the inline search input row (hidden by default in index.html). */
const SEARCH_INPUT_ROW_ID = 'search-input-row';
/** Id of the native `<input type="search">`. */
const SEARCH_INPUT_ID = 'branch-search-input';
/** Class of the trailing clear/close "×" button inside the input row. */
const SEARCH_CLEAR_CLASS = 'search-clear';
/** Id of the text-only "Branch not found" empty-state node. */
const EMPTY_STATE_ID = 'empty-state';
/** Id of the visually-hidden `aria-live="polite"` results region. */
const SEARCH_STATUS_ID = 'search-status';
/**
 * Id of the scrollable tree/branch list (the structural root). Used to test
 * whether the active repository's branch area is currently "live" — visible and
 * expanded — before rendering any filtered/resting rows into it (P12-FIND-12).
 */
const TREE_LIST_ID = 'tree-list';

/**
 * Debounce interval (ms) for the filter — responsive to typing yet coalesces
 * bursts so the branch region is not re-rendered on every keystroke (I3, ~150ms).
 */
const FILTER_DEBOUNCE_MS = 150;

/** Exact empty-state message, verbatim from the Figma design (R5). */
const EMPTY_STATE_MESSAGE = 'Branch not found';

/**
 * Branch rows shown before any pagination scroll (AAP R2: branch-1…branch-4).
 * Used ONLY as a fallback when the shared `state.loadedBranchCount` is absent,
 * so the pagination-aware restore never regresses to showing the full list.
 */
const DEFAULT_INITIAL_LOADED = 4;

/**
 * Selector that matches a branch row, a tree item, or the tree list itself.
 * Used to EXEMPT blur-dismissals whose focus target is a branch/tree element:
 * such a blur is the start of a branch click, which must own the interaction
 * (branch selection / Figma W6) rather than be raced by a search close (R3/R7).
 */
const TREE_TARGET_SELECTOR = '[data-branch-row], [role="treeitem"], #tree-list';

/* ============================================================================
 * debounce — a tiny, dependency-free trailing-edge debounce with a `cancel()`
 * method so a queued filter never fires after the field has been dismissed.
 * ==========================================================================*/

/**
 * Wrap `fn` so it runs only after `ms` milliseconds have elapsed since the most
 * recent call. The returned function exposes `cancel()` to drop a pending call.
 *
 * @param {(...args: any[]) => void} fn Function to debounce.
 * @param {number} ms Delay in milliseconds.
 * @returns {((...args: any[]) => void) & { cancel: () => void }}
 */
function debounce(fn, ms) {
  let timer = null;
  function wrapped(...args) {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn.apply(this, args);
    }, ms);
  }
  wrapped.cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return wrapped;
}

/* ============================================================================
 * DOM lookup helpers — defensive. index.html is the structural authority but
 * may be absent/partial in some contexts, so every lookup tolerates absence.
 * ==========================================================================*/

/** @returns {HTMLElement|null} The resting "Search" affordance row. */
function getAffordance() {
  return document.getElementById(SEARCH_AFFORDANCE_ID);
}

/** @returns {HTMLElement|null} The inline search input row. */
function getInputRow() {
  return document.getElementById(SEARCH_INPUT_ROW_ID);
}

/** @returns {HTMLInputElement|null} The native search input. */
function getInput() {
  return /** @type {HTMLInputElement|null} */ (document.getElementById(SEARCH_INPUT_ID));
}

/** @returns {HTMLElement|null} The text-only empty-state node. */
function getEmptyState() {
  return document.getElementById(EMPTY_STATE_ID);
}

/** @returns {HTMLElement|null} The visually-hidden aria-live region. */
function getStatus() {
  return document.getElementById(SEARCH_STATUS_ID);
}

/**
 * The clear/close "×" button, scoped WITHIN the input row (a stable class hook).
 * @param {HTMLElement|null} inputRow
 * @returns {HTMLElement|null}
 */
function getClearButton(inputRow) {
  const row = inputRow || getInputRow();
  return row ? row.querySelector('.' + SEARCH_CLEAR_CLASS) : null;
}

/** @returns {HTMLElement|null} The scrollable tree/branch list root. */
function getTreeList() {
  return document.getElementById(TREE_LIST_ID);
}

/**
 * Whether the active repository's branch area is currently "live" — i.e. its
 * `treeitem` is rendered inside #tree-list AND expanded, so branch rows rendered
 * now would attach beneath a visible, open repository.
 *
 * This mirrors the equivalent self-guard in pagination.js and is the core of the
 * P12-FIND-12 fix. Collapsing the active repo — or ANY ancestor folder of it
 * (engineering / frontend / web-app) — makes tree.js remove the repo's branch
 * rows and (for an ancestor) drop the repo's `treeitem` from the DOM entirely.
 * A debounced search filter that RESOLVES AFTER such a collapse must not render:
 * doing so would insert an orphan branch row beneath the collapsed subtree
 * (a selectable depth-5 row hanging under a collapsed depth-2 folder), corrupt
 * the tree, and desynchronise selection/footer state. Gating every render path
 * (`applyFilter`, the default `restoreList`) on this predicate — plus cancelling
 * the pending debounce on collapse via {@link initSearch}'s
 * `cancelPendingFilterIfHidden` — makes filtered rendering impossible unless the
 * active repo is actually on screen and open.
 *
 * The lookup compares `dataset.id` (injection-proof; no selector escaping) and
 * tolerates a missing #tree-list (test harnesses / partial DOM).
 *
 * @param {object} state Shared UI state.
 * @returns {boolean} True only when the active repo row is present and expanded.
 */
function isActiveRepoBranchAreaLive(state) {
  const treeList = getTreeList();
  if (!treeList) return false;
  const repoId = (state && state.activeRepoId) || ACTIVE_REPO_ID;
  const rows = treeList.querySelectorAll('[role="treeitem"][data-id]');
  for (const row of rows) {
    if (row.dataset.id === repoId) {
      return row.getAttribute('aria-expanded') === 'true';
    }
  }
  return false;
}

/* ============================================================================
 * State — search.js reads/writes `query` and `searchActive` and reads
 * `activeRepoId` / `loadedBranchCount` on the SINGLE shared UI state object
 * owned by app.js. It NEVER synthesizes a private/parallel feature state: when
 * the caller passes no usable object, {@link initSearch} returns an inert handle
 * instead, so there is exactly one source of truth (AAP §0.9).
 * ==========================================================================*/

/**
 * Validate and normalise the supplied shared UI state IN PLACE. Returns the SAME
 * object (never a copy) with the search-owned fields (`query`, `searchActive`)
 * guaranteed and `activeRepoId` defaulted in place when unset — or `null` when
 * the caller passed no usable object, signalling {@link initSearch} to go inert.
 *
 * This mutates the app-owned object; it does NOT create a second, competing
 * state container (the anti-pattern this replaces).
 *
 * @param {object} [state] Shared UI state from app.js (required in practice).
 * @returns {({ activeRepoId: string, query: string, searchActive: boolean }|null)}
 */
function normalizeState(state) {
  if (!state || typeof state !== 'object') return null;
  if (typeof state.activeRepoId !== 'string' || state.activeRepoId.length === 0) {
    state.activeRepoId = ACTIVE_REPO_ID;
  }
  if (typeof state.query !== 'string') state.query = '';
  if (typeof state.searchActive !== 'boolean') state.searchActive = false;
  return state;
}

/**
 * The current paginated branch count from the shared state, falling back to the
 * AAP initial page ({@link DEFAULT_INITIAL_LOADED}) when unset. Keeps restore
 * pagination-aware — we restore the CURRENT slice, never the full branch list.
 * @param {object} state Shared UI state.
 * @returns {number}
 */
function getLoadedCount(state) {
  const n = state.loadedBranchCount;
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_INITIAL_LOADED;
}

/**
 * The RESTING branch slice: the active repository's branches truncated to the
 * current paginated count. This is what the list shows with no query applied, so
 * opening search, clearing the field, and dismissing all restore exactly it —
 * preserving list contents and scroll geometry (R2/R3/R7).
 * @param {object} state Shared UI state.
 * @returns {import('./data.js').TreeNode[]}
 */
function restingBranches(state) {
  const all = getBranches(state.activeRepoId) || [];
  return all.slice(0, getLoadedCount(state));
}

/**
 * True when `el` is (or is contained by) a branch row, a tree item, or the tree
 * list — i.e. a target that owns branch selection. Used to exempt blur
 * dismissals that are really the beginning of a branch click (R3/R7).
 * @param {*} el
 * @returns {boolean}
 */
function isTreeTarget(el) {
  return !!(el && typeof el.closest === 'function' && el.closest(TREE_TARGET_SELECTOR));
}

/**
 * An inert handle returned when the shared state or the essential DOM controls
 * are missing, so callers can wire search unconditionally without null checks.
 * @returns {{ open: () => void, close: () => void, applyFilter: (v: string) => void, isActive: () => boolean, destroy: () => void }}
 */
function inertHandle() {
  const noop = () => {};
  return {
    open: noop,
    close: noop,
    applyFilter: noop,
    isActive: () => false,
    cancelPendingFilterIfHidden: noop,
    destroy: noop,
  };
}

/* ============================================================================
 * Public API.
 * ==========================================================================*/

/**
 * Initialise the branch search behavior and wire all listeners.
 *
 * @param {object} state REQUIRED shared UI state (the single source of truth
 *   owned by app.js). Reads `activeRepoId`/`loadedBranchCount`; reads/writes
 *   `query` and `searchActive`. When absent/invalid an inert no-op handle is
 *   returned and NO private state is synthesized.
 * @param {object} [deps] Optional collaborators injected by app.js. Each is
 *   optional and falls back to a `./data.js` + `./tree.js` default:
 *   @param {(branches: import('./data.js').TreeNode[]) => void} [deps.renderMatches]
 *     Render the given branch nodes as plain rows (the single rendering owner for
 *     matches, the empty result, and the resting slice). Default: `renderBranchRows`.
 *   @param {() => void} [deps.restoreList] Re-render the RESTING branch list on
 *     dismissal. Default: render the active repo's current paginated slice
 *     (`loadedBranchCount` rows) via `renderMatches` — NOT the full branch list.
 *   @param {() => void} [deps.pausePagination] Suspend pagination while searching.
 *   @param {() => void} [deps.resumePagination] Resume pagination after dismissal.
 *   @param {(text: string) => void} [deps.announce] Announce a result string.
 *     Default: set `#search-status` `textContent`.
 * @returns {{ open: () => void, close: () => void, applyFilter: (value: string) => void, isActive: () => boolean, destroy: () => void }}
 *   A cohesive handle so app.js can drive search in one call (e.g. `close()` on
 *   branch selection, per Figma W6). An inert no-op handle is returned when the
 *   shared state or the essential DOM controls are absent.
 */
export function initSearch(state, deps) {
  const affordance = getAffordance();
  const inputRow = getInputRow();
  const input = getInput();

  // Require the SINGLE app-owned state object; never fabricate a parallel one.
  const uiState = normalizeState(state);
  if (!uiState) {
    return inertHandle();
  }

  // Resolve injected collaborators with defaults built on ./data.js + ./tree.js.
  const d = deps && typeof deps === 'object' ? deps : {};
  const renderMatches = typeof d.renderMatches === 'function'
    ? d.renderMatches
    : (branches) => renderBranchRows(branches, uiState);
  // Pagination-aware default: restore exactly the current paginated slice
  // (loadedBranchCount rows), routed through renderMatches so there is ONE
  // rendering-ownership model. app.js may inject a richer restore (R7).
  const restoreList = typeof d.restoreList === 'function'
    ? d.restoreList
    : () => {
      // P12-FIND-12: never restore branch rows into a non-live branch area
      // (collapsed active repo / ancestor). Restoring the resting slice while
      // the subtree is collapsed would inject orphan rows beneath it. tree.js
      // re-establishes the branch rows from its own preserved cache on
      // re-expand (syncBranchArea), so skipping here loses nothing.
      if (!isActiveRepoBranchAreaLive(uiState)) return;
      renderMatches(restingBranches(uiState));
    };
  const pausePagination = typeof d.pausePagination === 'function' ? d.pausePagination : () => {};
  const resumePagination = typeof d.resumePagination === 'function' ? d.resumePagination : () => {};
  const announce = typeof d.announce === 'function'
    ? d.announce
    : (text) => {
      const status = getStatus();
      if (status) status.textContent = text;
    };

  // Without the essential controls there is nothing to wire — return inert.
  if (!affordance || !inputRow || !input) {
    return inertHandle();
  }

  const clearButton = getClearButton(inputRow);

  /* ---- empty-state + announcement helpers ------------------------------ */

  /**
   * Toggle the text-only empty-state node via the `hidden` attribute only.
   * @param {boolean} show
   */
  function showEmptyState(show) {
    const el = getEmptyState();
    if (!el) return;
    if (show) el.removeAttribute('hidden');
    else el.setAttribute('hidden', '');
  }

  /**
   * Build the screen-reader result string ("1 branch found" / "N branches found").
   * @param {number} n
   * @returns {string}
   */
  function countMessage(n) {
    return n + ' ' + (n === 1 ? 'branch' : 'branches') + ' found';
  }

  /* ---- filter (R4 / W4, R5) -------------------------------------------- */

  /**
   * Filter the active repository's branches by the given value and reconcile the
   * branch rows, the empty state, and the live region. Runs synchronously; the
   * `input` listener debounces the CALLS into it.
   *
   * Semantics:
   *  - empty query  → the RESTING paginated slice (NOT the full list), no empty
   *                   state, cleared announcement;
   *  - matches      → plain rows (no highlight), empty state hidden, count announced;
   *  - no matches   → rows cleared, "Branch not found" revealed and announced.
   *
   * Note: matches are computed over ALL of the active repo's branches, so search
   * can reveal branches beyond the current paginated slice; only the EMPTY-query
   * resting view is limited to the slice (to preserve list contents/geometry).
   *
   * @param {string} rawValue The raw (un-trimmed) input value.
   */
  function applyFilter(rawValue) {
    // P12-FIND-12 (defensive last line): never render into the branch area when
    // the active repository's branch region is not live — i.e. its row is absent
    // or its subtree/an ancestor is collapsed. A debounced filter that resolves
    // AFTER the user collapsed an ancestor must NOT insert an orphan branch row
    // (or an orphan resting slice, for an empty query) beneath the collapsed
    // subtree. The pending debounce is normally already dropped by
    // `cancelPendingFilterIfHidden` (wired to tree.js's folder onToggle); this
    // guard guarantees filtered rendering is impossible when not live even if a
    // call slips through. Bail WITHOUT mutating `query`, so state stays coherent
    // with the (unchanged) rendered rows and a later re-expand restores cleanly.
    if (!isActiveRepoBranchAreaLive(uiState)) return;

    const raw = rawValue == null ? '' : String(rawValue);
    uiState.query = raw;

    const q = raw.trim().toLowerCase();
    const all = getBranches(uiState.activeRepoId) || [];

    // Empty query → restore the RESTING paginated slice (never the full list):
    // an empty field must preserve the current rendered slice/geometry, and
    // "Branch not found" only ever appears in response to an actual query.
    if (q === '') {
      showEmptyState(false);
      renderMatches(restingBranches(uiState));
      announce('');
      return;
    }

    const matches = all.filter(
      (b) => b && typeof b.label === 'string' && b.label.toLowerCase().includes(q),
    );

    if (matches.length === 0) {
      // No matches: clear the rows THROUGH the render collaborator (one
      // rendering-ownership model) and reveal the text-only empty state (R5).
      renderMatches([]);
      showEmptyState(true);
      announce(EMPTY_STATE_MESSAGE);
      return;
    }

    // Matches render as PLAIN rows (renderBranchRows adds no highlight — R4).
    showEmptyState(false);
    renderMatches(matches);
    announce(countMessage(matches.length));
  }

  const debouncedFilter = debounce(() => applyFilter(input.value), FILTER_DEBOUNCE_MS);

  /**
   * Pending deferred blur-dismissal timer (Finding #3 — Focus/Selection Race).
   * Per-instance (declared in the init closure) and always cleared by
   * `close()`/`destroy()` so a queued dismissal never fires after teardown.
   * @type {(ReturnType<typeof setTimeout>|null)}
   */
  let blurCloseTimer = null;

  /** Cancel any pending deferred blur-dismissal. */
  function cancelBlurClose() {
    if (blurCloseTimer !== null) {
      clearTimeout(blurCloseTimer);
      blurCloseTimer = null;
    }
  }

  /**
   * P12-FIND-12 — drop a still-pending debounced filter when the active
   * repository's branch area is no longer live while search is open.
   *
   * app.js wires this to tree.js's folder `onToggle` (see {@link module:app}),
   * so collapsing the active repo — or ANY ancestor of it — DURING the ~150 ms
   * debounce window cancels the queued filter before it can fire. Without this,
   * the delayed `applyFilter('dev')` would run after the collapse and render a
   * selectable branch row beneath the now-collapsed subtree (an orphan depth-5
   * row under a collapsed depth-2 folder), which the user could then click to
   * corrupt selection/footer state.
   *
   * Deliberately a STRICT no-op unless search is open AND the area is not live:
   *  - it never fires while the area is still live (ordinary typing/collapsing an
   *    UNRELATED folder leaves a live filter untouched); and
   *  - it never mutates `searchActive`/`query`, so a search that survives a
   *    collapse/re-expand (a settled query, Figma edge case) restores coherently
   *    from tree.js's preserved branch cache.
   */
  function cancelPendingFilterIfHidden() {
    if (!uiState.searchActive) return;
    if (isActiveRepoBranchAreaLive(uiState)) return;
    debouncedFilter.cancel();
  }

  /* ---- activation / dismissal (R3 / W3, R7 / W5) ----------------------- */

  /** Open search: transform the affordance IN PLACE into the input and focus it. */
  function open() {
    if (uiState.searchActive) {
      input.focus();
      return;
    }
    uiState.searchActive = true;
    uiState.query = '';

    // Toggle visibility via the `hidden` attribute only (no inline styles). The
    // input occupies the same tree position/indent as the affordance (index.html/CSS).
    // The affordance is a leaf role="treeitem" (P4-FIND-3) with NO aria-expanded —
    // it discloses the input row via aria-controls, not an owned subtree. Hiding it
    // also drops it from the roving set (getTreeItems filters out [hidden] rows).
    affordance.setAttribute('hidden', '');
    inputRow.removeAttribute('hidden');
    input.value = '';

    // Suspend pagination so the two features never fight over the branch rows.
    // Deliberately DO NOT re-render the branch region here: activating Search
    // must PRESERVE the exact rows already on screen (the current paginated
    // slice) and not change list contents or scroll geometry. The full match
    // set is rendered only once an actual (nonempty) query is applied (R3 / R2).
    pausePagination();
    showEmptyState(false);
    announce('');
    input.focus();
  }

  /**
   * Dismiss search: restore the affordance and the resting branch list (R7).
   *
   * @param {{ focusBranchId?: string }} [options] Optional focus intent. When a
   *   branch SELECTION dismisses an OPEN search (Figma W6, driven from app.js),
   *   the selected branch id is passed so keyboard focus is restored to the
   *   newly-rendered selected row after the resting list is back in the DOM
   *   (F-05) — otherwise `restoreList()` replaces the filtered row that held
   *   focus and focus drops to `<body>`. Escape, the clear-×, and blur pass NO
   *   intent and are unchanged: Escape and the clear-× restore the affordance
   *   themselves, and a blur means the user deliberately moved focus elsewhere.
   */
  function close(options) {
    if (!uiState.searchActive) return; // idempotent

    // P4-FIND-1: when a branch SELECTION drives the dismissal, ensure the
    // selected branch is INSIDE the restored paginated slice. Search can reveal
    // and select a branch BEYOND the current slice (e.g. 'dev' at index 22 while
    // only branch-1..4 are loaded). Without this, restoreList() renders only the
    // resting slice, so the just-selected row is ABSENT from the DOM — its
    // lavender highlight invisible and keyboard focus falling to the affordance —
    // even though the confirmation footer shows its full path (the incoherence
    // this finding reports). Advancing `loadedBranchCount` to include it (the
    // single source of truth pagination also reads) makes restoreList() render,
    // highlight (createRow re-applies the selected state from
    // `uiState.selectedBranchId`), and focus the selected row coherently, while
    // pagination resumes correctly from the new count.
    const focusBranchId = options && options.focusBranchId;
    if (focusBranchId) {
      const allBranches = getBranches(uiState.activeRepoId) || [];
      const selectedIdx = allBranches.findIndex((b) => b && b.id === focusBranchId);
      if (selectedIdx >= 0 && selectedIdx >= getLoadedCount(uiState)) {
        uiState.loadedBranchCount = selectedIdx + 1;
      }
    }

    // Flip state FIRST so the synchronous focusout that follows hiding the input
    // is a no-op (onRowFocusOut guards on `searchActive`), and any deferred
    // focusout-close timer that fires later also short-circuits. Drop the pending
    // debounce and any queued dismissal so neither fires against the restored list.
    uiState.searchActive = false;
    uiState.query = '';
    debouncedFilter.cancel();
    cancelBlurClose();

    // Reset and hide the input; restore the transparent affordance row. Clearing
    // the value leaves no residual query or caret; hiding removes the clear-× (R7).
    // The affordance is a leaf role="treeitem" (P4-FIND-3) — no aria-expanded state.
    input.value = '';
    inputRow.setAttribute('hidden', '');
    affordance.removeAttribute('hidden');
    showEmptyState(false);

    // Restore EXACTLY the current paginated slice, THEN re-establish a single
    // pagination observer over that restored DOM (order matters — the observer
    // must attach to the correct rows). Finally clear the live region (R7).
    restoreList();
    resumePagination();
    announce('');

    // F-05: restore keyboard focus ONLY when a branch selection drove the
    // dismissal (a `focusBranchId` intent, resolved above). The pre-close focus
    // was on the filtered row that `restoreList()` just replaced; without this,
    // focus would fall to <body>. `createRow` re-applied the selected highlight
    // from state during restore, so the target row is both highlighted and
    // focused — and thanks to the loadedBranchCount advancement above, an
    // out-of-slice selection is now guaranteed to be present in the restored DOM.
    if (focusBranchId && !focusBranchRow(focusBranchId)) {
      // The selected branch is outside the restored paginated slice — fall back
      // to a deliberate, always-present stable target (the restored affordance).
      affordance.focus();
    }
  }

  /* ---- event handlers -------------------------------------------------- */

  function onAffordanceClick() {
    open();
  }

  function onInput() {
    debouncedFilter();
  }

  /**
   * Escape dismisses and returns focus to the restored affordance.
   * @param {KeyboardEvent} event
   */
  function onInputKeydown(event) {
    if (event.key === 'Escape' || event.key === 'Esc') {
      event.preventDefault(); // suppress the UA's native search-field clear
      close();
      affordance.focus();
      return;
    }
    // P7-FIND-9: ArrowDown steps INTO the filtered results. Matches render as
    // ordinary treeitems carrying the roving `tabindex="-1"`, so they are
    // otherwise keyboard-unreachable from the input (Tab would skip to the
    // clear-× / "Load more"). Moving focus to the first result hands off to
    // tree.js roving navigation (ArrowUp/Down/Home/End) and selection.js's
    // Enter/Space activation, making a filtered branch — INCLUDING one paginated
    // out of the initial slice — fully keyboard-selectable (this complements the
    // P4-FIND-1 restore-slice fix in close()). preventDefault ONLY when focus
    // actually moved, so an ArrowDown with no results leaves the caret alone.
    if (event.key === 'ArrowDown') {
      if (focusFirstBranchRow()) event.preventDefault();
    }
  }

  /**
   * Focus leaving the search input ROW dismisses search ONLY when the field is
   * empty (never fight the user mid-query). The listener is bound to the ROW via
   * `focusout` (which BUBBLES, unlike `blur`), so we observe focus leaving ANY
   * element in the row — the input OR the clear-×. This closes the gap where a
   * Tab sequence input → clear-× → next-control left an empty field open, because
   * the final hop was a blur on the clear button (not the input) that a
   * blur-on-input listener never saw (Finding P4-FIND-2). Focus moves WITHIN the
   * row (input ↔ clear-×) remain exempt.
   *
   * To avoid racing a branch click — whose event order is
   * `mousedown → focusout → mouseup → click` — a synchronous close() would
   * re-render and DISCONNECT the target row before its click fires. So the
   * dismissal is:
   *   (a) SKIPPED when focus moves WITHIN the row (input ↔ clear-×, whose own
   *       handler owns it) or to a branch/tree target (branch selection / Figma
   *       W6 owns the flow), and
   *   (b) otherwise DEFERRED to a macrotask, so any in-flight pointer interaction
   *       completes on still-connected rows before we re-render — then re-checked
   *       at fire time (including whether focus returned to ANY element in the
   *       row) in case state changed during the interaction.
   * Escape and the clear-× click remain the deterministic, immediate dismissals
   * (R7). Focus is never stolen — the user chose to move focus away.
   * @param {FocusEvent} event
   */
  function onRowFocusOut(event) {
    if (!uiState.searchActive) return;
    if (input.value.trim() !== '') return;

    // `relatedTarget` is the element gaining focus (an Element, or null).
    const next = event.relatedTarget;
    // Focus moving WITHIN the row (input ↔ clear-×) is not a dismissal.
    if (next && inputRow.contains(next)) return;
    // Exempt a branch/tree target: the click selecting a branch owns the flow.
    if (isTreeTarget(next)) return;

    // Defer so a pending branch click lands on connected rows before re-render.
    cancelBlurClose();
    blurCloseTimer = setTimeout(() => {
      blurCloseTimer = null;
      // Re-check at fire time: the interaction may have changed state.
      if (!uiState.searchActive) return;                    // already dismissed elsewhere
      if (input.value.trim() !== '') return;                // user resumed typing
      if (inputRow.contains(document.activeElement)) return; // focus returned into the row
      close();
    }, 0);
  }

  /** The clear-"×" button dismisses search and returns focus to the affordance. */
  function onClearClick() {
    close();
    affordance.focus();
  }

  /* ---- wire listeners -------------------------------------------------- */

  affordance.addEventListener('click', onAffordanceClick);
  input.addEventListener('input', onInput);
  input.addEventListener('keydown', onInputKeydown);
  // `focusout` on the ROW (bubbles) so focus leaving the input OR the clear-×
  // is observed — the empty-field Tab-out dismissal (P4-FIND-2).
  inputRow.addEventListener('focusout', onRowFocusOut);
  if (clearButton) clearButton.addEventListener('click', onClearClick);

  /* ---- teardown -------------------------------------------------------- */

  /** Remove every listener and drop any pending debounce/timer (safe to call twice). */
  function destroy() {
    debouncedFilter.cancel();
    cancelBlurClose();
    affordance.removeEventListener('click', onAffordanceClick);
    input.removeEventListener('input', onInput);
    input.removeEventListener('keydown', onInputKeydown);
    inputRow.removeEventListener('focusout', onRowFocusOut);
    if (clearButton) clearButton.removeEventListener('click', onClearClick);
  }

  return {
    open,
    close,
    applyFilter,
    isActive: () => uiState.searchActive === true,
    cancelPendingFilterIfHidden,
    destroy,
  };
}
