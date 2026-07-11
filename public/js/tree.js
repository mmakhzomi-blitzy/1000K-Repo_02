/**
 * @file public/js/tree.js
 * @module tree
 *
 * Tree rendering + folder expand/collapse — the DOM/behavior layer for the
 * "Branch pagination + search" static frontend.
 *
 * Responsibilities (Requirement R1 tree rendering, I5 expand/collapse):
 *  - Build the folder / repository / branch / "New branch" rows from the flat
 *    {@link module:data.treeData} model and render them into the `#tree-list`
 *    scroll region declared by `public/index.html`.
 *  - Own the DOM STRUCTURE and SEMANTICS of every row (indent spacers, type
 *    icon, disclosure chevron, label), while deferring EVERY pixel of visual
 *    styling to `public/css/branch-list.css`.
 *  - Implement folder/repo expand/collapse via event delegation on the tree
 *    root, keeping `aria-expanded`, the folder-icon swap, the chevron rotation
 *    hook, and descendant visibility in sync.
 *  - Expose the two branch-row entry points — {@link renderBranchRows} and
 *    {@link appendBranchRows} (plus {@link clearBranchRows}) — that
 *    `pagination.js` and `search.js` build on. Their signatures are a stable
 *    contract; the pagination sentinel is always kept as the last child of the
 *    tree root.
 *
 * Design contract (do not break):
 *  - Native ES module using named `export`s only. Zero dependencies, no build
 *    step, no framework/library. Imports ONLY from `./data.js`.
 *  - NO INLINE STYLES. Visual intent is communicated exclusively by toggling
 *    CSS classes and by setting semantic attributes (`role`, `aria-*`,
 *    `data-*`, `hidden`, `tabindex`) plus the presentational `width`/`height`
 *    and `src`/`alt` attributes on `<img>` icons and `textContent`. No `style`
 *    attribute or `element.style.*` visual assignment is ever produced.
 *  - No invented UI: default rows are plain text; hover/selected use the
 *    `--color-row-highlight` background applied purely via CSS classes. No
 *    badges, counts, spinners, or decorations that are not in the design.
 *  - Content strings are taken verbatim from `data.js` (e.g. "New branch",
 *    "branch-1", "main", "dev", folder/repo names) and never altered.
 *  - No `fetch`/API/network and no backend coupling of any kind.
 */

import {
  treeData,
  getNode,
  getChildren,
  getBranches,
  getFullPath,
  ACTIVE_REPO_ID,
} from './data.js';

/* ============================================================================
 * Constants — DOM hooks, asset paths, and class names.
 * These are a hard contract shared with index.html, branch-list.css, and the
 * sibling JS modules (pagination.js / search.js / selection.js / app.js).
 * ==========================================================================*/

/** Id of the scrollable tree root (also the IntersectionObserver root). */
const TREE_LIST_ID = 'tree-list';
/** Id of the pagination sentinel that MUST remain the last child of the root. */
const SENTINEL_ID = 'pagination-sentinel';
/** Id of the static "Search" affordance row (owned/toggled by search.js). */
const SEARCH_AFFORDANCE_ID = 'search-affordance';
/** Id of the static inline search input row (owned/toggled by search.js). */
const SEARCH_INPUT_ROW_ID = 'search-input-row';
/** Class of the static, hidden "Branch not found" empty-state node. */
const EMPTY_STATE_CLASS = 'empty-state';

/**
 * Document-relative base path for icon assets. Resolved relative to
 * `public/index.html` (which lives at `public/`), i.e. `public/assets/icons/`.
 */
const ICON_BASE = 'assets/icons/';

/** Icon filenames per node kind / state (sourced from Figma by node id). */
const ICONS = {
  folderClosed: 'icon_folder.svg',
  folderOpen: 'icon_folder_open.svg',
  repo: 'icon_repo.svg',
  branch: 'icon_git_branch.svg',
  action: 'icon_plus.svg',
  chevron: 'icon_chevron_right.svg',
};

