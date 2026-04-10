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
  isFiltered,
  emptyState,
  skeletonState,
  SVG_EYE,
  SVG_EYE_CLOSED,
  SVG_FOLD,
  SVG_UNFOLD,
  SVG_SORT_FILES,
  SVG_SORT_NAME,
  SVG_SORT_SIZE,
  SVG_SORT_LINES,
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
const root = document.getElementById('root')!;
const treeHeaderTitle = document.getElementById('tree-header-title')!;
const treeHeaderBreadcrumb = document.getElementById('tree-header-breadcrumb')!;
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

// Consolidated tab-local UI state.
const tabUI = {
  searchCollapsed: false,
  legendCollapsed: false,
  legendShowPct: false,
  showIgnored: false,
  truncationEnabled: true,
  isLocal: true,
  stickyEnabled: true,
  isMultiRoot: false,
};
// Initialise chevron to match expanded state (chevron rotated 90° = expanded).
searchChevronEl.style.transform = 'rotate(90deg)';

// Cmd+F / Ctrl+F: expand and focus the search section.
window.addEventListener('keydown', (e: KeyboardEvent) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
    e.preventDefault();
    if (tabUI.searchCollapsed) {
      tabUI.searchCollapsed = false;
      searchContentEl.style.display = '';
      searchChevronEl.style.transform = 'rotate(90deg)';
      updateSearchActiveAlert();
    }
    searchBar.focus();
  }
});

function updateSearchActiveAlert() {
  searchActiveAlert.style.display = (tabUI.searchCollapsed && state.searchResults) ? '' : 'none';
}

function updateLegendActiveAlert() {
  legendActiveAlert.style.display = (tabUI.legendCollapsed && state.activeFilters.size > 0) ? '' : 'none';
}

const renderer = createRenderer(state, {
  vscode,
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
  onNavigate: (path: string) => navigateTo(path),
});

// ── Navigation history ────────────────────────────────────────────────────
// Tracks the sequence of dirPaths for mouse back/forward navigation.
const navHistory: string[] = [''];
let navIndex = 0;
let navigatingViaHistory = false;

function navigateTo(path: string): void {
  // Trim forward history when navigating from a non-tip position.
  if (navIndex < navHistory.length - 1) {
    navHistory.length = navIndex + 1;
  }
  navHistory.push(path);
  navIndex = navHistory.length - 1;
  vscode.postMessage({ command: 'navigateToDir', path });
}

function navigateBack(): void {
  if (navIndex <= 0) { return; }
  navIndex--;
  navigatingViaHistory = true;
  vscode.postMessage({ command: 'navigateToDir', path: navHistory[navIndex] });
}

function navigateForward(): void {
  if (navIndex >= navHistory.length - 1) { return; }
  navIndex++;
  navigatingViaHistory = true;
  vscode.postMessage({ command: 'navigateToDir', path: navHistory[navIndex] });
}

// Note: mouse back/forward buttons (3/4) don't reach VS Code webviews.
// Navigation history is used by the footer breadcrumb and could be wired
// to keyboard shortcuts if VS Code exposes them in future.

// (showIgnored, truncationEnabled, isLocal now in tabUI)
// The directory path this tab is rooted at ('' = workspace root).
state.dirPath = '';
// Workspace folder name used by ancestor path context menus.
state.workspaceFolderName = '';

// Tab-local truncation defaults (match config defaults)
state.truncateThreshold = 4;
// (tabUI.legendCollapsed, tabUI.legendShowPct now in tabUI)

// SVG icons for the legend display toggle — typographic % and # glyphs, matching sidebar title bar icons
const SVG_PCT = '<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><text x="8" y="12.5" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, \'Segoe UI\', sans-serif" font-weight="600" font-size="13" fill="currentColor">%</text></svg>';
const SVG_HASH = '<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><text x="8" y="12.5" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, \'Segoe UI\', sans-serif" font-weight="600" font-size="13" fill="currentColor">#</text></svg>';

