/**
 * @file public/js/data.js
 * @module data
 *
 * Sample in-memory codebase folder/repository/branch tree dataset plus small,
 * pure lookup helpers for the "Branch pagination + search" static frontend.
 *
 * This is the FOUNDATION module of the feature: it is imported by `tree.js`,
 * `pagination.js`, `search.js`, `selection.js`, and `app.js`, and it imports
 * nothing itself. There is intentionally NO backend, NO API, and NO network
 * layer — every folder, repository, and branch is hardcoded here in memory so
 * the feature runs as a fully static, zero-dependency bundle.
 *
 * Design contract (do not break):
 *  - Native ES module using named `export`s only (no CommonJS module system).
 *  - Zero dependencies and ZERO side effects: no DOM access, no browser host
 *    globals, no event listeners, no network calls, no logging, no throw on
 *    load. It is therefore safe to import from any context.
 *  - All exported helpers are PURE: they never mutate `treeData` or any node.
 *  - Content strings (labels) mirror the Figma design verbatim and must not be
 *    altered: e.g. "New branch", "branch-1"…"branch-16", "main", "dev".
 */

/**
 * A single node in the codebase tree.
 *
 * The tree is stored as a FLAT array of nodes linked by `parentId`; this makes
 * path-building, filtering, and pagination trivial. Visual nesting is derived
 * from `depth`, and ancestry is derived by walking `parentId`.
 *
 * @typedef {Object} TreeNode
 * @property {string} id            Unique, stable identifier. Used as the DOM
 *                                  `data-id` and for all lookups (e.g.
 *                                  "engineering", "customer-portal", "branch-2").
 * @property {("folder"|"repo"|"branch"|"action")} type
 *                                  The node kind. Drives icon selection and
 *                                  which rows are treated as branches.
 * @property {string} label         Human-visible text rendered in the row. Exact
 *                                  string from the design (rendered verbatim).
 * @property {number} depth         Indentation level, integer 0–5. Drives the
 *                                  `depth × 28px` indentation applied in
 *                                  `tree.js`.
 * @property {(string|null)} parentId
 *                                  `id` of the parent node, or `null` for roots.
 *                                  Used to build full paths and child lists.
 * @property {boolean} [expanded]   Optional. For folders/repos: whether children
 *                                  are shown by default (the active branch chain
 *                                  is expanded to match the initial Figma view).
 * @property {boolean} [selected]   Optional. Initial selection state (cosmetic;
 *                                  runtime selection is managed by `selection.js`).
 */

/**
 * The `id` of the repository whose branches drive pagination and search.
 *
 * Exposed as a single source of truth so `app.js` and the sibling modules agree
 * on the active repository without duplicating the literal string.
 *
 * @type {string}
 */
export const ACTIVE_REPO_ID = 'customer-portal';

/**
 * Build the branch leaves that live under the active repository.
 *
 * Generated programmatically to keep the dataset minimal while still producing
 * real, individual entries in `treeData`:
 *  - `branch-1` … `branch-16` (16 sequentially-numbered branches),
 *  - six rows labeled "main" with unique ids `main-1` … `main-6`,
 *  - a single `dev` branch, flagged `selected` to mirror the static mock.
 *
 * This is a module-private pure factory (no side effects); it is invoked once
 * while composing `treeData`.
 *
 * @returns {TreeNode[]} Ordered branch nodes parented to {@link ACTIVE_REPO_ID}.
 */
function buildBranchNodes() {
  /** @type {TreeNode[]} */
  const branches = [];

  // branch-1 … branch-16 — numbered branches used to demonstrate pagination.
  for (let n = 1; n <= 16; n += 1) {
    branches.push({
      id: `branch-${n}`,
      type: 'branch',
      label: `branch-${n}`,
      depth: 4,
      parentId: ACTIVE_REPO_ID,
    });
  }

  // Six "main" rows. Ids are unique (main-1 … main-6) while the label is the
  // identical, verbatim "main" — exercising duplicate-label / unique-id handling.
  for (let n = 1; n <= 6; n += 1) {
    branches.push({
      id: `main-${n}`,
      type: 'branch',
      label: 'main',
      depth: 4,
      parentId: ACTIVE_REPO_ID,
    });
  }

  // The `dev` branch, pre-selected to mirror the #F2F0FE selected row in the mock.
  branches.push({
    id: 'dev',
    type: 'branch',
    label: 'dev',
    depth: 4,
    parentId: ACTIVE_REPO_ID,
    selected: true,
  });

  return branches;
}

/**
 * The complete codebase tree as a flat, ordered array of {@link TreeNode}s.
 *
 * Order is DEPTH-FIRST and mirrors the Figma visible row order exactly:
 * platform, engineering, backend, frontend, web-app, customer-portal,
 * "New branch", branch-1…branch-16, main×6, dev, admin-dash, design-system,
 * shared-components, qa, data-science, infrastructure.
 *
 * The chain engineering → frontend → web-app → customer-portal → branch-N is
 * authoritative: it is what makes `getFullPath("branch-2")` resolve to
 * "engineering/frontend/web-app/customer-portal/branch-2". `platform` and
 * `backend` are intentionally NOT ancestors of the branches.
 *
 * @type {TreeNode[]}
 */