/** Base row class applied to every row so shared geometry always resolves. */
const CLASS_ROW = 'tree-row';
/** Per-kind modifier / hook classes (coordinated with branch-list.css). */
const CLASS_FOLDER = 'tree-row--folder';
const CLASS_REPO = 'tree-row--repo';
const CLASS_ACTION = 'new-branch-row';
const CLASS_BRANCH = 'branch-row';
/** Structural sub-element classes. */
const CLASS_INDENT = 'tree-row__indent';
const CLASS_CHEVRON = 'tree-row__chevron';
const CLASS_ICON = 'tree-row__icon';
const CLASS_LABEL = 'tree-row__label';
/** State hook classes (branch-list.css styles both these and the aria-* form). */
const CLASS_EXPANDED = 'is-expanded';
const CLASS_SELECTED = 'is-selected';

/* ============================================================================
 * Module state.
 * `tree.js` is a stateless renderer over the shared UI `state` object owned by
 * app.js; the few module-level variables below only cache references so the
 * exported functions remain robust when a caller omits `state`, and so a
 * single delegated listener survives re-renders.
 * ==========================================================================*/

/** The most recent shared UI state object seen by any exported function. */
let activeState = null;
/** The most recent `handlers` object passed to {@link renderTree}. */
let activeHandlers = {};
/**
 * The branch nodes currently "in view" (the live pagination page or the active
 * search match set). Preserved across folder collapse/expand so re-expanding an
 * ancestor of the active repository restores the exact same branch rows without
 * `tree.js` having to duplicate pagination/search logic.
 * @type {import('./data.js').TreeNode[]}
 */
let lastRenderedBranches = [];
/**
 * True when {@link syncBranchArea} hid the static search control because the
 * active repository (or an ancestor) was collapsed. Ensures we only restore a
 * control that WE hid, never fighting search.js during normal operation.
 */
let searchHiddenByCollapse = false;

/* ============================================================================
 * DOM lookup helpers — all defensive; index.html is the structural authority
 * and may not be present in every context, so every lookup tolerates absence.
 * ==========================================================================*/

/** @returns {HTMLElement|null} The tree root scroll region, or null. */
function getTreeList() {
  return document.getElementById(TREE_LIST_ID);
}

/** @returns {HTMLElement|null} The pagination sentinel element, or null. */
function getSentinel() {
  return document.getElementById(SENTINEL_ID);
}

/**
 * Resolve the shared UI state, caching it for subsequent calls that omit it.
 * Guarantees `state.expanded` is a usable `Set` without mutating `treeData`.
 *
 * @param {object} [state] The shared UI state object from app.js.
 * @returns {object} A usable state object (never null).
 */
function resolveState(state) {
  if (state && typeof state === 'object') {
    activeState = state;
  } else if (!activeState) {
    activeState = {
      activeRepoId: ACTIVE_REPO_ID,
      expanded: null,
      query: '',
      searchActive: false,
      selectedBranchId: null,
    };
  }
  ensureExpandedSet(activeState);
  return activeState;
}

/**
 * Ensure `state.expanded` is a `Set` of expanded node ids. When absent, it is
 * seeded from the `expanded: true` flags authored in `data.js` (the initial
 * open chain), WITHOUT mutating any `treeData` node.
 *
 * @param {object} state The shared UI state object.
 * @returns {Set<string>} The expanded-id set (now guaranteed on `state`).
 */
function ensureExpandedSet(state) {
  if (!(state.expanded instanceof Set)) {
    const seed = treeData.filter((node) => node.expanded).map((node) => node.id);
    state.expanded = new Set(seed);
  }
  return state.expanded;
}

/* ============================================================================
 * Expansion-state + node-classification helpers.
 * ==========================================================================*/

/**
 * @param {string} id Node id.
 * @param {object} state Shared UI state.
 * @returns {boolean} Whether the node is currently expanded.
 */
