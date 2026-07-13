/**
 * js/branch-selector.js — Core branch-selector feature module (Requirements R1–R7)
 * ===========================================================================
 * Blitzy Platform 2.0 — "Branch pagination + search" (AAP §0.1.1, §0.6.2).
 *
 * This is the SECOND of three classic (non-module) scripts loaded by
 * index.html at the end of <body>, in this exact order:
 *     js/data.js  ->  js/branch-selector.js  ->  js/app.js
 *
 * It reads the client-side static seed exposed by js/data.js
 * (window.BranchData = { tree, branches }) and renders the interactive
 * branch-selector into the empty #branch-selector container declared by
 * index.html. It applies ONLY the CSS class names defined in css/styles.css
 * and references the SVG icons in assets/icons/ (rendered as <img>).
 *
 * Requirements implemented here:
 *   R1  Tree rendering (folder/repo chain + action rows + branch rows).
 *   R2  Pagination by scroll (append-on-scroll; NO pager/Load-more/spinner).
 *   R3  Search activation (action row -> focused input).
 *   R4  Debounced, case-insensitive branch filtering (NO match highlighting).
 *   R5  Empty state (text-only "Branch not found").
 *   R6  Search dismissal (clear "×" / Escape -> action row + unfiltered list).
 *   R7  Selection + pinned confirmation bar (full-path text).
 *   §5.8 ARIA tree semantics + polite live region + keyboard operability.
 *
 * Public contract (must not change):
 *     window.BranchSelector = { init: function (container, data, options) }
 *
 * ---------------------------------------------------------------------------
 * DELIVERY DECISIONS / DEVIATIONS (documented per agent_prompt §2, §6):
 *   1. Indentation uses an inline `--depth` custom property per row (0..4),
 *      consumed by the delivered css/styles.css rule
 *      `.tree-row { padding-left: calc(var(--space-12) + var(--depth,0)*24px) }`.
 *      The alternative `.tree-row__indent` spacer-cell path (agent_prompt §4)
 *      is intentionally NOT used: `.tree-row` sets `gap: 4px`, so emitting
 *      spacer cells would add an extra 4px per level and break pixel alignment.
 *   2. Action-row order is "New branch" then "Search" (Figma structural order,
 *      nodes 48966:64504 < 48966:64514, confirmed in Phase 2), which overrides
 *      the agent_prompt §4 example diagram that listed "Search" first.
 *   3. The polite live region is created here (visually-hidden inline styles),
 *      because css/styles.css defines no `.sr-only`/visually-hidden utility.
 *      An existing `[aria-live]` region (if index.html provides one) is reused.
 *   4. Only the data.js hierarchy is rendered — the folder/repo FOREST it
 *      declares (platform [collapsed] + engineering > { backend [collapsed],
 *      frontend > web-app > customer-portal }) plus the 18 flat branches
 *      attached under the repo. js/data.js is the authoritative data source
 *      (AAP Constraint 6, §0.6.2); no folder set is invented beyond it.
 *   5. git-branch.svg is a single shared asset baked at #999999. Tree-row
 *      instances render #999999 as-is; the confirmation-bar instance is
 *      recoloured to #333333 via a CSS mask in styles.css to match Figma
 *      48966:68385 (AAP §0.3.4 keeps ONE reused asset — only the colour of
 *      that one instance differs).
 *   6. Pagination uses a native IntersectionObserver sentinel (with a scroll
 *      listener fallback). No numbered pager, "Load more", next/previous
 *      control, visible scrollbar, or spinner is rendered (AAP §0.7.2).
 *
 * Constraints honoured: vanilla JS only — NO import/export/require, NO
 * framework/library, NO bundler, NO fetch/XHR/WebSocket/network, NO backend.
 * Native browser APIs only. The single global added is window.BranchSelector.
 * ===========================================================================
 */
