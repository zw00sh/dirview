// Main E2E test harness.
// Composes real webview modules with the real SearchService (real ripgrep),
// connected by a message bridge. No VS Code, no browser — runs as vitest
// tests in jsdom with direct state access.

import * as path from 'path';
import { SearchService } from '../search/searchService';
import { setupDom, teardownDom } from './dom-setup';
import { createBridge, type Bridge, type HandleSearchMessageFn, type HandleCommonMessageFn } from './bridge';
import { loadFixture, fixturePathForWorkspace } from './fixture-loader';
import { getVisibleFiles, getVisibleDirs, getLegendStats } from './assertions';
import { flattenTree } from '../views/webview/virtual/flatten';
import type { DirNode, WebviewState, SortMode, BackendToWebviewMessage, VsCodeApi, Renderer, LangStat } from '../views/webview/types';

// Imports from the webview barrel — these are the real modules.
// These do NOT import vscode, so they can be imported directly.
import {
  createState,
  createScanBar,
  createTooltip,
  createRenderer,
  createMessageHandler,
  createSearchBar,
  computeStats,
  renderLegend,
  isFiltered,
  emptyState,
} from '../views/webview/index';

export interface HarnessOptions {
  /** Path to test-repo directory (relative to project root, e.g. 'test-repos/source'). */
  workspace: string;
  /** JSON fixture path. Auto-detected from workspace if omitted. */
  fixture?: string;
  /** Default: false */
  showIgnored?: boolean;
  /** Default: 0 (disabled) */
  truncateThreshold?: number;
  /**
   * Backend message handlers from providerUtils.ts.
   * Must be passed in by the test file after vi.mock('vscode') is set up,
   * because providerUtils.ts imports 'vscode'.
   */
  handlers: {
    handleSearchMessage: HandleSearchMessageFn;
    handleCommonMessage: HandleCommonMessageFn;
  };
}

export interface Harness {
  state: WebviewState;
  roots: DirNode[];
  root: HTMLElement;
  bridge: Bridge;

  search(pattern: string): Promise<void>;
  searchFiles(glob: string): Promise<void>;
  setIncludeGlob(glob: string): void;
  setExcludeGlob(glob: string): void;
  setLanguageFilter(langs: string[]): void;
  clearLanguageFilter(): void;
  /** Re-trigger the active content search with current language filter scope. */
  retriggerSearch(): Promise<void>;
  clearSearch(): Promise<void>;
  /** Wait for a pending search to complete. */
  waitForSearchComplete(): Promise<void>;

  getVisibleFiles(): string[];
  getVisibleDirs(): string[];
  getLegendStats(): Array<{ name: string; count: number }>;

  /** Re-render the tree with current state. */
  rerender(): void;

  dispose(): void;
}

/**
 * Creates an E2E test harness with the full webview rendering pipeline.
 *
 * Must be called inside a test that has:
 * - `vi.mock('vscode', ...)` set up (for providerUtils imports)
 * - jsdom environment (vitest default or `@vitest-environment jsdom` comment)
 * - ResizeObserver polyfill
 * - handlers from providerUtils passed in options.handlers
 */