function isExpanded(id, state) {
  const set = ensureExpandedSet(state);
  return set.has(id);
}

/**
 * Set the expanded flag for a node in the shared state's `expanded` Set.
 *
 * @param {string} id Node id.
 * @param {boolean} value Desired expanded state.
 * @param {object} state Shared UI state.
 */
function setExpanded(id, value, state) {
  const set = ensureExpandedSet(state);
  if (value) {
    set.add(id);
  } else {
    set.delete(id);
  }
}

/**
 * A node is EXPANDABLE when it can reveal/hide descendant rows:
 *  - folders are always expandable containers (even when currently empty), and
 *  - repositories are expandable only when they actually have children
 *    (the active `customer-portal` has branch children; sibling repos do not).
 *
 * @param {import('./data.js').TreeNode} node
 * @returns {boolean}
 */
function isExpandable(node) {
  if (!node) return false;
  if (node.type === 'folder') return true;
  if (node.type === 'repo') return getChildren(node.id).length > 0;
  return false;
}

/**
 * Whether every ANCESTOR of the node is expanded (the node's own expand flag
 * does not affect its visibility — only its ancestors do). Root nodes are
 * always visible. The walk is cycle-safe.
 *
 * @param {import('./data.js').TreeNode} node
 * @param {object} state Shared UI state.
 * @returns {boolean}
 */
function isAncestorChainExpanded(node, state) {
  const visited = new Set();
  let parentId = node ? node.parentId : null;
  while (parentId !== null && parentId !== undefined && !visited.has(parentId)) {
    visited.add(parentId);
    if (!isExpanded(parentId, state)) return false;
    const parent = getNode(parentId);
    parentId = parent ? parent.parentId : null;
  }
  return true;
}

/* ============================================================================
 * Visibility computation — which non-branch scaffold nodes render, and how the
 * scaffold splits around the active repository's branch region.
 * ==========================================================================*/

/**
 * The ordered, currently-visible NON-branch scaffold nodes (folders, repos, and
 * the "New branch" action). Branch leaves are excluded here because they are
 * rendered separately by {@link renderBranchRows}/{@link appendBranchRows}.
 * A node is visible when every ancestor in its chain is expanded.
 *
 * @param {object} state Shared UI state.
 * @returns {import('./data.js').TreeNode[]} Depth-first ordered scaffold nodes.
 */
function getVisibleScaffoldNodes(state) {
  return treeData.filter(
    (node) => node.type !== 'branch' && isAncestorChainExpanded(node, state),
  );
}

/**
 * Split the visible scaffold into the rows that render BEFORE the active
 * repository's branch region ("lead") and those that render AFTER it ("trail").
 *
 * The split is derived from the flat `treeData` order: every branch of the
 * active repository is contiguous, sitting between the "New branch" action and
 * the sibling repositories. Scaffold nodes positioned before the first active
 * branch are "lead"; those after the last active branch are "trail". This keeps
 * the branch region correctly sandwiched between the "New branch"/search rows
 * and the sibling repositories (e.g. `admin-dash`).
 *
 * @param {import('./data.js').TreeNode[]} visibleNodes Output of {@link getVisibleScaffoldNodes}.
 * @param {object} state Shared UI state.
 * @returns {{ lead: import('./data.js').TreeNode[], trail: import('./data.js').TreeNode[] }}
 */
function splitScaffold(visibleNodes, state) {
  const activeId = (state && state.activeRepoId) || ACTIVE_REPO_ID;
  const branches = getBranches(activeId);
  if (branches.length === 0) {
    return { lead: visibleNodes.slice(), trail: [] };
  }

  const firstIdx = treeData.findIndex((n) => n.id === branches[0].id);
  const lastIdx = treeData.findIndex(
    (n) => n.id === branches[branches.length - 1].id,
  );

  const lead = [];
  const trail = [];
  for (const node of visibleNodes) {
    const idx = treeData.findIndex((n) => n.id === node.id);
    if (idx < firstIdx) {
      lead.push(node);
    } else if (idx > lastIdx) {
      trail.push(node);
    }
    // Nodes inside [firstIdx, lastIdx] are branch leaves, already excluded.
  }
  return { lead, trail };
}

