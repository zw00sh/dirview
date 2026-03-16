import {
  h,
  createScanBar,
  createTooltip,
  createState,
  createRenderer,
  createMessageHandler,
  createSearchBar,
  computeStats,
  renderLegend,
  tieredExpandAll,
  tieredCollapseAll,
  emptyState,
  SVG_EYE,
  SVG_EYE_CLOSED,
  SVG_FOLD,
  SVG_UNFOLD,
  SVG_SORT_FILES,
  SVG_SORT_NAME,
  SVG_SORT_SIZE,
  SVG_STICKY,
  SVG_STICKY_OFF,
} from './index';
import { flattenTree } from './virtual/flatten';
import { createVirtualScroller } from './virtual/scroller';
import { createStickyOverlay } from './virtual/sticky-overlay';
import type { FlatRow } from './virtual/types';
import type { DirNode, SortMode, LangStat, BackendToWebviewMessage, Renderer } from './types';

const vscode = acquireVsCodeApi();
const legendSection = document.getElementById('legend-section')!;
const legendHeader = document.getElementById('legend-header')!;
const legendChevron = document.getElementById('legend-chevron')!;
const legendDisplayToggle = document.getElementById('legend-display-toggle')!;
const legendEl = document.getElementById('legend')!;
const searchSection = document.getElementById('search-section')!;
const searchHeaderEl = document.getElementById('search-header')!;
const searchChevronEl = document.getElementById('search-chevron')!;
const searchContentEl = document.getElementById('search-content')!;
const searchActiveAlert = document.getElementById('search-active-alert')!;
const legendActiveAlert = document.getElementById('legend-active-alert')!;
const treeSection = document.getElementById('tree-section')!;
const treeHeaderEl = document.getElementById('tree-header')!;
const treeChevronEl = document.getElementById('tree-chevron')!;
const root = document.getElementById('root')!;
const sortBtn = document.getElementById('tab-sort')!;
const toggleStickyBtn = document.getElementById('tab-toggle-sticky')!;
const toggleTruncationBtn = document.getElementById('tab-toggle-truncation')!;
const toggleIgnoredBtn = document.getElementById('tab-toggle-ignored')!;
const expandAllBtn = document.getElementById('tab-expand-all')!;
const collapseAllBtn = document.getElementById('tab-collapse-all')!;
const refreshBtn = document.getElementById('tab-refresh')!;

const scanBar = createScanBar();
const tooltip = createTooltip();
const state = createState();
state.scanBar = scanBar;

// Mount search bar inside the collapsible search section.
const searchBar = createSearchBar(state, vscode, {
  onClearLangFilter: () => clearAllFilters(),
});
searchContentEl.appendChild(searchBar.el);

let searchCollapsed = false;
let treeCollapsed = false;
// Initialise chevrons to match expanded state (chevron rotated 90° = expanded).
searchChevronEl.style.transform = 'rotate(90deg)';
treeChevronEl.style.transform = 'rotate(90deg)';

// Cmd+F / Ctrl+F: expand and focus the search section.
window.addEventListener('keydown', (e: KeyboardEvent) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
    e.preventDefault();
    if (searchCollapsed) {
      searchCollapsed = false;
      searchContentEl.style.display = '';
      searchChevronEl.style.transform = 'rotate(90deg)';
      updateSearchActiveAlert();
    }
    searchBar.focus();
  }
});

function updateSearchActiveAlert() {
  searchActiveAlert.style.display = (searchCollapsed && state.searchResults) ? '' : 'none';
}

function updateLegendActiveAlert() {
  legendActiveAlert.style.display = (legendCollapsed && state.activeFilters.size > 0) ? '' : 'none';
}

const renderer = createRenderer(state, {
  vscode,
  root,
  tooltip,
  options: {
    skipDepthZeroGuides: false,
    hideRootBar: true,
    barFactor: 0.35,
    barMaxWidth: 400,
    barFallbackWidth: 600,
    barMinWidth: 24,
    barSqrt: true,
  },
  // Navigate to directory when its name is clicked in the tab tree.
  onNavigate: (path: string) => vscode.postMessage({ command: 'navigateToDir', path }),
});

let currentShowIgnored = false;
let currentTruncationEnabled = true;
let currentIsLocal = true;
// The directory path this tab is rooted at ('' = workspace root).
state.dirPath = '';
// Workspace folder name used by ancestor path context menus.
state.workspaceFolderName = '';