export const treeData = [
  // ── Root-level folders (depth 0) ──────────────────────────────────────────
  { id: 'platform', type: 'folder', label: 'platform', depth: 0, parentId: null, expanded: false },
  { id: 'engineering', type: 'folder', label: 'engineering', depth: 0, parentId: null, expanded: true },

  // ── engineering › folders (depth 1) ───────────────────────────────────────
  { id: 'backend', type: 'folder', label: 'backend', depth: 1, parentId: 'engineering', expanded: false },
  { id: 'frontend', type: 'folder', label: 'frontend', depth: 1, parentId: 'engineering', expanded: true },

  // ── engineering › frontend › folder (depth 2) ─────────────────────────────
  { id: 'web-app', type: 'folder', label: 'web-app', depth: 2, parentId: 'frontend', expanded: true },

  // ── engineering › frontend › web-app › repository (depth 3) — ACTIVE repo ──
  { id: ACTIVE_REPO_ID, type: 'repo', label: 'customer-portal', depth: 3, parentId: 'web-app', expanded: true },

  // ── customer-portal › children (depth 4) ──────────────────────────────────
  // The "New branch" action row precedes the branch leaves in the design.
  { id: 'new-branch', type: 'action', label: 'New branch', depth: 4, parentId: ACTIVE_REPO_ID },
  // branch-1…16, main×6, dev (generated above, in visible order).
  ...buildBranchNodes(),

  // ── engineering › frontend › web-app › sibling repositories (depth 3) ──────
  { id: 'admin-dash', type: 'repo', label: 'admin-dash', depth: 3, parentId: 'web-app', expanded: false },
  { id: 'design-system', type: 'repo', label: 'design-system', depth: 3, parentId: 'web-app', expanded: false },
  { id: 'shared-components', type: 'repo', label: 'shared-components', depth: 3, parentId: 'web-app', expanded: false },

  // ── engineering › sibling folders (depth 1) ───────────────────────────────
  { id: 'qa', type: 'folder', label: 'qa', depth: 1, parentId: 'engineering', expanded: false },
  { id: 'data-science', type: 'folder', label: 'data-science', depth: 1, parentId: 'engineering', expanded: false },

  // ── Root-level folder (depth 0) ───────────────────────────────────────────
  { id: 'infrastructure', type: 'folder', label: 'infrastructure', depth: 0, parentId: null, expanded: false },
];

/**
 * Look up a node by its unique `id`.
 *
 * @param {string} id  The node id to find.
 * @returns {(TreeNode|undefined)} The matching node, or `undefined` if none.
 */
export function getNode(id) {
  return treeData.find((node) => node.id === id);
}

/**
 * Return the ordered direct children of a node.
 *
 * Children preserve their `treeData` order (depth-first / visible order), so the
 * result is render-ready for `tree.js`. Pass `null` to get the root-level nodes.
 * The returned array is a fresh copy; the node objects it holds are shared.
 *
 * @param {(string|null)} parentId  The parent node id, or `null` for roots.
 * @returns {TreeNode[]} A new array of direct child nodes (may be empty).
 */
export function getChildren(parentId) {
  return treeData.filter((node) => node.parentId === parentId);
}

/**
 * Return the ordered branch leaves (`type === "branch"`) of a repository.
 *
 * Used by `pagination.js` (to page through branches) and `search.js` (to filter
 * them). Non-branch children — e.g. the "New branch" action row — are excluded.
 * For the active repository this yields branch-1…branch-16, six "main" rows, and
 * "dev" (23 nodes total).
 *
 * @param {string} repoId  The repository node id (typically {@link ACTIVE_REPO_ID}).
 * @returns {TreeNode[]} A new array of branch nodes in visible order (may be empty).
 */
export function getBranches(repoId) {
  return treeData.filter((node) => node.type === 'branch' && node.parentId === repoId);
}

/**
 * Build the full "/"-joined path from the root down to the given node.
 *
 * Walks the `parentId` chain upward collecting labels, then reverses to
 * top-down order. Only ancestors on the node's own chain are included, so
 * unrelated roots/folders (e.g. `platform`, `backend`) never appear.
 *
 * Example: `getFullPath("branch-2")` →
 *   "engineering/frontend/web-app/customer-portal/branch-2".
 *
 * The traversal is cycle-safe (guarded by a visited set) and returns an empty
 * string for an unknown id.
 *
 * @param {string} id  The node id whose path to build.
 * @returns {string} The "/"-joined label path, or "" if `id` is not found.
 */
export function getFullPath(id) {
  const labels = [];
  const visited = new Set();

  let current = getNode(id);
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    labels.push(current.label);
    current = current.parentId === null ? undefined : getNode(current.parentId);
  }

  return labels.reverse().join('/');
}