/* ============================================================================
 * Row factory — builds a single accessible row element for any node kind.
 * Sets classes + semantic attributes ONLY; never any inline style.
 * ==========================================================================*/

/**
 * Compute the space-separated class list for a node's row. Every row carries
 * the base `tree-row` class (shared geometry) plus a kind-specific class/hook.
 *
 * @param {import('./data.js').TreeNode} node
 * @returns {string}
 */
function rowClassFor(node) {
  switch (node.type) {
    case 'folder':
      return `${CLASS_ROW} ${CLASS_FOLDER}`;
    case 'repo':
      return `${CLASS_ROW} ${CLASS_REPO}`;
    case 'action':
      return `${CLASS_ROW} ${CLASS_ACTION}`;
    case 'branch':
      return `${CLASS_ROW} ${CLASS_BRANCH}`;
    default:
      return CLASS_ROW;
  }
}

/**
 * Pick the type-icon filename for a node, accounting for the open/closed folder
 * state. The chevron is a separate element handled in {@link createRow}.
 *
 * @param {import('./data.js').TreeNode} node
 * @param {object} state Shared UI state.
 * @returns {string} Icon filename (without the directory prefix).
 */
function iconFileFor(node, state) {
  switch (node.type) {
    case 'folder':
      return isExpanded(node.id, state) ? ICONS.folderOpen : ICONS.folderClosed;
    case 'repo':
      return ICONS.repo;
    case 'branch':
      return ICONS.branch;
    case 'action':
      return ICONS.action;
    default:
      return ICONS.repo;
  }
}

/**
 * Create a decorative 16×16 `<img>` icon. `alt=""` + `aria-hidden="true"` keep
 * it out of the accessibility tree; the row label carries the accessible name.
 * `width`/`height`/`src`/`alt` are presentational/semantic attributes — not
 * inline styles.
 *
 * @param {string} className
 * @param {string} fileName Icon filename relative to {@link ICON_BASE}.
 * @returns {HTMLImageElement}
 */
function createIcon(className, fileName) {
  const img = document.createElement('img');
  img.className = className;
  img.setAttribute('src', ICON_BASE + fileName);
  img.setAttribute('alt', '');
  img.setAttribute('aria-hidden', 'true');
  img.setAttribute('width', '16');
  img.setAttribute('height', '16');
  return img;
}

/**
 * Build a fully-formed, accessible row element for a tree node.
 *
 * Child order matches the design: `node.depth` indent spacers → (folders only)
 * a disclosure chevron → the type icon → the text label. Folders/expandable
 * repos expose `aria-expanded`; branch rows carry `data-branch-id`/`data-path`
 * and reflect the current selection. The row is keyboard-focusable so folder
 * toggling and branch selection work from the keyboard.
 *
 * @param {import('./data.js').TreeNode} node
 * @param {object} state Shared UI state.
 * @returns {HTMLElement} A detached row element (caller inserts it).
 */
