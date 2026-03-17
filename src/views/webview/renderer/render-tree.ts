// Tree rendering functions: renderRoots, renderTree.

import { sortDirs, sortFiles, groupEmptyDirs, computeMaxMetric, emptyState } from '../utils';
import { filterTree } from '../filter';
import { patchTreeChildren } from './dom-patch';
import { h } from '../h';

import type { DirNode, WebviewState, Renderer } from '../types';

// Renders the root-level tree rows into treeEl. Roots' children appear at depth 0.
// For multi-root workspaces, a header row with the folder name appears above each root's children.
export function renderRoots(
  renderer: Renderer,
  state: WebviewState,
  treeEl: HTMLElement,
  maxMetric: number,
  clientWidth: number,
  isFiltered: boolean,
  opts?: { cssClass?: string },
): void {
  const roots = state.lastRoots!;

  for (const r of roots) {
    state.currentRootName = r.name;
    if (roots.length > 1) {
      treeEl.appendChild(h('li', { className: 'workspace-root-header', textContent: r.name }));
    }
    const sortedChildren = sortDirs(r.children, state.currentSortMode);
    const sortedFiles = sortFiles(r.files || []);

    // Empty dir grouping — only when no filter is active (filtered trees already pruned)
    if (!isFiltered && sortedChildren.length > 0) {
      for (const group of groupEmptyDirs(sortedChildren)) {
        if (group.type === 'emptyGroup') {
          if (state.emptyGroupExpanded.has(group.nodes[0].path)) {
            for (const n of group.nodes) { treeEl.appendChild(renderer.renderDirNode(n, 0, maxMetric, [], clientWidth)); }
          } else {
            treeEl.appendChild(renderer.renderEmptyGroupNode(group.nodes, 0, maxMetric, []));
          }
        } else {
          treeEl.appendChild(renderer.renderDirNode(group.node, 0, maxMetric, [], clientWidth));
        }
      }
    } else {
      for (const child of sortedChildren) {
        treeEl.appendChild(renderer.renderDirNode(child, 0, maxMetric, [], clientWidth));
      }
    }
    // File truncation — disabled when search/filter is active.
    // Also disabled when the root has no directory children (single-dir root).
    const isSingleDirRoot = sortedChildren.length === 0;
    const shouldTruncate = !isFiltered && !isSingleDirRoot && state.truncateThreshold > 0 && sortedFiles.length > state.truncateThreshold && !state.truncationExpanded.has(r.path);
    const shownFiles = shouldTruncate ? sortedFiles.slice(0, state.truncateThreshold) : sortedFiles;
    const hiddenFiles = shouldTruncate ? sortedFiles.slice(state.truncateThreshold) : [];
    for (const file of shownFiles) {
      treeEl.appendChild(renderer.renderFileNode(file, 0, []));
      renderer.renderFileMatches(treeEl, file, 1, []);
    }
    if (hiddenFiles.length > 0) {
      treeEl.appendChild(renderer.renderTruncatedRow(hiddenFiles, 0, [], r.path, maxMetric, clientWidth));
    }
  }
}

/**
 * Renders the tree <ul> into rootEl. If rootEl already contains a <ul class="tree">
 * from a previous render, patches it incrementally (preserves scroll, avoids flicker).
 * Otherwise creates and appends a new tree element (first render or after loading/error).
 */
export function renderTree(
  state: WebviewState,
  renderer: Renderer,
  rootEl: HTMLElement,
  opts?: { cssClass?: string },
): void {
  // Clear the nodeMap so stale entries from the previous render don't persist.
  if (renderer.beforeRender) { renderer.beforeRender(); }

  // Pre-filter the tree: the renderer receives a pruned tree and renders unconditionally.
  const filtered = filterTree(state.lastRoots!, {
    activeFilters: state.activeFilters,
    searchResults: state.searchResults,
    searchAncestorPaths: state.searchAncestorPaths,
    searchResultsVersion: state.searchResultsVersion,
  });
  // Swap in filtered roots for this render pass. The original roots stay in state.lastRoots
  // (set by the render() function in tab.ts/main.ts) for future filter changes.
  const savedRoots = state.lastRoots;
  state.lastRoots = filtered.roots;
  // Store isFiltered on state so the renderer can read it for auto-expand logic.
  state._isFiltered = filtered.isFiltered;
  state.lastFilteredFileCount = filtered.totalVisibleFiles;
  state.lastFilteredMatchCount = filtered.totalVisibleMatches;

  const maxMetric = computeMaxMetric(filtered.roots, state.currentSortMode, false);
  const clientWidth = rootEl.clientWidth;
  const treeClass = 'tree' +
    (opts && opts.cssClass ? ' ' + opts.cssClass : '') +
    (state.currentSortMode === 'size' ? ' sort-size' : '');

  // Check if filtered tree is completely empty (no matching files/dirs).
  const filteredEmpty = filtered.isFiltered && filtered.roots.every(r => r.totalFiles === 0);

  const existingTree = rootEl.querySelector(':scope > ul.tree') as HTMLElement | null;
  if (existingTree) {
    // Incremental path: build the new tree off-screen, then reconcile with existing DOM.
    existingTree.className = treeClass;
    const newTreeEl = h('ul', { className: treeClass });
    renderRoots(renderer, state, newTreeEl, maxMetric, clientWidth, filtered.isFiltered, opts);
    patchTreeChildren(existingTree, newTreeEl);
  } else {
    // First render (or after loading/error cleared the container): full creation.
    const treeEl = h('ul', { className: treeClass });
    renderRoots(renderer, state, treeEl, maxMetric, clientWidth, filtered.isFiltered, opts);
    rootEl.appendChild(treeEl);
  }

  // Show/hide "no results" empty state when filters produce an empty tree.
  const existingNoResults = rootEl.querySelector(':scope > .empty-state');
  if (filteredEmpty) {
    if (!existingNoResults) { rootEl.appendChild(emptyState('noResults')); }
  } else {
    existingNoResults?.remove();
  }

  // Restore original roots so filter changes can recompute from the full tree.
  state.lastRoots = savedRoots;
}