// Tab-local truncation defaults (match config defaults)
state.truncateThreshold = 4;
let legendCollapsed = false;
let legendShowPct = false;

// SVG icons for the legend display toggle — typographic % and # glyphs, matching sidebar title bar icons
const SVG_PCT = '<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><text x="8" y="12.5" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, \'Segoe UI\', sans-serif" font-weight="600" font-size="13" fill="currentColor">%</text></svg>';
const SVG_HASH = '<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><text x="8" y="12.5" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, \'Segoe UI\', sans-serif" font-weight="600" font-size="13" fill="currentColor">#</text></svg>';

function getSortTitle(mode: SortMode): string {
  const sortNames: Record<SortMode, string> = { files: 'by file count', name: 'by name', size: 'by size' };
  const base = 'Sort: ' + (sortNames[mode] || 'by file count');
  if (!currentIsLocal) { return base + ' (size unavailable on remote filesystems)'; }
  return base;
}

// ── Toolbar button helpers ──────────────────────────────────────────────

function updateToggleIgnoredBtn() {
  toggleIgnoredBtn.innerHTML = currentShowIgnored ? SVG_EYE_CLOSED : SVG_EYE;
  toggleIgnoredBtn.title = currentShowIgnored ? 'Hide Ignored Files' : 'Show Ignored Files';
  toggleIgnoredBtn.setAttribute('aria-label', toggleIgnoredBtn.title);
}

function updateTruncationBtn() {
  toggleTruncationBtn.innerHTML = currentTruncationEnabled ? SVG_FOLD : SVG_UNFOLD;
  toggleTruncationBtn.title = currentTruncationEnabled ? 'Disable File Truncation' : 'Enable File Truncation';
  toggleTruncationBtn.setAttribute('aria-label', toggleTruncationBtn.title);
}

let currentStickyEnabled = true;

function updateStickyBtn() {
  toggleStickyBtn.innerHTML = currentStickyEnabled ? SVG_STICKY : SVG_STICKY_OFF;
  toggleStickyBtn.title = currentStickyEnabled ? 'Disable Sticky Headers' : 'Enable Sticky Headers';
  toggleStickyBtn.setAttribute('aria-label', toggleStickyBtn.title);
}

function updateRefreshBtn(autoRescanEnabled: boolean) {
  refreshBtn.style.display = autoRescanEnabled ? 'none' : '';
}

updateToggleIgnoredBtn();
updateTruncationBtn();
updateStickyBtn();
updateRefreshBtn(true);

// ── Virtual scroller + sticky overlay ───────────────────────────────────

function renderFlatRow(r: Renderer, row: FlatRow): HTMLElement {
  switch (row.type) {
    case 'dir':
      return r.renderDirRow(row.node, row.depth, row.maxMetric, row.ancestors, row.clientWidth);
    case 'file':
      return r.renderFileNode(row.file, row.depth, row.ancestors);
    case 'truncated':
      return r.renderTruncatedRow(row.hiddenFiles, row.depth, row.ancestors, row.dirPath, row.maxMetric, row.clientWidth);
    case 'emptyGroup':
      return r.renderEmptyGroupNode(row.nodes, row.depth, row.maxMetric, row.ancestors);
    case 'matchGroup': {
      // Build copy text for context menu
      const firstMatch = row.matches[0];
      let copyText: string;
      if (row.matches.length === 1) {
        copyText = firstMatch.matchGroup[0].lineText || '';
      } else {
        const copyLines: string[] = [];
        for (const me of row.matches) {
          for (const ctx of me.contextBefore) { copyLines.push(ctx.lineText || ''); }
          copyLines.push(me.matchGroup[0].lineText || '');
        }
        copyText = copyLines.join('\n');
      }
      const wrapper = h('li', {
        className: 'match-group' + (row.hasGap ? ' gap-before' : ''),
        dataset: {
          nodePath: 'match:' + row.file.path + ':' + firstMatch.matchGroup[0].line,
          action: 'openFileAtLine',
          path: row.file.path,
          line: String(firstMatch.matchGroup[0].line),
        },
        attr: { 'data-vscode-context': JSON.stringify({
          webviewSection: 'matchLine',
          path: row.file.path,
          lineText: copyText,
          preventDefaultContextMenuItems: true,
        }) },
      });
      // Spacer for gap
      if (row.hasGap) {
        wrapper.appendChild(h('div', { className: 'match-group-spacer' }, r.renderIndentGuides(row.depth, row.ancestors)));
      }
      // Render each match cluster
      for (const me of row.matches) {
        for (const ctx of me.contextBefore) {
          const ctxLi = r.renderContextLine(row.file, ctx, row.depth, row.ancestors, row.dedent);
          const ctxDiv = ctxLi.firstElementChild as HTMLElement;
          delete ctxDiv.dataset.action;
          delete ctxDiv.dataset.path;
          delete ctxDiv.dataset.line;
          wrapper.appendChild(ctxDiv);
        }
        const matchLi = r.renderMatchLine(row.file, me.matchGroup, row.depth, row.ancestors, row.dedent);
        const matchDiv = matchLi.firstElementChild as HTMLElement;
        matchDiv.removeAttribute('data-vscode-context');
        wrapper.appendChild(matchDiv);
      }
      // Context-after
      for (const ctx of row.contextAfter) {
        const ctxLi = r.renderContextLine(row.file, ctx, row.depth, row.ancestors, row.dedent);
        const ctxDiv = ctxLi.firstElementChild as HTMLElement;
        delete ctxDiv.dataset.action;
        delete ctxDiv.dataset.path;
        delete ctxDiv.dataset.line;
        wrapper.appendChild(ctxDiv);
      }
      return wrapper;
    }
    case 'moreMatches':
      return r.renderMoreMatchesRow(row.count, row.depth, row.ancestors, row.filePath);
    case 'workspaceHeader':
      return h('li', { className: 'workspace-root-header', textContent: row.name });
  }
}