function createRow(node, state) {
  const row = document.createElement('div');
  row.className = rowClassFor(node);
  row.setAttribute('role', 'treeitem');
  row.dataset.id = node.id;
  row.dataset.type = node.type;
  row.dataset.depth = String(node.depth);
  // Flat-tree ARIA level is 1-based.
  row.setAttribute('aria-level', String(node.depth + 1));
  row.tabIndex = 0;

  // Expandable rows advertise and reflect their open/closed state.
  if (isExpandable(node)) {
    const expanded = isExpanded(node.id, state);
    row.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    if (expanded) row.classList.add(CLASS_EXPANDED);
  }

  // Branch rows expose selection hooks for selection.js and reflect state.
  if (node.type === 'branch') {
    row.dataset.branchRow = '';
    row.dataset.branchId = node.id;
    row.dataset.path = getFullPath(node.id);
    const selected = !!(state && state.selectedBranchId === node.id);
    row.setAttribute('aria-selected', selected ? 'true' : 'false');
    if (selected) row.classList.add(CLASS_SELECTED);
  }

  // Depth indentation: one CSS-sized spacer per level (no pixel math here).
  for (let i = 0; i < node.depth; i += 1) {
    const spacer = document.createElement('span');
    spacer.className = CLASS_INDENT;
    spacer.setAttribute('aria-hidden', 'true');
    row.appendChild(spacer);
  }

  // Disclosure chevron — folders only (rotated 90° when expanded, via CSS).
  if (node.type === 'folder') {
    row.appendChild(createIcon(CLASS_CHEVRON, ICONS.chevron));
  }

  // Type icon (folder/open-folder/repo/branch/plus).
  row.appendChild(createIcon(CLASS_ICON, iconFileFor(node, state)));

  // Text label — verbatim from the data model.
  const label = document.createElement('span');
  label.className = CLASS_LABEL;
  label.textContent = node.label;
  row.appendChild(label);

  return row;
}

/* ============================================================================
 * Insertion-anchor + sentinel-invariant helpers.
 * All insertions go BEFORE the sentinel so it stays the last child of the root.
 * ==========================================================================*/

/**
 * Return `el` only when it is a DIRECT child of `treeList` (required for
 * `insertBefore`), otherwise null.
 *
 * @param {HTMLElement} treeList
 * @param {?Element} el
 * @returns {?Element}
 */
function directChild(treeList, el) {
  return el && el.parentNode === treeList ? el : null;
}

/**
 * Anchor before which LEAD scaffold rows are inserted (so they precede the
 * search control and the branch region). Prefers the search control, then the
 * first branch row, then the empty-state, then the first trail row, then the
 * sentinel; appends when none exist.
 *
 * @param {HTMLElement} treeList
 * @returns {?Element}
 */
function getLeadInsertAnchor(treeList) {
  const candidates = [
    document.getElementById(SEARCH_AFFORDANCE_ID),
    document.getElementById(SEARCH_INPUT_ROW_ID),
    treeList.querySelector('[data-branch-row]'),
    treeList.querySelector('.' + EMPTY_STATE_CLASS),
    treeList.querySelector('[data-scaffold-pos="trail"]'),
    getSentinel(),
  ];
  for (const el of candidates) {
    const anchor = directChild(treeList, el);
    if (anchor) return anchor;
  }
  return null;
}

/**
 * Anchor before which BRANCH rows are inserted (so they follow the search
 * control and precede the empty-state and the trailing repositories). Prefers
 * the empty-state, then the first trail row, then the sentinel.
 *
 * @param {HTMLElement} treeList
 * @returns {?Element}
 */
function getBranchInsertAnchor(treeList) {
  const candidates = [
    treeList.querySelector('.' + EMPTY_STATE_CLASS),
    treeList.querySelector('[data-scaffold-pos="trail"]'),
    getSentinel(),
  ];
  for (const el of candidates) {
    const anchor = directChild(treeList, el);
    if (anchor) return anchor;
  }
  return null;
}

/**
 * Guarantee the pagination sentinel remains the LAST child of the tree root.
 * Only moves it when it has drifted, so normal insert-before flows are cheap.
 *
 * @param {HTMLElement} [treeList]
 */
function ensureSentinelLast(treeList) {
  const list = treeList || getTreeList();
  const sentinel = getSentinel();
  if (!list || !sentinel) return;
  if (sentinel.parentNode === list && list.lastElementChild !== sentinel) {
    list.appendChild(sentinel);
  }
}

/* ============================================================================
 * Branch-row rendering — the single entry point shared by pagination.js
 * (progressive append) and search.js (replace-with-matches / clear-for-empty).
 * ==========================================================================*/

/**
 * Coerce an arbitrary argument into a clean array of branch nodes.
 *
 * @param {*} branches
 * @returns {import('./data.js').TreeNode[]}
 */
