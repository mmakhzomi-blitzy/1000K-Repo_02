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
 *  - Dismissal (R7 / W5): Escape, the clear-"×" button, or blurring an empty
 *    field restores the affordance row, clears the query, hides the empty state,
 *    and re-renders the full branch list — leaving NO residual query, caret, or
 *    clear control.
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
import { renderBranchRows, clearBranchRows } from './tree.js';

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
 * Debounce interval (ms) for the filter — responsive to typing yet coalesces
 * bursts so the branch region is not re-rendered on every keystroke (I3, ~150ms).
 */
const FILTER_DEBOUNCE_MS = 150;

/** Exact empty-state message, verbatim from the Figma design (R5). */
const EMPTY_STATE_MESSAGE = 'Branch not found';

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

/* ============================================================================
 * State helper — search.js reads/writes `activeRepoId`, `query`, and
 * `searchActive` on the shared UI state owned by app.js. When omitted (e.g. an
 * isolated test), a private object seeded with the canonical active repo id is
 * used so the module never throws.
 * ==========================================================================*/

/**
 * @param {object} [state] Shared UI state from app.js.
 * @returns {{ activeRepoId: string, query: string, searchActive: boolean }}
 */
function resolveState(state) {
  const s = state && typeof state === 'object' ? state : {};
  if (typeof s.activeRepoId !== 'string' || s.activeRepoId.length === 0) {
    s.activeRepoId = ACTIVE_REPO_ID;
  }
  if (typeof s.query !== 'string') s.query = '';
  if (typeof s.searchActive !== 'boolean') s.searchActive = false;
  return s;
}

/**
 * An inert handle returned when the essential DOM controls are missing, so
 * callers can wire search unconditionally without null checks.
 * @returns {{ open: () => void, close: () => void, applyFilter: (v: string) => void, isActive: () => boolean, destroy: () => void }}
 */
function inertHandle() {
  const noop = () => {};
  return { open: noop, close: noop, applyFilter: noop, isActive: () => false, destroy: noop };
}

/* ============================================================================
 * Public API.
 * ==========================================================================*/

/**
 * Initialise the branch search behavior and wire all listeners.
 *
 * @param {object} state Shared UI state (single source of truth from app.js).
 *   Reads/writes `activeRepoId` (string), `query` (string), `searchActive` (bool).
 * @param {object} [deps] Optional collaborators injected by app.js. Each is
 *   optional and falls back to a `./data.js` + `./tree.js` default:
 *   @param {(branches: import('./data.js').TreeNode[]) => void} [deps.renderMatches]
 *     Render the given branch nodes as plain rows. Default: `renderBranchRows`.
 *   @param {() => void} [deps.restoreList] Re-render the resting branch list on
 *     dismissal (app.js restores its paginated page). Default: render the full
 *     branch list of the active repo via `renderBranchRows`.
 *   @param {() => void} [deps.pausePagination] Suspend pagination while searching.
 *   @param {() => void} [deps.resumePagination] Resume pagination after dismissal.
 *   @param {(text: string) => void} [deps.announce] Announce a result string.
 *     Default: set `#search-status` `textContent`.
 * @returns {{ open: () => void, close: () => void, applyFilter: (value: string) => void, isActive: () => boolean, destroy: () => void }}
 *   A cohesive handle so app.js can drive search in one call (e.g. `close()` on
 *   branch selection, per Figma W6).
 */