(function () {
  'use strict';

  /* ========================================================================
   * Constants
   * ===================================================================== */

  // Relative directory holding the pre-downloaded Figma SVG icons. Icons are
  // rendered as <img> and their colours are baked into the SVG files, so the
  // correct file MUST be placed in the correct slot. (One exception: the
  // confirmation-bar git-branch instance is recoloured to #333333 via a CSS
  // mask in styles.css — see header decision note 5 above.)
  var ICON_BASE = 'assets/icons/';
  var ICON = {
    folder: 'folder.svg',          // collapsed folder      (Figma 36337:14981)
    folderOpen: 'folder-open.svg', // expanded folder       (Figma 36337:14989)
    chevron: 'chevron-right.svg',  // expand/collapse arrow (Figma 9257:3856)
    repo: 'repo.svg',              // repository root icon   (Figma 36743:5599)
    gitBranch: 'git-branch.svg',   // branch + confirmation  (Figma 17131:133168)
    plus: 'plus.svg',              // "New branch" action    (Figma 5621:12657)
    search: 'search.svg',          // magnifier              (Figma 27466:15545)
    close: 'close.svg',            // clear "×" (active)     (Figma 10178:9938)
    checkCircle: 'check-circle.svg' // confirmation 24x24    (Figma 9117:8754)
  };

  // Behavioural defaults (overridable via init options).
  var DEFAULT_PAGE_SIZE = 6;   // branch rows appended per pagination step (R2)
  var DEFAULT_DEBOUNCE_MS = 300; // filter debounce window (R4; AAP §0.2.3)
  var SCROLL_FALLBACK_THRESHOLD = 1; // px slack for the scroll-listener fallback

  // Verbatim copy strings (reproduced exactly from Figma; do not reword).
  var EMPTY_MESSAGE = 'Branch not found';   // R5 (Figma text node 48966:70346)
  var SEARCH_LABEL = 'Search';              // R3 (action label + placeholder)
  var NEW_BRANCH_LABEL = 'New branch';      // R1 (action label)

  /* ========================================================================
   * Small DOM helpers
   * ===================================================================== */

  /**
   * Create an element with an optional class string and an optional map of
   * attributes. Attributes are applied via setAttribute so ARIA/data-* names
   * are written verbatim.
   */
  function makeEl(tag, className, attrs) {
    var node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (attrs) {
      for (var key in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, key)) {
          node.setAttribute(key, attrs[key]);
        }
      }
    }
    return node;
  }

  /**
   * Build a decorative icon <img>. The label text of each row conveys meaning,
   * so every icon is hidden from assistive technology (alt="" + aria-hidden).
   */
  function decorativeIcon(fileName) {
    var img = document.createElement('img');
    img.setAttribute('src', ICON_BASE + fileName);
    img.setAttribute('alt', '');
    img.setAttribute('aria-hidden', 'true');
    img.setAttribute('draggable', 'false');
    return img;
  }

  /**
   * Set the structural depth of a row. `--depth` drives the CSS indent
   * (padding-left: calc(space-12 + depth*24px)); the mirrored data-depth
   * attribute is read back by recomputeVisibility() for collapse handling.
   * `--depth` is a plain integer count, NOT a theme token, so setting it inline
   * does not violate the token-driven-styling rule (AAP §0.8).
   */
  function setDepth(node, depth) {
    node.style.setProperty('--depth', String(depth));
    node.setAttribute('data-depth', String(depth));
  }

  /**
   * Find the polite live region provided by index.html, or create a
   * visually-hidden one so announcements always work (§5.8). The visually
   * hidden styling is applied inline because css/styles.css has no equivalent
   * utility class; the element is invisible and has no layout impact.
   */
  function ensureLiveRegion(container) {
    var existing = container.querySelector('[aria-live]');
    if (existing) {
      return existing;
    }
    var region = makeEl('div', 'branch-selector__live', {
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': 'true'
    });
    region.style.cssText = [
      'position:absolute',
      'width:1px',
      'height:1px',
      'margin:-1px',
      'padding:0',
      'border:0',
      'overflow:hidden',
      'clip:rect(0 0 0 0)',
      'clip-path:inset(50%)',
      'white-space:nowrap'
    ].join(';') + ';';
    container.appendChild(region);
    return region;
  }

  /** Announce a message to assistive technology via the polite live region. */
  function announce(state, message) {
    if (!state.liveRegion) {
      return;
    }
    state.liveRegion.textContent = message;
  }

  /* ========================================================================
   * Row builders (R1 / R3 / R5 / R7)
   * ===================================================================== */

  /**
   * Build a single tree row. `config`:
   *   type      'folder' | 'repo' | 'branch' | 'action'
   *   label     visible text
   *   depth     indentation level (0..4)
   *   icon      icon filename for the .tree-row__icon slot
   *   path      full path (folders/repo/branch) — stored as data-path
   *   name      branch name — stored as data-name (branch rows)
   *   expanded  folders/repo only — initial expanded state
   *   selected  branch rows only — initial selected state
   */
  function createTreeRow(state, config) {
    var row = makeEl('div', 'tree-row tree-row--' + config.type, {
      role: 'treeitem',
      'aria-level': String(config.depth + 1),
      tabindex: '-1'
    });
    setDepth(row, config.depth);
    if (config.path) {
      row.setAttribute('data-path', config.path);
    }

    // Folders and the repository are expandable: they own a chevron cell and
    // carry aria-expanded. CSS rotates the chevron 90deg when expanded, so JS
    // only toggles the attribute/class (never hand-rotates the glyph).
    if (config.type === 'folder' || config.type === 'repo') {
      row.setAttribute('aria-expanded', config.expanded ? 'true' : 'false');
      if (config.expanded) {
        row.classList.add('tree-row--expanded');
      }
      var chevron = makeEl('span', 'tree-row__chevron');
      chevron.appendChild(decorativeIcon(ICON.chevron));
      row.appendChild(chevron);
    }

    // Branch rows are selectable leaves.
    if (config.type === 'branch') {
      row.setAttribute('aria-selected', config.selected ? 'true' : 'false');
      if (config.selected) {
        row.classList.add('tree-row--selected');
      }
      if (config.name) {
        row.setAttribute('data-name', config.name);
      }
    }

    var iconCell = makeEl('span', 'tree-row__icon');
    iconCell.appendChild(decorativeIcon(config.icon));
    row.appendChild(iconCell);

    var label = makeEl('span', 'tree-row__label');
    label.textContent = config.label; // textContent — never innerHTML
    row.appendChild(label);

    return row;
  }

  /** Build a branch row from a { name, path } seed entry (R1 / R7). */
  function createBranchRow(state, branch) {
    return createTreeRow(state, {
      type: 'branch',
      label: branch.name,
      name: branch.name,
      path: branch.path,
      depth: state.branchDepth,
      icon: ICON.gitBranch,
      selected: branch.path === state.selectedPath
    });
  }

  /** Build the collapsed "Search" action-link row (R3 entry point). */
  function buildSearchActionRow(state, depth) {
    var row = makeEl('div', 'search-row search-row--action', {
      role: 'treeitem',
      'aria-level': String(depth + 1),
      'aria-label': SEARCH_LABEL,
      tabindex: '-1'
    });
    setDepth(row, depth);

    var icon = makeEl('span', 'search-row__icon');
    icon.appendChild(decorativeIcon(ICON.search));
    row.appendChild(icon);

    var label = makeEl('span', 'search-row__label');
    label.textContent = SEARCH_LABEL;
    row.appendChild(label);

    return row;
  }

  /**
   * Build the active search input row (R3). Uses a real <input> so the native
   * text caret blinks (never a hardcoded "|"). The magnifier stays accent and a
   * clear "×" <button> appears; css/styles.css draws the bottom-only divider.
   */
  function buildSearchActiveRow(state, depth) {
    // R3/§5.8: the active search row REPLACES the collapsed "Search" treeitem in
    // the tree, so it must preserve treeitem semantics (role + aria-level) to keep
    // the ARIA tree contract intact. The row carries tabindex="-1"; the inner
    // <input> remains the actual focus/roving target (see focusTargetOf).
    var row = makeEl('div', 'search-row search-row--active', {
      role: 'treeitem',
      'aria-level': String(depth + 1),
      tabindex: '-1'
    });
    setDepth(row, depth);

    var icon = makeEl('span', 'search-row__icon');
    icon.appendChild(decorativeIcon(ICON.search));
    row.appendChild(icon);

    var input = makeEl('input', 'search-row__input', {
      // id/name give the field a stable form-control identity (resolves the
      // "form field should have an id or name attribute" advisory). The value is
      // fixed because exactly one search input exists in the tree at a time.
      id: 'branch-search',
      name: 'branch-search',
      type: 'text',
      placeholder: SEARCH_LABEL,
      'aria-label': 'Search branches',
      autocomplete: 'off',
      spellcheck: 'false',
      tabindex: '0'
    });
    row.appendChild(input);

    var clear = makeEl('button', 'search-row__clear', {
      type: 'button',
      'aria-label': 'Clear search'
    });
    clear.appendChild(decorativeIcon(ICON.close));
    row.appendChild(clear);

    return row;
  }

  /* ========================================================================
   * Structure rendering (R1)
   * ===================================================================== */

  /**
   * Render the folder/repo FOREST from state.tree as a pre-order depth-first
   * traversal, so each node's row is emitted immediately before its descendants
   * — the flat, document-ordered row list that recomputeVisibility() relies on
   * for depth-based collapse handling.
   *
   * state.tree is normally an ARRAY of root nodes (a forest); a single root
   * object is also accepted and wrapped, so this stays robust to either shape.
   *
   * Confirmed Figma forest (screens 48966:64339 / 48966:69650 / 48966:70150),
   * rendered top -> bottom (15 rows):
   *   platform (L0, collapsed)
   *   engineering (L0, expanded)
   *     ├─ backend (L1, collapsed)
   *     ├─ frontend (L1, expanded)
   *     │   ├─ web-app (L2, expanded)
   *     │   │   ├─ customer-portal (repo, L3, expanded, branchHost)
   *     │   │   │     └─ [New branch + Search + branch list inject HERE]
   *     │   │   └─ admin-dash (repo, L3, collapsed)
   *     │   ├─ design-system (L2, collapsed)
   *     │   └─ shared-components (L2, collapsed)
   *     └─ qa (L1, collapsed)
   *   data-science (L0, collapsed)
   *   infrastructure (L0, collapsed)
   *
   * The branch-host repo (customer-portal) is NOT the last node — six sibling
   * rows follow it. renderTreeNode() therefore injects the action + branch rows
   * (via injectBranchRegion) the moment it renders the node carrying
   * branchHost:true, so those siblings render AFTER the branch region and remain
   * persistently visible below the branch list / filter result / empty message
   * (R1). The host's depth is recorded as state.repoDepth and the branch rows
   * attach one level deeper (repoDepth + 1). If no branchHost node exists, the
   * region is attached at the end of the chain as a graceful fallback (below).
   */
  function renderChain(state) {
    var roots = Array.isArray(state.tree) ? state.tree : [state.tree];
    state.repoDepth = 0;          // fallback if the forest contains no repo node
    state.lastRepoDepth = null;   // deepest/last repo depth seen (fallback anchor)
    state.branchHostRendered = false;
    for (var i = 0; i < roots.length; i++) {
      renderTreeNode(state, roots[i], 0);
    }
    // Graceful-degradation fallback: if the seed declared NO branchHost repo, the
    // branch region was never injected during the traversal, so attach it now at
    // the end of the chain (matching the pre-restructure behaviour). With the
    // confirmed seed this never runs — js/data.js marks customer-portal as
    // branchHost, so injectBranchRegion() already fired mid-traversal, placing the
    // action rows + anchor immediately beneath it and BEFORE the persistent
    // sibling rows (R1 — Figma 48966:69650 / 48966:70150).
    if (!state.branchHostRendered) {
      state.repoDepth = (state.lastRepoDepth !== null) ? state.lastRepoDepth : 0;
      state.branchDepth = state.repoDepth + 1;
      injectBranchRegion(state);
    }
  }

  /**
   * Recursively render one folder/repo node and its children (pre-order). A node
   * is EXPANDED unless it explicitly sets `expanded: false`; the flag selects the
   * folder vs folder-open icon and the initial aria-expanded state. Children are
   * always rendered regardless of the node's expanded state — recomputeVisibility()
   * hides the descendants of any collapsed ancestor via their data-depth, so a
   * later expand reveals pre-existing rows without a re-render. In this seed the
   * collapsed nodes (platform, backend, admin-dash, design-system,
   * shared-components, qa, data-science, infrastructure) carry no children, so
   * they reveal nothing but remain persistent rows (Figma 48966:69650 /
   * 48966:70150). The branch-host repo's depth is captured in state.repoDepth so
   * branch/action rows attach beneath it, and injectBranchRegion() fires here the
   * moment the branchHost node is rendered (see below).
   */
  function renderTreeNode(state, node, depth) {
    if (!node) {
      return;
    }
    var isRepo = node.type === 'repo';
    var expanded = node.expanded !== false; // default to expanded
    var row = createTreeRow(state, {
      type: isRepo ? 'repo' : 'folder',
      label: node.name,
      path: node.path,
      depth: depth,
      icon: isRepo ? ICON.repo : (expanded ? ICON.folderOpen : ICON.folder),
      expanded: expanded
    });
    state.branchTree.appendChild(row);

    // Mirror the initial collapse state into state.collapsed so it stays in sync
    // with the DOM (toggleExpand keeps it updated on every subsequent toggle).
    if (node.path) {
      state.collapsed[node.path] = !expanded;
    }

    // Track the depth of the last repo encountered so the malformed-data
    // fallback in renderChain() can still attach the branch region sensibly.
    if (isRepo) {
      state.lastRepoDepth = depth;
    }

    // R1 (Figma 48966:69650 / 48966:70150): the branch region — the "New branch"
    // and "Search" action rows, the paginated/filtered branch list, and the
    // invisible branch-end anchor — attaches directly beneath the SINGLE
    // branch-host repo. Inject it HERE, immediately after the repo's own row and
    // BEFORE recursing into any children or returning to render this repo's
    // siblings, so the persistent sibling rows that follow the host in the forest
    // (admin-dash, design-system, shared-components, qa, data-science,
    // infrastructure) render AFTER the branch region in document order and stay
    // visible below the branch list / filter result / empty message. Keyed off
    // the explicit `branchHost` flag (NOT `type === 'repo'`) so the region never
    // attaches under the sibling admin-dash repo.
    if (node.branchHost) {
      state.repoDepth = depth;          // branches/actions attach at repoDepth + 1
      state.branchDepth = depth + 1;
      injectBranchRegion(state);
      state.branchHostRendered = true;
    }

    var children = node.children;
    if (children && children.length) {
      for (var i = 0; i < children.length; i++) {
        renderTreeNode(state, children[i], depth + 1);
      }
    }
  }

  /**
   * Append the two action rows under the repository, in Figma structural
   * order: "New branch" (plus) FIRST, then the "Search" action row. The search
   * row reference is retained; branch rows are always appended after it.
   */
  function appendChromeRows(state) {
    var depth = state.branchDepth;

    var newBranch = createTreeRow(state, {
      type: 'action',
      label: NEW_BRANCH_LABEL,
      depth: depth,
      icon: ICON.plus
    });
    newBranch.setAttribute('aria-label', NEW_BRANCH_LABEL);
    state.branchTree.appendChild(newBranch);

    var searchRow = buildSearchActionRow(state, depth);
    state.branchTree.appendChild(searchRow);
    state.searchRowEl = searchRow;
  }

  /**
   * Inject the branch region beneath the branch-host repo: the "New branch" +
   * "Search" action rows followed by an INVISIBLE, zero-height, aria-hidden
   * "branch-end" anchor. Everything the branch list owns (paginated rows,
   * filtered rows, the empty state, and the pagination sentinel) is later
   * inserted BETWEEN the Search row and this anchor via insertIntoBranchArea(),
   * so the persistent sibling rows that follow the host in the forest stay
   * visible below the branch region (R1 — Figma 48966:69650 / 48966:70150).
   *
   * The anchor carries NO data-depth and is neither a .tree-row nor a
   * .search-row, so recomputeVisibility() and getNavigableRows() both skip it —
   * it never renders, never receives focus, and never participates in
   * collapse/expand visibility. It exists purely as a stable DOM boundary.
   */
  function injectBranchRegion(state) {
    appendChromeRows(state);
    var anchor = makeEl('div', 'branch-tree__branch-end', { 'aria-hidden': 'true' });
    anchor.style.cssText = 'height:0;width:100%;pointer-events:none;';
    state.branchTree.appendChild(anchor);
    state.branchEndAnchor = anchor;
  }

  /**
   * Insert a node (single row, document fragment, sentinel, or empty state) into
   * the branch region — i.e. immediately BEFORE the branch-end anchor, so it
   * lands between the Search row and the persistent sibling rows that follow.
   * Falls back to appendChild only when no anchor exists (the malformed-data
   * fallback path where injectBranchRegion attached the chrome at the chain end).
   */
  function insertIntoBranchArea(state, node) {
    if (state.branchEndAnchor && state.branchEndAnchor.parentNode === state.branchTree) {
      state.branchTree.insertBefore(node, state.branchEndAnchor);
    } else {
      state.branchTree.appendChild(node);
    }
  }

  /**
   * Remove every node the branch list owns — the rows between the Search row and
   * the branch-end anchor (branch rows, empty state, sentinel). The anchor itself
   * and the persistent sibling rows that follow it are PRESERVED, so a filter /
   * empty-state / unfiltered re-render never disturbs the sibling rows that must
   * stay visible below the branch region (R1 — Figma 48966:69650 / 48966:70150).
   */
  function clearBranchArea(state) {
    var anchor = state.branchEndAnchor;
    var sibling = state.searchRowEl.nextSibling;
    while (sibling && sibling !== anchor) {
      var toRemove = sibling;
      sibling = sibling.nextSibling;
      state.branchTree.removeChild(toRemove);
    }
  }

  /* ========================================================================
   * Pagination (R2) — append-on-scroll, no pager / spinner / scrollbar chrome
   * ===================================================================== */

  /**
   * Render the unfiltered branch list from scratch: reset the rendered count,
   * append the first page, then wire the pagination sentinel/observer.
   */
  function renderUnfilteredBranches(state) {
    teardownPagination(state);
    clearBranchArea(state);
    state.renderedCount = 0;
    appendBranchPage(state, false); // first page — no announcement
    // R7: if a branch is currently selected, ensure enough pages are rendered
    // that the selected row is present in the restored unfiltered list. Its
    // #F2F0FE highlight is the ONLY selection cue, so the row must exist in the
    // DOM even when the selection was made from a filtered result beyond the
    // first page (e.g. branch-16); otherwise the highlight would vanish once the
    // search closes. Runs BEFORE setupPagination so the sentinel is placed after
    // whatever remainder is left (or omitted entirely once all rows are shown).
    ensureSelectedRendered(state);
    setupPagination(state);
    recomputeVisibility(state);
    ensureRovingTarget(state);
  }

  /**
   * Append additional unfiltered pages (silently — no live-region announcement)
   * until the currently selected branch has been rendered, or the branch list
   * is exhausted. No-op when nothing is selected or the selected path is not in
   * the current list. The loop is bounded by the branch count so it can never
   * spin, and stops early if a page adds nothing.
   */
  function ensureSelectedRendered(state) {
    if (!state.selectedPath) {
      return;
    }
    var targetIndex = -1;
    for (var i = 0; i < state.branches.length; i++) {
      if (state.branches[i].path === state.selectedPath) {
        targetIndex = i;
        break;
      }
    }
    if (targetIndex === -1) {
      return; // selected path not in this list — nothing to render through
    }
    var guard = state.branches.length + 1;
    while (state.renderedCount <= targetIndex &&
           state.renderedCount < state.branches.length &&
           guard-- > 0) {
      if (appendBranchPage(state, false) === 0) {
        break;
      }
    }
  }

  /**
   * Append the next page of unfiltered branches (inserted before the sentinel
   * so the sentinel stays last). Announces the appended count when doAnnounce
   * is true (i.e. for scroll-triggered pages, not the initial render).
   */
  function appendBranchPage(state, doAnnounce) {
    var start = state.renderedCount;
    var total = state.branches.length;
    if (start >= total) {
      return 0;
    }
    var end = Math.min(start + state.pageSize, total);
    var fragment = document.createDocumentFragment();
    for (var i = start; i < end; i++) {
      fragment.appendChild(createBranchRow(state, state.branches[i]));
    }
    if (state.sentinel && state.sentinel.parentNode === state.branchTree) {
      state.branchTree.insertBefore(fragment, state.sentinel);
    } else {
      insertIntoBranchArea(state, fragment); // before the branch-end anchor
    }

    var added = end - start;
    state.renderedCount = end;
    recomputeVisibility(state);

    if (doAnnounce && added > 0) {
      announce(state, 'Loaded ' + added + ' more branch' + (added === 1 ? '' : 'es'));
    }
    if (state.renderedCount >= total) {
      teardownPagination(state); // all rendered — no "end" chrome, just stop
    }
    return added;
  }

  /**
   * Set up scroll-based pagination via an invisible bottom sentinel observed by
   * an IntersectionObserver (root = the scroll container). Falls back to a
   * native scroll listener where IntersectionObserver is unavailable. The
   * sentinel is a zero-content, aria-hidden node — it renders nothing visible.
   */
  function setupPagination(state) {
    if (state.renderedCount >= state.branches.length) {
      return; // everything already rendered
    }
    var sentinel = makeEl('div', 'branch-tree__sentinel', { 'aria-hidden': 'true' });
    sentinel.style.cssText = 'height:1px;width:100%;flex:0 0 auto;pointer-events:none;';
    // Tag with branch depth so it hides alongside branches when the repo is
    // collapsed (keeps recomputeVisibility() consistent).
    setDepth(sentinel, state.branchDepth);
    // Insert BEFORE the branch-end anchor so the sentinel stays inside the branch
    // region (after the last branch row, before the persistent sibling rows).
    // This keeps scroll pagination triggering on the branch list — not on the
    // trailing siblings — exactly as before the restructure.
    insertIntoBranchArea(state, sentinel);
    state.sentinel = sentinel;

    if (typeof window.IntersectionObserver === 'function') {
      state.observer = new window.IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          if (entries[i].isIntersecting) {
            appendBranchPage(state, true);
            break;
          }
        }
      }, { root: state.branchTree, rootMargin: '0px', threshold: 0 });
      state.observer.observe(sentinel);
    } else {
      state.scrollHandler = function () {
        var el = state.branchTree;
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - SCROLL_FALLBACK_THRESHOLD) {
          appendBranchPage(state, true);
        }
      };
      state.branchTree.addEventListener('scroll', state.scrollHandler);
    }
  }

  /** Tear down pagination: disconnect observer / remove listener / drop sentinel. */
  function teardownPagination(state) {
    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }
    if (state.scrollHandler) {
      state.branchTree.removeEventListener('scroll', state.scrollHandler);
      state.scrollHandler = null;
    }
    if (state.sentinel && state.sentinel.parentNode) {
      state.sentinel.parentNode.removeChild(state.sentinel);
    }
    state.sentinel = null;
  }

  /* ========================================================================
   * Filtering (R4) + empty state (R5)
   * ===================================================================== */

  /**
   * Render a fully-filtered branch list (no pagination — the filtered result is
   * shown in full, per agent_prompt §5.4). Selection highlight is re-applied by
   * createBranchRow via state.selectedPath.
   */
  function renderFilteredBranches(state, list) {
    teardownPagination(state);
    clearBranchArea(state);
    var fragment = document.createDocumentFragment();
    for (var i = 0; i < list.length; i++) {
      fragment.appendChild(createBranchRow(state, list[i]));
    }
    insertIntoBranchArea(state, fragment); // before the branch-end anchor
    recomputeVisibility(state);
    ensureRovingTarget(state);
  }

  /** Render the text-only empty state (R5). No icon, no illustration. */
  function renderEmptyState(state) {
    teardownPagination(state);
    clearBranchArea(state);
    var empty = makeEl('div', 'empty-state');
    setDepth(empty, state.branchDepth);
    empty.textContent = EMPTY_MESSAGE;
    insertIntoBranchArea(state, empty); // before the branch-end anchor
    recomputeVisibility(state);
    ensureRovingTarget(state);
  }

  /**
   * Debounced-entry filter (R4). Trims + lower-cases the query, then performs a
   * case-insensitive substring match against branch names. Empty query -> the
   * unfiltered paginated list. No matches -> the empty state. Matches -> the
   * filtered list. Result counts are announced to the live region.
   */
  function applyFilter(state, rawValue) {
    var query = (rawValue || '').trim().toLowerCase();
    state.query = query;

    if (query === '') {
      renderUnfilteredBranches(state);
      return;
    }

    var matches = [];
    for (var i = 0; i < state.branches.length; i++) {
      if (state.branches[i].name.toLowerCase().indexOf(query) !== -1) {
        matches.push(state.branches[i]);
      }
    }

    if (matches.length === 0) {
      renderEmptyState(state);
      announce(state, EMPTY_MESSAGE);
    } else {
      renderFilteredBranches(state, matches);
      announce(state, matches.length + (matches.length === 1 ? ' branch found' : ' branches found'));
    }
  }

  /* ========================================================================
   * Search activation / dismissal (R3 / R6)
   * ===================================================================== */

  /** Transform the collapsed "Search" action row into a focused input (R3). */
  function activateSearch(state) {
    if (state.searchActive) {
      return;
    }
    var activeRow = buildSearchActiveRow(state, state.branchDepth);
    state.branchTree.replaceChild(activeRow, state.searchRowEl);
    state.searchRowEl = activeRow;
    state.searchActive = true;

    var input = activeRow.querySelector('.search-row__input');
    input.addEventListener('input', function () {
      if (state.debounceTimer) {
        clearTimeout(state.debounceTimer);
      }
      state.debounceTimer = setTimeout(function () {
        state.debounceTimer = null;
        applyFilter(state, input.value);
      }, state.debounceMs);
    });

    focusRow(state, activeRow); // moves focus into the input (native caret)
  }

  /**
   * Close the search field (R6): revert to the "Search" action row, clear the
   * query and any pending debounce, and restore the unfiltered paginated list.
   * The current selection (state.selectedPath) is preserved.
   */
  function dismissSearch(state, focusIt) {
    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer);
      state.debounceTimer = null;
    }
    state.query = '';
    state.searchActive = false;

    if (state.searchRowEl.classList.contains('search-row--active')) {
      var actionRow = buildSearchActionRow(state, state.branchDepth);
      state.branchTree.replaceChild(actionRow, state.searchRowEl);
      state.searchRowEl = actionRow;
    }

    renderUnfilteredBranches(state);

    if (focusIt) {
      focusRow(state, state.searchRowEl);
    } else {
      ensureRovingTarget(state);
    }
  }

  /* ========================================================================
   * Selection + confirmation bar (R7)
   * ===================================================================== */

  /**
   * Select a branch (R7): record the path, apply the #F2F0FE highlight (the
   * only selection cue), close any active search back to the action row, and
   * render/update the pinned confirmation bar with the branch's full path.
   */
  function selectBranch(state, path, name) {
    if (!path) {
      return;
    }
    state.selectedPath = path;

    if (state.searchActive) {
      // Selecting also closes the search and restores the unfiltered list
      // (agent_prompt §5.7). The restored rows re-apply the highlight via
      // createBranchRow (state.selectedPath). Closing the search removes the
      // focused input from the DOM, so move focus to the selected row when it
      // is visible in the restored list, otherwise to the search action row.
      dismissSearch(state, false);
      var restoredRow = state.branchTree.querySelector('.tree-row--selected');
      if (restoredRow && restoredRow.style.display !== 'none') {
        focusRow(state, restoredRow);
      } else if (state.searchRowEl) {
        focusRow(state, state.searchRowEl);
      }
    } else {
      applySelectionHighlight(state);
    }

    renderConfirmationBar(state, path);
    state.container.classList.add('branch-selector--confirmed');
    recomputeVisibility(state);
    announce(state, 'Selected branch ' + (name || path));
  }

  /** Apply the selected highlight to whichever rendered branch row matches. */
  function applySelectionHighlight(state) {
    var rows = state.branchTree.querySelectorAll('.tree-row--branch');
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var isSelected = row.getAttribute('data-path') === state.selectedPath;
      row.classList.toggle('tree-row--selected', isSelected);
      row.setAttribute('aria-selected', isSelected ? 'true' : 'false');
    }
  }

  /**
   * Create (once) and populate the pinned confirmation bar (R7): git-branch
   * icon + full-path text + accent check-circle. CSS pins it to the panel
   * bottom with a top-only border and 0/0/12/12 radius.
   */
  function renderConfirmationBar(state, path) {
    if (!state.confirmationBar) {
      var bar = makeEl('div', 'confirmation-bar');

      var iconCell = makeEl('span', 'confirmation-bar__icon');
      iconCell.appendChild(decorativeIcon(ICON.gitBranch));
      bar.appendChild(iconCell);

      var pathEl = makeEl('span', 'confirmation-bar__path');
      bar.appendChild(pathEl);

      var checkCell = makeEl('span', 'confirmation-bar__check');
      checkCell.appendChild(decorativeIcon(ICON.checkCircle));
      bar.appendChild(checkCell);

      state.container.appendChild(bar);
      state.confirmationBar = bar;
      state.confirmationBarPath = pathEl;
    }
    state.confirmationBarPath.textContent = path;
  }

  /* ========================================================================
   * Collapse / expand (R1 tree behaviour)
   * ===================================================================== */

  /** Toggle a folder/repo row's expanded state and re-evaluate row visibility. */
  function toggleExpand(state, row) {
    var path = row.getAttribute('data-path');
    var isExpanded = row.getAttribute('aria-expanded') === 'true';
    var willExpand = !isExpanded;

    row.setAttribute('aria-expanded', willExpand ? 'true' : 'false');
    row.classList.toggle('tree-row--expanded', willExpand);
    if (path) {
      state.collapsed[path] = !willExpand;
    }

    // Swap the folder glyph (folders only; the repo keeps its repo icon —
    // only the chevron rotates for the repo).
    if (row.classList.contains('tree-row--folder')) {
      var img = row.querySelector('.tree-row__icon img');
      if (img) {
        img.setAttribute('src', ICON_BASE + (willExpand ? ICON.folderOpen : ICON.folder));
      }
    }

    recomputeVisibility(state);
    ensureRovingTarget(state);
  }

  /**
   * Recompute per-row visibility from the ordered row list. Any row deeper than
   * the nearest collapsed ancestor is hidden. Uses inline display (NOT the
   * [hidden] attribute, which `.tree-row { display:flex }` would out-specify).
   */
  function recomputeVisibility(state) {
    var rows = state.branchTree.querySelectorAll(
      '.tree-row, .search-row, .empty-state, .branch-tree__sentinel'
    );
    var hideDeeperThan = Infinity;
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var depthAttr = row.getAttribute('data-depth');
      if (depthAttr === null) {
        continue;
      }
      var depth = parseInt(depthAttr, 10);
      // The pagination sentinel is a permanent, empty aria-hidden node; only
      // its display is toggled (its aria-hidden must never be removed).
      var isSentinel = row.classList.contains('branch-tree__sentinel');
      if (depth > hideDeeperThan) {
        row.style.display = 'none';
        if (!isSentinel) {
          row.setAttribute('aria-hidden', 'true');
        }
      } else {
        row.style.display = '';
        if (!isSentinel) {
          row.removeAttribute('aria-hidden');
        }
        hideDeeperThan = Infinity;
        if (row.getAttribute('aria-expanded') === 'false') {
          hideDeeperThan = depth; // hide this collapsed group's descendants
        }
      }
    }
  }

  /* ========================================================================
   * Row activation dispatch (click / keyboard)
   * ===================================================================== */

  /** Activate a focused/clicked row according to its type. */
  function activateRow(state, row) {
    if (row.classList.contains('search-row')) {
      if (row.classList.contains('search-row--action')) {
        activateSearch(state); // R3
      }
      return;
    }
    if (row.classList.contains('tree-row--branch')) {
      selectBranch(state, row.getAttribute('data-path'), row.getAttribute('data-name')); // R7
      return;
    }
    if (row.classList.contains('tree-row--folder') || row.classList.contains('tree-row--repo')) {
      toggleExpand(state, row);
      return;
    }
    // tree-row--action ("New branch"): benign no-op (no design behaviour).
  }

  /* ========================================================================
   * Keyboard navigation + roving tabindex (§5.8)
   * ===================================================================== */

  /** Ordered list of currently-visible navigable rows (tree rows + search row). */
  function getNavigableRows(state) {
    var all = state.branchTree.querySelectorAll('.tree-row, .search-row');
    var out = [];
    for (var i = 0; i < all.length; i++) {
      if (all[i].style.display !== 'none') {
        out.push(all[i]);
      }
    }
    return out;
  }

  /** The element that should receive focus for a given row. */
  function focusTargetOf(row) {
    if (row.classList.contains('search-row--active')) {
      return row.querySelector('.search-row__input') || row;
    }
    return row;
  }

  /** Make exactly one row (its focus target) the tab stop; others get -1. */
  function setRovingActive(state, row) {
    var navs = state.branchTree.querySelectorAll('.tree-row, .search-row');
    for (var i = 0; i < navs.length; i++) {
      navs[i].setAttribute('tabindex', '-1');
      var input = navs[i].querySelector('.search-row__input');
      if (input) {
        input.setAttribute('tabindex', '-1');
      }
    }
    var target = focusTargetOf(row);
    target.setAttribute('tabindex', '0');
    state.activeRow = row;
  }

  /** Set roving active AND move focus to the row's focus target. */
  function focusRow(state, row) {
    setRovingActive(state, row);
    var target = focusTargetOf(row);
    if (target && typeof target.focus === 'function') {
      target.focus();
    }
  }

  /** Guarantee a single valid tab stop exists after any structural re-render. */
  function ensureRovingTarget(state) {
    var navs = getNavigableRows(state);
    if (!navs.length) {
      return;
    }
    for (var i = 0; i < navs.length; i++) {
      if (navs[i].getAttribute('tabindex') === '0') {
        return;
      }
      var input = navs[i].querySelector('.search-row__input');
      if (input && input.getAttribute('tabindex') === '0') {
        return;
      }
    }
    setRovingActive(state, navs[0]);
  }

  /** Move focus by one visible row in the given direction (+1 down / -1 up). */
  function moveFocus(state, direction) {
    var rows = getNavigableRows(state);
    if (!rows.length) {
      return;
    }
    var active = document.activeElement;
    var currentRow = (active && active.closest) ? active.closest('.tree-row, .search-row') : null;
    var index = currentRow ? rows.indexOf(currentRow) : -1;
    if (index === -1 && state.activeRow) {
      index = rows.indexOf(state.activeRow);
    }
    if (index === -1) {
      index = 0;
    }
    var nextIndex = index + direction;
    if (nextIndex < 0) {
      nextIndex = 0;
    }
    if (nextIndex > rows.length - 1) {
      nextIndex = rows.length - 1;
    }
    focusRow(state, rows[nextIndex]);
  }

  /** Move focus to the first or last visible row. */
  function moveFocusEdge(state, edge) {
    var rows = getNavigableRows(state);
    if (!rows.length) {
      return;
    }
    focusRow(state, edge === 'first' ? rows[0] : rows[rows.length - 1]);
  }

  /**
   * The first visible child row of an expanded folder/repo, or null. In the
   * pre-order DFS row list the first child of a node is the immediately
   * following navigable row whose depth is exactly one greater. Used by
   * ArrowRight on an already-open node (ARIA tree pattern).
   */
  function firstChildRow(state, row) {
    var rows = getNavigableRows(state);
    var idx = rows.indexOf(row);
    if (idx === -1) {
      return null;
    }
    var depthAttr = row.getAttribute('data-depth');
    if (depthAttr === null) {
      return null;
    }
    var depth = parseInt(depthAttr, 10);
    var next = rows[idx + 1];
    if (!next) {
      return null;
    }
    var nextDepthAttr = next.getAttribute('data-depth');
    if (nextDepthAttr !== null && parseInt(nextDepthAttr, 10) === depth + 1) {
      return next;
    }
    return null;
  }

  /**
   * The parent row of a given row, or null for a root row. The parent is the
   * nearest preceding visible row at a shallower depth (correct for a properly
   * nested pre-order tree). Used by ArrowLeft on a leaf/closed node (ARIA tree
   * pattern).
   */
  function parentRow(state, row) {
    var rows = getNavigableRows(state);
    var idx = rows.indexOf(row);
    if (idx === -1) {
      return null;
    }
    var depthAttr = row.getAttribute('data-depth');
    if (depthAttr === null) {
      return null;
    }
    var depth = parseInt(depthAttr, 10);
    for (var i = idx - 1; i >= 0; i--) {
      var dAttr = rows[i].getAttribute('data-depth');
      if (dAttr === null) {
        continue;
      }
      if (parseInt(dAttr, 10) < depth) {
        return rows[i];
      }
    }
    return null;
  }

  /** Keydown handler (delegated on the tree). Implements the ARIA tree pattern. */
  function onKeydown(state, event) {
    var target = event.target;
    var key = event.key;

    // While typing in the active search input, most keys keep native behaviour
    // (caret movement, text editing). Three keys are intercepted for the ARIA
    // tree pattern (§5.8): Escape closes the search (R6); ArrowDown/ArrowUp move
    // roving focus OUT of the input and INTO the (filtered) branch rows so
    // keyboard users can reach and select results after typing (R4). All other
    // keys fall through to native single-line input editing.
    if (target && target.classList && target.classList.contains('search-row__input')) {
      if (key === 'Escape') {
        event.preventDefault();
        dismissSearch(state, true);
        return;
      }
      if (key === 'ArrowDown' || key === 'ArrowUp') {
        event.preventDefault();
        // Flush any pending debounced filter first so navigation targets the
        // CURRENT results rather than a stale render. The active search row (and
        // its input) is preserved across the re-render, so focus stays valid.
        if (state.debounceTimer) {
          clearTimeout(state.debounceTimer);
          state.debounceTimer = null;
          applyFilter(state, target.value);
        }
        moveFocus(state, key === 'ArrowDown' ? 1 : -1);
        return;
      }
      return;
    }

    var row = (target && target.closest) ? target.closest('.tree-row, .search-row') : null;
    if (!row || !state.branchTree.contains(row)) {
      return;
    }

    if (key === 'ArrowDown') {
      event.preventDefault();
      moveFocus(state, 1);
    } else if (key === 'ArrowUp') {
      event.preventDefault();
      moveFocus(state, -1);
    } else if (key === 'Home') {
      event.preventDefault();
      moveFocusEdge(state, 'first');
    } else if (key === 'End') {
      event.preventDefault();
      moveFocusEdge(state, 'last');
    } else if (key === 'ArrowRight') {
      // ARIA tree pattern: on a CLOSED expandable node, open it (focus stays);
      // on an already-OPEN node, move focus to its first child; on a leaf
      // (branch / action / search rows carry no aria-expanded), do nothing.
      var expandedR = row.getAttribute('aria-expanded');
      if (expandedR !== null) {
        event.preventDefault();
        if (expandedR === 'false') {
          toggleExpand(state, row);
        } else {
          var child = firstChildRow(state, row);
          if (child) {
            focusRow(state, child);
          }
        }
      }
    } else if (key === 'ArrowLeft') {
      // ARIA tree pattern: on an OPEN expandable node, close it (focus stays);
      // otherwise (closed node or leaf) move focus to the parent node. A root
      // leaf/closed node has no parent, so focus does not move.
      var expandedL = row.getAttribute('aria-expanded');
      if (expandedL === 'true') {
        event.preventDefault();
        toggleExpand(state, row);
      } else {
        var parent = parentRow(state, row);
        if (parent) {
          event.preventDefault();
          focusRow(state, parent);
        }
      }
    } else if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
      event.preventDefault();
      activateRow(state, row);
    } else if (key === 'Escape') {
      if (state.searchActive) {
        event.preventDefault();
        dismissSearch(state, true);
      }
    }
  }

  /** Click handler (delegated on the tree). */
  function onClick(state, event) {
    var target = event.target;

    // Clear "×" closes the search (R6).
    if (target && target.closest) {
      var clearBtn = target.closest('.search-row__clear');
      if (clearBtn && state.branchTree.contains(clearBtn)) {
        dismissSearch(state, true);
        return;
      }
    }

    var row = (target && target.closest) ? target.closest('.tree-row, .search-row') : null;
    if (!row || !state.branchTree.contains(row)) {
      return;
    }
    // Clicks within the active input do not trigger a row action.
    if (row.classList.contains('search-row--active')) {
      return;
    }
    setRovingActive(state, row);
    activateRow(state, row);
  }

  /* ========================================================================
   * Public entry point
   * ===================================================================== */

  /**
   * Sanitize a raw branches array into a fresh array of plain { name, path }
   * objects, dropping any entry that is missing a string name or string path.
   * This keeps downstream rendering/filtering (which call .toLowerCase() and
   * render label textContent) safe against malformed seed data without throwing.
   */
  function normalizeBranches(rawBranches) {
    var out = [];
    for (var i = 0; i < rawBranches.length; i++) {
      var b = rawBranches[i];
      if (b && typeof b.name === 'string' && typeof b.path === 'string') {
        out.push({ name: b.name, path: b.path });
      }
    }
    return out;
  }

  /**
   * Initialise the branch selector inside `container`.
   *   container : the #branch-selector element (required).
   *   data      : { tree, branches } — defaults to window.BranchData.
   *   options   : optional { pageSize, debounceMs }.
   * Returns a small handle ({ getSelectedPath, destroy }) or null on no-op.
   */
  function init(container, data, options) {
    if (!container) {
      return null;
    }
    data = data || (typeof window !== 'undefined' ? window.BranchData : null);
    // Require a renderable tree — a single root node OR a non-empty forest array
    // (renderChain normalizes either shape) — and a non-empty ARRAY of branches.
    // Array.isArray guards against a non-array `branches` (object/string/etc.)
    // before any array operation below (robustness / graceful invalid-data).
    if (!data || !data.tree ||
        (Array.isArray(data.tree) && !data.tree.length) ||
        !Array.isArray(data.branches) || !data.branches.length) {
      return null; // nothing valid to render — leave the container untouched
    }

    // Sanitize branch entries up front: drop anything without a string name and
    // string path. Done BEFORE any teardown/DOM change so an invalid re-init
    // never disturbs a previously-mounted valid instance.
    var normalizedBranches = normalizeBranches(data.branches);
    if (!normalizedBranches.length) {
      return null; // no usable branches — safe no-op
    }

    options = options || {};

    // Idempotent re-init: fully tear down any PRIOR instance mounted in this
    // container BEFORE touching its DOM. The previous instance's
    // IntersectionObserver, scroll handler, debounce timer and delegated
    // click/keydown listeners live in its closure and would otherwise leak
    // across repeated init() calls; the cleanup handle is parked on the
    // container by the prior init (see destroy() below).
    if (typeof container.__branchSelectorDestroy === 'function') {
      try {
        container.__branchSelectorDestroy();
      } catch (err) {
        // Never let a prior teardown abort a fresh init.
      }
      container.__branchSelectorDestroy = null;
    }

    // Drop any prior render but keep an existing live region.
    var priorTree = container.querySelector('.branch-tree');
    if (priorTree) {
      container.removeChild(priorTree);
    }
    var priorBar = container.querySelector('.confirmation-bar');
    if (priorBar) {
      container.removeChild(priorBar);
    }
    container.classList.remove('branch-selector--confirmed');

    var pageSize = (typeof options.pageSize === 'number' && options.pageSize > 0)
      ? Math.floor(options.pageSize)
      : DEFAULT_PAGE_SIZE;
    var debounceMs = (typeof options.debounceMs === 'number' && options.debounceMs >= 0)
      ? options.debounceMs
      : DEFAULT_DEBOUNCE_MS;

    var state = {
      container: container,
      tree: data.tree,
      branches: normalizedBranches, // sanitized, fresh {name, path} array
      pageSize: pageSize,
      debounceMs: debounceMs,
      branchTree: null,
      liveRegion: null,
      searchRowEl: null,
      searchActive: false,
      query: '',
      renderedCount: 0,
      selectedPath: null,
      collapsed: {},
      confirmationBar: null,
      confirmationBarPath: null,
      repoDepth: 0,
      branchDepth: 4,
      lastRepoDepth: null,       // deepest/last repo depth seen (fallback anchor)
      branchHostRendered: false, // set once the branch-host repo injects the region
      branchEndAnchor: null,     // invisible DOM boundary after the branch region
      observer: null,
      scrollHandler: null,
      sentinel: null,
      debounceTimer: null,
      activeRow: null,
      onClickHandler: null,
      onKeydownHandler: null
    };

    state.liveRegion = ensureLiveRegion(container);

    var tree = makeEl('div', 'branch-tree', {
      role: 'tree',
      'aria-label': 'Repository branches',
      tabindex: '-1'
    });
    state.branchTree = tree;
    container.appendChild(tree);

    // renderChain renders the folder/repo forest AND injects the branch region
    // (New branch + Search action rows + the invisible branch-end anchor) directly
    // beneath the branch-host repo mid-traversal, so the persistent sibling rows
    // that follow the host render AFTER the branch region (R1 — Figma 48966:69650
    // / 48966:70150). renderUnfilteredBranches then inserts the initial paginated
    // branch list BEFORE the anchor.
    renderChain(state);              // R1 — forest + injected branch region
    renderUnfilteredBranches(state); // R1/R2 — initial paginated branch list

    // Delegated interaction handlers. Keep NAMED references on `state` so
    // destroy() can detach them (anonymous listeners can never be removed).
    state.onClickHandler = function (event) { onClick(state, event); };
    state.onKeydownHandler = function (event) { onKeydown(state, event); };
    tree.addEventListener('click', state.onClickHandler);
    tree.addEventListener('keydown', state.onKeydownHandler);

    // Instance cleanup: disconnect the observer / remove the scroll listener /
    // drop the sentinel (teardownPagination), clear any pending debounce timer,
    // and detach the delegated listeners. Parked on the container so a later
    // init() — or an explicit consumer call — can fully tear this instance down,
    // preventing observer/timer/listener leaks across repeated initialization.
    function destroy() {
      teardownPagination(state);
      if (state.debounceTimer) {
        clearTimeout(state.debounceTimer);
        state.debounceTimer = null;
      }
      if (state.branchTree) {
        state.branchTree.removeEventListener('click', state.onClickHandler);
        state.branchTree.removeEventListener('keydown', state.onKeydownHandler);
      }
      if (container.__branchSelectorDestroy === destroy) {
        container.__branchSelectorDestroy = null;
      }
    }
    container.__branchSelectorDestroy = destroy;

    return {
      getSelectedPath: function () {
        return state.selectedPath;
      },
      destroy: destroy
    };
  }

  // Expose the single global namespace consumed by js/app.js.
  window.BranchSelector = { init: init };
})();