function normalizeBranches(branches) {
  if (!Array.isArray(branches)) return [];
  return branches.filter(
    (n) => n && n.type === 'branch' && typeof n.id === 'string',
  );
}

/**
 * Insert one branch row before the shared branch anchor (kept before the
 * sentinel). Falls back to appending when no anchor is a direct child.
 *
 * @param {import('./data.js').TreeNode} node
 * @param {object} state
 * @param {HTMLElement} treeList
 * @param {?Element} anchor
 */
function insertBranchRow(node, state, treeList, anchor) {
  const row = createRow(node, state);
  if (anchor && anchor.parentNode === treeList) {
    treeList.insertBefore(row, anchor);
  } else {
    treeList.appendChild(row);
  }
}

/** Remove every branch row from the DOM (does NOT clear the preserved cache). */
function removeBranchRowsFromDom() {
  const treeList = getTreeList();
  if (!treeList) return;
  treeList.querySelectorAll('[data-branch-row]').forEach((el) => el.remove());
}

/**
 * Render (replace) the branch region with the given ordered branch nodes.
 *
 * Clears any existing branch rows first, then renders the supplied set as plain
 * rows (no highlight/emphasis — matches render identically to normal rows).
 * Used by app.js for the initial page and by search.js to show a filtered set.
 * The sentinel is kept last.
 *
 * @param {import('./data.js').TreeNode[]} branches Ordered branch nodes.
 * @param {object} [state] Shared UI state.
 */
export function renderBranchRows(branches, state) {
  const resolved = resolveState(state);
  const list = normalizeBranches(branches);
  lastRenderedBranches = list.slice();

  const treeList = getTreeList();
  if (!treeList) return;

  removeBranchRowsFromDom();
  const anchor = getBranchInsertAnchor(treeList);
  for (const node of list) {
    insertBranchRow(node, resolved, treeList, anchor);
  }
  ensureSentinelLast(treeList);
}

/**
 * Append additional branch rows WITHOUT clearing existing ones (progressive
 * reveal). New rows land after the current branch rows and before the
 * empty-state / trailing repositories / sentinel. Used by pagination.js.
 *
 * @param {import('./data.js').TreeNode[]} branches Ordered branch nodes to add.
 * @param {object} [state] Shared UI state.
 */
export function appendBranchRows(branches, state) {
  const resolved = resolveState(state);
  const list = normalizeBranches(branches);

  const treeList = getTreeList();
  if (!treeList) return;

  const anchor = getBranchInsertAnchor(treeList);
  for (const node of list) {
    insertBranchRow(node, resolved, treeList, anchor);
    if (!lastRenderedBranches.some((b) => b.id === node.id)) {
      lastRenderedBranches.push(node);
    }
  }
  ensureSentinelLast(treeList);
}

/**
 * Remove all branch rows and forget the preserved branch view. Used by
 * search.js when a query matches nothing (the empty-state is then revealed by
 * search.js). The sentinel is kept last.
 */
export function clearBranchRows() {
  lastRenderedBranches = [];
  removeBranchRowsFromDom();
  ensureSentinelLast();
}

/* ============================================================================
 * Branch-area visibility — keeps the branch region consistent with the active
 * repository's expand/visibility state during folder collapse/expand.
 * ==========================================================================*/

/**
 * Synchronise the branch area (branch rows + the search control + empty-state)
 * with whether the active repository is currently visible AND expanded.
 *
 * Branch ROWS are added/removed from the DOM (rather than toggled via the
 * `hidden` attribute) because a `.branch-row` is `display: flex` and an author
 * `display` beats the user-agent `[hidden]` rule — removal is the only
 * reliable hide. The preserved {@link lastRenderedBranches} cache lets a
 * re-expand restore the exact same rows. The search control is hidden via the
 * `hidden` attribute (reliable — branch-list.css defines `[hidden]` for it and
 * search.js relies on the same), guarded so we only ever restore a control WE
 * hid, honouring the shared `state.searchActive`.
 *
 * @param {object} state Shared UI state.
 */