export function initSearch(state, deps) {
  const affordance = getAffordance();
  const inputRow = getInputRow();
  const input = getInput();

  const uiState = resolveState(state);

  // Resolve injected collaborators with defaults built on ./data.js + ./tree.js.
  const d = deps && typeof deps === 'object' ? deps : {};
  const renderMatches = typeof d.renderMatches === 'function'
    ? d.renderMatches
    : (branches) => renderBranchRows(branches, uiState);
  const restoreList = typeof d.restoreList === 'function'
    ? d.restoreList
    : () => renderBranchRows(getBranches(uiState.activeRepoId), uiState);
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
   *  - empty query  → full branch list, no empty state, cleared announcement;
   *  - matches      → plain rows (no highlight), empty state hidden, count announced;
   *  - no matches   → rows cleared, "Branch not found" revealed and announced.
   *
   * @param {string} rawValue The raw (un-trimmed) input value.
   */
  function applyFilter(rawValue) {
    const raw = rawValue == null ? '' : String(rawValue);
    uiState.query = raw;

    const q = raw.trim().toLowerCase();
    const all = getBranches(uiState.activeRepoId) || [];

    // Empty query → the full branch list is shown; "Branch not found" only ever
    // appears in response to an actual query (never for an empty field).
    if (q === '') {
      showEmptyState(false);
      renderMatches(all);
      announce('');
      return;
    }

    const matches = all.filter(
      (b) => b && typeof b.label === 'string' && b.label.toLowerCase().includes(q),
    );

    if (matches.length === 0) {
      // No matches: clear the rows and reveal the text-only empty state (R5).
      clearBranchRows();
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

  /* ---- activation / dismissal (R3 / W3, R7 / W5) ----------------------- */

  /** Open search: transform the affordance IN PLACE into the input and focus it. */
  function open() {
    if (uiState.searchActive) {
      input.focus();
      return;
    }
    uiState.searchActive = true;

    // Toggle visibility via the `hidden` attribute only (no inline styles). The
    // input occupies the same tree position/indent as the affordance (index.html/CSS).
    affordance.setAttribute('hidden', '');
    affordance.setAttribute('aria-expanded', 'true');
    inputRow.removeAttribute('hidden');
    input.value = '';

    // Suspend pagination so the two features never fight over the branch rows,
    // then show the full branch list beneath the open (empty) field.
    pausePagination();
    applyFilter('');
    input.focus();
  }

  /** Dismiss search: restore the affordance and the resting branch list (R7). */
  function close() {
    if (!uiState.searchActive) return; // idempotent

    // Flip state FIRST so the synchronous blur that follows hiding the input is
    // a no-op (onInputBlur guards on `searchActive`).
    uiState.searchActive = false;
    uiState.query = '';
    debouncedFilter.cancel();

    // Reset and hide the input; restore the transparent affordance row. Clearing
    // the value leaves no residual query or caret; hiding removes the clear-× (R7).
    input.value = '';
    inputRow.setAttribute('hidden', '');
    affordance.removeAttribute('hidden');
    affordance.setAttribute('aria-expanded', 'false');
    showEmptyState(false);

    // Restore the resting list (app.js re-renders its paged page) and resume
    // pagination; clear the live region.
    restoreList();
    resumePagination();
    announce('');
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
    }
  }

  /**
   * Blur restores ONLY when the field is empty (never fight the user mid-query),
   * and only when focus has left the input row (so the clear-× click handler is
   * not raced). Focus is not stolen — the user clicked elsewhere.
   * @param {FocusEvent} event
   */
  function onInputBlur(event) {
    if (!uiState.searchActive) return;
    if (input.value.trim() !== '') return;
    // `relatedTarget` is the element gaining focus (an Element or null for focus
    // events); if it lives inside the input row (e.g. the clear-× button), defer
    // to that control's own handler instead of racing it.
    const next = event.relatedTarget;
    if (next && inputRow.contains(next)) return;
    close();
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
  input.addEventListener('blur', onInputBlur);
  if (clearButton) clearButton.addEventListener('click', onClearClick);

  /* ---- teardown -------------------------------------------------------- */

  /** Remove every listener and drop any pending debounce (safe to call twice). */
  function destroy() {
    debouncedFilter.cancel();
    affordance.removeEventListener('click', onAffordanceClick);
    input.removeEventListener('input', onInput);
    input.removeEventListener('keydown', onInputKeydown);
    input.removeEventListener('blur', onInputBlur);
    if (clearButton) clearButton.removeEventListener('click', onClearClick);
  }

  return {
    open,
    close,
    applyFilter,
    isActive: () => uiState.searchActive === true,
    destroy,
  };
}