function getSortTitle(mode: SortMode): string {
  const sortNames: Record<SortMode, string> = { files: 'by file count', name: 'by name', size: 'by size', lines: 'by lines of code' };
  const base = 'Sort: ' + (sortNames[mode] || 'by file count');
  if (!tabUI.isLocal) { return base + ' (size/lines unavailable on remote filesystems)'; }
  return base;
}

// ── Toolbar button helpers ──────────────────────────────────────────────

function updateToggleIgnoredBtn() {
  toggleIgnoredBtn.innerHTML = tabUI.showIgnored ? SVG_EYE_CLOSED : SVG_EYE;
  toggleIgnoredBtn.title = tabUI.showIgnored ? 'Hide Ignored Files' : 'Show Ignored Files';
  toggleIgnoredBtn.setAttribute('aria-label', toggleIgnoredBtn.title);
}

function updateTruncationBtn() {
  toggleTruncationBtn.innerHTML = tabUI.truncationEnabled ? SVG_FOLD : SVG_UNFOLD;
  toggleTruncationBtn.title = tabUI.truncationEnabled ? 'Disable File Truncation' : 'Enable File Truncation';
  toggleTruncationBtn.setAttribute('aria-label', toggleTruncationBtn.title);
}

// (stickyEnabled now in tabUI)

function updateStickyBtn() {
  // Sticky headers disabled pending visual polish — hide the button.
  toggleStickyBtn.style.display = 'none';
  // toggleStickyBtn.innerHTML = tabUI.stickyEnabled ? SVG_STICKY : SVG_STICKY_OFF;
  // toggleStickyBtn.title = tabUI.stickyEnabled ? 'Disable Sticky Headers' : 'Enable Sticky Headers';
  // toggleStickyBtn.setAttribute('aria-label', toggleStickyBtn.title);
}

function updateRefreshBtn(autoRescanEnabled: boolean) {
  refreshBtn.style.display = autoRescanEnabled ? 'none' : '';
}

function updateNavigation() {
  // In single-root mode, show the workspace folder name (matching the editor tab title);
  // in multi-root mode, show the generic "WORKSPACE" label since no single name applies.
  const titleText = !tabUI.isMultiRoot && state.workspaceFolderName
    ? state.workspaceFolderName
    : 'WORKSPACE';
  treeHeaderTitle.textContent = titleText;

  treeHeaderBreadcrumb.innerHTML = '';
  // The title acts as the navigation root. The breadcrumb only shows the drill-down
  // path (when dirPath is non-empty) — segments separated by " / ", each clickable
  // to jump to that ancestor level.
  if (!state.dirPath) { return; }

  const segments = state.dirPath.split('/');
  for (let i = 0; i < segments.length; i++) {
    treeHeaderBreadcrumb.appendChild(h('span', { className: 'path-sep', textContent: ' / ' }));
    const segPath = segments.slice(0, i + 1).join('/');
    const isLast = i === segments.length - 1;
    const seg = h('span', {
      className: 'path-segment' + (isLast ? ' current' : ''),
      textContent: segments[i],
    });
    if (!isLast) {
      seg.addEventListener('click', (e: MouseEvent) => {
        e.stopPropagation();
        navigateTo(segPath);
      });
    }
    treeHeaderBreadcrumb.appendChild(seg);
  }
}

// WORKSPACE title click → navigate to the all-roots view (drill back out to the top).
treeHeaderTitle.addEventListener('click', () => navigateTo(''));
treeHeaderTitle.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigateTo(''); }
});

updateToggleIgnoredBtn();
updateTruncationBtn();
updateStickyBtn();
updateRefreshBtn(true);
updateNavigation();

// ── Virtual scroller + sticky overlay ───────────────────────────────────

function renderFlatRow(r: Renderer, row: FlatRow): HTMLElement {
  switch (row.type) {
    case 'dir':
      return r.renderDirRow(row.node, row.depth, row.maxMetric, row.ancestors, row.clientWidth, row.isWorkspaceRoot);
    case 'file':
      return r.renderFileNode(row.file, row.depth, row.ancestors, row.hasMatches, row.maxFileMetric, row.clientWidth);
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
  }
}

