// Message handler for backend → webview communication.

import { emptyState, skeletonState } from './utils';
import { tieredExpandAll, tieredCollapseAll } from './state';
import { expandMatchedDirs, updateSearchStatus, scheduleSearchRender, expandBatchFiles, buildAncestorPaths } from './search';

import type { WebviewState, ScanBar, MessageHandlerDeps, BackendToWebviewMessage } from './types';

/**
 * Creates a window 'message' handler that handles common message types
 * (scanning, loading, update, filter, expandAll, collapseAll, error).
 */
export function createMessageHandler(
  state: WebviewState,
  scanBar: ScanBar,
  rootEl: HTMLElement,
  deps: MessageHandlerDeps,
): (event: MessageEvent) => void {
  type MessageHandlers = {
    [T in BackendToWebviewMessage['type']]?: (msg: Extract<BackendToWebviewMessage, { type: T }>) => void;
  };
  const handlers: MessageHandlers = {
    scanning() {
      scanBar.show(true);
    },
    loading() {
      scanBar.show(false);
      rootEl.innerHTML = '';
      rootEl.appendChild(skeletonState());
      if (deps.onLoading) { deps.onLoading(); }
    },
    update(message: BackendToWebviewMessage & { type: 'update' }) {
      if (deps.onBeforeUpdate) { deps.onBeforeUpdate(message); }
      scanBar.show(true);
      requestAnimationFrame(() => {
        const sortMode = deps.resolveUpdateSortMode ? deps.resolveUpdateSortMode(message) : message.sortMode;
        deps.render(message.roots, message.autoRescanEnabled, sortMode);
        scanBar.show(false);
        if (deps.onAfterRender) { deps.onAfterRender(message); }
      });
    },
    filter(message: BackendToWebviewMessage & { type: 'filter' }) {
      const hadFilters = state.activeFilters.size > 0;
      state.activeFilters = new Set(message.langs || []);
      if (!hadFilters && state.activeFilters.size > 0) { state.expanded.clear(); }
      if (state.lastRoots) {
        state.rerender();
      }
      if (deps.onFilter) { deps.onFilter(hadFilters); }
    },
    expandAll() {
      if (state.lastRoots) {
        tieredExpandAll(state, state.lastRoots);
        state.rerender();
        if (deps.onExpandAll) { deps.onExpandAll(); }
      }
    },
    collapseAll() {
      if (state.lastRoots) {
        tieredCollapseAll(state, state.lastRoots);
        state.truncationExpanded.clear();
        // tieredCollapseAll already populates matchesCollapsed when search is active.
        state.rerender();
        if (deps.onCollapseAll) { deps.onCollapseAll(); }
      }
    },
    updateSortMode(message: BackendToWebviewMessage & { type: 'updateSortMode' }) {
      // Lightweight sort-mode change from sidebarProvider.updateSortMode():
      // avoids re-serializing the full tree when only the sort order changed.
      state.currentSortMode = message.sortMode || 'files';
      if (state.lastRoots) { state.rerender(); }
    },
    updateTruncation(message: BackendToWebviewMessage & { type: 'updateTruncation' }) {
      // Lightweight truncation change from sidebarProvider.updateTruncateThreshold():
      // avoids re-serializing the full tree when only the truncation threshold changed.
      if (typeof message.truncateThreshold === 'number' && message.truncateThreshold !== state.truncateThreshold) {
        state.truncationExpanded.clear();
      }
      if (typeof message.truncateThreshold === 'number') { state.truncateThreshold = message.truncateThreshold; }
      if (state.lastRoots) { state.rerender(); }
    },
    error(message: BackendToWebviewMessage & { type: 'error' }) {
      scanBar.show(false);
      rootEl.innerHTML = '';
      rootEl.appendChild(emptyState('error', message.message));
    },
    searchResults(message: BackendToWebviewMessage & { type: 'searchResults' }) {
      // Non-streaming fallback (used by searchFiles / clearSearch / errors).
      state.searchResultsVersion++;
      state.searchResults = message.matches
        ? new Map(Object.entries(message.matches))
        : null;
      // Build ancestor path index for O(1) dirMatchesSearch lookups.
      state.searchAncestorPaths = state.searchResults
        ? buildAncestorPaths(state.searchResults.keys(), state.searchRootPaths)
        : null;
      state.searchActive = false;
      if (state.scanBar) { state.scanBar.show(false); }
      // Selectively expand only dirs that contain matches (avoids rendering entire tree).
      if (state.searchResults && state.searchResults.size > 0 && state.lastRoots) {
        expandMatchedDirs(state, state.lastRoots, state.searchResults, state.activeFilters);
      }
      updateSearchStatus(state, message);
      if (state.lastRoots) { state.rerender(); }
    },
    searchResultsBatch(message: BackendToWebviewMessage & { type: 'searchResultsBatch' }) {
      // Progressive delivery: merge incoming batch into accumulated results.
      state.searchResultsVersion++;
      const newFilePaths = new Set(Object.keys(message.matches || {}));
      if (!state.searchResults) { state.searchResults = new Map(); }
      for (const [p, m] of Object.entries(message.matches || {})) { state.searchResults.set(p, m); }
      updateSearchStatus(state, message);
      // Incrementally expand only dirs containing newly arrived files — avoids full tree
      // walk on every batch. searchProgress must have cleared expanded first so this
      // only needs to add newly matched dirs rather than rebuilding from all results.
      if (newFilePaths.size > 0 && state.lastRoots) {
        expandBatchFiles(state, state.lastRoots, newFilePaths);
      }
      // Throttle: coalesce rapid batch arrivals into at most one render per 300ms.
      scheduleSearchRender(state);
    },
    searchResultsHighlight(message: BackendToWebviewMessage & { type: 'searchResultsHighlight' }) {
      // Syntax highlight patches arrive after the plain-text batch has already rendered.
      // Merge highlighted HTML into the in-place match objects and schedule a re-render.
      if (!state.searchResults) { return; }
      for (const { path, idx, html } of (message.patches || [])) {
        const fileMatches = state.searchResults.get(path);
        if (fileMatches && fileMatches[idx] !== undefined) {
          fileMatches[idx].highlightedHtml = html;
        }
      }
      scheduleSearchRender(state);
    },
    searchResultsDone(message: BackendToWebviewMessage & { type: 'searchResultsDone' }) {
      // Final signal after all batches have been delivered.
      // If no batches arrived (zero results), searchResults is still null — set to empty Map
      // so the tree filters to empty rather than falling back to showing the full tree.
      state.searchResultsVersion++;
      if (state.searchResults === null) { state.searchResults = new Map(); }
      state.searchActive = false;
      if (state.scanBar) { state.scanBar.show(false); }
      updateSearchStatus(state, message);
      // Cancel any pending throttled render and do a final immediate render.
      if (state._searchRenderTimer) { clearTimeout(state._searchRenderTimer); state._searchRenderTimer = null; }
      if (state.lastRoots) { state.rerender(); }
    },
    searchProgress(message: BackendToWebviewMessage & { type: 'searchProgress' }) {
      state.searchResultsVersion++;
      state.searchActive = true;
      // Store workspace root paths for converting absolute file paths to relative.
      state.searchRootPaths = message.rootPaths || [];
      // Clear stale results, ancestor index, and expand state from a previous search.
      state.searchResults = null;
      state.searchAncestorPaths = null;
      state.searchFileCount = 0;
      state.searchMatchCount = 0;
      state.searchTruncated = false;
      // Clear expanded so expandBatchFiles starts fresh for the new search.
      state.expanded.clear();
      // Cancel any throttled render from the previous search.
      if (state._searchRenderTimer) { clearTimeout(state._searchRenderTimer); state._searchRenderTimer = null; }
      if (state.scanBar) { state.scanBar.show(true); }
      if (state.searchBar_updateStatus) { state.searchBar_updateStatus(); }
      if (state.lastRoots) { state.rerender(); }
    },
  };

  return function (event: MessageEvent): void {
    const message = event.data as BackendToWebviewMessage;
    const handler = handlers[message.type] as ((msg: BackendToWebviewMessage) => void) | undefined;
    if (handler) { handler(message); }
  };
}