function syncBranchArea(state) {
  const treeList = getTreeList();
  if (!treeList) return;

  const activeId = (state && state.activeRepoId) || ACTIVE_REPO_ID;
  const activeNode = getNode(activeId);
  const activeVisible =
    !!activeNode &&
    isAncestorChainExpanded(activeNode, state) &&
    isExpanded(activeId, state);

  const affordance = document.getElementById(SEARCH_AFFORDANCE_ID);
  const inputRow = document.getElementById(SEARCH_INPUT_ROW_ID);
  const emptyState = treeList.querySelector('.' + EMPTY_STATE_CLASS);

  if (activeVisible) {
    // Restore the preserved branch view if it was removed on a prior collapse.
    const domHasBranches = !!treeList.querySelector('[data-branch-row]');
    if (!domHasBranches && lastRenderedBranches.length > 0) {
      const anchor = getBranchInsertAnchor(treeList);
      for (const node of lastRenderedBranches) {
        insertBranchRow(node, state, treeList, anchor);
      }
      ensureSentinelLast(treeList);
    }
    // Restore only the search control WE hid, consistent with search state.
    if (searchHiddenByCollapse) {
      if (state && state.searchActive) {
        if (inputRow) inputRow.hidden = false;
        if (affordance) affordance.hidden = true;
      } else {
        if (affordance) affordance.hidden = false;
        if (inputRow) inputRow.hidden = true;
      }
      searchHiddenByCollapse = false;
    }
  } else {
    // Active repo (or an ancestor) collapsed: take the branch area out of view.
    removeBranchRowsFromDom(); // preserve lastRenderedBranches for re-expand
    if (emptyState) emptyState.hidden = true;
    if (affordance || inputRow) {
      if (affordance) affordance.hidden = true;
      if (inputRow) inputRow.hidden = true;
      searchHiddenByCollapse = true;
    }
    ensureSentinelLast(treeList);
  }
}

/* ============================================================================
 * Tree scaffold rendering.
 * ==========================================================================*/

/**
 * Render the folder/repository hierarchy and the "New branch" action row into
 * `#tree-list`, respecting the current expand/collapse state, then reconcile
 * the branch area. Branch leaves themselves are rendered by
 * {@link renderBranchRows}/{@link appendBranchRows}; this call preserves any
 * branch rows already present (they are not scaffold).
 *
 * Idempotent: previously rendered scaffold rows are removed (identified by
 * `data-scaffold-pos`, so branch rows are never touched) and rebuilt. A single
 * delegated listener for folder toggling is attached to the root on first call.
 *
 * @param {object} state Shared UI state (single source of truth from app.js).
 * @param {{ onToggle?: (id: string, state: object) => void }} [handlers]
 *        Optional callbacks; `onToggle` fires after a folder is toggled.
 */
export function renderTree(state, handlers) {
  const resolved = resolveState(state);
  if (handlers && typeof handlers === 'object') {
    activeHandlers = handlers;
  }

  const treeList = getTreeList();
  if (!treeList) return;

  ensureDelegation(treeList);

  // Remove only previously-rendered scaffold rows; leave branch rows + static
  // controls + sentinel untouched.
  treeList
    .querySelectorAll('[data-scaffold-pos]')
    .forEach((el) => el.remove());

  const visible = getVisibleScaffoldNodes(resolved);
  const { lead, trail } = splitScaffold(visible, resolved);

  const leadAnchor = getLeadInsertAnchor(treeList);
  for (const node of lead) {
    const row = createRow(node, resolved);
    row.dataset.scaffoldPos = 'lead';
    if (leadAnchor && leadAnchor.parentNode === treeList) {
      treeList.insertBefore(row, leadAnchor);
    } else {
      treeList.appendChild(row);
    }
  }

  const sentinel = getSentinel();
  for (const node of trail) {
    const row = createRow(node, resolved);
    row.dataset.scaffoldPos = 'trail';
    if (sentinel && sentinel.parentNode === treeList) {
      treeList.insertBefore(row, sentinel);
    } else {
      treeList.appendChild(row);
    }
  }

  syncBranchArea(resolved);
  ensureSentinelLast(treeList);
}