let currentFlatRows: FlatRow[] = [];
/** Filtered roots from the last render — used for legend stats that reflect the filtered subset. */
let lastFilteredRoots: DirNode[] | null = null;
/** Per-language stats from search-only filtering (no language filter). Used by legendStats(). */
let lastSearchFilteredStats: Array<{ name: string; color: string; count: number }> = [];

const scroller = createVirtualScroller({
  container: root,
  renderRow: (row) => renderFlatRow(renderer, row),
  overscan: 15,
  treeClass: '',
  onRender: (visibleStart, _visibleEnd) => {
    overlay.update(currentFlatRows, visibleStart);
    // Show shadow under tree header when scrolled, unless sticky overlay has taken over.
    const scrolled = root.scrollTop > 0;
    const hasStuck = overlay.hasStuckRows();
    treeHeaderEl.classList.toggle('scrolled', scrolled && !hasStuck);
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
  vscode.postMessage({ command: 'toggleTruncation', enabled: !tabUI.truncationEnabled });
});
sortBtn.addEventListener('click', () => {
  if (!state.lastRoots) { return; }
  const modes: SortMode[] = tabUI.isLocal ? ['files', 'name', 'size', 'lines'] : ['files', 'name'];
  const next = modes[(modes.indexOf(state.currentSortMode) + 1) % modes.length];
  state.currentSortMode = next;
  sortBtn.title = getSortTitle(next);
  sortBtn.setAttribute('aria-label', sortBtn.title);
  sortBtn.innerHTML = ({ files: SVG_SORT_FILES, name: SVG_SORT_NAME, size: SVG_SORT_SIZE, lines: SVG_SORT_LINES } as Record<SortMode, string>)[next] || SVG_SORT_FILES;
  scroller.setTreeClass(next === 'size' || next === 'lines' ? 'sort-size' : '');
  state.rerender();
});
toggleIgnoredBtn.addEventListener('click', () => {
  vscode.postMessage({ command: 'toggleIgnored', show: !tabUI.showIgnored });
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
  vscode.postMessage({ command: 'toggleStickyHeaders', enabled: !tabUI.stickyEnabled });
});
refreshBtn.addEventListener('click', () => {
  vscode.postMessage({ command: 'refresh' });
});
function toggleLegend() {
  tabUI.legendCollapsed = !tabUI.legendCollapsed;
  legendEl.style.display = tabUI.legendCollapsed ? 'none' : '';
  legendChevron.style.transform = tabUI.legendCollapsed ? 'rotate(0deg)' : 'rotate(90deg)';
  legendHeader.setAttribute('aria-expanded', String(!tabUI.legendCollapsed));
  updateLegendActiveAlert();
}
function toggleSearch() {
  tabUI.searchCollapsed = !tabUI.searchCollapsed;
  searchContentEl.style.display = tabUI.searchCollapsed ? 'none' : '';
  searchChevronEl.style.transform = tabUI.searchCollapsed ? 'rotate(0deg)' : 'rotate(90deg)';
  searchHeaderEl.setAttribute('aria-expanded', String(!tabUI.searchCollapsed));
  updateSearchActiveAlert();
}
legendHeader.addEventListener('click', toggleLegend);
searchHeaderEl.addEventListener('click', toggleSearch);
// Keyboard support: Enter/Space toggles sections
for (const [el, fn] of [[legendHeader, toggleLegend], [searchHeaderEl, toggleSearch]] as const) {
  el.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); }
  });
}
legendDisplayToggle.addEventListener('click', (e: MouseEvent) => {
  e.stopPropagation(); // Don't collapse the legend section when clicking the toggle
  tabUI.legendShowPct = !tabUI.legendShowPct;
  legendDisplayToggle.innerHTML = tabUI.legendShowPct ? SVG_HASH : SVG_PCT;
  legendDisplayToggle.title = tabUI.legendShowPct ? 'Show counts' : 'Show percentages';
  legendDisplayToggle.setAttribute('aria-label', legendDisplayToggle.title);
  updateLegend();
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
  // Re-run the content search so ripgrep's language scope (--type-add) matches
  // the updated filter. Without this, removing a language filter would leave
  // stale results scoped to the old language set.
  if (state.searchResults) { searchBar.triggerSearch(); return; }
  schedulePostFilterStatusUpdate();
  state.rerender();
}

function clearAllFilters() {
  state.activeFilters.clear();
  state.searchResultsVersion++;
  vscode.postMessage({ command: 'filter', langs: [] });
  searchBar.updateFilterWarning(0);
  updateLegendActiveAlert();
  // Re-run the content search so ripgrep drops the language scope.
  if (state.searchResults) { searchBar.triggerSearch(); return; }
  schedulePostFilterStatusUpdate();
  state.rerender();
}

// After a language filter change, the search status counts must be refreshed
// post-render since filterTree recomputes totalVisibleFiles/Matches during render.
function schedulePostFilterStatusUpdate() {
  if (!state.searchResults && !state.fileFilterActive) { return; }
  state.onAfterRender = () => {
    state.onAfterRender = null;
    searchBar.updateFilteredStatus();
  };
}

/** Compute legend stats. When a search/include/exclude filter is active, use
 *  search-only stats (not affected by language filters) so all languages remain
 *  visible with accurate counts. Otherwise use the full unfiltered tree stats. */
function legendStats(): LangStat[] {
  if (!state.lastRoots) { return []; }
  if (lastSearchFilteredStats.length > 0) {
    // Search active — show stats scoped to search results, ignoring language filter.
    const total = lastSearchFilteredStats.reduce((sum, s) => sum + s.count, 0);
    return lastSearchFilteredStats.map(s => ({
      name: s.name,
      color: s.color,
      count: s.count,
      pct: total > 0 ? ((s.count / total) * 100).toFixed(1) : '0',
    }));
  }
  // No search active — use original unfiltered tree stats.
  return computeStats(state.lastRoots);
}

// Base legend stats from the initial unfiltered scan — frozen order for stable layout.
// Updated only when new scan data arrives, not on search/filter changes.
let baseLegendStats: LangStat[] = [];

function updateLegend(stats?: LangStat[]) {
  const s = stats ?? legendStats();
  // Hide legend only when there's no data at all (no scan yet).
  // When baseStats exist, show the legend even if current stats are empty
  // (all items render at 0 via the frozen base order).
  if ((!s || s.length === 0) && baseLegendStats.length === 0) {
    legendSection.style.display = 'none';
    return;
  }
  legendSection.style.display = '';
  legendEl.style.display = tabUI.legendCollapsed ? 'none' : '';
  renderLegend(legendEl, s, state.activeFilters, toggleFilter, tabUI.legendShowPct, baseLegendStats.length > 0 ? baseLegendStats : undefined);
}

// ── Tree ────────────────────────────────────────────────────────────────

// Set to true when new scan data arrives (update message); cleared after the first render
// uses it. Prevents auto-truncation-disable from firing on expand/collapse rerenders.
let initialRender = true;

function render(roots: DirNode[], autoRescanEnabled: boolean, sortMode: SortMode) {
  state.lastRoots = roots;
  state.lastAutoRescanEnabled = autoRescanEnabled;
  state.currentSortMode = sortMode || 'files';

  sortBtn.title = getSortTitle(state.currentSortMode);
  sortBtn.setAttribute('aria-label', sortBtn.title);
  sortBtn.innerHTML = ({ files: SVG_SORT_FILES, name: SVG_SORT_NAME, size: SVG_SORT_SIZE, lines: SVG_SORT_LINES } as Record<SortMode, string>)[state.currentSortMode] || SVG_SORT_FILES;

  // Legend stats are updated after flattenTree (below) so they reflect filtered roots.
  searchBar.updateFilterWarning(state.activeFilters.size);

  root.querySelector('.empty-state')?.remove();

  updateRefreshBtn(autoRescanEnabled);

  if (!roots || roots.length === 0) {
    currentFlatRows = [];
    lastFilteredRoots = null;
    updateLegend([]);
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
  state._isFiltered = isFiltered(state);

  // Auto-disable truncation when the tree fits in the viewport on initial render
  // (new scan data or dir change). Once the user interacts (expand/collapse), truncation
  // follows the normal threshold so expanding a dir doesn't cause others to truncate.
  const savedThreshold = state.truncateThreshold;
  if (initialRender && state.truncateThreshold > 0) {
    // First pass: flatten with truncation to get the truncated height.
    const probe = flattenTree(state, roots, { clientWidth: root.clientWidth || 600 });
    const viewportHeight = root.clientHeight || 0;
    if (viewportHeight > 0 && probe.totalHeight <= viewportHeight) {
      state.truncateThreshold = 0; // fits on screen — disable truncation
    }
    initialRender = false;
  }

  // Build flat rows and update virtual scroller
  const { flatRows, totalHeight, totalVisibleFiles, totalVisibleMatches, filteredRoots, searchFilteredStats } = flattenTree(state, roots, {
    clientWidth: root.clientWidth || 600,
  });

  // Restore threshold for future interactive renders.
  state.truncateThreshold = savedThreshold;
  state.lastFilteredFileCount = totalVisibleFiles;
  state.lastFilteredMatchCount = totalVisibleMatches;
  lastFilteredRoots = filteredRoots;
  lastSearchFilteredStats = searchFilteredStats;
  updateLegend();
  currentFlatRows = flatRows;

  // Check if filtered tree is empty (no matching files/dirs)
  const filteredEmpty = state._isFiltered && flatRows.length === 0;

  scroller.setTreeClass(state.currentSortMode === 'size' || state.currentSortMode === 'lines' ? 'sort-size' : '');
  scroller.update(flatRows, totalHeight);

  // Show/hide "no results" empty state — include scope hint when in a subdirectory tab
  const existingNoResults = root.querySelector(':scope > .empty-state');
  if (filteredEmpty) {
    if (!existingNoResults) {
      const el = emptyState('noResults');
      if (state.dirPath && (state.searchResults || state.fileFilterActive)) {
        const scopePath = (state.workspaceFolderName ? state.workspaceFolderName + ' / ' : '') + state.dirPath.split('/').join(' / ');
        const textEl = el.querySelector('.empty-state-text')!;
        textEl.textContent = 'No results found. Searches are currently scoped to:';
        textEl.appendChild(h('br'));
        textEl.appendChild(h('span', { textContent: scopePath }));
      }
      root.appendChild(el);
    }
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
    initialRender = true;
    // Freeze the base legend stats from fresh scan data for stable layout ordering.
    if (message.roots && message.roots.length > 0) {
      baseLegendStats = computeStats(message.roots as DirNode[]);
    }
    tabUI.showIgnored = message.showIgnored || false;
    if (typeof message.isLocal === 'boolean') { tabUI.isLocal = message.isLocal; }
    updateToggleIgnoredBtn();
    if (typeof message.dirPath === 'string') {
      const dirChanged = state.dirPath !== message.dirPath;
      state.dirPath = message.dirPath;
      searchBar.setScopeWarning(message.dirPath);
      // Record in navigation history unless this update was triggered by back/forward.
      if (dirChanged && !navigatingViaHistory) {
        // External navigation (e.g. open-in-tab button from sidebar) — add to history.
        if (navHistory[navIndex] !== message.dirPath) {
          if (navIndex < navHistory.length - 1) { navHistory.length = navIndex + 1; }
          navHistory.push(message.dirPath);
          navIndex = navHistory.length - 1;
        }
      }
      navigatingViaHistory = false;
      // Re-run the search against the new root when the directory scope changes.
      if (dirChanged && state.searchResults) { searchBar.triggerSearch(); }
    }
    if (typeof message.workspaceFolderName === 'string') { state.workspaceFolderName = message.workspaceFolderName; }
    if (typeof message.isMultiRoot === 'boolean') { tabUI.isMultiRoot = message.isMultiRoot; }
    updateNavigation();
    if (typeof message.stickyHeadersEnabled === 'boolean') {
      tabUI.stickyEnabled = message.stickyHeadersEnabled;
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
    tabUI.stickyEnabled = message.enabled;
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
      tabUI.truncationEnabled = message.truncationEnabled;
      updateTruncationBtn();
    }
    if (state.lastRoots) { state.rerender(); }
    return;
  }
  sharedHandler(event);
});

// Skeleton is pre-rendered in the HTML for instant paint; just show the progress bar.
scanBar.show(true);
