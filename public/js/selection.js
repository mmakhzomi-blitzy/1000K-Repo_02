/**
 * @file public/js/selection.js
 * @module selection
 *
 * Branch selection state + pinned confirmation footer for the
 * "Branch pagination + search" static frontend
 * (Workflow W6, Requirement R6; Technical Spec §0.2.2 W6 and §0.2.4
 * ConfirmationFooter — Figma node 48966:68383).
 *
 * Responsibility
 * --------------
 * Coordinate the two — and only two — visuals that constitute "selection":
 *   1. A SINGLE highlighted branch row. The selected row receives a light
 *      lavender background (`--color-row-highlight`, #F2F0FE) through a CSS
 *      class toggle ONLY. Its text stays `--color-text-primary` (#333333) and
 *      it gets NO per-row checkmark (faithful selection model, §0.9).
 *   2. A pinned CONFIRMATION FOOTER at the bottom of the container echoing the
 *      branch's full "/"-joined path plus a purple check-circle. The
 *      check-circle belongs to the footer ONLY — never to a row.
 *
 * Design contract (do not break)
 * ------------------------------
 *  - Native ES module, named exports only, ZERO dependencies, no build step.
 *  - NO inline styles: every visual value lives in `css/branch-list.css`. This
 *    module only toggles classes, flips the `hidden` attribute, sets element
 *    attributes (src / alt / width / height / aria-*), and writes textContent.
 *  - Selection survives pagination appends and search re-renders because the
 *    activation listener is DELEGATED on the stable `#tree-list` container.
 *  - No network, no backend, no `fetch`.
 *
 * DOM contract (markup authored in public/index.html; rows by public/js/tree.js)
 * ----------------------------------------------------------------------------
 *  - `#tree-list`            The scrollable list holding every tree/branch row;
 *                            the single event-delegation root.
 *  - `[data-branch-id]`      Marks a selectable branch row. Each such row also
 *                            carries `data-path` (= its full "/"-joined path).
 *  - `#confirmation-footer`  `<div class="branch-tree__footer"
 *                            id="confirmation-footer" hidden>` — a direct child
 *                            of `.branch-tree`, sibling of `#tree-list`, pinned
 *                            to the container bottom and hidden until a branch
 *                            is selected.
 */

import { getFullPath, getNode } from './data.js';

/* ==========================================================================
 * Constants — DOM hooks, class names, and asset paths.
 * ==========================================================================*/

/** id of the scrollable tree/branch list (event-delegation root). */
const TREE_LIST_ID = 'tree-list';

/** id of the pinned confirmation footer (hidden until a selection is made). */
const FOOTER_ID = 'confirmation-footer';

/** Attribute selector identifying a selectable branch row. */
const BRANCH_ROW_SELECTOR = '[data-branch-id]';

/**
 * CSS classes that render the selected-row background (#F2F0FE), defined in
 * `css/branch-list.css`. Both the state-style convention (`is-selected`) and
 * the BEM-modifier convention (`tree-row--selected`) named by the design spec
 * are applied together, so the highlight resolves regardless of which the
 * stylesheet ultimately defines — toggling an unused class is harmless and
 * keeps this module decoupled from the exact stylesheet naming.
 *
 * @type {ReadonlyArray<string>}
 */
export const SELECTED_CLASSES = Object.freeze(['is-selected', 'tree-row--selected']);

/**
 * Secondary reveal hook toggled on the footer. The PRIMARY reveal mechanism is
 * removing the `hidden` attribute (per the DOM contract); this class is an
 * additional, harmless styling hook for `branch-list.css` if it prefers a
 * class-gated display.
 */
const FOOTER_VISIBLE_CLASS = 'branch-tree__footer--visible';

/**
 * Document-relative icon asset paths (exact filenames from Technical Spec
 * §0.2.5). Resolved relative to public/index.html, which lives at the public/
 * root, so `assets/icons/…` maps to public/assets/icons/….
 */
const ICON_GIT_BRANCH = 'assets/icons/icon_git_branch.svg';
const ICON_CHECK_CIRCLE = 'assets/icons/icon_check_circle.svg';

/** Class hooks for the footer's children (visuals handled by branch-list.css). */
const FOOTER_ICON_CLASS = 'branch-tree__footer-icon';
const FOOTER_PATH_CLASS = 'branch-tree__footer-path';
const FOOTER_CHECK_CLASS = 'branch-tree__footer-check';

