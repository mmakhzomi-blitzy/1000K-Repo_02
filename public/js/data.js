/**
 * @file public/js/data.js
 * @module data
 *
 * Sample in-memory folder/repository/branch tree plus pure lookup helpers for
 * the "Branch pagination + search" static frontend. There is no backend/API/
 * network layer — every node is hardcoded here so the feature is fully static.
 *
 * Contract: native ES module, named exports only; zero dependencies; zero side
 * effects (no DOM, no host globals, no listeners, no network, no logging, no
 * throw on load); all helpers are pure and never mutate `treeData` or a node.
 * Content labels mirror the Figma design verbatim and must not be altered.
 *
 * SAFE RENDERING CONTRACT (CWE-79 / CWE-20 — consumers MUST obey):
 *  - Build rows with `document.createElement`; insert every data-derived string
 *    (label, full path, query echo, live-status text) via `textContent` or
 *    `document.createTextNode`. NEVER interpolate a node field into `innerHTML`,
 *    `insertAdjacentHTML`, or an inline event/`href`/`src` attribute.
 *  - Choose icons ONLY from the frozen {@link ICON_BY_TYPE} whitelist keyed by a
 *    validated `node.type`; never build an icon `src` from a data string.
 *  - Validate untrusted/derived nodes with {@link isValidNode} before rendering.
 * These rules keep rendering injection-safe if the dataset is ever sourced
 * dynamically. This module supplies the enforcement primitives; the render
 * modules apply them.
 *
 * @typedef {Object} TreeNode
 * @property {string} id        Unique, stable id (DOM `data-id` + lookups).
 * @property {("folder"|"repo"|"branch"|"action")} type  Node kind (drives icon).
 * @property {string} label     Human-visible row text (verbatim from the design).
 * @property {number} depth     Indent level 0–5 (drives `depth × 28px` indent).
 * @property {(string|null)} parentId  Parent id, or `null` for roots.
 * @property {boolean} [expanded]  Folders/repos: children shown by default.
 * @property {boolean} [selected]  Initial (cosmetic) selection flag.
 */

/** The repository whose branches drive pagination and search. @type {string} */
export const ACTIVE_REPO_ID = 'customer-portal';

/** Allowed node types. @type {readonly string[]} */
const NODE_TYPES = Object.freeze(['folder', 'repo', 'branch', 'action']);

/**
 * Fixed whitelist mapping a validated `node.type` to its local icon filename
 * under `assets/icons/`. Renderers pick icons from THIS frozen map — never from
 * a data string. Expanded folders swap the `folder` value for `folderOpen`.
 * @type {Readonly<Record<string, string>>}
 */
export const ICON_BY_TYPE = Object.freeze({
  folder: 'icon_folder.svg',
  folderOpen: 'icon_folder_open.svg',
  repo: 'icon_repo.svg',
  branch: 'icon_git_branch.svg',
  action: 'icon_plus.svg',
});

/**
 * Build the branch leaves under the active repository: `branch-1`…`branch-16`,
 * six `main` rows with unique ids `main-1`…`main-6`, and one `dev` (pre-selected
 * to mirror the mock). Module-private pure factory, invoked once below.
 * @returns {TreeNode[]}
 */
function buildBranchNodes() {
  /** @type {TreeNode[]} */
  const branches = [];

  for (let n = 1; n <= 16; n += 1) {
    branches.push({ id: `branch-${n}`, type: 'branch', label: `branch-${n}`, depth: 4, parentId: ACTIVE_REPO_ID });
  }
  // Six "main" rows: identical verbatim label, unique ids.
  for (let n = 1; n <= 6; n += 1) {
    branches.push({ id: `main-${n}`, type: 'branch', label: 'main', depth: 4, parentId: ACTIVE_REPO_ID });
  }
  branches.push({ id: 'dev', type: 'branch', label: 'dev', depth: 4, parentId: ACTIVE_REPO_ID, selected: true });

  return branches;
}

