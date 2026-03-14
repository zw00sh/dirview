// @ts-check
// State management for dirview webviews.
// Exposes window._DirviewState — loaded after shared-utils.js.
(function () {
  'use strict';

  const { compactedNode, compactedPath, hasExpandedDescendant } = window._DirviewUtils;

  // Create a fresh webview state object with default values.
  function createState() {
    const state = {
      activeFilters: new Set(),
      expanded: new Map(),
      truncationExpanded: new Set(),
      emptyGroupExpanded: new Set(),
      truncateThreshold: 4,
      currentSortMode: 'files',
      lastRoots: null,
      lastAutoRescanEnabled: true,
      /** @type {Function|null} */
      render: null,
      /** @type {string} */
      currentRootName: '',
      /** Workspace folder name sent by tabProvider. Empty in sidebar (falls back to currentRootName). */
      workspaceFolderName: '',
      // Search state — local to each webview instance, not synced with host.
      /** @type {Map<string, Array>|null} Absolute path → match array. null = no active search. */
      searchResults: null,
      searchActive: false,
      searchTruncated: false,
      searchFileCount: 0,
      searchMatchCount: 0,
      /** @type {Function|null} Called by message handler to refresh search bar status text. */
      searchBar_updateStatus: null,
    };
    state.scanBar = null;           // Set by main.js / tab.js after creation
    state._rerenderPending = false; // Deduplication flag: collapse rapid calls into one render
    state._searchRenderTimer = null; // Throttle: coalesces batch/highlight renders during active search

    // Convenience shorthand: re-renders with the current roots/flags without re-passing them explicitly.
    // Double rAF: the first frame paints the scan bar as visible; the second
    // frame runs the heavy DOM render.  Without this, show(true) and show(false)
    // both execute before the browser paints, so the bar is never seen.
    state.rerender = () => {
      if (state._rerenderPending) { return; }
      state._rerenderPending = true;
      if (state.scanBar) { state.scanBar.show(true); }
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          state._rerenderPending = false;
          state.render(state.lastRoots, state.lastAutoRescanEnabled, state.currentSortMode);
          if (state.scanBar && !state.searchActive) { state.scanBar.show(false); }
        });
      });
    };
    return state;
  }

  function walkExpand(state, nodes) {
    for (const n of nodes) {
      state.expanded.set(n.path, true);
      walkExpand(state, n.children || []);
    }
  }

  function walkCollapse(state, nodes) {
    for (const n of nodes) {
      state.expanded.set(n.path, false);
      walkCollapse(state, n.children || []);
    }
  }

  // Tiered expand for the toolbar/sidebar "expand all" button, mirroring per-dir expand button behaviour.
  // Workspace folder nodes (roots) are always-visible containers; their children are the top-level
  // expandable items. The tiers mirror the per-dir button with the virtual workspace root as target:
  // Tier 1: any top-level item not expanded → expand all top-level items
  // Tier 2: all top-level items expanded → recursively expand entire subtree
  function tieredExpandAll(state, roots) {
    const topLevel = roots.flatMap(r => r.children || []);
    if (topLevel.length === 0) { return; }

    const allTopExpanded = topLevel.every(node => {
      const cn = compactedNode(node);
      return cn.children.length === 0 || state.expanded.get(cn.path);
    });

    if (!allTopExpanded) {
      // Tier 1: expand all top-level items that have children
      for (const node of topLevel) {
        if (compactedNode(node).children.length > 0) {
          state.expanded.set(compactedPath(node), true);
        }
      }
      return;
    }

    // Tier 2: recursively expand entire subtree
    walkExpand(state, topLevel);
  }

  // 3-tier collapse for the toolbar/sidebar "collapse all" button, mirroring per-dir collapse button behaviour.
  // Tier 1: any top-level item has expanded descendants → collapse those (keep top-level items open)
  // Tier 2: only top-level items expanded (no deeper descendants) → collapse all top-level items
  // Tier 3: nothing is expanded → no-op
  function tieredCollapseAll(state, roots) {
    const topLevel = roots.flatMap(r => r.children || []);
    if (topLevel.length === 0) { return; }

    const anyTopExpanded = topLevel.some(node => state.expanded.get(compactedPath(node)));
    if (!anyTopExpanded) {
      // Tier 3: nothing to collapse
      return;
    }

    const anyDeeperExpanded = topLevel.some(node => {
      const cn = compactedNode(node);
      return hasExpandedDescendant(state, cn);
    });

    if (anyDeeperExpanded) {
      // Tier 1: collapse everything inside top-level items, keep top-level itself open
      for (const node of topLevel) {
        const cn = compactedNode(node);
        walkCollapse(state, cn.children || []);
      }
    } else {
      // Tier 2: collapse all top-level items
      for (const node of topLevel) {
        state.expanded.set(compactedPath(node), false);
      }
    }
  }

  window._DirviewState = {
    createState, walkExpand, walkCollapse, tieredExpandAll, tieredCollapseAll,
  };
})();