/** Fixed pixel dimensions for the footer icons (§0.2.4). */
const GIT_BRANCH_ICON_SIZE = 16;
const CHECK_CIRCLE_ICON_SIZE = 24;

/* ==========================================================================
 * Small DOM helpers (all null-safe; no side effects beyond querying).
 * ==========================================================================*/

/**
 * @returns {HTMLElement|null} The `#tree-list` element, or null if absent.
 */
function getTreeList() {
  return document.getElementById(TREE_LIST_ID);
}

/**
 * @returns {HTMLElement|null} The `#confirmation-footer` element, or null.
 */
function getFooter() {
  return document.getElementById(FOOTER_ID);
}

/**
 * Escape a value for safe interpolation inside an attribute selector. Prefers
 * the native `CSS.escape`; falls back to escaping quotes/backslashes so ids
 * containing unusual characters cannot break the selector.
 *
 * @param {string} value  Raw attribute value.
 * @returns {string} A selector-safe representation of `value`.
 */
function escapeAttr(value) {
  const str = String(value);
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(str);
  }
  return str.replace(/["\\]/g, '\\$&');
}

/**
 * Find the branch row for a given branch id within `#tree-list`.
 *
 * @param {string} branchId  The branch id (a row's `data-branch-id`).
 * @returns {HTMLElement|null} The matching row, or null if not found.
 */
function findBranchRow(branchId) {
  const treeList = getTreeList();
  if (!treeList || branchId == null) return null;
  return treeList.querySelector(`[data-branch-id="${escapeAttr(branchId)}"]`);
}

/**
 * Resolve the full "/"-joined path for a branch. The data model
 * (`getFullPath`) is authoritative; the row's `data-path` attribute is a
 * defensive fallback for ids that are not present in the in-memory tree.
 *
 * Example: `resolveFullPath('branch-2')` →
 *   "engineering/frontend/web-app/customer-portal/branch-2".
 *
 * @param {string} branchId  The branch id whose path to resolve.
 * @returns {string} The "/"-joined path, or "" when unavailable.
 */
function resolveFullPath(branchId) {
  const path = getFullPath(branchId);
  if (path) return path;
  const row = findBranchRow(branchId);
  return (row && row.dataset.path) || '';
}

/**
 * Remove the selected state from every currently-highlighted row so that at
 * most ONE row is ever selected at a time. Scoped to `#tree-list` when present
 * (falls back to the whole document defensively). This also clears the
 * data-driven initial highlight (e.g. the pre-selected `dev` row) the first
 * time the user picks a different branch.
 */
function clearSelectionHighlight() {
  const scope = getTreeList() || document;
  const selector = SELECTED_CLASSES.map((cls) => `.${cls}`).join(',');
  scope.querySelectorAll(selector).forEach((row) => {
    row.classList.remove(...SELECTED_CLASSES);
    if (row.hasAttribute('aria-selected')) {
      row.setAttribute('aria-selected', 'false');
    }
  });
}

/* ==========================================================================
 * Confirmation footer.
 * ==========================================================================*/

/**
 * Build (once) or update the pinned confirmation footer for the selected
 * branch, then reveal it.
 *
 * Footer children render in Figma order (§0.2.4): the git-branch icon
 * (#999999, 16×16) → the full-path text (#333333) → the check-circle
 * (#5B39F3, 24×24). On repeat selections the existing child nodes are reused
 * and only the path text is updated, so children are never duplicated.
 *
 * @param {string} branchId  The selected branch id.
 * @returns {string} The rendered full path (empty string if the footer or path
 *   is unavailable).
 */
export function renderConfirmationFooter(branchId) {
  const footer = getFooter();
  if (!footer) return '';

  const path = resolveFullPath(branchId);

  // Reuse the path node as the sentinel for "structure already built".
  let pathEl = footer.querySelector(`.${FOOTER_PATH_CLASS}`);

  if (!pathEl) {
    // First render: construct the footer's children exactly once.
    footer.textContent = '';

    const branchIcon = document.createElement('img');
    branchIcon.className = FOOTER_ICON_CLASS;
    branchIcon.src = ICON_GIT_BRANCH;
    branchIcon.alt = '';
    branchIcon.setAttribute('aria-hidden', 'true');
    branchIcon.width = GIT_BRANCH_ICON_SIZE;
    branchIcon.height = GIT_BRANCH_ICON_SIZE;

    pathEl = document.createElement('span');
    pathEl.className = FOOTER_PATH_CLASS;

    const checkIcon = document.createElement('img');
    checkIcon.className = FOOTER_CHECK_CLASS;
    checkIcon.src = ICON_CHECK_CIRCLE;
    checkIcon.alt = 'Selected';
    checkIcon.width = CHECK_CIRCLE_ICON_SIZE;
    checkIcon.height = CHECK_CIRCLE_ICON_SIZE;

    footer.append(branchIcon, pathEl, checkIcon);
  }

  // Update in place — `textContent` (never innerHTML) so the literal path is
  // rendered verbatim and can never inject markup.
  pathEl.textContent = path;

  // Reveal: primary mechanism is the `hidden` attribute (per the DOM
  // contract); the visible class is a harmless secondary hook.
  footer.hidden = false;
  footer.classList.add(FOOTER_VISIBLE_CLASS);

  return path;
}

/* ==========================================================================
 * Public selection API.
 * ==========================================================================*/

/**
 * Select a branch: update shared state, move the single row highlight, and
 * render the confirmation footer. Safe to call programmatically (e.g. from
 * `app.js`) as well as from the delegated activation listener.
 *
 * The selected row's text color is intentionally left untouched and NO
 * checkmark is added to the row — the check-circle lives only in the footer
 * (faithful selection model, §0.9).
 *
 * @param {string} branchId  Branch id to select (a row's `data-branch-id`).
 * @param {{selectedBranchId?: (string|null)}} [state]  Shared UI state object.
 * @returns {(string|undefined)} The selected branch id, or undefined when the
 *   request is ignored (falsy id, or a known non-branch node).
 */
export function selectBranch(branchId, state) {
  if (!branchId) return undefined;

  // Only branch nodes are selectable. When the id is absent from the data
  // model we still honour the DOM row (defensive), but a node that is known to
  // be a non-branch (folder / repo / action) is rejected outright.
  const node = getNode(branchId);
  if (node && node.type !== 'branch') return undefined;

  if (state) state.selectedBranchId = branchId;

  // Enforce single-selection before applying the new highlight.
  clearSelectionHighlight();

  const row = findBranchRow(branchId);
  if (row) {
    row.classList.add(...SELECTED_CLASSES);
    row.setAttribute('aria-selected', 'true');
  }

  renderConfirmationFooter(branchId);

  return branchId;
}

/**
 * Clear the current selection: drop the row highlight, hide the confirmation
 * footer, and reset `state.selectedBranchId`.
 *
 * This is optional in the R6 flow — the primary behaviour is that, once shown,
 * the footer stays pinned. `app.js` may call this (e.g. on search dismissal)
 * when it wants to reset the selection entirely.
 *
 * @param {{selectedBranchId?: (string|null)}} [state]  Shared UI state object.
 */
export function clearSelection(state) {
  clearSelectionHighlight();

  const footer = getFooter();
  if (footer) {
    footer.hidden = true;
    footer.classList.remove(FOOTER_VISIBLE_CLASS);
  }

  if (state) state.selectedBranchId = null;
}

/**
 * Wire branch selection using ONE delegated listener set on the stable
 * `#tree-list` container, so selection keeps working after pagination appends
 * rows and after search re-renders the branch list.
 *
 * Activation triggers: a click on a branch row, and Enter / Space while a
 * branch row is focused (Space's default page-scroll is suppressed). The
 * actual target is resolved with `event.target.closest('[data-branch-id]')`,
 * so clicks on a row's icon or label still select the row.
 *
 * @param {{selectedBranchId?: (string|null)}} [state]  Shared UI state object.
 * @returns {({selectedBranchId?: (string|null)}|undefined)} The same `state`
 *   object for chaining, or undefined if `#tree-list` is not in the DOM.
 */
export function initSelection(state) {
  const treeList = getTreeList();
  if (!treeList) return undefined;

  treeList.addEventListener('click', (event) => {
    const target = event.target;
    if (!target || typeof target.closest !== 'function') return;

    const row = target.closest(BRANCH_ROW_SELECTOR);
    if (row && treeList.contains(row)) {
      selectBranch(row.dataset.branchId, state);
    }
  });

  treeList.addEventListener('keydown', (event) => {
    // Enter, and Space (' ' modern; 'Spacebar' legacy Edge/IE), activate.
    if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') {
      return;
    }

    const target = event.target;
    if (!target || typeof target.closest !== 'function') return;

    const row = target.closest(BRANCH_ROW_SELECTOR);
    if (row && treeList.contains(row)) {
      // Prevent Space from scrolling the container / page on activation.
      event.preventDefault();
      selectBranch(row.dataset.branchId, state);
    }
  });

  return state;
}