export async function createHarness(options: HarnessOptions): Promise<Harness> {
  const projectRoot = path.resolve(__dirname, '..', '..');
  const workspacePath = path.resolve(projectRoot, options.workspace);

  // 1. Load fixture
  const fixturePath = options.fixture || fixturePathForWorkspace(options.workspace);
  const fixtureData = loadFixture(fixturePath);
  const roots = fixtureData.roots;

  // 2. Create SearchService with the @vscode/ripgrep binary
  const searchService = new SearchService();
  const hasRipgrep = await searchService.probe();

  // 3. Set up jsdom with tab HTML skeleton
  let bridge: Bridge;
  const { root, vsCodeApi } = setupDom({
    onPostMessage: (message) => {
      // Route webview messages through the bridge.
      bridge.handleWebviewMessage(message);
    },
  });

  // 4. Create the bridge with injected handlers
  bridge = createBridge({
    searchService,
    hasRipgrep,
    rootPaths: [workspacePath],
    workspaceRootPaths: [workspacePath],
    handleSearchMessage: options.handlers.handleSearchMessage,
    handleCommonMessage: options.handlers.handleCommonMessage,
  });

  // 5. Create webview state
  const state = createState();
  state.truncateThreshold = options.truncateThreshold ?? 0;

  // 6. Create scan bar
  const scanBar = createScanBar();
  state.scanBar = scanBar;

  // 7. Create tooltip
  const tooltip = createTooltip();

  // 8. Create renderer
  const renderer = createRenderer(state, {
    vscode: vsCodeApi,
    root,
    tooltip,
    options: {
      skipDepthZeroGuides: false,
      barFactor: 0.35,
      barMaxWidth: 400,
      barFallbackWidth: 600,
      barMinWidth: 24,
      barSqrt: true,
    },
  });

  // 9. Create search bar (mounted into the search-content div)
  const searchContentEl = document.getElementById('search-content')!;
  const searchBar = createSearchBar(state, vsCodeApi, {
    onClearLangFilter: () => {
      state.activeFilters.clear();
      state.searchResultsVersion++;
      rerender();
    },
  });
  searchContentEl.appendChild(searchBar.el);

  // 10. Create the render function (simplified from tab.ts)
  const legendEl = document.getElementById('legend')!;
  const legendSection = document.getElementById('legend-section')!;

  function render(newRoots: DirNode[], autoRescanEnabled: boolean, sortMode: SortMode) {
    state.lastRoots = newRoots;
    state.lastAutoRescanEnabled = autoRescanEnabled;
    state.currentSortMode = sortMode || 'files';
    state._isFiltered = isFiltered(state);

    if (!newRoots || newRoots.length === 0) {
      return;
    }

    renderer.beforeRender();

    const { flatRows, totalHeight, totalVisibleFiles, totalVisibleMatches, filteredRoots, searchFilteredStats } =
      flattenTree(state, newRoots, { clientWidth: root.clientWidth || 600 });

    state.lastFilteredFileCount = totalVisibleFiles;
    state.lastFilteredMatchCount = totalVisibleMatches;

    // Update legend
    const stats = computeStats(newRoots);
    if (stats.length > 0) {
      legendSection.style.display = '';
      renderLegend(legendEl, stats, state.activeFilters, (lang: string) => {
        if (state.activeFilters.has(lang)) { state.activeFilters.delete(lang); }
        else { state.activeFilters.add(lang); }
        if (state.activeFilters.size > 0) { state.expanded.clear(); }
        state.searchResultsVersion++;
        rerender();
      }, false);
    }

    // Render rows into the root element (simplified: no virtual scroller, render all)
    const ul = document.createElement('ul');
    ul.className = 'tree-list';
    for (const row of flatRows) {
      switch (row.type) {
        case 'dir':
          ul.appendChild(renderer.renderDirRow(row.node, row.depth, row.maxMetric, row.ancestors, row.clientWidth));
          break;
        case 'file':
          ul.appendChild(renderer.renderFileNode(row.file, row.depth, row.ancestors));
          break;
        case 'truncated':
          ul.appendChild(renderer.renderTruncatedRow(row.hiddenFiles, row.depth, row.ancestors, row.dirPath, row.maxMetric, row.clientWidth));
          break;
        case 'emptyGroup':
          ul.appendChild(renderer.renderEmptyGroupNode(row.nodes, row.depth, row.maxMetric, row.ancestors));
          break;
        case 'workspaceHeader': {
          const li = document.createElement('li');
          li.className = 'workspace-root-header';
          li.textContent = row.name;
          ul.appendChild(li);
          break;
        }
      }
    }
    // Replace tree content
    const existingTree = root.querySelector('.tree-list');
    if (existingTree) existingTree.remove();
    root.querySelector('.empty-state')?.remove();
    root.appendChild(ul);

    if (state.onAfterRender) {
      state.onAfterRender();
      state.onAfterRender = null;
    }
  }

  state.render = render;

  // Override rerender to be synchronous (no rAF in test environment).
  function rerender() {
    if (state.render && state.lastRoots) {
      state.render(state.lastRoots, state.lastAutoRescanEnabled, state.currentSortMode);
    }
  }
  state.rerender = rerender;

  // 11. Create message handler (wires incoming backend messages to the webview)
  const sharedHandler = createMessageHandler(state, scanBar, root, {
    vscode: vsCodeApi,
    render,
    resolveUpdateSortMode: () => state.currentSortMode || 'files',
    onBeforeUpdate: (message: BackendToWebviewMessage & { type: 'update' }) => {
      if (typeof message.dirPath === 'string') { state.dirPath = message.dirPath; }
      if (typeof message.workspaceFolderName === 'string') { state.workspaceFolderName = message.workspaceFolderName; }
      if (typeof (message as any).hasRipgrep === 'boolean') { searchBar.setHasRipgrep((message as any).hasRipgrep); }
    },
  });

  // Wire the message handler to listen for window messages.
  const messageListener = (event: MessageEvent) => {
    const message = event.data as BackendToWebviewMessage;

    // Handle updateTruncation directly (tab.ts has its own handler for this).
    if (message.type === 'updateTruncation') {
      const newThreshold = (message as any).truncateThreshold;
      if (typeof newThreshold === 'number' && newThreshold !== state.truncateThreshold) {
        state.truncationExpanded.clear();
        state.emptyGroupExpanded.clear();
      }
      if (typeof newThreshold === 'number') { state.truncateThreshold = newThreshold; }
      if (state.lastRoots) { rerender(); }
      return;
    }

    // For 'update' type, call render synchronously instead of via rAF.
    if (message.type === 'update') {
      const msg = message as BackendToWebviewMessage & { type: 'update' };
      if (typeof msg.dirPath === 'string') { state.dirPath = msg.dirPath; }
      if (typeof msg.workspaceFolderName === 'string') { state.workspaceFolderName = msg.workspaceFolderName; }
      if (typeof (msg as any).hasRipgrep === 'boolean') { searchBar.setHasRipgrep((msg as any).hasRipgrep); }
      render(msg.roots as DirNode[], msg.autoRescanEnabled, msg.sortMode);
      return;
    }

    // For search messages, handle synchronously.
    if (message.type === 'searchProgress' ||
        message.type === 'searchResultsBatch' ||
        message.type === 'searchResultsHighlight' ||
        message.type === 'searchResultsDone' ||
        message.type === 'searchResults') {
      // Use the shared handler but wrap the event.
      sharedHandler(event);
      // After processing search messages, do a synchronous rerender.
      if (state.lastRoots && (
        message.type === 'searchResultsDone' ||
        message.type === 'searchResults' ||
        message.type === 'searchResultsBatch'
      )) {
        // Cancel any pending throttled render and do an immediate one.
        if (state._searchRenderTimer) {
          clearTimeout(state._searchRenderTimer);
          state._searchRenderTimer = null;
        }
        rerender();
      }
      return;
    }

    sharedHandler(event);
  };

  window.addEventListener('message', messageListener);

  // 12. Send initial update message with fixture data
  bridge.dispatchToWebview({
    type: 'update',
    roots: roots as any,
    autoRescanEnabled: true,
    sortMode: 'files',
    truncateThreshold: options.truncateThreshold ?? 0,
    stickyHeadersEnabled: false,
    showIgnored: options.showIgnored ?? false,
    isLocal: true,
    dirPath: '',
    workspaceFolderName: fixtureData.workspaceFolderName,
    hasRipgrep: hasRipgrep,
  });

  // Track last search pattern so language filter changes can re-trigger.
  let lastSearchPattern = '';

  // ── Harness API ──────────────────────────────────────────────────────────

  return {
    state,
    roots,
    root,
    bridge,

    async search(pattern: string): Promise<void> {
      lastSearchPattern = pattern;
      const waitPromise = bridge.waitForSearchComplete();
      bridge.handleWebviewMessage({
        command: 'search',
        pattern,
        useRegex: false,
        langFilters: state.activeFilters.size > 0 ? [...state.activeFilters] : undefined,
      });
      await waitPromise;
      // Allow any pending microtasks and rerenders.
      await bridge.flush();
      rerender();
    },

    async searchFiles(glob: string): Promise<void> {
      const waitPromise = bridge.waitForSearchComplete();
      bridge.handleWebviewMessage({ command: 'searchFiles', glob });
      await waitPromise;
      await bridge.flush();
      rerender();
    },

    setIncludeGlob(glob: string): void {
      state.fileFilterActive = glob !== '' && glob !== '*';
    },

    setExcludeGlob(glob: string): void {
      state.fileFilterActive = glob !== '';
    },

    setLanguageFilter(langs: string[]): void {
      state.activeFilters = new Set(langs);
      if (state.activeFilters.size > 0) { state.expanded.clear(); }
      state.searchResultsVersion++;
      rerender();
    },

    /** Re-trigger the active search with updated language filter scope.
     *  Must be called after setLanguageFilter/clearLanguageFilter when a content
     *  search is active, mirroring the tab.ts toggleFilter/clearAllFilters fix. */
    async retriggerSearch(): Promise<void> {
      if (!lastSearchPattern) return;
      const waitPromise = bridge.waitForSearchComplete();
      bridge.handleWebviewMessage({
        command: 'search',
        pattern: lastSearchPattern,
        useRegex: false,
        langFilters: state.activeFilters.size > 0 ? [...state.activeFilters] : undefined,
      });
      await waitPromise;
      await bridge.flush();
      rerender();
    },

    clearLanguageFilter(): void {
      state.activeFilters.clear();
      state.searchResultsVersion++;
      rerender();
    },

    async clearSearch(): Promise<void> {
      const waitPromise = bridge.waitForSearchComplete();
      bridge.handleWebviewMessage({ command: 'clearSearch' });
      await waitPromise;
      await bridge.flush();
      state.searchResults = null;
      state.searchAncestorPaths = null;
      state.fileFilterActive = false;
      rerender();
    },

    async waitForSearchComplete(): Promise<void> {
      return bridge.waitForSearchComplete();
    },

    getVisibleFiles(): string[] {
      return getVisibleFiles(root);
    },

    getVisibleDirs(): string[] {
      return getVisibleDirs(root);
    },

    getLegendStats(): Array<{ name: string; count: number }> {
      return getLegendStats(legendEl);
    },

    rerender,

    dispose(): void {
      window.removeEventListener('message', messageListener);
      searchService.cancel();
      teardownDom();
    },
  };
}