let currentFlatRows: FlatRow[] = [];

const scroller = createVirtualScroller({
  container: root,
  renderRow: (row) => renderFlatRow(renderer, row),
  overscan: 15,
  treeClass: '',
  onRender: (visibleStart, _visibleEnd) => {
    overlay.update(currentFlatRows, visibleStart);
  },
});

const overlay = createStickyOverlay({
  container: root,
  renderRow: (row) => renderFlatRow(renderer, row),
});

// ── Toolbar event listeners ─────────────────────────────────────────────

// Stop toolbar button clicks from bubbling to the collapsible tree header.
for (const btn of [sortBtn, toggleStickyBtn, toggleTruncationBtn, toggleIgnoredBtn, expandAllBtn, collapseAllBtn, refreshBtn]) {
  btn.addEventListener('click', (e: MouseEvent) => e.stopPropagation());
}

toggleTruncationBtn.addEventListener('click', () => {
  vscode.postMessage({ command: 'toggleTruncation', enabled: !currentTruncationEnabled });
});
sortBtn.addEventListener('click', () => {
  if (!state.lastRoots) { return; }
  const modes: SortMode[] = currentIsLocal ? ['files', 'name', 'size'] : ['files', 'name'];
  const next = modes[(modes.indexOf(state.currentSortMode) + 1) % modes.length];
  state.currentSortMode = next;
  sortBtn.title = getSortTitle(next);
  sortBtn.setAttribute('aria-label', sortBtn.title);
  sortBtn.innerHTML = ({ files: SVG_SORT_FILES, name: SVG_SORT_NAME, size: SVG_SORT_SIZE } as Record<SortMode, string>)[next] || SVG_SORT_FILES;
  scroller.setTreeClass(next === 'size' ? 'sort-size' : '');
  state.rerender();
});
toggleIgnoredBtn.addEventListener('click', () => {
  vscode.postMessage({ command: 'toggleIgnored', show: !currentShowIgnored });
});
expandAllBtn.addEventListener('click', () => {
  if (!state.lastRoots) { return; }
  tieredExpandAll(state, state.lastRoots);
  // tieredExpandAll clears matchesCollapsed.
  state.rerender();
});
collapseAllBtn.addEventListener('click', () => {
  if (!state.lastRoots) { return; }
  tieredCollapseAll(state, state.lastRoots);
  state.truncationExpanded.clear();
  state.emptyGroupExpanded.clear();
  // tieredCollapseAll populates matchesCollapsed when search is active.
  state.rerender();
});
toggleStickyBtn.addEventListener('click', () => {
  vscode.postMessage({ command: 'toggleStickyHeaders', enabled: !currentStickyEnabled });
});
refreshBtn.addEventListener('click', () => {
  vscode.postMessage({ command: 'refresh' });
});
function toggleLegend() {
  legendCollapsed = !legendCollapsed;
  legendEl.style.display = legendCollapsed ? 'none' : '';
  legendChevron.style.transform = legendCollapsed ? 'rotate(0deg)' : 'rotate(90deg)';
  legendHeader.setAttribute('aria-expanded', String(!legendCollapsed));
  updateLegendActiveAlert();
}
function toggleSearch() {
  searchCollapsed = !searchCollapsed;
  searchContentEl.style.display = searchCollapsed ? 'none' : '';
  searchChevronEl.style.transform = searchCollapsed ? 'rotate(0deg)' : 'rotate(90deg)';
  searchHeaderEl.setAttribute('aria-expanded', String(!searchCollapsed));
  updateSearchActiveAlert();
}
function toggleTree() {
  treeCollapsed = !treeCollapsed;
  root.style.display = treeCollapsed ? 'none' : '';
  treeChevronEl.style.transform = treeCollapsed ? 'rotate(0deg)' : 'rotate(90deg)';
  treeHeaderEl.setAttribute('aria-expanded', String(!treeCollapsed));
}
legendHeader.addEventListener('click', toggleLegend);
searchHeaderEl.addEventListener('click', toggleSearch);
treeHeaderEl.addEventListener('click', toggleTree);
// Keyboard support: Enter/Space toggles sections
for (const [el, fn] of [[legendHeader, toggleLegend], [searchHeaderEl, toggleSearch], [treeHeaderEl, toggleTree]] as const) {
  el.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); }
  });
}
legendDisplayToggle.addEventListener('click', (e: MouseEvent) => {
  e.stopPropagation(); // Don't collapse the legend section when clicking the toggle
  legendShowPct = !legendShowPct;
  legendDisplayToggle.innerHTML = legendShowPct ? SVG_HASH : SVG_PCT;
  legendDisplayToggle.title = legendShowPct ? 'Show counts' : 'Show percentages';
  legendDisplayToggle.setAttribute('aria-label', legendDisplayToggle.title);
  if (state.lastRoots) {
    updateLegend(computeStats(state.lastRoots));
  }
});