/* ============================================================================
 * Folder expand/collapse (I5) + event delegation.
 * ==========================================================================*/

/**
 * Toggle a folder/expandable-repo's expanded state and re-render.
 *
 * Flips `state.expanded`, re-renders the scaffold (which swaps the folder icon,
 * updates `aria-expanded`, toggles the chevron-rotation hook, and shows/hides
 * descendants), restores focus to the toggled row, and fires the optional
 * `onToggle` handler. Branch rows and the current selection are preserved.
 *
 * @param {string} id Node id of the folder/repo to toggle.
 * @param {object} [state] Shared UI state.
 * @param {{ onToggle?: (id: string, state: object) => void }} [handlers]
 * @returns {boolean} True if a toggle occurred.
 */
export function toggleFolder(id, state, handlers) {
  const resolved = resolveState(state);
  if (handlers && typeof handlers === 'object') {
    activeHandlers = handlers;
  }

  const node = getNode(id);
  if (!isExpandable(node)) return false;

  setExpanded(id, !isExpanded(id, resolved), resolved);
  renderTree(resolved, activeHandlers);

  // Restore focus to the toggled row (survives the scaffold rebuild).
  const treeList = getTreeList();
  if (treeList) {
    const row = Array.from(
      treeList.querySelectorAll('[role="treeitem"]'),
    ).find((el) => el.dataset.id === id);
    if (row) row.focus();
  }

  if (activeHandlers && typeof activeHandlers.onToggle === 'function') {
    activeHandlers.onToggle(id, resolved);
  }
  return true;
}

/**
 * Whether a row element represents an expandable folder/repo (i.e. it carries
 * `aria-expanded`, set by {@link createRow} only for expandable nodes).
 *
 * @param {Element} row
 * @returns {boolean}
 */
function isExpandableRow(row) {
  return !!row && row.hasAttribute('aria-expanded');
}

/**
 * Delegated click handler on the tree root. Toggles the nearest expandable
 * row; ignores branch/action rows so selection.js can own branch activation.
 *
 * @param {MouseEvent} event
 */
function onTreeClick(event) {
  const treeList = getTreeList();
  if (!treeList) return;
  const row =
    event.target && event.target.closest
      ? event.target.closest('[role="treeitem"]')
      : null;
  if (!row || !treeList.contains(row) || !isExpandableRow(row)) return;
  toggleFolder(row.dataset.id, activeState, activeHandlers);
}

/**
 * Delegated keydown handler on the tree root. Enter/Space toggles the nearest
 * expandable row (Space's default page-scroll is prevented). Branch-row keys
 * are left for selection.js.
 *
 * @param {KeyboardEvent} event
 */
function onTreeKeydown(event) {
  if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') {
    return;
  }
  const treeList = getTreeList();
  if (!treeList) return;
  const row =
    event.target && event.target.closest
      ? event.target.closest('[role="treeitem"]')
      : null;
  if (!row || !treeList.contains(row) || !isExpandableRow(row)) return;
  event.preventDefault();
  toggleFolder(row.dataset.id, activeState, activeHandlers);
}

/**
 * Attach the delegated click/keydown listeners exactly once per tree root. A
 * dataset flag guards against duplicate attachment across re-renders.
 *
 * @param {HTMLElement} treeList
 */
function ensureDelegation(treeList) {
  if (treeList.dataset.treeDelegationAttached === 'true') return;
  treeList.dataset.treeDelegationAttached = 'true';
  treeList.addEventListener('click', onTreeClick);
  treeList.addEventListener('keydown', onTreeKeydown);
}
