// State management for dirview webviews.

import type { DirNode, WebviewState, SortMode } from './types';
import { compactedNode, compactedPath, hasExpandedDescendant } from './utils';

// Create a fresh webview state object with default values.
export function createState(): WebviewState {
  const state: WebviewState = {
    activeFilters: new Set(),
    expanded: new Map(),
    truncationExpanded: new Set(),
    emptyGroupExpanded: new Set(),
    truncateThreshold: 4,
    currentSortMode: 'files',
    lastRoots: null,
    lastAutoRescanEnabled: true,
    render: null,
    currentRootName: '',
    workspaceFolderName: '',
    dirPath: '',
    // Search state — local to each webview instance, not synced with host.
    searchResults: null,
    matchesCollapsed: new Set(),
    searchActive: false,
    searchTruncated: false,
    searchFileCount: 0,
    searchMatchCount: 0,
    fileFilterFn: null,
    searchAncestorPaths: null,
    searchBar_updateStatus: null,
    // Internal
    scanBar: null,
    _rerenderPending: false,
    _searchRenderTimer: null,
    // Placeholder — assigned below
    rerender: null!,
  };

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
        if (state.render) {
          state.render(state.lastRoots!, state.lastAutoRescanEnabled, state.currentSortMode);
        }
        if (state.scanBar && !state.searchActive) { state.scanBar.show(false); }
      });
    });
  };
  return state;
}

export function walkExpand(state: WebviewState, nodes: DirNode[]): void {
  for (const n of nodes) {
    state.expanded.set(n.path, true);
    walkExpand(state, n.children || []);
  }
}

export function walkCollapse(state: WebviewState, nodes: DirNode[]): void {
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
export function tieredExpandAll(state: WebviewState, roots: DirNode[]): void {
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
  // Also expand all file match groups when search is active.
  state.matchesCollapsed.clear();
}

// 3-tier collapse for the toolbar/sidebar "collapse all" button, mirroring per-dir collapse button behaviour.
// Tier 1: any top-level item has expanded descendants → collapse those (keep top-level items open)
// Tier 2: only top-level items expanded (no deeper descendants) → collapse all top-level items
// Tier 3: nothing is expanded → no-op
export function tieredCollapseAll(state: WebviewState, roots: DirNode[]): void {
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
  // Collapse all file match groups when search is active.
  if (state.searchResults) {
    for (const path of state.searchResults.keys()) {
      state.matchesCollapsed.add(path);
    }
  }
}