// ── Legend ──────────────────────────────────────────────────────────────

function toggleFilter(langName: string) {
  if (state.activeFilters.has(langName)) { state.activeFilters.delete(langName); }
  else { state.activeFilters.add(langName); }
  if (state.activeFilters.size > 0) {
    state.expanded.clear();
  }
  state.searchResultsVersion++;
  vscode.postMessage({ command: 'filter', langs: [...state.activeFilters] });
  searchBar.updateFilterWarning(state.activeFilters.size);
  updateLegendActiveAlert();
  schedulePostFilterStatusUpdate();
  state.rerender();
}

function clearAllFilters() {
  state.activeFilters.clear();
  state.searchResultsVersion++;
  vscode.postMessage({ command: 'filter', langs: [] });
  searchBar.updateFilterWarning(0);
  updateLegendActiveAlert();
  schedulePostFilterStatusUpdate();
  state.rerender();
}

// After a language filter change, the search status counts must be refreshed
// post-render since filterTree recomputes totalVisibleFiles/Matches during render.
function schedulePostFilterStatusUpdate() {
  if (!state.searchResults && !state.fileFilterFn) { return; }
  state.onAfterRender = () => {
    state.onAfterRender = null;
    searchBar.updateFilteredStatus();
  };
}

function updateLegend(stats: LangStat[]) {
  if (!stats || stats.length === 0) {
    legendSection.style.display = 'none';
    return;
  }
  legendSection.style.display = '';
  legendEl.style.display = legendCollapsed ? 'none' : '';
  renderLegend(legendEl, stats, state.activeFilters, toggleFilter, legendShowPct);
}

// ── Tree ────────────────────────────────────────────────────────────────

