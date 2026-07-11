/**
 * js/data.js — Client-side static branch/folder seed (Requirement R1).
 *
 * This repository has no backend data source for repository branches, and
 * backend changes are prohibited (AAP Constraint 6). This file therefore acts
 * as the client-side static seed that REPLACES the absent backend: it declares
 * a plain, in-memory data structure describing the folder/repository hierarchy
 * (`tree`) and the flat list of selectable branches (`branches`).
 *
 * It is a vanilla, classic (non-module) script — the FIRST of three loaded by
 * index.html at the end of <body> in this exact order:
 *     js/data.js  ->  js/branch-selector.js  ->  js/app.js
 * It performs NO rendering, NO DOM access, NO event wiring, and NO
 * network/API/DB/fetch/XHR calls. The data is consumed by:
 *   - js/branch-selector.js — reads window.BranchData.tree (to render the
 *     folder/repo chain) and window.BranchData.branches (to render, paginate,
 *     and filter the branch rows).
 *   - js/app.js — passes window.BranchData into the selector's init function.
 *
 * Public contract (must not change): window.BranchData = { tree, branches }.
 */
(function () {
  'use strict';

  // Full path of the repository that owns every branch in this seed. Confirmed
  // from the Figma confirmation-bar text node (48966:68386):
  // "engineering/frontend/web-app/customer-portal/branch-2".
  var REPO_PATH = 'engineering/frontend/web-app/customer-portal';

  // Build the branch name list programmatically to stay minimal and to avoid
  // transcription errors: branch-1..branch-16 in ascending numeric order,
  // followed by the additional selectable branches "main" and "dev". This
  // ordering preserves the documented Figma pagination viewports (branch-1..4
  // initially visible, branch-5..16 revealed on scroll).
  var branchNames = [];
  for (var i = 1; i <= 16; i++) {
    branchNames.push('branch-' + i);
  }
  branchNames.push('main');
  branchNames.push('dev');

  // Each branch is a plain { name, path } object. `path` is the full
  // forward-slash path (no leading/trailing slash) that the confirmation bar
  // (R7) renders verbatim on selection.
  var branches = branchNames.map(function (name) {
    return { name: name, path: REPO_PATH + '/' + name };
  });

  // Folder / repository hierarchy shown in the branch selector. Confirmed from
  // Figma (screen 48966:64339): the tree is a FOREST of top-level folders whose
  // initial (unscrolled) viewport renders these rows, top -> bottom:
  //   platform            (folder, L0, COLLAPSED — reveals nothing)
  //   engineering         (folder, L0, EXPANDED)
  //   ├─ backend          (folder, L1, COLLAPSED — reveals nothing)
  //   └─ frontend         (folder, L1, EXPANDED)
  //      └─ web-app        (folder, L2, EXPANDED)
  //         └─ customer-portal   (repo, L3, EXPANDED)
  // `platform` (a top-level sibling of `engineering`) and `backend` (the FIRST
  // child of `engineering`, before `frontend`) are rendered COLLAPSED: closed-
  // folder icon + a non-rotated chevron, with no children revealed. Every other
  // node is EXPANDED so the branch list under customer-portal is visible by
  // default. Each node carries an explicit `expanded` flag consumed by
  // js/branch-selector.js (renderChain) to choose the folder vs folder-open icon
  // and the initial aria-expanded state.
  //
  // The repository's branches are NOT nested inside `tree`; they live in the
  // flat `branches` array above and are attached under the customer-portal repo
  // at render time by js/branch-selector.js. Folder/repo `path` values are
  // stable identifiers used only for collapse/expand tracking (they need not map
  // to any branch path). `tree` is an ARRAY of root nodes (a forest) because
  // `platform` and `engineering` are siblings at depth 0.
  var tree = [
    {
      type: 'folder', name: 'platform', path: 'platform',
      expanded: false, children: []
    },
    {
      type: 'folder', name: 'engineering', path: 'engineering',
      expanded: true,
      children: [
        {
          type: 'folder', name: 'backend', path: 'engineering/backend',
          expanded: false, children: []
        },
        {
          type: 'folder', name: 'frontend', path: 'engineering/frontend',
          expanded: true,
          children: [
            {
              type: 'folder', name: 'web-app', path: 'engineering/frontend/web-app',
              expanded: true,
              children: [
                {
                  type: 'repo', name: 'customer-portal', path: REPO_PATH,
                  expanded: true, children: []
                }
              ]
            }
          ]
        }
      ]
    }
  ];

  // Expose the single global namespace consumed by the later classic scripts.
  // Only this property is added to the global scope (everything else above is
  // function-scoped to this IIFE).
  window.BranchData = { tree: tree, branches: branches };
})();