/**
 * The codebase tree as a flat, ordered array of {@link TreeNode}s (depth-first,
 * matching the Figma visible row order). The chain engineering → frontend →
 * web-app → customer-portal → branch-N makes `getFullPath("branch-2")` resolve
 * to "engineering/frontend/web-app/customer-portal/branch-2"; `platform` and
 * `backend` are intentionally NOT ancestors of the branches.
 * @type {TreeNode[]}
 */
export const treeData = [
  // Root folders (depth 0)
  { id: 'platform', type: 'folder', label: 'platform', depth: 0, parentId: null, expanded: false },
  { id: 'engineering', type: 'folder', label: 'engineering', depth: 0, parentId: null, expanded: true },

  // engineering › folders (depth 1)
  { id: 'backend', type: 'folder', label: 'backend', depth: 1, parentId: 'engineering', expanded: false },
  { id: 'frontend', type: 'folder', label: 'frontend', depth: 1, parentId: 'engineering', expanded: true },

  // engineering › frontend › folder (depth 2)
  { id: 'web-app', type: 'folder', label: 'web-app', depth: 2, parentId: 'frontend', expanded: true },

  // engineering › frontend › web-app › ACTIVE repo (depth 3)
  { id: ACTIVE_REPO_ID, type: 'repo', label: 'customer-portal', depth: 3, parentId: 'web-app', expanded: true },

  // customer-portal › children (depth 4): "New branch" action, then branches.
  { id: 'new-branch', type: 'action', label: 'New branch', depth: 4, parentId: ACTIVE_REPO_ID },
  ...buildBranchNodes(),

  // web-app › sibling repository (depth 3)
  { id: 'admin-dash', type: 'repo', label: 'admin-dash', depth: 3, parentId: 'web-app', expanded: false },

  // frontend › sibling folders (depth 2) — listed after the web-app subtree so
  // depth-first visible order stays exact.
  { id: 'design-system', type: 'folder', label: 'design-system', depth: 2, parentId: 'frontend', expanded: false },
  { id: 'shared-components', type: 'folder', label: 'shared-components', depth: 2, parentId: 'frontend', expanded: false },

  // engineering › sibling folders (depth 1)
  { id: 'qa', type: 'folder', label: 'qa', depth: 1, parentId: 'engineering', expanded: false },
  { id: 'data-science', type: 'folder', label: 'data-science', depth: 1, parentId: 'engineering', expanded: false },

  // Root folder (depth 0)
  { id: 'infrastructure', type: 'folder', label: 'infrastructure', depth: 0, parentId: null, expanded: false },
];

/**
 * Non-throwing structural validator for a node (safe-rendering contract).
 * @param {*} node
 * @returns {boolean} true if `node` has a valid id/type/label/depth/parentId.
 */
export function isValidNode(node) {
  return Boolean(node)
    && typeof node.id === 'string' && node.id.length > 0
    && typeof node.label === 'string'
    && NODE_TYPES.includes(node.type)
    && Number.isInteger(node.depth) && node.depth >= 0 && node.depth <= 5
    && (node.parentId === null || typeof node.parentId === 'string');
}

/**
 * Look up a node by id.
 * @param {string} id
 * @returns {(TreeNode|undefined)}
 */
export function getNode(id) {
  return treeData.find((node) => node.id === id);
}

/**
 * Ordered direct children of a node (`null` → root nodes). Fresh array; node
 * objects are shared.
 * @param {(string|null)} parentId
 * @returns {TreeNode[]}
 */
export function getChildren(parentId) {
  return treeData.filter((node) => node.parentId === parentId);
}

/**
 * Ordered branch leaves (`type === "branch"`) of a repository. For the active
 * repo this is branch-1…branch-16, six "main", and "dev" (23 nodes).
 * @param {string} repoId
 * @returns {TreeNode[]}
 */
export function getBranches(repoId) {
  return treeData.filter((node) => node.type === 'branch' && node.parentId === repoId);
}

/**
 * Build the "/"-joined path from a root down to `id` (cycle-safe; "" if unknown).
 * Example: getFullPath("branch-2") → "engineering/frontend/web-app/customer-portal/branch-2".
 * @param {string} id
 * @returns {string}
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