function render(roots: DirNode[], autoRescanEnabled: boolean, sortMode: SortMode) {
  state.lastRoots = roots;
  state.lastAutoRescanEnabled = autoRescanEnabled;
  state.currentSortMode = sortMode || 'files';

  sortBtn.title = getSortTitle(state.currentSortMode);
  sortBtn.setAttribute('aria-label', sortBtn.title);
  sortBtn.innerHTML = ({ files: SVG_SORT_FILES, name: SVG_SORT_NAME, size: SVG_SORT_SIZE } as Record<SortMode, string>)[state.currentSortMode] || SVG_SORT_FILES;

  updateLegend(roots ? computeStats(state.lastRoots!) : []);
  searchBar.updateFilterWarning(state.activeFilters.size);

  root.querySelector('.empty-state')?.remove();

  updateRefreshBtn(autoRescanEnabled);

  if (!roots || roots.length === 0) {
    currentFlatRows = [];
    scroller.update([], 0);
    if (!root.querySelector('.empty-state')) {
      root.appendChild(emptyState('noWorkspace'));
    }
    return;
  }

  root.querySelector('.empty-state')?.remove();

  // Clear nodeMap before each render pass
  renderer.beforeRender();

  // Set _isFiltered on state so the renderer's renderDirRow can read it for chevron/expand logic.
  (state as any)._isFiltered = state.activeFilters.size > 0 || state.searchResults !== null || state.fileFilterFn !== null;

  // Build flat rows and update virtual scroller
  const { flatRows, totalHeight, totalVisibleFiles, totalVisibleMatches } = flattenTree(state, roots, {
    showRootNode: true,
    clientWidth: root.clientWidth || 600,
  });
  state.lastFilteredFileCount = totalVisibleFiles;
  state.lastFilteredMatchCount = totalVisibleMatches;
  currentFlatRows = flatRows;

  // Check if filtered tree is empty (no matching files/dirs)
  const isFiltered = state.activeFilters.size > 0 || state.searchResults !== null || state.fileFilterFn !== null;
  const filteredEmpty = isFiltered && flatRows.length === 0;

  scroller.setTreeClass(state.currentSortMode === 'size' ? 'sort-size' : '');
  scroller.update(flatRows, totalHeight);

  // Show/hide "no results" empty state
  const existingNoResults = root.querySelector(':scope > .empty-state');
  if (filteredEmpty) {
    if (!existingNoResults) { root.appendChild(emptyState('noResults')); }
  } else {
    existingNoResults?.remove();
  }

  updateSearchActiveAlert();
}

state.render = render;

// ── Message handler ─────────────────────────────────────────────────────

const sharedHandler = createMessageHandler(state, scanBar, root, {
  vscode,
  render,
  resolveUpdateSortMode: () => state.currentSortMode || 'files',
  onBeforeUpdate: (message: BackendToWebviewMessage & { type: 'update' }) => {
    currentShowIgnored = message.showIgnored || false;
    if (typeof message.isLocal === 'boolean') { currentIsLocal = message.isLocal; }
    updateToggleIgnoredBtn();
    if (typeof message.dirPath === 'string') {
      const dirChanged = state.dirPath !== message.dirPath;
      state.dirPath = message.dirPath;
      searchBar.setDirPill(message.dirPath);
      // Re-run the search against the new root when the directory scope changes.
      if (dirChanged && state.searchResults) { searchBar.triggerSearch(); }
    }
    if (typeof message.workspaceFolderName === 'string') { state.workspaceFolderName = message.workspaceFolderName; }
    if (typeof message.stickyHeadersEnabled === 'boolean') {
      currentStickyEnabled = message.stickyHeadersEnabled;
      updateStickyBtn();
      overlay.setEnabled(message.stickyHeadersEnabled);
    }
    if (typeof message.hasRipgrep === 'boolean') {
      searchBar.setHasRipgrep(message.hasRipgrep);
    }
  },
  onLoading: () => {
    legendSection.style.display = 'none';
  },
});

window.addEventListener('message', (event: MessageEvent) => {
  const message = event.data;
  if (message.type === 'themeChanged') {
    // Shiki theme changed — re-render to pick up new syntax highlight colors.
    if (state.lastRoots) { state.rerender(); }
    return;
  }
  if (message.type === 'updateStickyHeaders') {
    currentStickyEnabled = message.enabled;
    updateStickyBtn();
    overlay.setEnabled(message.enabled);
    return;
  }
  if (message.type === 'updateTruncation') {
    const newThreshold = message.truncateThreshold;
    if (typeof newThreshold === 'number' && newThreshold !== state.truncateThreshold) {
      state.truncationExpanded.clear();
      state.emptyGroupExpanded.clear();
    }
    if (typeof newThreshold === 'number') { state.truncateThreshold = newThreshold; }
    if (typeof message.truncationEnabled === 'boolean') {
      currentTruncationEnabled = message.truncationEnabled;
      updateTruncationBtn();
    }
    if (state.lastRoots) { state.rerender(); }
    return;
  }
  sharedHandler(event);
});

root.appendChild(emptyState('initializing'));
scanBar.show(true);
