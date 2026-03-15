// Tree rendering functions: createRescanWarning, renderRoots, renderTree.

import * as Icons from './shared-icons';
import { sortDirs, sortFiles, groupEmptyDirs, computeMaxMetric, getVisibleChildren, getVisibleFiles } from './shared-utils';
import { patchTreeChildren } from './shared-dom-patch';

import type { DirNode, FileNode, WebviewState, SortMode, VsCodeApi, Renderer } from './types';

// ── Shared view helpers ───────────────────────────────────────────────────

/**
 * Creates the "auto-rescan disabled" warning banner with a wired Refresh button.
 */
export function createRescanWarning(vscode: VsCodeApi): HTMLElement {
  const warn = document.createElement('div');
  warn.className = 'rescan-warning';
  warn.innerHTML = `
    <span class="rescan-warning-icon">${Icons.SVG_WARNING}</span>
    <span>Auto-rescan disabled (large repo)</span>
    <button class="rescan-btn">Refresh</button>
  `;
  (warn.querySelector('.rescan-btn') as HTMLElement).addEventListener('click', () => {
    vscode.postMessage({ command: 'refresh' });
  });
  return warn;
}

// Renders the root-level tree rows into treeEl. Shared between sidebar and tab views.
// Requires state.lastRoots to be set.
// opts.showRootNode: if true (tab), render each root as a depth-0 dir-row itself rather than
//   rendering the root's children at depth 0. Enables the root-as-tree-node design where the
//   workspace folder (or subdir) appears as the topmost row and its children are at depth 1.
export function renderRoots(
  renderer: Renderer,
  state: WebviewState,
  treeEl: HTMLElement,
  maxMetric: number,
  clientWidth: number,
  opts?: { showRootNode?: boolean; cssClass?: string },
): void {
  const roots = state.lastRoots!;

  if (opts && opts.showRootNode) {
    // Tab view: each root is a visible depth-0 node; no workspace-root-header needed.
    for (const r of roots) {
      state.currentRootName = r.name;
      treeEl.appendChild(renderer.renderDirNode(r, 0, maxMetric, [], clientWidth));
    }
    return;
  }

  for (const r of roots) {
    state.currentRootName = r.name;
    if (roots.length > 1) {
      const header = document.createElement('li');
      header.className = 'workspace-root-header';
      header.textContent = r.name;
      treeEl.appendChild(header);
    }
    const sortedChildren = sortDirs(r.children, state.currentSortMode);
    const sortedFiles = sortFiles(r.files || []);
    const visibleChildren = getVisibleChildren(sortedChildren, state.activeFilters, (c: DirNode) => renderer.dirMatchesFilter(c), state.searchResults, (c: DirNode) => renderer.dirMatchesSearch(c), state.fileFilterFn, (c: DirNode) => renderer.dirMatchesFileFilter(c));
    const visibleFiles = getVisibleFiles(sortedFiles, state.activeFilters, state.searchResults, state.fileFilterFn);
    if (state.activeFilters.size === 0 && !state.searchResults && visibleChildren.length > 0) {
      for (const group of groupEmptyDirs(visibleChildren)) {
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
      for (const child of visibleChildren) {
        treeEl.appendChild(renderer.renderDirNode(child, 0, maxMetric, [], clientWidth));
      }
    }
    // File truncation — disabled when search is active.
    // Also disabled when the root has no directory children (single-dir root).
    const isSingleDirRoot = visibleChildren.length === 0;
    const shouldTruncate = !state.searchResults && !isSingleDirRoot && state.truncateThreshold > 0 && visibleFiles.length > state.truncateThreshold && !state.truncationExpanded.has(r.path);
    const shownFiles = shouldTruncate ? visibleFiles.slice(0, state.truncateThreshold) : visibleFiles;
    const hiddenFiles = shouldTruncate ? visibleFiles.slice(state.truncateThreshold) : [];
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
  opts?: { cssClass?: string; showRootNode?: boolean },
): void {
  // Clear the nodeMap so stale entries from the previous render don't persist.
  if (renderer.beforeRender) { renderer.beforeRender(); }
  const maxMetric = computeMaxMetric(state.lastRoots!, state.currentSortMode, false);
  const clientWidth = rootEl.clientWidth;
  const treeClass = 'tree' +
    (opts && opts.cssClass ? ' ' + opts.cssClass : '') +
    (state.currentSortMode === 'size' ? ' sort-size' : '');

  const existingTree = rootEl.querySelector(':scope > ul.tree') as HTMLElement | null;
  if (existingTree) {
    // Incremental path: build the new tree off-screen, then reconcile with existing DOM.
    existingTree.className = treeClass;
    const newTreeEl = document.createElement('ul');
    newTreeEl.className = treeClass;
    renderRoots(renderer, state, newTreeEl, maxMetric, clientWidth, opts);
    patchTreeChildren(existingTree, newTreeEl);
  } else {
    // First render (or after loading/error cleared the container): full creation.
    const treeEl = document.createElement('ul');
    treeEl.className = treeClass;
    renderRoots(renderer, state, treeEl, maxMetric, clientWidth, opts);
    rootEl.appendChild(treeEl);
  }
}
