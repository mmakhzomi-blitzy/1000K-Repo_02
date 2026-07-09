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

  // Folder -> repository hierarchy that leads down to the customer-portal repo:
  //   engineering (folder)
  //   └─ frontend (folder)
  //      └─ web-app (folder)
  //         └─ customer-portal (repo)
  // The repository's branches are NOT nested inside `tree`; they live in the
  // flat `branches` array above and are attached under the repo at render time
  // by js/branch-selector.js. The repo node keeps an empty `children: []` so
  // its shape stays consistent with the folder nodes for the consumer.
  var tree = {
    type: 'folder',
    name: 'engineering',
    path: 'engineering',
    children: [{
      type: 'folder',
      name: 'frontend',
      path: 'engineering/frontend',
      children: [{
        type: 'folder',
        name: 'web-app',
        path: 'engineering/frontend/web-app',
        children: [{
          type: 'repo',
          name: 'customer-portal',
          path: REPO_PATH,
          children: []
        }]
      }]
    }]
  };

  // Expose the single global namespace consumed by the later classic scripts.
  // Only this property is added to the global scope (everything else above is
  // function-scoped to this IIFE).
  window.BranchData = { tree: tree, branches: branches };
})();
